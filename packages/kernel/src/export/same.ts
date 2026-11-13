/**
 * Bodies that are the same shape, only moved and turned (a track's pieces, a pattern's copies, the mirror image of a
 * symmetrical part), so a print needs one file of the shape and how many to make. Pure maths on triangles: each body's
 * surface moments give its middle and its main axes, a copy's axes give the turn from the first one, and its corners
 * have to land on the copy's to count.
 */
import type { MeshBody } from "./mesh";

/** Row-major 3×3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type V3 = [number, number, number];

export interface SameShape {
  /** The index of the body the others copy. */
  first: number;
  /** Every body of this shape, the first one too, with the turn and move that put the first one where it is. */
  copies: { index: number; turn: Mat3; move: V3 }[];
}

interface Moments {
  area: number;
  centre: V3;
  /** Main axes as columns, largest spread first, and the spreads. */
  axes: Mat3;
  spread: V3;
  size: number;
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function moments(t: Float32Array): Moments | null {
  let area = 0;
  const s = [0, 0, 0];
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i + 8 < t.length; i += 9) {
    const ax = t[i + 3]! - t[i]!,
      ay = t[i + 4]! - t[i + 1]!,
      az = t[i + 5]! - t[i + 2]!;
    const bx = t[i + 6]! - t[i]!,
      by = t[i + 7]! - t[i + 1]!,
      bz = t[i + 8]! - t[i + 2]!;
    const a = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
    if (!(a > 0)) continue;
    area += a;
    const sum = [0, 0, 0];
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) sum[k] += t[i + v * 3 + k]!;
    for (let k = 0; k < 3; k++) s[k]! += (a * sum[k]!) / 3;
    // ∫ x xᵀ dA over the triangle: a/12 (Σ vᵢvᵢᵀ + (Σ vᵢ)(Σ vᵢ)ᵀ).
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        let vv = 0;
        for (let v = 0; v < 3; v++) vv += t[i + v * 3 + r]! * t[i + v * 3 + c]!;
        m[r * 3 + c]! += (a / 12) * (vv + sum[r]! * sum[c]!);
      }
    for (let k = i; k < i + 9; k++) {
      lo = Math.min(lo, t[k]!);
      hi = Math.max(hi, t[k]!);
    }
  }
  if (!(area > 0)) return null;
  const centre = s.map((v) => v / area) as V3;
  const cov = m.map((v, i) => v / area - centre[Math.floor(i / 3)]! * centre[i % 3]!);
  const { values, vectors } = eigen(cov);
  return { area, centre, axes: vectors, spread: values, size: hi - lo };
}

/** Eigenvalues (largest first) and eigenvectors (columns, right-handed) of a symmetric 3×3, by Jacobi turns. */
export function eigen(a0: number[]): { values: V3; vectors: Mat3 } {
  const a = [...a0];
  const v = [...IDENTITY];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[1]! ** 2 + a[2]! ** 2 + a[5]! ** 2;
    if (off < 1e-24 * (a[0]! ** 2 + a[4]! ** 2 + a[8]! ** 2 + 1e-300)) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const apq = a[p * 3 + q]!;
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p]!,
          akq = a[k * 3 + q]!;
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k]!,
          aqk = a[q * 3 + k]!;
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p]!,
          vkq = v[k * 3 + q]!;
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j * 4]! - a[i * 4]!);
  const vectors = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
  order.forEach((col, i) => {
    for (let r = 0; r < 3; r++) vectors[r * 3 + i] = v[r * 3 + col]!;
  });
  if (det(vectors) < 0) for (let r = 0; r < 3; r++) vectors[r * 3 + 2] = -vectors[r * 3 + 2]!;
  return { values: order.map((i) => a[i * 4]!) as V3, vectors };
}

const det = (m: Mat3) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k]! * b[k * 3 + c]!;
  return out;
}

const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

const apply = (m: Mat3, x: number, y: number, z: number): V3 => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
];

/** A lookup of a body's corners, to tell whether a point lands on one. */
class Corners {
  private cells = new Map<string, number[]>();
  constructor(
    t: Float32Array,
    private tol: number,
  ) {
    for (let i = 0; i + 2 < t.length; i += 3) {
      const key = this.key(t[i]!, t[i + 1]!, t[i + 2]!);
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      if (list.length < 64) list.push(t[i]!, t[i + 1]!, t[i + 2]!);
    }
  }
  private key(x: number, y: number, z: number) {
    return `${Math.floor(x / this.tol)},${Math.floor(y / this.tol)},${Math.floor(z / this.tol)}`;
  }
  has(x: number, y: number, z: number): boolean {
    const cx = Math.floor(x / this.tol),
      cy = Math.floor(y / this.tol),
      cz = Math.floor(z / this.tol);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (let i = 0; i < list.length; i += 3) if (Math.hypot(list[i]! - x, list[i + 1]! - y, list[i + 2]! - z) <= this.tol) return true;
        }
    return false;
  }
}

const SIGNS: V3[] = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
];

/**
 * The turn and move that put body `a` onto body `b`, or null when they aren't the same shape. Only turns, never a
 * mirror: a mirror image prints as a different part unless the part is symmetrical, and then a turn does it.
 */
function fit(a: Float32Array, ma: Moments, mb: Moments, corners: Corners): { turn: Mat3; move: V3 } | null {
  const tol = 0.01;
  if (Math.abs(ma.area - mb.area) > tol * ma.area) return null;
  const big = ma.spread[0];
  if (ma.spread.some((s, i) => Math.abs(s - mb.spread[i]!) > tol * big + 1e-6)) return null;
  // Two spreads alike leave the axes free to turn between them: the moments can't say how it's turned.
  if (ma.spread[0] - ma.spread[1] < 0.02 * big || ma.spread[1] - ma.spread[2] < 0.02 * big) return null;
  const stride = Math.max(1, Math.floor(a.length / 3 / 400)) * 3;
  for (const s of SIGNS) {
    const flipped = mb.axes.map((v, i) => v * s[i % 3]!) as Mat3;
    const turn = mul(flipped, transpose(ma.axes));
    const r = apply(turn, ...ma.centre);
    const move: V3 = [mb.centre[0] - r[0], mb.centre[1] - r[1], mb.centre[2] - r[2]];
    let hits = 0;
    let tried = 0;
    for (let i = 0; i + 2 < a.length; i += stride) {
      const p = apply(turn, a[i]!, a[i + 1]!, a[i + 2]!);
      tried++;
      if (corners.has(p[0] + move[0], p[1] + move[1], p[2] + move[2])) hits++;
    }
    if (tried && hits >= 0.9 * tried) return { turn, move };
  }
  return null;
}

/** The bodies grouped by shape, in the order each shape first comes. A body like no other is a group of its own. */
export function sameShapes(bodies: MeshBody[]): SameShape[] {
  const m = bodies.map((b) => moments(b.triangles));
  const groups: SameShape[] = [];
  const corners = new Map<number, Corners>();
  for (let i = 0; i < bodies.length; i++) {
    const mi = m[i];
    let placed = false;
    if (mi)
      for (const g of groups) {
        const mf = m[g.first];
        if (!mf) continue;
        let c = corners.get(i);
        if (!c) corners.set(i, (c = new Corners(bodies[i]!.triangles, Math.max(0.02, mi.size * 2e-4))));
        const f = fit(bodies[g.first]!.triangles, mf, mi, c);
        if (f) {
          g.copies.push({ index: i, ...f });
          placed = true;
          break;
        }
      }
    if (!placed) groups.push({ first: i, copies: [{ index: i, turn: [...IDENTITY] as Mat3, move: [0, 0, 0] }] });
  }
  return groups;
}

/**
 * A turn as roll, pitch and yaw in degrees (about X, then Y, then Z, as URDF's rpy and the kevsrobots scene editor
 * have it: R = Rz(yaw) Ry(pitch) Rx(roll)).
 */
export function rpy(m: Mat3): V3 {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m[6])));
  let roll: number;
  let yaw: number;
  if (Math.abs(m[6]) < 0.9999999) {
    roll = Math.atan2(m[7], m[8]);
    yaw = Math.atan2(m[3], m[0]);
  } else {
    roll = 0;
    yaw = Math.atan2(-m[1], m[4]);
  }
  const d = (r: number) => Math.round(((r * 180) / Math.PI) * 1000) / 1000 + 0;
  return [d(roll), d(pitch), d(yaw)];
}
