import type { Entity, Id, Sketch } from "./model";

/** The end points a curve joins others by: a line's or arc's two ends, an open spline's first and last points. */
function curveEnds(e: Entity): Id[] {
  if (e.kind === "line" || e.kind === "arc") return [e.a, e.b];
  if (e.kind === "spline" && !e.closed && e.pts.length) return [e.pts[0]!, e.pts[e.pts.length - 1]!];
  return [];
}

/**
 * Every curve joined end to end with `id`, `id` first: lines, arcs and open splines that share an end point, or whose
 * ends are tied by a coincident constraint, walked outwards through every branch, as a double-click picks a whole
 * outline in Fusion. Construction joins only construction. A circle, closed spline or ellipse is a chain of its own.
 * Not a curve: an empty list.
 */
export function connectedCurves(s: Sketch, id: Id): Id[] {
  const start = s.entities.find((e) => e.id === id);
  if (!start || start.kind === "point") return [];
  // Points tied by coincident constraints count as one.
  const parent = new Map<Id, Id>();
  const find = (p: Id): Id => {
    let r = p;
    while (parent.has(r)) r = parent.get(r)!;
    return r;
  };
  for (const c of s.constraints) {
    if (c.type !== "coincident" || c.suppressed) continue;
    const a = find(c.a);
    const b = find(c.b);
    if (a !== b) parent.set(a, b);
  }
  const construction = !!start.construction;
  const byEnd = new Map<Id, Entity[]>();
  for (const e of s.entities) {
    if (!!e.construction !== construction) continue;
    for (const p of curveEnds(e)) {
      const k = find(p);
      const list = byEnd.get(k);
      if (list) list.push(e);
      else byEnd.set(k, [e]);
    }
  }
  const seen = new Set<Id>([id]);
  const out: Id[] = [id];
  const todo: Entity[] = [start];
  while (todo.length) {
    const e = todo.pop()!;
    for (const p of curveEnds(e)) {
      for (const n of byEnd.get(find(p)) ?? []) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        out.push(n.id);
        todo.push(n);
      }
    }
  }
  return out;
}
