/**
 * Posing (#173): turn hinges and wheels, slide sliders, and see the mechanism move. A pose is view state, not a step:
 * joint values by joint id, in degrees or mm, zero at home (where the joint was made). Forward kinematics runs down the
 * joint tree, so moving a parent carries everything below it. The maths is pure, with no three.js, so the editor, the
 * tests and a later URDF export share it.
 */
import type { JointKind, V3 } from "./joints";

/** Joint values by joint id: degrees for a hinge or wheel, mm for a slider. A joint left out is at home (0). */
export type Pose = Record<string, number>;

/** A 4×4 transform, column-major (as three.js's Matrix4.elements). */
export type Mat4 = number[];

/** What posing needs of a joint: JointFeature has it all. */
export interface PoseJoint {
  id: string;
  kind: JointKind;
  child: string;
  parent: string | null;
  origin: V3;
  axis: V3;
  lower: number;
  upper: number;
}

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Whether a joint moves at all: a fixed joint doesn't. */
export const movable = (j: Pick<PoseJoint, "kind">) => j.kind !== "fixed";

/**
 * A value the joint can take: a hinge and a slider stay between their limits, a wheel wraps to -180°…180°, a fixed
 * joint is always 0.
 */
export function clampJoint(j: Pick<PoseJoint, "kind" | "lower" | "upper">, v: number): number {
  if (!Number.isFinite(v) || j.kind === "fixed") return 0;
  if (j.kind === "continuous") {
    if (v >= -180 && v <= 180) return v;
    return ((((v + 180) % 360) + 360) % 360) - 180;
  }
  const lo = Math.min(j.lower, j.upper);
  const hi = Math.max(j.lower, j.upper);
  return Math.min(hi, Math.max(lo, v));
}

/** The joint's value in a pose, kept in range. */
export const jointValue = (j: PoseJoint, pose: Pose | undefined) => clampJoint(j, pose?.[j.id] ?? 0);

/** a × b, column-major. */
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const r = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row]! * b[c * 4 + k]!;
      r[c * 4 + row] = s;
    }
  return r;
}

/** Where a point goes under a transform. */
export function mat4Apply(m: Mat4, p: V3): V3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

/** Where a direction goes under a transform (no translation). */
export function mat4ApplyDir(m: Mat4, d: V3): V3 {
  return [m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2], m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2], m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2]];
}

const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * The joint's own motion in home (world) coordinates: a turn of `value`° about the axis through the origin, or a slide of
 * `value` mm along the axis.
 */
export function jointMotion(j: Pick<PoseJoint, "kind" | "origin" | "axis">, value: number): Mat4 {
  const [x, y, z] = norm(j.axis);
  if (j.kind === "prismatic") return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x * value, y * value, z * value, 1];
  if (j.kind === "fixed" || value === 0) return IDENTITY.slice();
  const t = (value * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = 1 - c;
  // Rodrigues, column-major.
  const r: Mat4 = [
    c + x * x * k,
    y * x * k + z * s,
    z * x * k - y * s,
    0,
    x * y * k - z * s,
    c + y * y * k,
    z * y * k + x * s,
    0,
    x * z * k + y * s,
    y * z * k - x * s,
    c + z * z * k,
    0,
    0,
    0,
    0,
    1,
  ];
  // About the origin: p' = R (p - o) + o.
  const [ox, oy, oz] = j.origin;
  const ro = mat4Apply(r, j.origin);
  r[12] = ox - ro[0];
  r[13] = oy - ro[1];
  r[14] = oz - ro[2];
  return r;
}

/**
 * Forward kinematics: where each jointed link sits in the pose, as a transform from home, by link id. A child moves
 * with its parent and then about its own joint, in the parent's moved frame. Links that hang from nothing, and joints
 * whose parent isn't reached (a loop, which the build already refuses), stay at home and are left out.
 */
export function linkTransforms(joints: PoseJoint[], pose: Pose | undefined): Map<string, Mat4> {
  const out = new Map<string, Mat4>();
  const byParent = new Map<string | null, PoseJoint[]>();
  for (const j of joints) byParent.set(j.parent, [...(byParent.get(j.parent) ?? []), j]);
  // Roots are joints on Base or on a link that has no joint of its own.
  const children = new Set(joints.map((j) => j.child));
  const queue: { j: PoseJoint; parent: Mat4 }[] = joints.filter((j) => j.parent === null || !children.has(j.parent)).map((j) => ({ j, parent: IDENTITY }));
  const seen = new Set<string>();
  while (queue.length) {
    const { j, parent } = queue.shift()!;
    if (seen.has(j.child)) continue;
    seen.add(j.child);
    const m = mat4Mul(parent, jointMotion(j, jointValue(j, pose)));
    out.set(j.child, m);
    for (const c of byParent.get(j.child) ?? []) queue.push({ j: c, parent: m });
  }
  return out;
}

/** Each joint's origin and axis in the pose, by joint id: they ride on the parent link. */
export function posedFrames(joints: PoseJoint[], links: Map<string, Mat4>): Map<string, { origin: V3; axis: V3 }> {
  const out = new Map<string, { origin: V3; axis: V3 }>();
  for (const j of joints) {
    const m = (j.parent && links.get(j.parent)) || IDENTITY;
    out.set(j.id, { origin: mat4Apply(m, j.origin), axis: norm(mat4ApplyDir(m, j.axis)) });
  }
  return out;
}

/** Whether every joint is at home. */
export const atHome = (joints: PoseJoint[], pose: Pose | undefined) => joints.every((j) => jointValue(j, pose) === 0);

/** "35°", "12 mm": a joint value as the UI shows it. */
export function formatJointValue(kind: JointKind, v: number): string {
  const r = Math.round(v * 10) / 10;
  return kind === "prismatic" ? `${r} mm` : `${r}°`;
}
