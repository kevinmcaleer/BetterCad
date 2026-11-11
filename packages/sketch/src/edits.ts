import { SketchIndex, newId, type Curve, type Entity, type Id, type Sketch, type Vec2 } from "./model";
import { add, dist, dot, insidePolygon, norm, perp, scale, sub } from "./geom2d";
import { regions } from "./profiles";
import { Draft } from "./draw";
import { crossings, param, samples, shapeOf, type EditResult, type Shape } from "./edit";
import { offsetChain, samePoint, trimAt } from "./cut";

/**
 * The sketch edits that load with their tools rather than at first paint (#267, #270, #266): mirror, extend, trim by
 * dragging, and offsetting both ways or a whole region. The app imports them from "@bettercad/sketch/edits".
 */

/**
 * Trims every piece a dragged path crosses (#270): the path is a pointer trail in sketch mm. Pieces go one at a time,
 * each where the path first crosses it, until the path crosses nothing left.
 */
export function trimAlong(sketch: Sketch, path: Vec2[]): EditResult {
  let s = sketch;
  let trimmed = 0;
  for (let guard = 0; guard < 200; guard++) {
    const hit = pathHit(s, path);
    if (!hit) break;
    const r = trimAt(s, hit.id, hit.xy);
    if (typeof r === "string") return trimmed ? s : r;
    s = r;
    trimmed++;
  }
  return trimmed ? s : "Drag across the pieces to trim";
}

/** The first curve a path crosses, and where. */
function pathHit(sketch: Sketch, path: Vec2[]): { id: Id; xy: Vec2 } | null {
  const idx = new SketchIndex(sketch);
  const curves = sketch.entities.filter((e): e is Curve => e.kind !== "point");
  for (let i = 1; i < path.length; i++) {
    const seg: Shape = { kind: "line", a: path[i - 1]!, b: path[i]! };
    let best: { id: Id; xy: Vec2; t: number } | null = null;
    for (const c of curves)
      for (const xy of crossings(seg, shapeOf(idx, c))) {
        const t = param(seg, xy);
        if (!best || t < best.t) best = { id: c.id, xy, t };
      }
    if (best) return best;
  }
  return null;
}

/** How far a line looks for something to grow to, mm. */
const REACH = 1e4;

/**
 * Where the end of a line or arc nearest `at` would grow to (#270): the next curve it meets past that end. `pts` is
 * the piece it would add, for the hover.
 */
export function extendTarget(sketch: Sketch, id: Id, at: Vec2): { end: "a" | "b"; xy: Vec2; meets: Id; pts: Vec2[] } | null {
  const idx = new SketchIndex(sketch);
  const e = idx.get(id);
  if (e?.kind !== "line" && e?.kind !== "arc") return null;
  const sh = shapeOf(idx, e) as Extract<Shape, { kind: "line" | "arc" }>;
  const A = idx.xy(e.a);
  const B = idx.xy(e.b);
  const end: "a" | "b" = dist(at, B) <= dist(at, A) ? "b" : "a";
  let ray: Shape;
  if (sh.kind === "line") {
    const from = end === "b" ? B : A;
    const dir = norm(end === "b" ? sub(B, A) : sub(A, B));
    ray = { kind: "line", a: from, b: add(from, scale(dir, REACH)) };
  }
  // The gap round from the arc's end back to its start: growing b looks forward into it, growing a looks back.
  else ray = { kind: "arc", c: sh.c, r: sh.r, s: sh.s + sh.w, w: 2 * Math.PI - sh.w };
  const span = ray.kind === "line" ? 1 : ray.w;
  const eps = ray.kind === "line" ? 1e-6 / REACH : 1e-6;
  let best: { t: number; xy: Vec2; meets: Id } | null = null;
  for (const o of sketch.entities) {
    if (o.id === id || o.kind === "point") continue;
    for (const xy of crossings(ray, shapeOf(idx, o))) {
      const t = param(ray, xy);
      // Along the gap, how far from the end that grows.
      const k = ray.kind === "arc" && end === "a" ? span - t : t;
      if (k > eps && k < span - eps && (!best || k < best.t)) best = { t: k, xy, meets: o.id };
    }
  }
  if (!best) return null;
  const pts = ray.kind === "line" ? [end === "b" ? B : A, best.xy] : end === "b" ? samples(ray, 0, best.t) : samples(ray, span - best.t, span);
  return { end, xy: best.xy, meets: best.meets, pts };
}

/**
 * Grows the end of a line or arc nearest `at` to the next curve it meets (#270), and ties it there: coincident with
 * an end it lands on, otherwise on the curve.
 */
export function extendAt(sketch: Sketch, id: Id, at: Vec2): EditResult {
  const idx = new SketchIndex(sketch);
  const e = idx.get(id);
  if (e?.kind !== "line" && e?.kind !== "arc") return "Hover the end of a line or arc";
  const target = extendTarget(sketch, id, at);
  if (!target) return "Nothing to grow to past that end";
  const p = e[target.end];
  if (idx.users(p).length > 1 || samePoint(sketch, p).size > 1) return "That end is joined to another shape";
  if (sketch.constraints.some((c) => c.type === "fix" && c.p === p)) return "That end is fixed";
  const d = new Draft(sketch);
  d.entities = d.entities.map((x) => (x.id === p ? { ...x, x: target.xy[0], y: target.xy[1] } : x));
  // A grown line's length no longer holds; an arc's radius does.
  if (e.kind === "line") d.dimensions = d.dimensions.filter((dm) => !(dm.refs.includes(id) && dm.kind === "length"));
  const other = idx.get(target.meets);
  const landed = other && (other.kind === "line" || other.kind === "arc") ? [other.a, other.b].find((q) => dist(idx.xy(q), target.xy) < 1e-6) : undefined;
  if (landed) d.constrain({ type: "coincident", a: p, b: landed });
  else if (other && (other.kind === "line" || other.kind === "arc" || other.kind === "circle")) d.constrain({ type: "pointOn", p, e: other.id });
  return d.done().sketch;
}

/** Where `p` lands mirrored across the line through `a` and `b`. */
export function reflect(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const u = norm(sub(b, a));
  const foot = add(a, scale(u, dot(sub(p, a), u)));
  return sub(scale(foot, 2), p);
}

/**
 * Mirrors shapes across a line (#267). Each copied point is tied to its original by a Symmetric constraint, so editing
 * one side moves the other; circles keep equal radii. Points on the mirror line are shared rather than doubled (and
 * held on it), so a mirrored half profile closes into one shape. An ellipse brings its axes.
 */
export function mirrorShapes(sketch: Sketch, ids: Id[], line: Id): EditResult {
  const idx = new SketchIndex(sketch);
  const m = idx.get(line);
  if (m?.kind !== "line") return "Pick a line to mirror across";
  const a = idx.xy(m.a);
  const b = idx.xy(m.b);
  const len = dist(a, b);
  if (len < 1e-9) return "That line has no length to mirror across";
  const picked = new Set(ids.filter((id) => id !== line));
  for (const id of [...picked]) {
    const e = idx.get(id);
    if (e?.kind === "ellipse") picked.add(e.ax1).add(e.ax2);
  }
  const shapes = [...picked].map((id) => idx.get(id)).filter((e): e is Entity => !!e && !(e.kind === "line" && e.id === line));
  if (!shapes.length) return "Pick the shapes to mirror, then the line";
  const n = perp(norm(sub(b, a)));
  const onLine = (p: Vec2) => Math.abs(dot(n, sub(p, a))) < 1e-4;
  const d = new Draft(sketch);
  // Points already held on the line, or fixed, need nothing more to stay there.
  const held = new Set(sketch.constraints.flatMap((c) => ((c.type === "pointOn" && c.e === line) || c.type === "fix" ? [c.p] : [])));
  const copies = new Map<Id, Id>();
  const copyPoint = (p: Id): Id => {
    const had = copies.get(p);
    if (had) return had;
    const pt = idx.point(p);
    const xy: Vec2 = [pt.x, pt.y];
    let out: Id;
    if (p === m.a || p === m.b) out = p;
    else if (onLine(xy)) {
      out = p;
      if (!held.has(p)) {
        d.constrain({ type: "pointOn", p, e: line });
        held.add(p);
      }
    } else {
      out = d.point(reflect(xy, a, b), !!pt.construction);
      d.constrain({ type: "symmetric", a: p, b: out, line });
    }
    copies.set(p, out);
    return out;
  };
  const made = new Map<Id, Id>();
  for (const e of shapes) {
    const construction = !!e.construction;
    if (e.kind === "point") copyPoint(e.id);
    else if (e.kind === "line") made.set(e.id, d.line(copyPoint(e.a), copyPoint(e.b), { construction, auto: false }));
    else if (e.kind === "circle") {
      const c = d.circle(copyPoint(e.c), e.r, construction);
      d.constrain({ type: "equal", a: e.id, b: c });
      made.set(e.id, c);
    }
    // A mirror turns the arc the other way round, so it runs from the copy of b to the copy of a.
    else if (e.kind === "arc") made.set(e.id, d.arc(copyPoint(e.c), copyPoint(e.b), copyPoint(e.a), construction));
  }
  for (const e of shapes) {
    if (e.kind !== "ellipse") continue;
    const ax1 = made.get(e.ax1);
    const ax2 = made.get(e.ax2);
    if (!ax1 || !ax2) continue;
    const id = newId("e");
    d.entities.push({ id, kind: "ellipse", c: copyPoint(e.c), ax1, ax2, ...(e.construction && { construction: true }) });
    d.ids.push(id);
  }
  return d.done().sketch;
}

// ------------------------------------------------------------------ offset, part two (#266)

/** Copies on both sides of the chain through `id` (#266): a wall round a centre line. Both share one distance. */
export function offsetBoth(sketch: Sketch, id: Id, d: number): EditResult {
  const group = newId("o");
  const one = offsetChain(sketch, id, Math.abs(d), group);
  if (typeof one === "string") return one;
  return offsetChain(one, id, -Math.abs(d), group);
}

/**
 * Offsets the whole outline of the region round `at` (#266): its outside and any holes, all by one distance. Positive
 * grows the region (out past its outside, into its holes), negative shrinks it; `both` copies both ways.
 */
export function offsetRegion(sketch: Sketch, at: Vec2, d: number, both = false): EditResult {
  if (!d) return "Type a distance";
  const inside = regions(sketch)
    .filter((r) => insidePolygon(at, r.points) && !r.holes.some((h) => insidePolygon(at, h.points)))
    .sort((a, b) => a.area - b.area)[0];
  if (!inside) return "Click a line, arc or circle, or inside a closed shape";
  const idx = new SketchIndex(sketch);
  const loops = [inside, ...inside.holes];
  if (loops.some((l) => l.edges.some((e) => !["line", "arc", "circle"].includes(idx.get(e.id)?.kind ?? "")))) {
    return "Offset takes lines, arcs and circles for now";
  }
  const group = newId("o");
  let out = sketch;
  for (const [i, l] of loops.entries()) {
    const sign = i === 0 ? 1 : -1;
    for (const s of both ? [1, -1] : [1]) {
      const r = offsetChain(out, l.edges[0]!.id, sign * s * d, group);
      if (typeof r === "string") return r;
      out = r;
    }
  }
  return out;
}
export { filletAt, filletLines, offsetChain, trimAt, trimPiece } from "./cut";
