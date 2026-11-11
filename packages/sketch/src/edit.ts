import {
  SketchIndex,
  constraintRefs,
  curvePoints,
  ellipseAngle,
  ellipseGeo,
  ellipsePoint,
  newId,
  removeEntities,
  toSketch,
  type Arc,
  type Curve,
  type EllipseGeo,
  type Entity,
  type Frame,
  type Id,
  type Line,
  type ProjectedRef,
  type Spline,
  type Sketch,
  type TopoRef,
  type Vec2,
  type Vec3,
} from "./model";
import { circleSide, curveEllipse, ellipseSide, lineEllipse } from "./ellipse";
import { curveSplineParams, lineSide, sampleSpline, splineGeo, splineParam, splinePoint, splineSpline, type SplineGeo } from "./spline";
import {
  add,
  angleOf,
  circleCircle,
  circleFrom3,
  dist,
  dot,
  filletCorner,
  lineCircle,
  lineLine,
  norm,
  onArc,
  perp,
  polar,
  polygonArea,
  scale,
  sub,
  sweep,
  wrap,
} from "./geom2d";
import { Draft } from "./draw";

/**
 * The editing tools (#54) as pure functions on a sketch: round a corner, trim a piece between crossings, offset a
 * chain. Each returns the new sketch, or a sentence saying why it can't, for the tool's hint.
 */
export type EditResult = Sketch | string;

/** Drops points nothing uses any more, with the constraints and sizes on them. */
function prune(s: Sketch, candidates: Id[]): Sketch {
  const used = new Set(s.entities.flatMap((e) => (e.kind === "point" ? [] : curvePoints(e))));
  const gone = new Set(candidates.filter((p) => !used.has(p)));
  if (!gone.size) return s;
  return {
    ...s,
    entities: s.entities.filter((e) => !gone.has(e.id)),
    constraints: s.constraints.filter((c) => !constraintRefs(c).some((r) => gone.has(r))),
    dimensions: s.dimensions.filter((d) => !d.refs.some((r) => gone.has(r))),
  };
}

/** Points tied to `p` by coincident constraints, and `p`. */
export function samePoint(s: Sketch, p: Id): Set<Id> {
  const out = new Set([p]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of s.constraints) {
      if (c.type !== "coincident" || c.suppressed) continue;
      if (out.has(c.a) !== out.has(c.b)) {
        out.add(c.a);
        out.add(c.b);
        grew = true;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ fillet corner

/** Rounds the corner where two lines meet at `point` with a tangent arc of radius `r`. */
export function filletAt(sketch: Sketch, point: Id, r: number): EditResult {
  if (!(r > 0)) return "Type a radius above 0";
  const at = samePoint(sketch, point);
  const lines = sketch.entities.filter((e): e is Line => e.kind === "line" && (at.has(e.a) || at.has(e.b)));
  if (lines.length !== 2) return "Pick a corner where two lines meet";
  const idx = new SketchIndex(sketch);
  const [l1, l2] = lines as [Line, Line];
  const end1: "a" | "b" = at.has(l1.a) ? "a" : "b";
  const end2: "a" | "b" = at.has(l2.a) ? "a" : "b";
  const corner = idx.xy(l1[end1]);
  const far1 = idx.xy(l1[end1 === "a" ? "b" : "a"]);
  const far2 = idx.xy(l2[end2 === "a" ? "b" : "a"]);
  const f = filletCorner(corner, far1, far2, r);
  if (!f) return `A ${r} mm round doesn't fit this corner`;

  const d = new Draft(sketch);
  const t1 = d.point(f.ta);
  const t2 = d.point(f.tb);
  d.entities = d.entities.map((e) => (e.id === l1.id ? { ...l1, [end1]: t1 } : e.id === l2.id ? { ...l2, [end2]: t2 } : e));
  const arc = d.arc(f.c, f.ccw ? t1 : t2, f.ccw ? t2 : t1);
  d.constrain({ type: "tangent", a: arc, b: l1.id });
  d.constrain({ type: "tangent", a: arc, b: l2.id });
  d.dimension("radius", [arc], r);
  let out = d.done().sketch;
  // The corner and anything tied to it go; the lines keep their other constraints.
  out = {
    ...out,
    constraints: out.constraints.filter((c) => !constraintRefs(c).some((x) => at.has(x))),
    dimensions: out.dimensions.filter((x) => !x.refs.some((y) => at.has(y))),
  };
  return prune(out, [...at]);
}

/** Rounds the corner two lines share. */
export function filletLines(sketch: Sketch, a: Id, b: Id, r: number): EditResult {
  const idx = new SketchIndex(sketch);
  const l1 = idx.get(a);
  const l2 = idx.get(b);
  if (l1?.kind !== "line" || l2?.kind !== "line") return "Pick two lines, or the corner between them";
  for (const p of [l1.a, l1.b]) {
    const at = samePoint(sketch, p);
    if (at.has(l2.a) || at.has(l2.b)) return filletAt(sketch, p, r);
  }
  return "Those lines don't meet at a corner";
}

// ------------------------------------------------------------------ trim

/** A curve's shape for cutting: a line from a to b, or a circle or arc about c (arcs from angle s through sweep w). */
export type Shape =
  | { kind: "line"; a: Vec2; b: Vec2 }
  | { kind: "circle"; c: Vec2; r: number }
  | { kind: "arc"; c: Vec2; r: number; s: number; w: number }
  | { kind: "ellipse"; g: EllipseGeo }
  | { kind: "spline"; g: SplineGeo };

export function shapeOf(idx: SketchIndex, e: Curve): Shape {
  if (e.kind === "line") return { kind: "line", a: idx.xy(e.a), b: idx.xy(e.b) };
  if (e.kind === "ellipse") return { kind: "ellipse", g: ellipseGeo(idx, e) };
  if (e.kind === "spline") return { kind: "spline", g: splineGeo(idx, e) };
  const c = idx.xy(e.c);
  if (e.kind === "circle") return { kind: "circle", c, r: e.r };
  const s = angleOf(sub(idx.xy(e.a), c));
  return { kind: "arc", c, r: e.r, s, w: sweep(s, angleOf(sub(idx.xy(e.b), c))) };
}

/** Where along a shape a point is: 0..1 along a line, radians from the start on an arc or circle. */
export function param(sh: Shape, p: Vec2): number {
  if (sh.kind === "line") {
    const d = sub(sh.b, sh.a);
    return ((p[0] - sh.a[0]) * d[0] + (p[1] - sh.a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2);
  }
  if (sh.kind === "ellipse") return ellipseAngle(sh.g, p);
  if (sh.kind === "spline") return splineParam(sh.g, p).t;
  const ang = angleOf(sub(p, sh.c));
  return sh.kind === "circle" ? wrap(ang) : wrap(ang - sh.s);
}

function pointAt(sh: Shape, t: number): Vec2 {
  if (sh.kind === "line") return add(sh.a, scale(sub(sh.b, sh.a), t));
  if (sh.kind === "ellipse") return ellipsePoint(sh.g, t);
  if (sh.kind === "spline") return splinePoint(sh.g, t);
  return polar(sh.c, sh.r, sh.kind === "circle" ? t : sh.s + t);
}

function contains(sh: Shape, p: Vec2): boolean {
  if (sh.kind === "line") {
    const t = param(sh, p);
    return t >= -1e-9 && t <= 1 + 1e-9;
  }
  if (sh.kind === "circle" || sh.kind === "ellipse" || sh.kind === "spline") return true;
  return onArc(angleOf(sub(p, sh.c)), sh.s, sh.s + sh.w);
}

/** Where two shapes cross. */
export function crossings(a: Shape, b: Shape): Vec2[] {
  let pts: Vec2[];
  if (a.kind === "spline" || b.kind === "spline") {
    const [sp, o] = (a.kind === "spline" ? [a, b] : [b, a]) as [Extract<Shape, { kind: "spline" }>, Shape];
    if (o.kind === "spline") pts = splineSpline(sp.g, o.g);
    else {
      const side =
        o.kind === "line"
          ? lineSide(o.a, o.b)
          : o.kind === "ellipse"
            ? ellipseSide(o.g)
            : (p: Vec2) => Math.hypot(p[0] - (o as { c: Vec2 }).c[0], p[1] - (o as { c: Vec2 }).c[1]) - (o as { r: number }).r;
      pts = curveSplineParams(side, sp.g).map((t) => splinePoint(sp.g, t));
    }
  } else if (a.kind === "ellipse" || b.kind === "ellipse") {
    const [el, o] = (a.kind === "ellipse" ? [a, b] : [b, a]) as [Extract<Shape, { kind: "ellipse" }>, Shape];
    pts =
      o.kind === "line"
        ? lineEllipse(o.a, o.b, el.g)
        : curveEllipse(o.kind === "ellipse" ? ellipseSide(o.g) : circleSide((o as { c: Vec2 }).c, (o as { r: number }).r), el.g);
  } else if (a.kind === "line" && b.kind === "line") {
    const x = lineLine(a.a, a.b, b.a, b.b);
    pts = x ? [x.p] : [];
  } else if (a.kind === "line") pts = lineCircle(a.a, a.b, (b as { c: Vec2 }).c, (b as { r: number }).r).map((x) => x.p);
  else if (b.kind === "line") pts = lineCircle(b.a, b.b, a.c, a.r).map((x) => x.p);
  else pts = circleCircle(a.c, a.r, b.c, b.r);
  return pts.filter((p) => contains(a, p) && contains(b, p));
}

/** The points along a curve where others cross or touch it, as sorted parameters inside its ends. */
export function cutsOn(sketch: Sketch, id: Id): number[] {
  const idx = new SketchIndex(sketch);
  const e = idx.get(id);
  if (!e || e.kind === "point") return [];
  const sh = shapeOf(idx, e);
  const span = sh.kind === "line" ? 1 : sh.kind === "arc" ? sh.w : sh.kind === "spline" ? sh.g.bez.length : 2 * Math.PI;
  const eps = 1e-6;
  const ts: number[] = [];
  for (const o of sketch.entities) {
    if (o.id === id || o.kind === "point") continue;
    for (const p of crossings(sh, shapeOf(idx, o))) {
      const t = param(sh, p);
      const inside = sh.kind === "circle" || sh.kind === "ellipse" || (sh.kind === "spline" && sh.g.closed) ? true : t > eps && t < span - eps;
      if (inside && !ts.some((x) => Math.abs(x - t) < 1e-6)) ts.push(t);
    }
  }
  return ts.sort((x, y) => x - y);
}

/** Every point where two curves cross, with the two curves (for the snap to intersections, #55). */
export function allCrossings(sketch: Sketch, skip: Set<Id> = new Set()): { xy: Vec2; a: Id; b: Id }[] {
  const idx = new SketchIndex(sketch);
  const curves = sketch.entities.filter((e): e is Curve => e.kind !== "point" && !skip.has(e.id) && !curvePoints(e).some((p) => skip.has(p)));
  const shapes = curves.map((c) => shapeOf(idx, c));
  const out: { xy: Vec2; a: Id; b: Id }[] = [];
  for (let i = 0; i < curves.length; i++)
    for (let j = i + 1; j < curves.length; j++) for (const xy of crossings(shapes[i]!, shapes[j]!)) out.push({ xy, a: curves[i]!.id, b: curves[j]!.id });
  return out;
}

/** The piece of a curve between the crossings either side of `at`: its parameter range, for the hover highlight. */
export function trimPiece(sketch: Sketch, id: Id, at: Vec2): { from: number; to: number; pts: Vec2[] } | null {
  const idx = new SketchIndex(sketch);
  const e = idx.get(id);
  if (!e || e.kind === "point") return null;
  const sh = shapeOf(idx, e);
  const cuts = cutsOn(sketch, id);
  const t = param(sh, at);
  let from: number;
  let to: number;
  if (sh.kind === "circle" || sh.kind === "ellipse" || (sh.kind === "spline" && sh.g.closed)) {
    const period = sh.kind === "spline" ? sh.g.bez.length : 2 * Math.PI;
    if (cuts.length < 2 || sh.kind === "ellipse") return { from: 0, to: period, pts: samples(sh, 0, period) };
    const after = cuts.find((x) => x > t);
    to = after ?? cuts[0]! + period;
    from = [...cuts].reverse().find((x) => x <= t) ?? cuts[cuts.length - 1]! - period;
  } else {
    const span = sh.kind === "line" ? 1 : sh.kind === "spline" ? sh.g.bez.length : sh.w;
    const all = [0, ...cuts, span];
    const tc = Math.max(0, Math.min(span, t));
    const i = Math.max(0, all.findIndex((x) => x > tc) - 1);
    from = all[i]!;
    to = all[Math.min(i + 1, all.length - 1)]!;
  }
  return { from, to, pts: samples(sh, from, to) };
}

export function samples(sh: Shape, from: number, to: number): Vec2[] {
  if (sh.kind === "line") return [pointAt(sh, from), pointAt(sh, to)];
  if (sh.kind === "spline") return sampleSpline(sh.g, from, to);
  const n = Math.max(4, Math.ceil((to - from) / (Math.PI / 36)));
  return Array.from({ length: n + 1 }, (_, i) => pointAt(sh, from + ((to - from) * i) / n));
}

/**
 * Removes the piece of a curve between the crossings either side of `at`. A curve nothing crosses goes whole; a line
 * or arc cut in the middle becomes two, keeping its constraints on the first part (and its direction on both).
 */
export function trimAt(sketch: Sketch, id: Id, at: Vec2): EditResult {
  const idx = new SketchIndex(sketch);
  const e = idx.get(id);
  if (!e || e.kind === "point") return "Hover a line, circle or arc";
  // An ellipse goes whole, with its axes: there are no ellipse arcs to keep the rest as.
  if (e.kind === "ellipse") return removeEntities(sketch, [id]);
  const sh = shapeOf(idx, e);
  const piece = trimPiece(sketch, id, at)!;
  const cuts = cutsOn(sketch, id);
  const removeWhole = () => {
    const pts = curvePoints(e);
    const out = {
      ...sketch,
      entities: sketch.entities.filter((x) => x.id !== id),
      constraints: sketch.constraints.filter((c) => !constraintRefs(c).includes(id)),
      dimensions: sketch.dimensions.filter((d) => !d.refs.includes(id)),
    };
    return prune(out, pts);
  };
  if (!cuts.length || (sh.kind === "circle" && cuts.length < 2)) return removeWhole();

  const d = new Draft(sketch);
  // A shortened line's length no longer holds; an arc's radius does.
  const dropLength = () => {
    d.dimensions = d.dimensions.filter((dm) => !(dm.refs.includes(id) && dm.kind === "length"));
  };

  if (sh.kind === "circle") {
    // What is left runs anticlockwise from the end of the piece back round to its start.
    const a = d.point(pointAt(sh, piece.to));
    const b = d.point(pointAt(sh, piece.from));
    const c = e as Extract<Entity, { kind: "circle" }>;
    d.entities = d.entities.map((x) => (x.id === id ? ({ id, kind: "arc", c: c.c, a, b, r: c.r, ...(c.construction && { construction: true }) } as Arc) : x));
    return d.done().sketch;
  }

  if (sh.kind === "ellipse") return "Trim takes an ellipse whole";
  if (sh.kind === "spline") return trimSpline(sketch, e as Spline, sh.g, piece.from, piece.to);
  const span = sh.kind === "line" ? 1 : sh.w;
  const atStart = piece.from <= 1e-9;
  const atEnd = piece.to >= span - 1e-9;
  const old = e as Line | Arc;
  if (atStart || atEnd) {
    const p = d.point(pointAt(sh, atStart ? piece.to : piece.from));
    const end = atStart ? "a" : "b";
    const gone = old[end];
    d.entities = d.entities.map((x) => (x.id === id ? { ...old, [end]: p } : x));
    d.constraints = d.constraints.filter((c) => !(constraintRefs(c).includes(gone) && constraintRefs(c).includes(id)));
    dropLength();
    return prune(d.done().sketch, [gone]);
  }
  // Cut out of the middle: the curve keeps its start, a new one takes the rest.
  const p1 = d.point(pointAt(sh, piece.from));
  const p2 = d.point(pointAt(sh, piece.to));
  d.entities = d.entities.map((x) => (x.id === id ? { ...old, b: p1 } : x));
  const twin = newId(old.kind === "line" ? "l" : "a");
  d.entities.push({ ...old, id: twin, a: p2 });
  for (const c of sketch.constraints) {
    if ((c.type === "horizontal" || c.type === "vertical") && c.e === id) d.constrain({ type: c.type, e: twin });
    if ((c.type === "parallel" || c.type === "perpendicular") && (c.a === id || c.b === id)) d.constrain({ type: c.type, a: twin, b: c.a === id ? c.b : c.a });
  }
  if (old.kind === "line") d.constrain({ type: "parallel", a: id, b: twin });
  dropLength();
  return d.done().sketch;
}

/**
 * Trims a piece of a spline (#269): what is left keeps the fit points outside the piece, with a new one where it was
 * cut, so it bends much as before. A closed spline opens at the piece.
 */
function trimSpline(sketch: Sketch, e: Spline, g: SplineGeo, from: number, to: number): EditResult {
  const n = g.bez.length;
  const d = new Draft(sketch);
  const keep = (pts: Id[], ends: [Vec2 | Id, Vec2 | Id]) => {
    const ids = [typeof ends[0] === "string" ? ends[0] : d.point(ends[0]), ...pts, typeof ends[1] === "string" ? ends[1] : d.point(ends[1])];
    return ids.filter((p, i) => i === 0 || p !== ids[i - 1]);
  };
  // Fit point i sits at parameter i.
  const between = (a: number, b: number) => e.pts.filter((_, i) => i > a + 1e-9 && i < b - 1e-9);
  const parts: Id[][] = [];
  if (e.closed) {
    // Open it at the piece: from the piece's end round to its start.
    const ring = [...e.pts, ...e.pts].map((p, i) => [p, i] as const).filter(([, i]) => i > to + 1e-9 && i < from + n - 1e-9);
    parts.push(
      keep(
        ring.map(([p]) => p),
        [splinePoint(g, to % n), splinePoint(g, ((from % n) + n) % n)],
      ),
    );
  } else {
    if (from > 1e-9) parts.push(keep(between(0, from), [e.pts[0]!, splinePoint(g, from)]));
    if (to < n - 1e-9) parts.push(keep(between(to, n), [splinePoint(g, to), e.pts[e.pts.length - 1]!]));
  }
  d.entities = d.entities.filter((x) => x.id !== e.id);
  d.constraints = d.constraints.filter((c) => !constraintRefs(c).includes(e.id));
  for (const pts of parts.filter((p) => p.length >= 2)) {
    const id = newId("b");
    d.entities.push({ id, kind: "spline", pts, ...(e.construction && { construction: true }) });
  }
  return prune(d.done().sketch, e.pts);
}

// ------------------------------------------------------------------ offset

interface Step {
  e: Line | Arc;
  /** Walked from b to a. */
  rev: boolean;
}

/** The lines and arcs joined end to end with `id`, in order, and whether they close. */
export function chainOf(sketch: Sketch, id: Id): { steps: Step[]; closed: boolean } | null {
  const idx = new SketchIndex(sketch);
  const first = idx.get(id);
  if (first?.kind !== "line" && first?.kind !== "arc") return null;
  const curves = sketch.entities.filter((e): e is Line | Arc => (e.kind === "line" || e.kind === "arc") && e.construction === first.construction);
  const touching = (p: Id, not: Id) => {
    const same = samePoint(sketch, p);
    const found = curves.filter((c) => c.id !== not && (same.has(c.a) || same.has(c.b)));
    return found.length === 1 ? found[0]! : null;
  };
  const steps: Step[] = [{ e: first, rev: false }];
  const used = new Set([first.id]);
  let closed = false;
  // Forward from the end, then backward from the start.
  for (let tail = first.b, prev = first.id; ;) {
    const n = touching(tail, prev);
    if (!n) break;
    if (n.id === first.id || used.has(n.id)) {
      closed = n.id === steps[0]!.e.id;
      break;
    }
    const rev = !samePoint(sketch, tail).has(n.a);
    steps.push({ e: n, rev });
    used.add(n.id);
    tail = rev ? n.a : n.b;
    prev = n.id;
  }
  if (!closed) {
    for (let head = first.a, prev = first.id; ;) {
      const n = touching(head, prev);
      if (!n || used.has(n.id)) break;
      const rev = samePoint(sketch, head).has(n.a);
      steps.unshift({ e: n, rev });
      used.add(n.id);
      head = rev ? n.b : n.a;
      prev = n.id;
    }
  }
  return { steps, closed };
}

/** Which way is "out" of a closed chain: +1 when its left side is outside (it runs clockwise). */
function chainTurn(idx: SketchIndex, steps: Step[]): number {
  const pts = steps.map((s) => idx.xy(s.rev ? s.e.b : s.e.a));
  return polygonArea(pts) > 0 ? -1 : 1;
}

/**
 * A parallel copy of the chain through `id` at distance `d`: positive is outside a closed shape (or to the left of an
 * open chain as drawn), negative inside. Lines stay parallel to their originals, held at the distance by a size; arcs
 * stay concentric. Circles copy as concentric circles.
 */
export function offsetChain(sketch: Sketch, id: Id, d: number): EditResult {
  if (!d) return "Type a distance";
  const idx = new SketchIndex(sketch);
  const e = idx.get(id);
  if (e?.kind === "circle") {
    const r = e.r + d;
    if (r <= 1e-9) return "That's further in than the circle is big";
    const dr = new Draft(sketch);
    // Sharing the centre point keeps the copy concentric.
    dr.dimension("radius", [dr.circle(e.c, r, e.construction)], r);
    return dr.done().sketch;
  }
  const chain = chainOf(sketch, id);
  if (!chain) return "Pick a line, arc or circle";
  const { steps, closed } = chain;
  const side = (closed ? chainTurn(idx, steps) : 1) * d;
  // Each step offset to its left by `side`, as an oriented shape.
  const moved = steps.map((s) => {
    const a = idx.xy(s.rev ? s.e.b : s.e.a);
    const b = idx.xy(s.rev ? s.e.a : s.e.b);
    if (s.e.kind === "line") {
      const n = scale(perp(norm(sub(b, a))), side);
      return { kind: "line" as const, a: add(a, n), b: add(b, n) };
    }
    const c = idx.xy(s.e.c);
    // Walking an arc anticlockwise its left is the centre; walked backwards, the outside.
    const r = s.e.r + (s.rev ? side : -side);
    if (r <= 1e-9) return null;
    const start = polar(c, r, angleOf(sub(a, c)));
    const end = polar(c, r, angleOf(sub(b, c)));
    return { kind: "arc" as const, c, r, a: start, b: end, rev: s.rev };
  });
  if (moved.some((m) => !m)) return "That distance is bigger than an arc in the chain";
  const ms = moved as NonNullable<(typeof moved)[number]>[];
  // Corners: where neighbouring offset curves meet (nearest to their naive ends).
  const corner = (i: number, j: number): Vec2 => {
    const p = ms[i]!;
    const q = ms[j]!;
    const guess = p.b;
    let opts: Vec2[] = [];
    if (p.kind === "line" && q.kind === "line") {
      const x = lineLine(p.a, p.b, q.a, q.b);
      opts = x ? [x.p] : [];
    } else if (p.kind === "line" && q.kind === "arc") opts = lineCircle(p.a, p.b, q.c, q.r).map((x) => x.p);
    else if (p.kind === "arc" && q.kind === "line") opts = lineCircle(q.a, q.b, p.c, p.r).map((x) => x.p);
    else if (p.kind === "arc" && q.kind === "arc") opts = circleCircle(p.c, p.r, q.c, q.r);
    if (!opts.length) return guess;
    return opts.reduce((best, o) => (dist(o, guess) < dist(best, guess) ? o : best));
  };
  const n = ms.length;
  const corners: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    if (i + 1 < n) corners.push(corner(i, i + 1));
    else if (closed) corners.push(corner(i, 0));
  }
  const dr = new Draft(sketch);
  const startPt = closed ? null : dr.point(ms[0]!.a);
  const cornerPts = corners.map((p) => dr.point(p));
  const pointBefore = (i: number) => (i === 0 ? (closed ? cornerPts[n - 1]! : startPt!) : cornerPts[i - 1]!);
  const pointAfter = (i: number) => (i === n - 1 && !closed ? dr.point(ms[n - 1]!.b) : cornerPts[i]!);
  // A corner that crossed over (offset too far in) would flip a line: refuse it.
  for (let i = 0; i < n; i++) {
    const m = ms[i]!;
    const from = dr.xy(pointBefore(i));
    const to = i === n - 1 && !closed ? m.b : corners[i]!;
    if (m.kind === "line" && dot(sub(to, from), sub(m.b, m.a)) <= 1e-9) {
      return "That distance is too far for this shape";
    }
  }
  for (let i = 0; i < n; i++) {
    const s = steps[i]!;
    const m = ms[i]!;
    const p = pointBefore(i);
    const q = pointAfter(i);
    if (m.kind === "line") {
      const l = dr.line(p, q, { auto: false });
      dr.constrain({ type: "parallel", a: l, b: s.e.id });
      dr.dimension("distance", [p, s.e.id], Math.abs(d));
    } else {
      const c = (s.e as Arc).c;
      dr.arc(c, m.rev ? q : p, m.rev ? p : q);
    }
  }
  return dr.done().sketch;
}

// ------------------------------------------------------------------ project

/**
 * Brings a body's edges into the sketch (#54): world-space segments flattened onto the sketch plane as fixed lines,
 * construction by default, joined where their ends meet. Segments that flatten to a point (edges along the normal) are
 * skipped. Each line remembers the face it came from, so a rebuild can project it again.
 */
export function projectSegments(sketch: Sketch, frame: Frame, segments: [Vec3, Vec3][], from: TopoRef, construction = true): EditResult {
  const d = new Draft(sketch);
  const ids = new Map<string, Id>();
  const key = (p: Vec2) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const point = (p: Vec2) => {
    const k = key(p);
    let id = ids.get(k);
    if (!id) {
      id = d.point(p, construction);
      d.entities = d.entities.map((e) => (e.id === id ? { ...e, projectedFrom: from } : e));
      d.constrain({ type: "fix", p: id });
      ids.set(k, id);
    }
    return id;
  };
  let added = 0;
  for (const [a3, b3] of segments) {
    const a = toSketch(frame, a3);
    const b = toSketch(frame, b3);
    if (dist(a, b) < 1e-6) continue;
    const l = d.line(point(a), point(b), { construction, auto: false });
    d.entities = d.entities.map((e) => (e.id === l ? { ...e, projectedFrom: from } : e));
    added++;
  }
  if (!added) return "That face is edge-on to the sketch, so nothing projects";
  return d.done().sketch;
}

/**
 * A model edge flattened onto the sketch plane: a point (an edge square to the plane, or a vertex), a line, a circle,
 * an arc (anticlockwise from a to b) or, for any other shape, a chain of lines.
 */
export type FlatCurve =
  | { kind: "point"; p: Vec2 }
  | { kind: "line"; a: Vec2; b: Vec2 }
  | { kind: "circle"; c: Vec2; r: number }
  | { kind: "arc"; c: Vec2; r: number; a: Vec2; b: Vec2 }
  | { kind: "polyline"; pts: Vec2[] };

/** How far, in mm, a flattened point may stray and still count as on a line or circle. */
const FLAT_TOL = 1e-3;

/** Flattens an edge's points (in order along it, world mm) onto the sketch plane and names its shape. */
export function flattenCurve(frame: Frame, points: Vec3[]): FlatCurve {
  const raw = points.map((p) => toSketch(frame, p));
  // Repeated points (an edge square to the plane flattens to one spot) collapse.
  const pts: Vec2[] = [];
  for (const p of raw) if (!pts.length || dist(p, pts[pts.length - 1]!) > 1e-6) pts.push(p);
  if (pts.length >= 2 && dist(pts[0]!, pts[pts.length - 1]!) <= 1e-6 && pts.length === 2) pts.pop();
  if (pts.length === 1 || pts.every((p) => dist(p, pts[0]!) <= 1e-6)) return { kind: "point", p: pts[0] ?? [0, 0] };
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const closed = pts.length >= 4 && dist(first, last) <= FLAT_TOL;
  if (!closed) {
    const u = sub(last, first);
    const len = Math.hypot(u[0], u[1]);
    const off = (p: Vec2) => Math.abs(u[0] * (p[1] - first[1]) - u[1] * (p[0] - first[0])) / len;
    // A line runs one way: its points stay on the chord and in order along it.
    if (len > 1e-6 && pts.every((p) => off(p) <= FLAT_TOL)) {
      const along = pts.map((p) => dot(sub(p, first), u) / len);
      if (along.every((t, i) => i === 0 || t >= along[i - 1]! - FLAT_TOL)) return { kind: "line", a: first, b: last };
    }
  }
  const ring = closed ? pts.slice(0, -1) : pts;
  if (ring.length >= 3) {
    const n = ring.length;
    const c3 = closed ? circleFrom3(ring[0]!, ring[Math.floor(n / 3)]!, ring[Math.floor((2 * n) / 3)]!) : circleFrom3(first, ring[Math.floor(n / 2)]!, last);
    if (c3 && ring.every((p) => Math.abs(dist(p, c3.c) - c3.r) <= FLAT_TOL + 1e-4 * c3.r)) {
      if (closed) return { kind: "circle", c: c3.c, r: c3.r };
      // Which way it turns: the sum of the small steps in angle round the centre.
      let turn = 0;
      for (let i = 1; i < n; i++) turn += wrapPi(angleOf(sub(ring[i]!, c3.c)) - angleOf(sub(ring[i - 1]!, c3.c)));
      return turn >= 0 ? { kind: "arc", c: c3.c, r: c3.r, a: first, b: last } : { kind: "arc", c: c3.c, r: c3.r, a: last, b: first };
    }
  }
  return { kind: "polyline", pts };
}

const wrapPi = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

/** One model edge (or vertex, a single point) to bring into a sketch, and where it came from. */
export interface ModelCurve {
  points: Vec3[];
  from: ProjectedRef;
}

/** Points closer than this, in mm, are one point when projecting. */
const SAME_POINT = 1e-4;

/**
 * Brings model edges and vertices into the sketch (#54), as Fusion projects them: each flattened onto the plane and
 * named by its shape, so a hole comes in as a circle and a rounded corner as an arc. Everything is held in place
 * (fixed points; a projected circle keeps its radius), construction by default, and remembers what it came from.
 * Geometry already projected there is reused, not doubled. `ids` holds, per input, the entity it became (a polyline
 * gives its first line), or null when it adds nothing.
 */
export function projectCurves(sketch: Sketch, frame: Frame, curves: ModelCurve[], construction = true): { sketch: Sketch; ids: (Id | null)[] } {
  const d = new Draft(sketch);
  const projected = (e: Entity) => !!e.projectedFrom;
  // Points already projected are shared, so an edge meets the face outline it came with.
  const pts: { id: Id; xy: Vec2 }[] = sketch.entities.flatMap((e) => (e.kind === "point" && projected(e) ? [{ id: e.id, xy: [e.x, e.y] as Vec2 }] : []));
  const tag = (id: Id, from: ProjectedRef) => {
    d.entities = d.entities.map((e) => (e.id === id ? { ...e, projectedFrom: from } : e));
    return id;
  };
  const point = (xy: Vec2, from: ProjectedRef): Id => {
    const near = pts.find((p) => dist(p.xy, xy) <= SAME_POINT);
    if (near) return near.id;
    const id = tag(d.point(xy, construction), from);
    d.constrain({ type: "fix", p: id });
    pts.push({ id, xy });
    return id;
  };
  const existing = (match: (e: Entity) => boolean): Id | null => d.entities.find((e) => projected(e) && match(e))?.id ?? null;
  const ids: (Id | null)[] = [];
  for (const { points, from } of curves) {
    const f = flattenCurve(frame, points);
    if (f.kind === "point") {
      ids.push(point(f.p, from));
      continue;
    }
    if (f.kind === "line" || f.kind === "polyline") {
      const chain = f.kind === "line" ? [f.a, f.b] : f.pts;
      let firstId: Id | null = null;
      for (let i = 0; i + 1 < chain.length; i++) {
        const a = point(chain[i]!, from);
        const b = point(chain[i + 1]!, from);
        if (a === b) continue;
        const l =
          existing((e) => e.kind === "line" && ((e.a === a && e.b === b) || (e.a === b && e.b === a))) ??
          tag(d.line(a, b, { construction, auto: false }), from);
        firstId ??= l;
      }
      ids.push(firstId);
      continue;
    }
    const c = point(f.c, from);
    if (f.kind === "circle") {
      ids.push(existing((e) => e.kind === "circle" && e.c === c && Math.abs(e.r - f.r) <= SAME_POINT) ?? tag(d.circle(c, f.r, construction), from));
      continue;
    }
    const a = point(f.a, from);
    const b = point(f.b, from);
    ids.push(existing((e) => e.kind === "arc" && e.c === c && e.a === a && e.b === b) ?? tag(d.arc(c, a, b, construction), from));
  }
  return { sketch: d.done().sketch, ids };
}
