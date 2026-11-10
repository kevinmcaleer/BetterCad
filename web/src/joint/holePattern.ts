import { jointMove, mat4Apply, type JointParams } from "../state/document";
import { across, type V3 } from "./snapPoints";

/** A round hole on a picked face: its centre and radius. */
export interface Hole {
  point: V3;
  radius: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** An angle in degrees, brought into −180…180. */
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * The turn about a joint's axis that lines up the most holes of a pattern (#393): `child` holes on the moving part's
 * face (where it stood before the joint), `parent` holes on the face it snaps to. The snapped hole lines up whatever
 * the turn, so `count` is at least 1. Ties go to the turn nearest `current`. Null when either face has one hole only.
 */
export function lineUpHoles(
  j: Pick<JointParams, "origin" | "axis" | "from" | "flip">,
  child: Hole[],
  parent: Hole[],
  current = 0,
  tol = 0.02,
): { angle: number; count: number } | null {
  if (child.length < 2 || parent.length < 2 || !j.from) return null;
  const m = jointMove({ origin: j.origin, axis: j.axis, from: j.from, flip: j.flip });
  if (!m) return null;
  const n = unit(j.axis);
  const u = across(n);
  const v = cross(n, u);
  // Each hole flat on the plane through the axis: its distance out and its angle round it (degrees).
  const flat = (p: V3, r: number) => {
    const q = sub(p, j.origin);
    const a = dot(q, u);
    const b = dot(q, v);
    return { a, b, rho: Math.hypot(a, b), phi: (Math.atan2(b, a) * 180) / Math.PI, r };
  };
  const cs = child.map((h) => flat(mat4Apply(m, h.point), h.radius));
  const ps = parent.map((h) => flat(h.point, h.radius));
  const fits = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    const [cos, sin] = [Math.cos(t), Math.sin(t)];
    return cs.filter((c) => {
      const a = c.a * cos - c.b * sin;
      const b = c.a * sin + c.b * cos;
      return ps.some((p) => Math.abs(p.r - c.r) <= tol && Math.hypot(p.a - a, p.b - b) <= tol * 5);
    }).length;
  };
  const tries = new Set<number>([wrap(current), 0]);
  for (const c of cs) {
    if (c.rho <= tol) continue;
    for (const p of ps) if (Math.abs(p.rho - c.rho) <= tol * 5 && Math.abs(p.r - c.r) <= tol) tries.add(Math.round(wrap(p.phi - c.phi) * 1e6) / 1e6 + 0);
  }
  let best = { angle: wrap(current), count: fits(current) };
  const gap = (a: number) => Math.abs(wrap(a - current));
  for (const a of tries) {
    const count = fits(a);
    if (count > best.count || (count === best.count && gap(a) < gap(best.angle))) best = { angle: a, count };
  }
  return best;
}
