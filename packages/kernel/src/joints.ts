/**
 * Joints (#172): how a child link hangs from its parent, as URDF has it. The maths here is pure, so the editor and the
 * tests share it; the frame comes from what was picked, as the Measure tool describes it.
 */
import type { Single } from "./occt/measure";

export type V3 = [number, number, number];
export type JointKind = "revolute" | "continuous" | "prismatic" | "fixed";

/** The kinds, in plain words first, with URDF's name beside them. */
export const JOINT_KINDS: { id: JointKind; label: string; urdf: string; title: string }[] = [
  { id: "revolute", label: "Hinge", urdf: "revolute", title: "Turns about the axis, between limits" },
  { id: "continuous", label: "Wheel", urdf: "continuous", title: "Turns about the axis without limits" },
  { id: "prismatic", label: "Slider", urdf: "prismatic", title: "Slides along the axis, between limits" },
  { id: "fixed", label: "Fixed", urdf: "fixed", title: "Doesn't move: bolted on" },
];

/** Limits each kind starts with: degrees for a hinge, mm for a slider. */
export const JOINT_LIMITS: Record<JointKind, { lower: number; upper: number }> = {
  revolute: { lower: -90, upper: 90 },
  continuous: { lower: 0, upper: 0 },
  prismatic: { lower: 0, upper: 50 },
  fixed: { lower: 0, upper: 0 },
};

/** Whether a kind has limits, and their unit. */
export const limitUnit = (k: JointKind): "°" | "mm" | null => (k === "revolute" ? "°" : k === "prismatic" ? "mm" : null);

export const LOOP_MESSAGE = "A link can only hang from one joint. Closed loops can't go in URDF.";

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 | null => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : null;
};
const tidy = (a: V3): V3 => a.map((v) => (Math.abs(v) < 1e-9 ? 0 : Math.round(v * 1e6) / 1e6)) as V3;

/**
 * A joint's origin and axis from what was picked: a round edge or a round face gives its axis through its centre, a
 * flat face its normal through its middle, a straight edge its own line through its middle. Anything else gives none.
 */
export function jointFrame(s: Single): { origin: V3; axis: V3 } | null {
  if (s.kind === "edge") {
    if (s.circle?.axis) {
      // The way the rim faces, when the kernel could tell, so the snap faces out of the part as a face's does.
      const axis = unit(s.circle.facing ?? s.circle.axis);
      return axis && { origin: tidy(s.circle.centre), axis: tidy(axis) };
    }
    if (s.line) {
      const mid: V3 = [(s.ends[0][0] + s.ends[1][0]) / 2, (s.ends[0][1] + s.ends[1][1]) / 2, (s.ends[0][2] + s.ends[1][2]) / 2];
      const axis = unit(s.line);
      return axis && { origin: tidy(mid), axis: tidy(axis) };
    }
    return null;
  }
  if (s.kind === "face") {
    if (s.circle) {
      const axis = unit(s.circle.axis);
      if (!axis) return null;
      // On the axis, level with the middle of the face.
      const t = dot(sub(s.centre, s.circle.centre), axis);
      const c = s.circle.centre;
      return { origin: tidy([c[0] + axis[0] * t, c[1] + axis[1] * t, c[2] + axis[2] * t]), axis: tidy(axis) };
    }
    if (s.normal) {
      const axis = unit(s.normal);
      return axis && { origin: tidy(s.centre), axis: tidy(axis) };
    }
  }
  return null;
}

/** A joint as the tree sees it: the link it moves and the one it hangs from (null for Base). */
export interface JointLink {
  child: string;
  parent: string | null;
}

/**
 * Why a new joint can't go in: the child already hangs from one, or hanging it would close a loop. Null when it can.
 */
export function jointLinkProblem(joints: JointLink[], child: string, parent: string | null): string | null {
  if (child === parent) return "A link can't hang from itself";
  if (joints.some((j) => j.child === child)) return LOOP_MESSAGE;
  // Walk up from the parent: meeting the child means the child would be its own ancestor.
  const up = new Map(joints.map((j) => [j.child, j.parent]));
  const seen = new Set<string>();
  for (let at = parent; at !== null && !seen.has(at); at = up.get(at) ?? null) {
    if (at === child) return LOOP_MESSAGE;
    seen.add(at);
  }
  return null;
}
