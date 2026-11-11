import { ellipsePoint, type EllipseGeo, type Vec2 } from "./model";

/**
 * Where ellipses (#401) meet lines, circles and other ellipses. A line is met exactly, by turning and squashing the
 * ellipse into a circle; curves are met by walking round the ellipse and closing in on each change of side.
 */

/** A point in the ellipse's own frame, scaled so the ellipse is the unit circle. */
export function toUnit(g: EllipseGeo, p: Vec2): Vec2 {
  const [dx, dy] = [p[0] - g.c[0], p[1] - g.c[1]];
  const [cs, sn] = [Math.cos(g.rot), Math.sin(g.rot)];
  return [(dx * cs + dy * sn) / (g.r1 || 1e-12), (-dx * sn + dy * cs) / (g.r2 || 1e-12)];
}

/** Where the infinite line through a and b meets the ellipse. */
export function lineEllipse(a: Vec2, b: Vec2, g: EllipseGeo): Vec2[] {
  const p = toUnit(g, a);
  const q = toUnit(g, b);
  const d: Vec2 = [q[0] - p[0], q[1] - p[1]];
  const A = d[0] ** 2 + d[1] ** 2;
  if (A < 1e-24) return [];
  const B = 2 * (p[0] * d[0] + p[1] * d[1]);
  const C = p[0] ** 2 + p[1] ** 2 - 1;
  const disc = B * B - 4 * A * C;
  if (disc < -1e-9) return [];
  const angleAt = (t: number) => Math.atan2(p[1] + d[1] * t, p[0] + d[0] * t);
  if (disc < 1e-9) return [ellipsePoint(g, angleAt(-B / (2 * A)))];
  const s = Math.sqrt(disc);
  return [ellipsePoint(g, angleAt((-B - s) / (2 * A))), ellipsePoint(g, angleAt((-B + s) / (2 * A)))];
}

/**
 * Where a curve, given by which side of it a point is (`side` changes sign as the point crosses it), meets the
 * ellipse. Touches that never change side are missed.
 */
export function curveEllipse(side: (p: Vec2) => number, g: EllipseGeo, steps = 360): Vec2[] {
  const out: Vec2[] = [];
  const f = (t: number) => side(ellipsePoint(g, t));
  let t0 = 0;
  let f0 = f(0);
  for (let i = 1; i <= steps; i++) {
    const t1 = (2 * Math.PI * i) / steps;
    const f1 = f(t1);
    if (f0 === 0) out.push(ellipsePoint(g, t0));
    else if (f0 * f1 < 0) {
      let [lo, hi, flo] = [t0, t1, f0];
      for (let k = 0; k < 60; k++) {
        const m = (lo + hi) / 2;
        const fm = f(m);
        if (fm * flo <= 0) hi = m;
        else [lo, flo] = [m, fm];
      }
      out.push(ellipsePoint(g, (lo + hi) / 2));
    }
    [t0, f0] = [t1, f1];
  }
  return out;
}

/** How far `p` is from the ellipse's outline, mm (to within a hair: the nearest of points round it). */
export function ellipseDistance(g: EllipseGeo, p: Vec2, steps = 360): number {
  let best = Infinity;
  for (let i = 0; i < steps; i++) {
    const q = ellipsePoint(g, (2 * Math.PI * i) / steps);
    best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  return best;
}

/** Which side of a circle a point is: negative inside. */
export const circleSide = (c: Vec2, r: number) => (p: Vec2) => Math.hypot(p[0] - c[0], p[1] - c[1]) - r;

/** Which side of an ellipse a point is: negative inside. */
export const ellipseSide = (g: EllipseGeo) => (p: Vec2) => Math.hypot(...toUnit(g, p)) - 1;
