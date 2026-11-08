/**
 * The fast mesh test for the clash sweep (#179): do two triangle meshes cross, one moved against the other? A box tree
 * per mesh, built once, then a triangle-triangle test at the leaves. Faces that only touch, or lie in one plane, don't
 * count, so a washer on its face or a part resting on another isn't a clash. Plain TypeScript: no OCCT, no three.js.
 */
import type { Mat4 } from "./pose";

/** Crossings shallower than this don't count, mm. */
const EPS = 1e-3;
const LEAF = 8;
/** Triangles of each mesh to look inside the other from, when no faces cross. */
const PROBES = 8;

interface Node {
  min: [number, number, number];
  max: [number, number, number];
  /** Children, or -1 at a leaf. */
  left: number;
  right: number;
  /** A leaf's triangles: `order[start…start + count)`. */
  start: number;
  count: number;
}

export interface MeshTree {
  /** 9 numbers a triangle, in the mesh's own frame. */
  tris: Float32Array;
  order: Uint32Array;
  nodes: Node[];
}

/** A box tree over a mesh's triangles, split at the median along each box's longest side. */
export function meshTree(tris: Float32Array): MeshTree {
  const n = Math.floor(tris.length / 9);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const centre = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) centre[i * 3 + a] = (tris[i * 9 + a]! + tris[i * 9 + 3 + a]! + tris[i * 9 + 6 + a]!) / 3;
  const nodes: Node[] = [];
  const build = (start: number, count: number): number => {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let k = start; k < start + count; k++) {
      const t = order[k]! * 9;
      for (let v = 0; v < 9; v += 3)
        for (let a = 0; a < 3; a++) {
          const x = tris[t + v + a]!;
          if (x < min[a]!) min[a] = x;
          if (x > max[a]!) max[a] = x;
        }
    }
    const id = nodes.length;
    nodes.push({ min, max, left: -1, right: -1, start, count });
    if (count <= LEAF) return id;
    const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const axis = ext[0]! >= ext[1]! && ext[0]! >= ext[2]! ? 0 : ext[1]! >= ext[2]! ? 1 : 2;
    const part = Array.from(order.subarray(start, start + count)).sort((p, q) => centre[p * 3 + axis]! - centre[q * 3 + axis]!);
    order.set(part, start);
    const half = count >> 1;
    const left = build(start, half);
    const right = build(start + half, count - half);
    nodes[id]!.left = left;
    nodes[id]!.right = right;
    return id;
  };
  if (n) build(0, n);
  return { tris, order, nodes };
}

/** The inverse of a rigid transform (a turn and a shift), column-major. */
export function rigidInverse(m: Mat4): Mat4 {
  const t = [m[12]!, m[13]!, m[14]!];
  const r: Mat4 = [m[0]!, m[4]!, m[8]!, 0, m[1]!, m[5]!, m[9]!, 0, m[2]!, m[6]!, m[10]!, 0, 0, 0, 0, 1];
  r[12] = -(r[0]! * t[0]! + r[4]! * t[1]! + r[8]! * t[2]!);
  r[13] = -(r[1]! * t[0]! + r[5]! * t[1]! + r[9]! * t[2]!);
  r[14] = -(r[2]! * t[0]! + r[6]! * t[1]! + r[10]! * t[2]!);
  return r;
}

const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Where a triangle crosses the line, as an interval along it: from the edges whose ends lie either side of the plane. */
function interval(p: number[][], d: number[], dir: number[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const proj = p.map((v) => dot(v, dir));
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if (d[i] === 0) {
      lo = Math.min(lo, proj[i]!);
      hi = Math.max(hi, proj[i]!);
    }
    if (d[i]! * d[j]! < 0) {
      const t = proj[i]! + ((proj[j]! - proj[i]!) * d[i]!) / (d[i]! - d[j]!);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Whether two triangles cross by more than EPS (Möller's interval test). Touching and coplanar ones don't. */
export function trianglesCross(p: number[][], q: number[][]): boolean {
  const nq = cross(sub(q[1]!, q[0]!), sub(q[2]!, q[0]!));
  const lq = Math.hypot(nq[0]!, nq[1]!, nq[2]!);
  const np = cross(sub(p[1]!, p[0]!), sub(p[2]!, p[0]!));
  const lp = Math.hypot(np[0]!, np[1]!, np[2]!);
  if (lq < 1e-12 || lp < 1e-12) return false;
  const dq = dot(nq, q[0]!);
  const dp = p.map((v) => (dot(nq, v) - dq) / lq);
  if (Math.min(...dp) >= -EPS || Math.max(...dp) <= EPS) return false;
  const dpn = dot(np, p[0]!);
  const dqp = q.map((v) => (dot(np, v) - dpn) / lp);
  if (Math.min(...dqp) >= -EPS || Math.max(...dqp) <= EPS) return false;
  const line = cross(np, nq);
  const ll = Math.hypot(line[0]!, line[1]!, line[2]!);
  if (ll < 1e-12) return false;
  const dir = [line[0]! / ll, line[1]! / ll, line[2]! / ll];
  const a = interval(p, dp, dir);
  const b = interval(q, dqp, dir);
  return !!a && !!b && Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > EPS;
}

const apply = (m: Mat4, x: number, y: number, z: number) => [
  m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
  m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
  m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
];

/** A node's box moved by `m`, as the box around it. */
function movedBox(n: Node, m: Mat4): { min: number[]; max: number[] } {
  const c = [(n.min[0] + n.max[0]) / 2, (n.min[1] + n.max[1]) / 2, (n.min[2] + n.max[2]) / 2];
  const e = [(n.max[0] - n.min[0]) / 2, (n.max[1] - n.min[1]) / 2, (n.max[2] - n.min[2]) / 2];
  const mc = apply(m, c[0]!, c[1]!, c[2]!);
  const r = [0, 1, 2].map((row) => Math.abs(m[row]!) * e[0]! + Math.abs(m[4 + row]!) * e[1]! + Math.abs(m[8 + row]!) * e[2]!);
  return { min: mc.map((v, i) => v - r[i]!), max: mc.map((v, i) => v + r[i]!) };
}

const boxesMeet = (a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }) =>
  a.min.every((v, i) => v < b.max[i]! - EPS && b.min[i]! < a.max[i]! - EPS);

function tri(t: MeshTree, i: number, m?: Mat4): number[][] {
  const o = i * 9;
  const s = t.tris;
  const pts = [0, 3, 6].map((k) => [s[o + k]!, s[o + k + 1]!, s[o + k + 2]!]);
  return m ? pts.map((p) => apply(m, p[0]!, p[1]!, p[2]!)) : pts;
}

/** Whether a point lies inside a closed mesh: an odd count of crossings along a skewed ray. */
function inside(t: MeshTree, p: number[]): boolean {
  const dir = [0.8017837, 0.5345225, 0.2672612];
  let n = 0;
  const count = t.tris.length / 9;
  for (let i = 0; i < count; i++) {
    const [a, b, c] = tri(t, i);
    const e1 = sub(b!, a!);
    const e2 = sub(c!, a!);
    const h = cross(dir, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(p, a!);
    const u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(dir, q) / det;
    if (v < 0 || u + v > 1) continue;
    if (dot(e2, q) / det > 0) n++;
  }
  return n % 2 === 1;
}

/**
 * Whether mesh `b`, moved by `m` into `a`'s frame, crosses `a` or sits inside it (or `a` inside it). Touching doesn't
 * count.
 */
export function meshesClash(a: MeshTree, b: MeshTree, m: Mat4): boolean {
  if (!a.nodes.length || !b.nodes.length) return false;
  const stack: [number, number][] = [[0, 0]];
  // Triangles near where the two meet: faces flush with each other cross nowhere, so look inside from these.
  const nearA = new Set<number>();
  const nearB = new Set<number>();
  while (stack.length) {
    const [ia, ib] = stack.pop()!;
    const na = a.nodes[ia]!;
    const nb = b.nodes[ib]!;
    if (!boxesMeet(na, movedBox(nb, m))) continue;
    if (na.left < 0 && nb.left < 0) {
      for (let j = nb.start; j < nb.start + nb.count; j++) {
        const q = tri(b, b.order[j]!, m);
        for (let i = na.start; i < na.start + na.count; i++) if (trianglesCross(tri(a, a.order[i]!), q)) return true;
        if (nearB.size < PROBES) nearB.add(b.order[j]!);
      }
      for (let i = na.start; i < na.start + na.count && nearA.size < PROBES; i++) nearA.add(a.order[i]!);
      continue;
    }
    const splitA = nb.left < 0 || (na.left >= 0 && size(na) >= size(nb));
    if (splitA) stack.push([na.left, ib], [na.right, ib]);
    else stack.push([ia, nb.left], [ia, nb.right]);
  }
  // No faces cross. Flush faces (a block slid into one the same height) and one body wholly inside the other still
  // clash: a point just inside a face near where they meet is inside the other body.
  const inv = rigidInverse(m);
  for (const i of nearB) if (inside(a, probe(tri(b, i, m)))) return true;
  for (const i of nearA) if (inside(b, probe(tri(a, i, inv)))) return true;
  const ra = a.nodes[0]!;
  const rb = movedBox(b.nodes[0]!, m);
  const within = (o: { min: number[]; max: number[] }, i: { min: number[]; max: number[] }) => i.min.every((v, k) => v >= o.min[k]! && i.max[k]! <= o.max[k]!);
  if (within(ra, rb) && inside(a, probe(tri(b, 0, m)))) return true;
  if (within(rb, ra) && inside(b, probe(tri(a, 0, inv)))) return true;
  return false;
}

/** A point just inside a triangle's face, behind its middle: triangles are wound outward. */
function probe(t: number[][]): number[] {
  const n = cross(sub(t[1]!, t[0]!), sub(t[2]!, t[0]!));
  const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
  return [0, 1, 2].map((k) => (t[0]![k]! + t[1]![k]! + t[2]![k]!) / 3 - (n[k]! / l) * 4 * EPS);
}

const size = (n: Node) => n.max[0] - n.min[0] + n.max[1] - n.min[1] + n.max[2] - n.min[2];
