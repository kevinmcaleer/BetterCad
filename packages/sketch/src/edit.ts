import {
  SketchIndex,
  curvePoints,
  ellipseAngle,
  ellipseGeo,
  ellipsePoint,
  toSketch,
  type Curve,
  type EllipseGeo,
  type Entity,
  type Frame,
  type Id,
  type ProjectedRef,
  type Sketch,
  type TopoRef,
  type Vec2,
  type Vec3,
} from "./model";
import { circleSide, curveEllipse, ellipseSide, lineEllipse } from "./ellipse";
import { curveSplineParams, lineSide, sampleSpline, splineGeo, splineParam, splinePoint, splineSpline, type SplineGeo } from "./spline";
import { add, angleOf, circleCircle, circleFrom3, dist, dot, lineCircle, lineLine, onArc, polar, scale, sub, sweep, wrap } from "./geom2d";
import { Draft } from "./draw";

/**
 * What the editing tools (#54) share with the rest of the sketch: curves as shapes to cut, where they cross, grouped
 * sizes, and bringing model edges in. The tools themselves are in cut.ts and edits.ts, loaded with a sketch.
 */
export type EditResult = Sketch | string;

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

export function pointAt(sh: Shape, t: number): Vec2 {
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

export function samples(sh: Shape, from: number, to: number): Vec2[] {
  if (sh.kind === "line") return [pointAt(sh, from), pointAt(sh, to)];
  if (sh.kind === "spline") return sampleSpline(sh.g, from, to);
  const n = Math.max(4, Math.ceil((to - from) / (Math.PI / 36)));
  return Array.from({ length: n + 1 }, (_, i) => pointAt(sh, from + ((to - from) * i) / n));
}

/** Sets a size and every size grouped with it (#266) to `value`, typed as `expression`. */
export function setGroupedSize(sketch: Sketch, id: Id, value: number, expression: string): Sketch {
  const g = sketch.dimensions.find((x) => x.id === id)?.group;
  return {
    ...sketch,
    dimensions: sketch.dimensions.map((x) => (x.id === id || (g && x.group === g) ? { ...x, value, expression, driving: true } : x)),
  };
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
