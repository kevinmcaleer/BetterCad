import { q } from "./geom";
import type { Corner, P2 } from "./model";

/**
 * The plain geometry of a board's outline. It is on its own so the 3D board (`pcb/solid.ts`), which the modelling
 * kernel loads with every model, does not bring the nets and pads code with it.
 */

/** An outline as straight pieces: arcs (corners with a bulge) are cut into short chords, `step` mm of sag at most. */
export function outlinePoints(corners: Corner[], sag = 0.01): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    out.push([a.x, a.y]);
    if (!a.bulge) continue;
    const arc = arcOf(a, b);
    if (!arc) continue;
    const sweep = 4 * Math.atan(a.bulge);
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.acos(Math.max(0, 1 - sag / arc.r)))));
    for (let k = 1; k < n; k += 1) {
      const t = arc.a0 + (sweep * k) / n;
      out.push([q(arc.cx + arc.r * Math.cos(t)), q(arc.cy + arc.r * Math.sin(t))]);
    }
  }
  return out;
}

/** The circle an arc edge lies on, with the angle it starts at (radians). A positive bulge runs anticlockwise. */
export function arcOf(a: Corner, b: Corner): { cx: number; cy: number; r: number; a0: number; sweep: number } | null {
  const bulge = a.bulge ?? 0;
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!bulge || chord < 1e-9) return null;
  const sweep = 4 * Math.atan(bulge);
  const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  // The centre sits on the chord's normal, to the left of travel for an anticlockwise arc.
  const h = (chord / 2) * ((1 - bulge * bulge) / (2 * bulge));
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const nx = -(b.y - a.y) / chord;
  const ny = (b.x - a.x) / chord;
  const cx = mx + nx * h;
  const cy = my + ny * h;
  return { cx, cy, r, a0: Math.atan2(a.y - cy, a.x - cx), sweep };
}

/** Area of a closed polygon; positive when it runs anticlockwise. */
export function area(pts: P2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInPolygon(p: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
