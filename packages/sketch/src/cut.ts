import {
  SketchIndex,
  constraintRefs,
  curvePoints,
  newId,
  removeEntities,
  type Arc,
  type Entity,
  type Id,
  type Line,
  type Spline,
  type Sketch,
  type Vec2,
} from "./model";
import { splinePoint, type SplineGeo } from "./spline";
import { add, angleOf, circleCircle, dist, dot, filletCorner, lineCircle, lineLine, norm, perp, polar, polygonArea, scale, sub } from "./geom2d";
import { Draft } from "./draw";

import { crossings, param, pointAt, samples, shapeOf, type EditResult } from "./edit";

/**
 * Round a corner, trim a piece between crossings, offset a chain (#54): the editing tools the sketch loads with the
 * tool, so they stay out of the first page load. Each returns the new sketch, or a sentence saying why it can't.
 */
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
export function offsetChain(sketch: Sketch, id: Id, d: number, group: Id = newId("o")): EditResult {
  if (!d) return "Type a distance";
  const idx = new SketchIndex(sketch);
  const e = idx.get(id);
  if (e?.kind === "circle") {
    const r = e.r + d;
    if (r <= 1e-9) return "That's further in than the circle is big";
    const dr = new Draft(sketch);
    // Sharing the centre point keeps the copy concentric. A level construction spoke from the centre to the copy
    // crosses the original, and the gap along it holds the distance, so the copy follows when the original is resized.
    const c = idx.xy(e.c);
    const copy = dr.circle(e.c, r, e.construction);
    const rim = dr.point(add(c, [r, 0]), true);
    dr.constrain({ type: "pointOn", p: rim, e: copy });
    const spoke = dr.line(e.c, rim, { construction: true, auto: false });
    dr.constrain({ type: "horizontal", e: spoke });
    const on = dr.point(add(c, [e.r, 0]), true);
    dr.constrain({ type: "pointOn", p: on, e: e.id });
    dr.constrain({ type: "pointOn", p: on, e: spoke });
    dr.dimension("distance", [on, rim], Math.abs(d), { group });
    return dr.done().sketch;
  }
  if (e?.kind === "spline" || e?.kind === "ellipse") return "Offset takes lines, arcs and circles for now";
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
  // Where the original runs smoothly from one curve into the next (a slot's sides into its ends), so does the copy.
  // A tangent there already turns the copied line, so it isn't held parallel as well (that would say it twice).
  const smooth = (i: number, j: number) =>
    (j < n || closed) &&
    sketch.constraints.some((c) => c.type === "tangent" && !c.suppressed && [c.a, c.b].includes(steps[i]!.e.id) && [c.a, c.b].includes(steps[j % n]!.e.id));
  const copies: Id[] = [];
  for (let i = 0; i < n; i++) {
    const s = steps[i]!;
    const m = ms[i]!;
    const p = pointBefore(i);
    const q = pointAfter(i);
    if (m.kind === "line") {
      const l = dr.line(p, q, { auto: false });
      if (!smooth((i + n - 1) % n, i) && !smooth(i, i + 1)) dr.constrain({ type: "parallel", a: l, b: s.e.id });
      dr.dimension("distance", [p, s.e.id], Math.abs(d), { group });
      copies.push(l);
    } else {
      const c = (s.e as Arc).c;
      copies.push(dr.arc(c, m.rev ? q : p, m.rev ? p : q));
    }
  }
  for (let i = 0; i < n; i++)
    if (n > 1 && (i > 0 || closed) && smooth((i + n - 1) % n, i)) dr.constrain({ type: "tangent", a: copies[(i + n - 1) % n]!, b: copies[i]! });
  return dr.done().sketch;
}
