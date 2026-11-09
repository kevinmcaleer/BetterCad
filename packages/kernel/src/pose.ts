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
 * with its parent and then about its own joint, in the parent's moved frame. A component inside another (`nested`, its
 * parent by id) with no joint of its own rides on its parent (#171). Links that hang from nothing, and joints in a loop
 * (which the build already refuses), stay at home and are left out.
 */
export function linkTransforms(joints: PoseJoint[], pose: Pose | undefined, nested?: { id: string; parent?: string }[]): Map<string, Mat4> {
  const out = new Map<string, Mat4 | null>();
  const jointOf = new Map(joints.map((j) => [j.child, j]));
  const parentOf = new Map((nested ?? []).flatMap((l) => (l.parent ? [[l.id, l.parent] as const] : [])));
  const at = (id: string | null | undefined, path: Set<string>): Mat4 | null => {
    if (!id || path.has(id)) return null;
    if (out.has(id)) return out.get(id)!;
    path.add(id);
    const j = jointOf.get(id);
    const m = j ? mat4Mul(at(j.parent, path) ?? IDENTITY, jointMotion(j, jointValue(j, pose))) : at(parentOf.get(id), path);
    path.delete(id);
    out.set(id, m);
    return m;
  };
  for (const id of new Set([...jointOf.keys(), ...parentOf.keys()])) at(id, new Set());
  return new Map([...out].filter((e): e is [string, Mat4] => e[1] !== null));
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

/** What lining a joint up needs: the parent's snap (origin and axis) and the moving part's, and the line-up. */
export interface JointLineUp {
  origin: V3;
  axis: V3;
  /** The moving part's snap, where it stood before the joint: left out, it stays where it was modelled. */
  from?: { point: V3; normal: V3 };
  angle?: number;
  gap?: number;
  offset?: V3;
  flip?: boolean;
}

const translate = (v: V3): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1];
const turn = (axis: V3, deg: number, origin: V3 = [0, 0, 0]) => jointMotion({ kind: "revolute", origin, axis }, deg);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Any direction square to `a`. */
const across = (a: V3): V3 => norm(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));

/** The turn that takes direction `a` to direction `b`, about the world origin. */
function turnOnto(a: V3, b: V3): Mat4 {
  const u = norm(a);
  const v = norm(b);
  const c = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  if (c > 1 - 1e-12) return IDENTITY.slice();
  const axis = c < -1 + 1e-12 ? across(u) : cross(u, v);
  return turn(axis, (Math.acos(c) * 180) / Math.PI);
}

/**
 * How a joint moves the part it joins, as in the Projects scene editor: the moving part's snap lands on the parent's,
 * face to face (its normal looking back down the parent's, or along it when flipped), then it turns `angle`° about the
 * axis, stands off by `gap` mm and moves by `offset`. With no snap of its own, it turns over when flipped and takes the
 * angle, gap and offset where it stands. Null when it doesn't move.
 */
export function jointMove(j: JointLineUp): Mat4 | null {
  const n = norm(j.axis);
  const o = j.origin;
  let m: Mat4 | null = null;
  if (j.from) {
    const r = turnOnto(j.from.normal, j.flip ? n : [-n[0], -n[1], -n[2]]);
    const p = j.from.point;
    m = mat4Mul(translate(o), mat4Mul(r, translate([-p[0], -p[1], -p[2]])));
  } else if (j.flip) m = turn(across(n), 180, o);
  if (j.angle) m = mat4Mul(turn(n, j.angle, o), m ?? IDENTITY);
  const g = j.gap ?? 0;
  const off = j.offset ?? [0, 0, 0];
  if (g || off[0] || off[1] || off[2]) m = mat4Mul(translate([n[0] * g + off[0], n[1] * g + off[1], n[2] * g + off[2]]), m ?? IDENTITY);
  return m;
}

/** A frame (origin, X and normal) carried by a move: a sketch plane riding on its component. */
export function moveFrame<F extends { origin: V3; x: V3; normal: V3 }>(m: Mat4, f: F): F {
  return { ...f, origin: mat4Apply(m, f.origin), x: norm(mat4ApplyDir(m, f.x)), normal: norm(mat4ApplyDir(m, f.normal)) };
}

/** The inverse of a move made of turns and slides. */
export function mat4InvertRigid(m: Mat4): Mat4 {
  const t: V3 = [m[12]!, m[13]!, m[14]!];
  // Rᵀ, column-major.
  const r: Mat4 = [m[0]!, m[4]!, m[8]!, 0, m[1]!, m[5]!, m[9]!, 0, m[2]!, m[6]!, m[10]!, 0, 0, 0, 0, 1];
  const rt = mat4ApplyDir(r, t);
  r[12] = -rt[0];
  r[13] = -rt[1];
  r[14] = -rt[2];
  return r;
}

/** A part's place (turned about X, then Y, then Z, in degrees, then moved), as a transform. */
export function placeMatrix(position: V3, rotation: V3): Mat4 {
  const r = mat4Mul(turn([0, 0, 1], rotation[2]), mat4Mul(turn([0, 1, 0], rotation[1]), turn([1, 0, 0], rotation[0])));
  return mat4Mul(translate(position), r);
}

/** A transform back to a place: the position, and the turns about X, Y and Z (degrees) that `placeMatrix` takes. */
export function placeOf(m: Mat4): { position: V3; rotation: V3 } {
  const d = 180 / Math.PI;
  const r20 = m[2]!;
  const tidy = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  let x: number, y: number, z: number;
  if (Math.abs(r20) > 1 - 1e-9) {
    // Straight up or down: the X and Z turns are about one line, so it all goes in Z.
    y = r20 < 0 ? 90 : -90;
    x = 0;
    z = Math.atan2(-m[4]!, m[5]!) * d;
  } else {
    y = Math.asin(-r20) * d;
    x = Math.atan2(m[6]!, m[10]!) * d;
    z = Math.atan2(m[1]!, m[0]!) * d;
  }
  return { position: [tidy(m[12]!), tidy(m[13]!), tidy(m[14]!)], rotation: [tidy(x), tidy(y), tidy(z)] };
}
