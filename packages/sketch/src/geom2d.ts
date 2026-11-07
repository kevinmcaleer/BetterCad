import type { Vec2 } from "./model";

/** 2D geometry for the sketch tools (#53, #54): plain functions on [x, y] in mm, tested on their own. */
export const EPS = 1e-9;

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const mid = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
export const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
export const angleOf = (a: Vec2) => Math.atan2(a[1], a[0]);
export const polar = (c: Vec2, r: number, angle: number): Vec2 => [c[0] + r * Math.cos(angle), c[1] + r * Math.sin(angle)];

/** An angle in [0, 2π). */
export const wrap = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** The anticlockwise sweep from angle a to angle b, in (0, 2π]. */
export const sweep = (a: number, b: number) => {
  const s = wrap(b - a);
  return s < EPS ? 2 * Math.PI : s;
};

/** The circle through three points, or null when they are in a line. */
export function circleFrom3(p1: Vec2, p2: Vec2, p3: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]));
  if (Math.abs(d) < EPS) return null;
  const s1 = p1[0] ** 2 + p1[1] ** 2;
  const s2 = p2[0] ** 2 + p2[1] ** 2;
  const s3 = p3[0] ** 2 + p3[1] ** 2;
  const c: Vec2 = [
    (s1 * (p2[1] - p3[1]) + s2 * (p3[1] - p1[1]) + s3 * (p1[1] - p2[1])) / d,
    (s1 * (p3[0] - p2[0]) + s2 * (p1[0] - p3[0]) + s3 * (p2[0] - p1[0])) / d,
  ];
  return { c, r: dist(c, p1) };
}

/** An arc through start, a point on it and end: its centre, radius, and whether it runs anticlockwise start → end. */
export function arcFrom3(start: Vec2, through: Vec2, end: Vec2): { c: Vec2; r: number; ccw: boolean } | null {
  const circle = circleFrom3(start, through, end);
  if (!circle) return null;
  // Anticlockwise when the through point is on the right of start → end (it bulges that way).
  return { ...circle, ccw: cross(sub(end, start), sub(through, start)) < 0 };
}

/** A regular polygon's corners, the first at `angle` (radians) from the centre. */
export function polygonPoints(c: Vec2, r: number, sides: number, angle = Math.PI / 2): Vec2[] {
  return Array.from({ length: sides }, (_, i) => polar(c, r, angle + (2 * Math.PI * i) / sides));
}

/** Where two infinite lines (p1→p2, p3→p4) cross; null when parallel. Also the parameters along each. */
export function lineLine(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): { p: Vec2; t: number; u: number } | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const d = cross(r, s);
  if (Math.abs(d) < EPS) return null;
  const q = sub(p3, p1);
  const t = cross(q, s) / d;
  const u = cross(q, r) / d;
  return { p: add(p1, scale(r, t)), t, u };
}

/** Where the infinite line p1→p2 meets a circle, with the parameter along the line. */
export function lineCircle(p1: Vec2, p2: Vec2, c: Vec2, r: number): { p: Vec2; t: number }[] {
  const d = sub(p2, p1);
  const f = sub(p1, c);
  const a = dot(d, d);
  const b = 2 * dot(f, d);
  const k = dot(f, f) - r * r;
  const disc = b * b - 4 * a * k;
  if (a < EPS || disc < -EPS) return [];
  if (Math.abs(disc) <= EPS) {
    const t = -b / (2 * a);
    return [{ p: add(p1, scale(d, t)), t }];
  }
  const sq = Math.sqrt(disc);
  return [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].map((t) => ({ p: add(p1, scale(d, t)), t }));
}

/** Where two circles meet. */
export function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2);
  if (d < EPS || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const m = add(c1, scale(sub(c2, c1), a / d));
  if (h < 1e-7) return [m];
  const o = scale(perp(norm(sub(c2, c1))), h);
  return [add(m, o), sub(m, o)];
}

/** Whether angle `a` lies on the anticlockwise arc from `start` to `end`. */
export function onArc(a: number, start: number, end: number): boolean {
  return wrap(a - start) <= sweep(start, end) + 1e-9;
}

/** The nearest point on segment a→b, and its parameter. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { p: Vec2; t: number } {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return { p: add(a, scale(d, t)), t };
}

/** Points along an anticlockwise arc, for drawing and areas: at least `min` segments, about one per 5°. */
export function sampleArc(c: Vec2, r: number, start: number, end: number, min = 4): Vec2[] {
  const sw = sweep(start, end);
  const n = Math.max(min, Math.ceil(sw / (Math.PI / 36)));
  return Array.from({ length: n + 1 }, (_, i) => polar(c, r, start + (sw * i) / n));
}

/** Signed area of a closed polygon: positive when anticlockwise. */
export function polygonArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += cross(pts[i]!, pts[(i + 1) % pts.length]!);
  return s / 2;
}

/** Even-odd point-in-polygon. */
export function insidePolygon(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** The tangent arc that rounds the corner between two lines meeting at `corner` (#54): centre, and where it touches each. */
export function filletCorner(corner: Vec2, towardA: Vec2, towardB: Vec2, r: number): { c: Vec2; ta: Vec2; tb: Vec2; ccw: boolean } | null {
  const ua = norm(sub(towardA, corner));
  const ub = norm(sub(towardB, corner));
  const half = Math.acos(Math.max(-1, Math.min(1, dot(ua, ub)))) / 2;
  if (half < 1e-6 || Math.abs(half - Math.PI / 2) < 1e-6) return null;
  const t = r / Math.tan(half);
  if (t > dist(corner, towardA) + 1e-9 || t > dist(corner, towardB) + 1e-9) return null;
  const bis = norm(add(ua, ub));
  const c = add(corner, scale(bis, r / Math.sin(half)));
  const ta = add(corner, scale(ua, t));
  const tb = add(corner, scale(ub, t));
  return { c, ta, tb, ccw: cross(sub(ta, c), sub(tb, c)) > 0 };
}
