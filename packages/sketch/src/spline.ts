import type { Id, SketchIndex, Spline, Vec2 } from "./model";

/**
 * Fit-point splines (#269): a smooth curve through the points, as cubic pieces end to end. The pieces are the C2
 * spline through the points, spaced by the distances between them (chord length), with natural ends unless an end is
 * tangent to a line. The same Bézier pieces go to the kernel, so the view and the solid agree exactly.
 */

/** One cubic piece: its start, two handles and its end. */
export type Bezier = [Vec2, Vec2, Vec2, Vec2];

/** A spline's shape: its pieces, and whether it closes. Its parameter runs 0 to `bez.length`, one per piece. */
export interface SplineGeo {
  bez: Bezier[];
  closed: boolean;
  /** Each piece's length along the parameter the curve was fitted to (the chord between its fit points). */
  h?: number[];
}

/** Solves a small dense system A x = b in place (Gaussian elimination with partial pivoting). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!];
    [b[i], b[p]] = [b[p]!, b[i]!];
    const d = A[i]![i]! || 1e-12;
    for (let r = i + 1; r < n; r++) {
      const k = A[r]![i]! / d;
      if (!k) continue;
      for (let c = i; c < n; c++) A[r]![c]! -= k * A[i]![c]!;
      b[r]! -= k * b[i]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let c = i + 1; c < n; c++) s -= A[i]![c]! * x[c]!;
    x[i] = s / (A[i]![i]! || 1e-12);
  }
  return x;
}

/**
 * The spline through `pts`. `start` and `end` are directions (unit) the curve leaves its first point and arrives at its
 * last; without them the ends are natural (straight-ish). A closed spline runs back to its first point smoothly.
 */
export function fitSpline(pts: Vec2[], closed = false, start?: Vec2, end?: Vec2): SplineGeo {
  const P = closed ? [...pts, pts[0]!] : pts;
  const m = P.length - 1;
  if (m < 1) return { bez: [], closed, h: [] };
  const h = Array.from({ length: m }, (_, i) => Math.max(1e-9, Math.hypot(P[i + 1]![0] - P[i]![0], P[i + 1]![1] - P[i]![1])));
  // Second derivatives at each point, per coordinate.
  const M: Vec2[] = Array.from({ length: P.length }, () => [0, 0]);
  for (const k of [0, 1] as const) {
    const y = P.map((p) => p[k]);
    const slope = (i: number) => (y[i + 1]! - y[i]!) / h[i]!;
    if (closed) {
      // Unknowns M_0..M_{m-1}; M_m is M_0. Each point joins its two neighbours' pieces smoothly.
      const A = Array.from({ length: m }, () => new Array<number>(m).fill(0));
      const b = new Array<number>(m).fill(0);
      for (let i = 0; i < m; i++) {
        const prev = (i - 1 + m) % m;
        const next = (i + 1) % m;
        A[i]![prev]! += h[prev]!;
        A[i]![i]! += 2 * (h[prev]! + h[i]!);
        A[i]![next]! += h[i]!;
        b[i] = 6 * (slope(i) - slope(prev));
      }
      const x = m >= 2 ? solve(A, b) : new Array<number>(m).fill(0);
      for (let i = 0; i <= m; i++) M[i]![k] = x[i % m]!;
      continue;
    }
    const n = m + 1;
    const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const b = new Array<number>(n).fill(0);
    if (start) {
      A[0]![0] = 2 * h[0]!;
      A[0]![1] = h[0]!;
      b[0] = 6 * (slope(0) - start[k]);
    } else A[0]![0] = 1;
    if (end) {
      A[m]![m - 1] = h[m - 1]!;
      A[m]![m] = 2 * h[m - 1]!;
      b[m] = 6 * (end[k] - slope(m - 1));
    } else A[m]![m] = 1;
    for (let i = 1; i < m; i++) {
      A[i]![i - 1] = h[i - 1]!;
      A[i]![i] = 2 * (h[i - 1]! + h[i]!);
      A[i]![i + 1] = h[i]!;
      b[i] = 6 * (slope(i) - slope(i - 1));
    }
    const x = solve(A, b);
    for (let i = 0; i <= m; i++) M[i]![k] = x[i]!;
  }
  const bez: Bezier[] = [];
  for (let i = 0; i < m; i++) {
    const [p0, p3] = [P[i]!, P[i + 1]!];
    const hi = h[i]!;
    const d0 = [0, 1].map((k) => (p3[k]! - p0[k]!) / hi - (hi * (2 * M[i]![k]! + M[i + 1]![k]!)) / 6);
    const d1 = [0, 1].map((k) => (p3[k]! - p0[k]!) / hi + (hi * (M[i]![k]! + 2 * M[i + 1]![k]!)) / 6);
    bez.push([p0, [p0[0] + (d0[0]! * hi) / 3, p0[1] + (d0[1]! * hi) / 3], [p3[0] - (d1[0]! * hi) / 3, p3[1] - (d1[1]! * hi) / 3], p3]);
  }
  return { bez, closed, h };
}

const piece = (g: SplineGeo, t: number): [Bezier, number] => {
  const n = g.bez.length;
  // A closed spline goes round and round.
  if (g.closed && (t < 0 || t > n)) t = ((t % n) + n) % n;
  const i = Math.max(0, Math.min(n - 1, Math.floor(t)));
  return [g.bez[i]!, t - i];
};

/** The point at parameter t (0 to the number of pieces). */
export function splinePoint(g: SplineGeo, t: number): Vec2 {
  const [[p0, p1, p2, p3], u] = piece(g, t);
  const v = 1 - u;
  const [a, b, c, d] = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** Which way, and how fast, the curve runs at parameter t. */
export function splineDeriv(g: SplineGeo, t: number): Vec2 {
  const [[p0, p1, p2, p3], u] = piece(g, t);
  const v = 1 - u;
  const [a, b, c] = [3 * v * v, 6 * v * u, 3 * u * u];
  return [a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]), a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1])];
}

/** How hard the curve bends at t, left turns positive. */
export function splineCurvature(g: SplineGeo, t: number): number {
  const [[p0, p1, p2, p3], u] = piece(g, t);
  const d = splineDeriv(g, t);
  const dd: Vec2 = [0, 1].map((k) => 6 * (1 - u) * (p2[k]! - 2 * p1[k]! + p0[k]!) + 6 * u * (p3[k]! - 2 * p2[k]! + p1[k]!)) as Vec2;
  const s = Math.hypot(d[0], d[1]);
  return s < 1e-12 ? 0 : (d[0] * dd[1] - d[1] * dd[0]) / (s * s * s);
}

/** Points along the curve from parameter `from` to `to`, `per` to a piece. */
export function sampleSpline(g: SplineGeo, from = 0, to = g.bez.length, per = 24): Vec2[] {
  const k = Math.max(2, Math.ceil(Math.abs(to - from) * per));
  return Array.from({ length: k + 1 }, (_, i) => splinePoint(g, from + ((to - from) * i) / k));
}

/** The parameter of the point on the curve nearest `p`, and how far off it is. */
export function splineParam(g: SplineGeo, p: Vec2): { t: number; d: number } {
  const n = g.bez.length;
  let best = 0;
  let bd = Infinity;
  const steps = n * 32;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * n;
    const q = splinePoint(g, t);
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bd) [bd, best] = [d, t];
  }
  // Close in: the nearest point is where the curve runs square to the way to p.
  let t = best;
  for (let it = 0; it < 30; it++) {
    const q = splinePoint(g, t);
    const d1 = splineDeriv(g, t);
    const f = (q[0] - p[0]) * d1[0] + (q[1] - p[1]) * d1[1];
    const fp = d1[0] ** 2 + d1[1] ** 2 || 1e-12;
    const nt = Math.max(0, Math.min(n, t - f / fp));
    if (Math.abs(nt - t) < 1e-13) break;
    t = nt;
  }
  const q = splinePoint(g, t);
  return { t, d: Math.hypot(q[0] - p[0], q[1] - p[1]) };
}

/**
 * Where a curve, given by which side of it a point is (`side` changes sign as the point crosses it), meets the spline
 * between parameters `from` and `to`: as parameters, closed in on to within a hair. Touches that never change side
 * are missed.
 */
export function curveSplineParams(side: (p: Vec2) => number, g: SplineGeo, from = 0, to = g.bez.length): number[] {
  const out: number[] = [];
  const f = (t: number) => side(splinePoint(g, t));
  const steps = Math.max(8, Math.ceil((to - from) * 48));
  let t0 = from;
  let f0 = f(t0);
  for (let i = 1; i <= steps; i++) {
    const t1 = from + ((to - from) * i) / steps;
    const f1 = f(t1);
    if (f0 === 0) out.push(t0);
    else if (f0 * f1 < 0) {
      let [a, b, fa] = [t0, t1, f0];
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (fa * fm <= 0) b = m;
        else [a, fa] = [m, fm];
      }
      out.push((a + b) / 2);
    }
    [t0, f0] = [t1, f1];
  }
  if (f0 === 0) out.push(t0);
  return out.filter((t, i) => i === 0 || Math.abs(t - out[i - 1]!) > 1e-9);
}

/** Which side of the infinite line through a and b a point is. */
export const lineSide =
  (a: Vec2, b: Vec2) =>
  (p: Vec2): number =>
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

/** Where two splines cross, as points: each walked against the other's nearest-point side. */
export function splineSpline(g: SplineGeo, h: SplineGeo): Vec2[] {
  const out: Vec2[] = [];
  // Crossing pieces: walk g, and look at which side of h's nearest tangent each point is.
  const side = (p: Vec2) => {
    const { t } = splineParam(h, p);
    const q = splinePoint(h, t);
    const d = splineDeriv(h, t);
    return d[0] * (p[1] - q[1]) - d[1] * (p[0] - q[0]);
  };
  for (const t of curveSplineParams(side, g)) {
    const p = splinePoint(g, t);
    if (splineParam(h, p).d < 1e-6) out.push(p);
  }
  return out;
}

/**
 * A spline entity's shape in a sketch: its fit points, and an end made tangent to a line it shares that end with
 * leaves (or arrives) along that line.
 */
export function splineGeo(idx: SketchIndex, e: Spline): SplineGeo {
  const pts = e.pts.map((p) => idx.xy(p));
  if (e.closed) return fitSpline(pts, true);
  const dirAt = (p: Id, leaving: boolean): Vec2 | undefined => {
    for (const c of idx.sketch.constraints) {
      if (c.type !== "tangent" || c.suppressed || (c.a !== e.id && c.b !== e.id)) continue;
      const l = idx.get(c.a === e.id ? c.b : c.a);
      if (l?.kind !== "line" || (l.a !== p && l.b !== p)) continue;
      const far = idx.xy(l.a === p ? l.b : l.a);
      const at = idx.xy(p);
      // Leaving, the curve carries on from the line, away from its far end; arriving, it runs on into the line.
      const d: Vec2 = leaving ? [at[0] - far[0], at[1] - far[1]] : [far[0] - at[0], far[1] - at[1]];
      const n = Math.hypot(d[0], d[1]);
      if (n > 1e-12) return [d[0] / n, d[1] / n];
    }
    return undefined;
  };
  return fitSpline(pts, false, dirAt(e.pts[0]!, true), dirAt(e.pts[e.pts.length - 1]!, false));
}

/** Splits a cubic at u: the part before and the part after (de Casteljau). */
function splitBezier([p0, p1, p2, p3]: Bezier, u: number): [Bezier, Bezier] {
  const l = (a: Vec2, b: Vec2): Vec2 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  const [a, b, c] = [l(p0, p1), l(p1, p2), l(p2, p3)];
  const [d, e] = [l(a, b), l(b, c)];
  const f = l(d, e);
  return [
    [p0, a, d, f],
    [f, e, c, p3],
  ];
}

/**
 * The cubic pieces of a spline from parameter `from` to `to`, exactly (for the kernel). On a closed spline `to` may
 * run past the end, round to the start again.
 */
export function splinePieces(g: SplineGeo, from = 0, to = g.bez.length): { bez: Bezier[]; knots: number[] } {
  const n = g.bez.length;
  const bez: Bezier[] = [];
  // Where each piece starts and ends along the fitted parameter, so the kernel's curve is smooth (C2) at the joins.
  const knots = [0];
  const eps = 1e-12;
  for (let k = Math.floor(from + eps); k < to - eps; k++) {
    const i = g.closed ? ((k % n) + n) % n : Math.max(0, Math.min(n - 1, k));
    let b = g.bez[i]!;
    const u0 = Math.max(0, from - k);
    const u1 = Math.min(1, to - k);
    if (u1 < 1 - eps) b = splitBezier(b, u1)[0];
    if (u0 > eps) b = splitBezier(b, u0 / u1)[1];
    bez.push(b);
    knots.push(knots[knots.length - 1]! + (g.h?.[i] ?? 1) * (u1 - u0));
  }
  return { bez, knots };
}
