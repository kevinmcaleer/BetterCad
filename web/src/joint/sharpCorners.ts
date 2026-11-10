import type { SnapPoint, V3 } from "./snapPoints";

/**
 * The sharp corners a bevel or fillet cut away (#389): where a flat face would meet its neighbour if the chamfer or
 * round between them were not there. A part pushed into such a corner sits snug, which the rounded snap points can't
 * give. Pure, so it can be tested without a view: the caller hands in each face's shape and edge numbers and each
 * edge's points.
 */
export interface FaceGeom {
  flat: boolean;
  normal: V3;
  centroid: V3;
}

export interface BodyGeom {
  /** Each face's edge numbers. */
  faceEdges: number[][];
  face(i: number): FaceGeom | null;
  edge(i: number): V3[] | null;
}

/** A dashed line drawn where a cut-away edge would be, from `a` to `b`. */
export type Ghost = [V3, V3];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const tidy = (a: V3): V3 => a.map((v) => Math.round(v * 1e6) / 1e6 + 0) as V3;

interface Line {
  p: V3;
  d: V3;
  /** The original edge's ends, on the line. */
  ends: [V3, V3];
  /** How wide the bevel or round is (0 for a real edge). */
  width: number;
}

/** A straight edge's ends and direction, or null for a curve. */
function straight(pts: V3[] | null, tol: number): { a: V3; b: V3; d: V3 } | null {
  if (!pts || pts.length < 2) return null;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  if (len(sub(b, a)) < tol) return null;
  const d = unit(sub(b, a));
  for (const p of pts) {
    const v = sub(p, a);
    if (len(sub(v, mul(d, dot(v, d)))) > tol) return null;
  }
  return { a, b, d };
}

/** The line where two planes meet, or null when they are parallel. */
function meet(n1: V3, p1: V3, n2: V3, p2: V3): { p: V3; d: V3 } | null {
  const d = cross(n1, n2);
  const dd = dot(d, d);
  if (dd < 1e-6) return null;
  const h1 = dot(n1, p1);
  const h2 = dot(n2, p2);
  // A point on both planes: ((h1 n2 − h2 n1) × d) / |d|²
  const p = mul(cross(sub(mul(n2, h1), mul(n1, h2)), d), 1 / dd);
  return { p, d: unit(d) };
}

/** Where two lines in one plane cross, or null when they run side by side. */
function cross2(l: Line, m: Line): V3 | null {
  const n = cross(l.d, m.d);
  const nn = dot(n, n);
  if (nn < 1e-6) return null;
  const t = dot(cross(sub(m.p, l.p), m.d), n) / nn;
  return add(l.p, mul(l.d, t));
}

const along = (l: Line, q: V3): V3 => add(l.p, mul(l.d, dot(sub(q, l.p), l.d)));

/**
 * The cut-away corners and edge middles on flat face `f`, facing `normal` (out of the side you see), with the
 * cut-away edges as dashed lines. Empty when no edge of `f` runs into a bevel or round.
 */
export function sharpCorners(g: BodyGeom, f: number, normal: V3, x: V3, tol = 1e-3): { snaps: SnapPoint[]; ghosts: Ghost[] } {
  const A = g.face(f);
  const edges = g.faceEdges[f];
  if (!A?.flat || !edges) return { snaps: [], ghosts: [] };
  const owners = new Map<number, number[]>();
  g.faceEdges.forEach((list, i) => list.forEach((e) => owners.set(e, [...(owners.get(e) ?? []), i])));
  const across = (e: number, from: number) => owners.get(e)?.find((i) => i !== from) ?? null;
  const nA = unit(A.normal);
  const lines: Line[] = [];
  for (const e of edges) {
    const s = straight(g.edge(e), tol);
    if (!s) continue;
    const own: Line = { p: s.a, d: s.d, ends: [s.a, s.b], width: 0 };
    const b = across(e, f);
    const B = b === null ? null : g.face(b);
    let line = own;
    if (b !== null && B) {
      // The bevel's or round's far edge: straight, alongside this one, and the flat face beyond it.
      for (const e2 of g.faceEdges[b] ?? []) {
        if (e2 === e) continue;
        const s2 = straight(g.edge(e2), tol);
        if (!s2 || Math.abs(dot(s2.d, s.d)) < 0.999) continue;
        const c = across(e2, b);
        const C = c === null || c === f ? null : g.face(c);
        if (!C?.flat) continue;
        const nC = unit(C.normal);
        // Faces facing the same or opposite ways never meet; a chamfer's own face leans between the two.
        if (Math.abs(dot(nA, nC)) > 0.97) continue;
        if (B.flat && (dot(unit(B.normal), nA) < 0.05 || dot(unit(B.normal), nC) < 0.05)) continue;
        const width = len(sub(along({ p: s.a, d: s.d, ends: [s.a, s.b], width: 0 }, s2.a), s2.a));
        if (width > 0.5 * len(sub(s.b, s.a)) && width > 0.5 * len(sub(s2.b, s2.a))) continue;
        const m = meet(nA, A.centroid, nC, C.centroid);
        if (!m) continue;
        const l: Line = { p: m.p, d: m.d, ends: [s.a, s.b], width };
        line = { ...l, ends: [along(l, s.a), along(l, s.b)] };
        break;
      }
    }
    lines.push(line);
  }
  const virtual = lines.filter((l) => l.width > 0);
  if (!virtual.length) return { snaps: [], ghosts: [] };
  const snaps: SnapPoint[] = [];
  const push = (p: V3, kind: SnapPoint["kind"]) => {
    if (!snaps.some((s) => len(sub(s.point, p)) <= tol)) snaps.push({ point: tidy(p), normal, x, kind });
  };
  const ghosts: Ghost[] = [];
  for (const l of virtual) {
    // The line runs on to where it meets its neighbours, real or cut away, near this edge's ends.
    const hits: V3[] = [];
    for (const m of lines) {
      if (m === l) continue;
      const q = cross2(l, m);
      if (!q) continue;
      const reach = 3 * Math.max(l.width, m.width) + tol;
      const nearL = Math.min(len(sub(q, l.ends[0])), len(sub(q, l.ends[1])));
      const nearM = Math.min(len(sub(q, m.ends[0])), len(sub(q, m.ends[1])));
      if (nearL <= reach && nearM <= reach) hits.push(q);
    }
    const t = (q: V3) => dot(sub(q, l.p), l.d);
    let [a, b] = l.ends;
    if (t(a) > t(b)) [a, b] = [b, a];
    for (const q of hits) {
      if (Math.abs(t(q) - t(a)) <= Math.abs(t(q) - t(b))) a = q;
      else b = q;
    }
    for (const q of hits) push(q, "corner");
    push(mul(add(a, b), 0.5), "edge");
    ghosts.push([tidy(a), tidy(b)]);
  }
  return { snaps: snaps.map((s) => ({ ...s, sharp: true })), ghosts };
}
