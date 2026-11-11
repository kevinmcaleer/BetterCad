import type { BodyMesh } from "@bettercad/kernel";
import type { DecalFeature } from "../state/document";

/**
 * Where a decal (#263) sits: the face's own frame, and the picture laid on the face's triangles in it. Framework-free,
 * so the maths is tested without a view.
 */
export type V3 = [number, number, number];

/** A flat face's frame: its middle, the way its picture's right and up point, and its outward normal. */
export interface FaceFrame {
  origin: V3;
  x: V3;
  y: V3;
  normal: V3;
  /** The face's size along x and y, mm. */
  size: [number, number];
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const vertex = (m: BodyMesh, i: number): V3 => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];

/** How far a triangle's normal may lean from the face's and still count as flat: about 1°. */
const FLAT = Math.cos((1 * Math.PI) / 180);

/**
 * A face's frame, or null when the face is not flat (or not there). Up is world Z on an upright face, so a label on a
 * box's side reads the right way up; on a face looking up or down, right is world X.
 */
export function faceFrame(m: BodyMesh, face: number): FaceFrame | null {
  if (face < 0 || face >= m.faceTris.length - 1) return null;
  const from = m.faceTris[face]!;
  const to = m.faceTris[face + 1]!;
  if (to <= from) return null;
  const sum: V3 = [0, 0, 0];
  const normals: V3[] = [];
  for (let t = from; t < to; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => vertex(m, m.indices[t * 3 + k]!)) as [V3, V3, V3];
    const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    if (Math.hypot(...n) < 1e-12) continue;
    normals.push(unit(n));
    for (let k = 0; k < 3; k++) sum[k]! += n[k]!;
  }
  if (!normals.length) return null;
  const normal = unit(sum);
  if (normals.some((n) => dot(n, normal) < FLAT)) return null;
  const upright = Math.abs(normal[2]) < 0.9;
  let x: V3;
  let y: V3;
  if (upright) {
    y = unit([-normal[2] * normal[0], -normal[2] * normal[1], 1 - normal[2] * normal[2]]);
    x = cross(y, normal);
  } else {
    x = unit([1 - normal[0] * normal[0], -normal[0] * normal[1], -normal[0] * normal[2]]);
    y = cross(normal, x);
  }
  // The middle of the face's box in its own frame, on its plane.
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  let level = 0;
  const v0 = m.faceVerts[face]!;
  const v1 = m.faceVerts[face + 1]!;
  for (let v = v0; v < v1; v++) {
    const p = vertex(m, v);
    const u = [dot(p, x), dot(p, y)];
    for (let k = 0; k < 2; k++) {
      lo[k] = Math.min(lo[k]!, u[k]!);
      hi[k] = Math.max(hi[k]!, u[k]!);
    }
    level += dot(p, normal);
  }
  level /= Math.max(1, v1 - v0);
  const cu = (lo[0]! + hi[0]!) / 2;
  const cv = (lo[1]! + hi[1]!) / 2;
  const origin: V3 = [0, 1, 2].map((k) => x[k]! * cu + y[k]! * cv + normal[k]! * level) as V3;
  return { origin, x, y, normal, size: [hi[0]! - lo[0]!, hi[1]! - lo[1]!] };
}

export type Placement = Pick<DecalFeature, "x" | "y" | "width" | "height" | "angle" | "flip">;

/**
 * Where a point on the face lands on the picture: (0, 0) its bottom left, (1, 1) its top right, outside that off it.
 * The picture is centred `x`, `y` mm from the face's middle, turned anticlockwise by `angle` seen from outside.
 */
export function pictureAt(f: FaceFrame, d: Placement, p: V3): [number, number] {
  const r: V3 = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  const u = dot(r, f.x) - d.x;
  const v = dot(r, f.y) - d.y;
  const a = (-d.angle * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const s0 = (u * c - v * s) / d.width + 0.5;
  const t0 = (u * s + v * c) / d.height + 0.5;
  return [d.flip ? 1 - s0 : s0, t0];
}

/** The face's point at a spot on the picture (the inverse of pictureAt): for handles and the drag. */
export function pointOnPicture(f: FaceFrame, d: Placement, s: number, t: number): V3 {
  const s0 = d.flip ? 1 - s : s;
  const lu = (s0 - 0.5) * d.width;
  const lv = (t - 0.5) * d.height;
  const a = (d.angle * Math.PI) / 180;
  const [c, sn] = [Math.cos(a), Math.sin(a)];
  const u = lu * c - lv * sn + d.x;
  const v = lu * sn + lv * c + d.y;
  return [0, 1, 2].map((k) => f.origin[k]! + f.x[k]! * u + f.y[k]! * v) as V3;
}

/** A point given in the face's frame: mm right and up of its middle. */
export function inFace(f: FaceFrame, p: V3): [number, number] {
  const r: V3 = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  return [dot(r, f.x), dot(r, f.y)];
}

/** The mesh a decal is drawn with: the face's own triangles, lifted off it a little, with the picture's coordinates. */
export interface DecalMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Lifted this far off the face (mm), so the picture never fights the face for the same pixels. */
export const LIFT = 0.02;

/**
 * The decal's mesh on face `face`. `margin` is the share of the texture left clear round the picture on each side, so
 * the triangles' parts off the picture sample clear pixels.
 */
export function decalMesh(m: BodyMesh, face: number, f: FaceFrame, d: Placement, margin = 0): DecalMesh {
  const v0 = m.faceVerts[face]!;
  const v1 = m.faceVerts[face + 1]!;
  const n = v1 - v0;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const k = 1 - 2 * margin;
  for (let i = 0; i < n; i++) {
    const p = vertex(m, v0 + i);
    for (let j = 0; j < 3; j++) {
      positions[i * 3 + j] = p[j]! + f.normal[j]! * LIFT;
      normals[i * 3 + j] = f.normal[j]!;
    }
    const [s, t] = pictureAt(f, d, p);
    uvs[i * 2] = margin + s * k;
    uvs[i * 2 + 1] = margin + t * k;
  }
  const t0 = m.faceTris[face]!;
  const t1 = m.faceTris[face + 1]!;
  const indices = new Uint32Array((t1 - t0) * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = m.indices[t0 * 3 + i]! - v0;
  return { positions, normals, uvs, indices };
}

/** The face a decal sits on now: found by its name when the kernel names faces, else by its number. */
export function decalFace(d: Pick<DecalFeature, "face" | "faceName">, names?: string[]): number {
  if (d.faceName && names) {
    const i = names.indexOf(d.faceName);
    if (i >= 0) return i;
  }
  return d.face;
}
