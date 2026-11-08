/**
 * Inverse kinematics (#176): drag an arm's tool point and the joints between it and Base move to follow, within their
 * limits. Position only. Damped least squares over the chain's hinges, wheels and sliders, in plain TypeScript: no
 * DOM, no kernel. Joint values are degrees and mm, as in a pose; the tool point is where it sits at home, in the world.
 */
import { clampJoint, driveTo, linkTransforms, mat4Apply, posedFrames, resolvePose, type Pose, type PoseDrive, type PoseJoint, type V3 } from "./document";

export interface IkProblem {
  joints: PoseJoint[];
  drives?: PoseDrive[];
  /** The link the tool point rides on, and where the point is at home. */
  link: string;
  point: V3;
  /** Joint ids kept out of the solve. */
  locked?: string[];
}

export interface IkResult {
  pose: Pose;
  /** Where the tool point ends up, and how far that is from the target, mm. */
  at: V3;
  miss: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const RAD = Math.PI / 180;

/** The joints from Base down to the link, root first. */
export function chainTo(joints: PoseJoint[], link: string): PoseJoint[] {
  const out: PoseJoint[] = [];
  for (let at: string | null = link, n = 0; at !== null && n <= joints.length; n++) {
    const j = joints.find((x) => x.child === at);
    if (!j) break;
    out.unshift(j);
    at = j.parent;
  }
  return out;
}

/** Where the tool point is in a pose. */
export function toolPoint(p: IkProblem, pose: Pose | undefined): V3 {
  const m = linkTransforms(p.joints, resolvePose(p.drives ?? [], pose)).get(p.link);
  return m ? mat4Apply(m, p.point) : [...p.point];
}

/**
 * Moves the chain so the tool point gets as near `target` as it can, starting from `start`. Joints that are locked,
 * fixed or driven by another joint stay out; a driven joint still follows its driver. Out of reach, the arm stretches
 * to the nearest point it can, and `miss` says by how much.
 */
export function solveIk(p: IkProblem, start: Pose | undefined, target: V3, iterations = 60): IkResult {
  const drives = p.drives ?? [];
  const locked = new Set(p.locked ?? []);
  const driven = new Set(drives.map((d) => d.driven));
  const vars = chainTo(p.joints, p.link).filter((j) => j.kind !== "fixed" && !locked.has(j.id) && !driven.has(j.id));
  let pose: Pose = { ...start };
  let at = toolPoint(p, pose);
  let miss = Math.hypot(...sub(target, at));
  if (!vars.length) return { pose, at, miss };
  // Damping keeps it steady near a straight arm; it grows when a step makes things worse. It is scaled by the
  // Jacobian's size, so a small arm moves as readily as a big one.
  let mu = 0.5;
  for (let it = 0; it < iterations && miss > 1e-3; it++) {
    const frames = posedFrames(p.joints, linkTransforms(p.joints, resolvePose(drives, pose)));
    // Columns of the Jacobian: how the tool point moves per degree or per mm of each joint.
    const J = vars.map((j): V3 => {
      const f = frames.get(j.id) ?? j;
      if (j.kind === "prismatic") return f.axis;
      const c = cross(f.axis, sub(at, f.origin));
      return [c[0] * RAD, c[1] * RAD, c[2] * RAD];
    });
    const e = sub(target, at);
    // Δq = Jᵀ (J Jᵀ + λ² I)⁻¹ e
    const JJ = [0, 1, 2].map((r) => [0, 1, 2].map((c) => J.reduce((s, col) => s + col[r]! * col[c]!, 0)));
    const lambda2 = mu * mu * (JJ[0]![0]! + JJ[1]![1]! + JJ[2]![2]! || 1);
    const A = JJ.map((row, r) => row.map((v, c) => v + (r === c ? lambda2 : 0)));
    const y = solve3(A, e);
    if (!y) break;
    const next: Pose = { ...pose };
    vars.forEach((j, k) => {
      const dq = J[k]![0] * y[0] + J[k]![1] * y[1] + J[k]![2] * y[2];
      const now = next[j.id] ?? 0;
      next[j.id] = drives.length ? driveTo(p.joints, drives, next, j.id, now + dq).value : j.kind === "continuous" ? now + dq : clampJoint(j, now + dq);
    });
    const nextAt = toolPoint(p, next);
    const nextMiss = Math.hypot(...sub(target, nextAt));
    if (nextMiss < miss) {
      pose = next;
      at = nextAt;
      miss = nextMiss;
      mu = Math.max(0.01, mu * 0.5);
    } else {
      mu *= 4;
      if (mu > 1e3) break;
    }
  }
  return { pose, at, miss };
}

/** Where a point seen in a pose sits at home: the link's move undone (it is rigid, so its inverse is its transpose). */
export function homeOf(m: number[], p: V3): V3 {
  const d: V3 = [p[0] - m[12]!, p[1] - m[13]!, p[2] - m[14]!];
  return [m[0]! * d[0] + m[1]! * d[1] + m[2]! * d[2], m[4]! * d[0] + m[5]! * d[1] + m[6]! * d[2], m[8]! * d[0] + m[9]! * d[1] + m[10]! * d[2]];
}

/** A 3 × 3 system by Cramer's rule, or null when it's singular. */
function solve3(A: number[][], b: V3): V3 | null {
  const det = (m: number[][]) =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const d = det(A);
  if (Math.abs(d) < 1e-12) return null;
  const col = (k: number) => A.map((row, r) => row.map((v, c) => (c === k ? b[r]! : v)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}
