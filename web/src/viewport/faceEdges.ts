import type { V3 } from "./camera";

/** How far, in mm, a point may sit off a face's outline and still be on it. */
const ON = 1e-3;

const distToSegment = (p: V3, a: V3, b: V3): number => {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = l2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
};
const middle = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/**
 * Which of a body's edges (each a chain of points) run round a face, given the face's outline as segments from its
 * triangles: an edge is on the face when every piece of it lies on the outline. `rest` is any part of the outline no
 * edge covers, so nothing of the face is lost.
 */
export function edgesOnOutline(edges: V3[][], outline: [V3, V3][]): { edges: number[]; rest: [V3, V3][] } {
  const onOutline = (p: V3) => outline.some(([a, b]) => distToSegment(p, a, b) <= ON);
  const chosen: number[] = [];
  edges.forEach((pts, i) => {
    if (pts.length < 2) return;
    for (let k = 0; k + 1 < pts.length; k++) if (!onOutline(middle(pts[k]!, pts[k + 1]!))) return;
    if (!onOutline(pts[0]!) || !onOutline(pts[pts.length - 1]!)) return;
    chosen.push(i);
  });
  const covered = (p: V3) =>
    chosen.some((i) => {
      const pts = edges[i]!;
      for (let k = 0; k + 1 < pts.length; k++) if (distToSegment(p, pts[k]!, pts[k + 1]!) <= ON) return true;
      return false;
    });
  return { edges: chosen, rest: outline.filter(([a, b]) => !covered(middle(a, b))) };
}
