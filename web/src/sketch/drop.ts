import { SketchIndex, angleOf, closestOnSegment, dist, mid, onArc, polar, sub, type Id, type Sketch, type Vec2 } from "@bettercad/sketch";
import { ORIGIN, SNAP_LABEL, middleOf, type PointPick, type SnapKind } from "./snap";

/* Loaded once a sketch is open (not with the shell): a point dragged before it arrives just moves. */
/**
 * Where a dragged point would land as a coincident, Fusion-style: the nearest other point, then the origin, then the
 * middle of a line (a midpoint constraint, so two centres can meet), then a line, circle or arc, within `tol` mm. Skips
 * what can't take it: points already tied to it, the curves it is part of (and a line's other end), and curves it
 * already sits on or is the middle of. Null lets it go free.
 */
export function dropTarget(p: Vec2, sketch: Sketch, dragged: Id, tol: number, origin: Vec2 | null): PointPick | null {
  const idx = new SketchIndex(sketch);
  const skip = new Set([dragged]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of sketch.constraints) {
      if (c.type !== "coincident" || c.suppressed || skip.has(c.a) === skip.has(c.b)) continue;
      skip.add(c.a);
      skip.add(c.b);
      grew = true;
    }
  }
  const tied = new Set(skip);
  const own = (e: Sketch["entities"][number]) =>
    (e.kind === "line" && (tied.has(e.a) || tied.has(e.b))) ||
    (e.kind === "arc" && (tied.has(e.a) || tied.has(e.b) || tied.has(e.c))) ||
    (e.kind === "circle" && tied.has(e.c));
  // Curves it already sits on, and lines it is already the middle of: landing on them again only repeats a constraint.
  const on = new Set(
    sketch.constraints.flatMap((c) =>
      c.suppressed ? [] : c.type === "pointOn" && tied.has(c.p) ? [c.e] : c.type === "midpoint" && tied.has(c.p) ? [c.line] : [],
    ),
  );
  const middleOfAlready = new Set(sketch.constraints.flatMap((c) => (c.type === "midpoint" && !c.suppressed && tied.has(c.p) ? [c.line] : [])));
  // A curve's own points: a line can't fold onto itself, nor an arc's end onto its centre.
  for (const e of sketch.entities) {
    if (!own(e)) continue;
    if (e.kind === "line") [e.a, e.b].forEach((q) => skip.add(q));
    else if (e.kind === "arc") [e.a, e.b, e.c].forEach((q) => skip.add(q));
    else if (e.kind === "circle") skip.add(e.c);
  }
  const centres = new Set(sketch.entities.flatMap((e) => (e.kind === "circle" || e.kind === "arc" ? [e.c] : [])));
  let best = null as PointPick | null;
  let bestD = tol;
  for (const e of sketch.entities) {
    if (e.kind !== "point" || skip.has(e.id) || dist([e.x, e.y], p) > bestD) continue;
    const kind: SnapKind = centres.has(e.id) ? "centre" : "end";
    best = { id: e.id, xy: [e.x, e.y], kind, label: SNAP_LABEL[kind] };
    bestD = dist([e.x, e.y], p);
  }
  if (best) return best;
  if (origin && dist(p, origin) <= tol) return { id: ORIGIN, xy: origin, kind: "origin", label: SNAP_LABEL.origin };
  // The middle of a line, even one it sits on: a centre dropped there gets a midpoint constraint.
  for (const e of sketch.entities) {
    if (e.kind !== "line" || own(e) || middleOfAlready.has(e.id)) continue;
    const xy = mid(idx.xy(e.a), idx.xy(e.b));
    if (dist(xy, p) <= bestD) {
      best = { id: middleOf(e.id), xy, kind: "middle", label: SNAP_LABEL.middle };
      bestD = dist(xy, p);
    }
  }
  if (best) return best;
  for (const e of sketch.entities) {
    if (own(e) || on.has(e.id)) continue;
    let xy: Vec2 | null = null;
    if (e.kind === "line") xy = closestOnSegment(p, idx.xy(e.a), idx.xy(e.b)).p;
    else if (e.kind === "circle" || e.kind === "arc") {
      const c = idx.xy(e.c);
      const ang = angleOf(sub(p, c));
      if (e.kind === "circle" || onArc(ang, angleOf(sub(idx.xy(e.a), c)), angleOf(sub(idx.xy(e.b), c)))) xy = polar(c, e.r, ang);
    }
    if (xy && dist(xy, p) <= bestD) {
      best = { id: e.id, xy, kind: "on", label: SNAP_LABEL.on };
      bestD = dist(xy, p);
    }
  }
  return best;
}
