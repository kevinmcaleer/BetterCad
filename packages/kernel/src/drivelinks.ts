/**
 * Drive links (#194): one joint drives another by a ratio, so turning one turns the other. Meshed gears reverse the
 * direction, a belt keeps it, and a rack turns rotation into travel. The driven joint's value is always
 * `multiplier × driver + offset` (URDF's mimic), so a pose only keeps the driving joint's value. Pure maths.
 */
import { clampJoint, type Pose, type PoseJoint } from "./pose";
import type { JointKind } from "./joints";

/** `together` is a motion link: several joints move with a lead joint at the same speed (one step, many mimics). */
export type DriveKind = "gear" | "belt" | "rack" | "custom" | "together";

export const DRIVE_KINDS: { id: DriveKind; label: string; title: string }[] = [
  { id: "gear", label: "Gears", title: "Meshed gears: the driven one turns the other way, by the tooth ratio" },
  { id: "belt", label: "Belt", title: "Pulleys on a belt: the driven one turns the same way, by the tooth ratio" },
  { id: "rack", label: "Rack", title: "A gear on a rack: each turn slides it one pitch circle round" },
  { id: "custom", label: "Custom", title: "Any ratio you type" },
];

/** A drive as built: the driven joint's value is multiplier × the driver's + offset. */
export interface PoseDrive {
  id: string;
  driver: string;
  driven: string;
  /** Unitless between two rotary joints or two sliders; mm per degree from a hinge to a slider, degrees per mm back. */
  multiplier: number;
  offset: number;
}

const rotary = (k: JointKind) => k === "revolute" || k === "continuous";

/** A gear or pulley as the ratio needs it. */
export interface DriveGear {
  teeth: number;
  module: number;
  form: "spur" | "rack" | "gt2";
}

/**
 * The multiplier for a drive between two joints, from the gears on each when there are some. `axes` is the dot of the
 * two joints' axes: gears on parallel axes turn opposite ways, on axes that point opposite ways the same way. Null
 * when the kind doesn't fit the joints or the gears to work it out aren't there.
 */
export function driveMultiplier(
  kind: Exclude<DriveKind, "custom" | "together">,
  a: { kind: JointKind; gear?: DriveGear },
  b: { kind: JointKind; gear?: DriveGear },
  axes: number,
): number | null {
  const same = axes < 0 ? -1 : 1;
  if (kind === "rack") {
    // One end turns and the other slides; the gear's pitch circle rolls along the rack: π·m·z mm a turn.
    const spur = [a.gear, b.gear].find((g) => g?.form === "spur");
    if (!spur || rotary(a.kind) === rotary(b.kind) || !(rotary(a.kind) ? b.kind === "prismatic" : a.kind === "prismatic")) return null;
    const mmPerDeg = (Math.PI * spur.module * spur.teeth) / 360;
    return rotary(a.kind) ? mmPerDeg : 1 / mmPerDeg;
  }
  if (!rotary(a.kind) || !rotary(b.kind) || !a.gear || !b.gear) return null;
  const form = kind === "gear" ? "spur" : "gt2";
  if (a.gear.form !== form || b.gear.form !== form) return null;
  const r = a.gear.teeth / b.gear.teeth;
  return kind === "gear" ? -same * r : same * r;
}

/** Why the drive can't be: a joint is gone or doesn't move, drives itself, is driven twice, or the drives loop. */
export function driveProblem(joints: PoseJoint[], drives: Pick<PoseDrive, "driver" | "driven">[], driver: string, driven: string): string | null {
  const a = joints.find((j) => j.id === driver);
  const b = joints.find((j) => j.id === driven);
  if (!a || !b) return "A joint it links is gone";
  if (a.kind === "fixed" || b.kind === "fixed") return "A fixed joint can't drive or be driven";
  if (driver === driven) return "A joint can't drive itself";
  if (drives.some((d) => d.driven === driven)) return "That joint is already driven";
  // Walk up from the driver: reaching the driven one would make a loop.
  for (let at: string | undefined = driver, n = 0; at && n <= drives.length; n++) {
    if (at === driven) return "Those drives would go round in a loop";
    at = drives.find((d) => d.driven === at)?.driver;
  }
  return null;
}

/** Each joint as a line of the root driving it: value = a × root + b. A joint nothing drives is its own root. */
function chains(drives: PoseDrive[]): Map<string, { root: string; a: number; b: number }> {
  const out = new Map<string, { root: string; a: number; b: number }>();
  const of = (id: string, depth = 0): { root: string; a: number; b: number } => {
    const known = out.get(id);
    if (known) return known;
    const d = depth <= drives.length ? drives.find((x) => x.driven === id) : undefined;
    const up = d ? of(d.driver, depth + 1) : null;
    const line = d && up ? { root: up.root, a: d.multiplier * up.a, b: d.multiplier * up.b + d.offset } : { root: id, a: 1, b: 0 };
    out.set(id, line);
    return line;
  };
  for (const d of drives) of(d.driven);
  return out;
}

/** The pose with every driven joint's value filled in from its driver. A driven joint's own entry is ignored. */
export function resolvePose(drives: PoseDrive[], pose: Pose | undefined): Pose | undefined {
  if (!drives.length) return pose;
  const out: Pose = { ...pose };
  for (const [id, c] of chains(drives)) if (c.root !== id) out[id] = c.a * (pose?.[c.root] ?? 0) + c.b;
  return out;
}

/** The root driver's range that keeps every joint it drives within its limits. */
function rootRange(joints: PoseJoint[], drives: PoseDrive[], root: string): [number, number] {
  const j = joints.find((x) => x.id === root);
  let lo = j && j.kind !== "continuous" ? Math.min(j.lower, j.upper) : -Infinity;
  let hi = j && j.kind !== "continuous" ? Math.max(j.lower, j.upper) : Infinity;
  for (const [id, c] of chains(drives)) {
    if (c.root !== root || id === root || c.a === 0) continue;
    const k = joints.find((x) => x.id === id);
    if (!k || k.kind === "continuous") continue;
    const ends = [(Math.min(k.lower, k.upper) - c.b) / c.a, (Math.max(k.lower, k.upper) - c.b) / c.a];
    const next: [number, number] = [Math.max(lo, Math.min(...ends)), Math.min(hi, Math.max(...ends))];
    // Limits that can't all hold at once: keep the root's own.
    if (next[0] <= next[1]) [lo, hi] = next;
  }
  return [lo, hi];
}

/**
 * Moving joint `id` to `value`: the entry to set in the pose, which is the root driver's, kept within every limit along
 * the drive. A wheel is taken the shortest way round from where it is, so the joints it drives don't jump at ±180°.
 * Without drives it is the joint's own value, clamped as before.
 */
export function driveTo(joints: PoseJoint[], drives: PoseDrive[], pose: Pose | undefined, id: string, value: number): { id: string; value: number } {
  const j = joints.find((x) => x.id === id);
  const c = chains(drives).get(id);
  if (!j || !c || (c.root === id && !drives.some((d) => d.driver === id))) return { id, value: j ? clampJoint(j, value) : value };
  const root = joints.find((x) => x.id === c.root);
  if (!root) return { id, value: clampJoint(j, value) };
  const now = pose?.[c.root] ?? 0;
  let v = value;
  if (j.kind === "continuous") {
    // The nearest turn of `value` to where the joint is now.
    const at = c.a * now + c.b;
    v = value + Math.round((at - value) / 360) * 360;
  }
  let r = c.a === 0 ? now : (v - c.b) / c.a;
  const [lo, hi] = rootRange(joints, drives, c.root);
  r = Math.min(hi, Math.max(lo, r));
  if (!Number.isFinite(r)) r = 0;
  return { id: c.root, value: r };
}

/**
 * A motion link's multiplier for one joint (1 or −1): joints whose axes point the same way turn the same way, and
 * joints whose axes point opposite ways (wheels on the two sides of a rover) turn so they still go the same way round in
 * the model. `against` turns it the other way.
 */
export function togetherMultiplier(lead: { axis: readonly number[] }, joint: { axis: readonly number[] }, against = false): number {
  const dot = lead.axis[0]! * joint.axis[0]! + lead.axis[1]! * joint.axis[1]! + lead.axis[2]! * joint.axis[2]!;
  const m = dot < -1e-9 ? -1 : 1;
  return against ? -m : m;
}

/** Why a joint can't move with the lead in a motion link, on top of {@link driveProblem}: one turns, the other slides. */
export function togetherProblem(lead: { kind: JointKind }, joint: { kind: JointKind }): string | null {
  return rotary(lead.kind) === rotary(joint.kind) ? null : "A joint that turns can't move with one that slides";
}

/** "Turns −1/3 the other way", "Slides 0.17 mm a degree": a drive's ratio in words. */
export function driveRatioText(multiplier: number, from: JointKind, to: JointKind): string {
  const r = (v: number) => String(Math.round(v * 1000) / 1000);
  const m = Math.abs(multiplier);
  if (rotary(from) && to === "prismatic") return `Slides ${r(m * 360)} mm a turn`;
  if (from === "prismatic" && rotary(to)) return `Turns ${r(m)}° a mm`;
  return `${r(multiplier)}×, ${multiplier < 0 ? "the other way" : "the same way"}`;
}
