/**
 * Print checks on a body's triangles (#101, #102): overhangs that need support, and walls too thin to print. Both
 * give a value per vertex (0 = fine, up to 1 = worst) for the view to tint, and the connected areas for the Print
 * panel. Pure maths on the mesh, so it runs anywhere: overhangs on the main thread, thickness in the kernel worker.
 */
export interface CheckMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface CheckArea {
  /** mm². */
  area: number;
  /** The thinnest wall in the area, mm (thickness only). */
  min?: number;
  box: { min: [number, number, number]; max: [number, number, number] };
}

export interface CheckResult {
  /** Per vertex, 0 to 1: how strongly to tint it. */
  values: Float32Array;
  areas: CheckArea[];
  /** Total flagged area, mm². */
  area: number;
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function vert(m: CheckMesh, i: number): V3 {
  return [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
}

/** A triangle's corners, unit normal and area. */
function tri(m: CheckMesh, t: number) {
  const a = vert(m, m.indices[t * 3]!);
  const b = vert(m, m.indices[t * 3 + 1]!);
  const c = vert(m, m.indices[t * 3 + 2]!);
  const n = cross(sub(b, a), sub(c, a));
  const len = Math.hypot(n[0], n[1], n[2]);
  return { a, b, c, n: (len ? [n[0] / len, n[1] / len, n[2] / len] : [0, 0, 0]) as V3, area: len / 2 };
}

/** Groups flagged triangles that touch (share a corner position) into areas. */
function group(m: CheckMesh, flagged: number[], extra?: (t: number) => number, gap = 0): CheckArea[] {
  const key = (i: number) =>
    `${Math.round(m.positions[i * 3]! * 1e4)},${Math.round(m.positions[i * 3 + 1]! * 1e4)},${Math.round(m.positions[i * 3 + 2]! * 1e4)}`;
  const parent = flagged.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  flagged.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const p = key(m.indices[t * 3 + k]!);
      const o = owner.get(p);
      if (o === undefined) owner.set(p, i);
      else parent[find(i)] = find(o);
    }
  });
  const areas = new Map<number, CheckArea>();
  flagged.forEach((t, i) => {
    const r = find(i);
    const { a, b, c, area } = tri(m, t);
    let g = areas.get(r);
    if (!g) areas.set(r, (g = { area: 0, box: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } }));
    g.area += area;
    for (const p of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        g.box.min[k] = Math.min(g.box.min[k]!, p[k]!);
        g.box.max[k] = Math.max(g.box.max[k]!, p[k]!);
      }
    }
    if (extra) g.min = Math.min(g.min ?? Infinity, extra(t));
  });
  // Two sides of one thin wall don't share a corner: join areas that come within `gap` of each other.
  const list = [...areas.values()];
  if (gap > 0) {
    const near = (a: CheckArea, b: CheckArea) => [0, 1, 2].every((k) => a.box.min[k]! <= b.box.max[k]! + gap && b.box.min[k]! <= a.box.max[k]! + gap);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (!near(a, b)) continue;
        a.area += b.area;
        for (let k = 0; k < 3; k++) {
          a.box.min[k] = Math.min(a.box.min[k]!, b.box.min[k]!);
          a.box.max[k] = Math.max(a.box.max[k]!, b.box.max[k]!);
        }
        if (b.min !== undefined) a.min = Math.min(a.min ?? Infinity, b.min);
        list.splice(j, 1);
        j = i;
      }
    }
  }
  return list.sort((x, y) => (x.min ?? 0) - (y.min ?? 0) || y.area - x.area);
}

/**
 * Overhangs (#102): downward faces tilted more than `threshold` degrees from vertical, not touching the bed.
 * Bridges (short spans a printer can cross) aren't told apart yet.
 */
export function overhangs(m: CheckMesh, threshold = 45, bedZ = 0): CheckResult {
  const values = new Float32Array(m.positions.length / 3);
  const limit = Math.sin((threshold * Math.PI) / 180);
  const flagged: number[] = [];
  let total = 0;
  for (let t = 0; t < m.indices.length / 3; t++) {
    const { a, b, c, n, area } = tri(m, t);
    if (-n[2] <= limit + 1e-6) continue;
    if (Math.min(a[2], b[2], c[2]) <= bedZ + 0.2) continue;
    const angle = (Math.asin(Math.min(1, -n[2])) * 180) / Math.PI;
    const v = 0.35 + 0.65 * Math.min(1, (angle - threshold) / Math.max(1e-6, 90 - threshold));
    for (let k = 0; k < 3; k++) {
      const i = m.indices[t * 3 + k]!;
      values[i] = Math.max(values[i]!, v);
    }
    flagged.push(t);
    total += area;
  }
  return { values, areas: group(m, flagged), area: total };
}

/** A bounding-volume tree over the triangles, for casting rays at the body's own walls. */
class Bvh {
  private boxes: Float32Array;
  private tris: Float64Array;
  private order: Uint32Array;
  private nodes: { lo: number; hi: number; min: V3; max: V3; left?: number; right?: number }[] = [];
  constructor(m: CheckMesh) {
    const n = m.indices.length / 3;
    this.boxes = new Float32Array(n * 6);
    this.order = new Uint32Array(n);
    this.tris = new Float64Array(n * 12);
    for (let t = 0; t < n; t++) {
      this.order[t] = t;
      const { a, b, c, n: nn } = tri(m, t);
      this.tris.set([...a, ...sub(b, a), ...sub(c, a), ...nn], t * 12);
      for (let k = 0; k < 3; k++) {
        this.boxes[t * 6 + k] = Math.min(a[k]!, b[k]!, c[k]!);
        this.boxes[t * 6 + 3 + k] = Math.max(a[k]!, b[k]!, c[k]!);
      }
    }
    if (n) this.split(0, n);
  }
  private split(lo: number, hi: number): number {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = lo; i < hi; i++) {
      const t = this.order[i]!;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, this.boxes[t * 6 + k]!);
        max[k] = Math.max(max[k]!, this.boxes[t * 6 + 3 + k]!);
      }
    }
    const id = this.nodes.length;
    this.nodes.push({ lo, hi, min, max });
    if (hi - lo > 8) {
      const axis = [0, 1, 2].sort((x, y) => max[y]! - min[y]! - (max[x]! - min[x]!))[0]!;
      const part = [...this.order.subarray(lo, hi)].sort(
        (x, y) => this.boxes[x * 6 + axis]! + this.boxes[x * 6 + 3 + axis]! - this.boxes[y * 6 + axis]! - this.boxes[y * 6 + 3 + axis]!,
      );
      this.order.set(part, lo);
      const mid = (lo + hi) >> 1;
      this.nodes[id]!.left = this.split(lo, mid);
      this.nodes[id]!.right = this.split(mid, hi);
    }
    return id;
  }
  /** The nearest hit along the ray on a wall facing away from it (the inside of the far wall), or Infinity. */
  cast(o: V3, d: V3, skip: number, maxT: number): number {
    let best = maxT;
    const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]];
    const stack = this.nodes.length ? [0] : [];
    while (stack.length) {
      const node = this.nodes[stack.pop()!]!;
      let t0 = 0;
      let t1 = best;
      for (let k = 0; k < 3; k++) {
        let a = (node.min[k]! - o[k]!) * inv[k]!;
        let b = (node.max[k]! - o[k]!) * inv[k]!;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (t0 > t1 + 1e-9) continue;
      if (node.left !== undefined) {
        stack.push(node.left, node.right!);
        continue;
      }
      for (let i = node.lo; i < node.hi; i++) {
        const t = this.order[i]!;
        if (t === skip) continue;
        const h = this.hit(t, o, d);
        if (h > 1e-4 && h < best) best = h;
      }
    }
    return best;
  }
  private hit(t: number, o: V3, d: V3): number {
    // Corner a, edges e1 and e2, and the unit normal, packed per triangle (no allocation in the hot loop).
    const T = this.tris;
    const j = t * 12;
    const nx = T[j + 9]!;
    const ny = T[j + 10]!;
    const nz = T[j + 11]!;
    // Only the inside of a wall counts: its outward normal points along the ray. Walls the ray slides along don't.
    if (nx * d[0] + ny * d[1] + nz * d[2] < 0.1) return Infinity;
    const e1x = T[j + 3]!;
    const e1y = T[j + 4]!;
    const e1z = T[j + 5]!;
    const e2x = T[j + 6]!;
    const e2y = T[j + 7]!;
    const e2z = T[j + 8]!;
    const px = d[1] * e2z - d[2] * e2y;
    const py = d[2] * e2x - d[0] * e2z;
    const pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return Infinity;
    const sx = o[0] - T[j]!;
    const sy = o[1] - T[j + 1]!;
    const sz = o[2] - T[j + 2]!;
    const u = (sx * px + sy * py + sz * pz) / det;
    if (u < -1e-6 || u > 1 + 1e-6) return Infinity;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
    if (v < -1e-6 || u + v > 1 + 1e-6) return Infinity;
    return (e2x * qx + e2y * qy + e2z * qz) / det;
  }
}

/**
 * Wall thickness (#101): from the middle of each triangle, a ray straight into the body; where it meets the far wall
 * sooner than `threshold` mm, the wall is thin. Rays miss walls at grazing angles, so this is a guide, not a proof.
 */
export function thickness(m: CheckMesh, threshold = 0.8): CheckResult & { min: number | null } {
  const values = new Float32Array(m.positions.length / 3);
  const bvh = new Bvh(m);
  const depth = new Float32Array(m.indices.length / 3);
  const flagged: number[] = [];
  let total = 0;
  let min = Infinity;
  for (let t = 0; t < m.indices.length / 3; t++) {
    const { a, b, c, n, area } = tri(m, t);
    if (!area) continue;
    const o: V3 = [(a[0] + b[0] + c[0]) / 3 - n[0] * 1e-5, (a[1] + b[1] + c[1]) / 3 - n[1] * 1e-5, (a[2] + b[2] + c[2]) / 3 - n[2] * 1e-5];
    const d = bvh.cast(o, [-n[0], -n[1], -n[2]], t, threshold * 4);
    depth[t] = d;
    if (d >= threshold - 1e-6) continue;
    const v = 0.35 + 0.65 * Math.min(1, 1 - d / threshold);
    for (let k = 0; k < 3; k++) {
      const i = m.indices[t * 3 + k]!;
      values[i] = Math.max(values[i]!, v);
    }
    flagged.push(t);
    total += area;
    min = Math.min(min, d);
  }
  return { values, areas: group(m, flagged, (t) => depth[t]!, threshold * 1.5), area: total, min: flagged.length ? min : null };
}
