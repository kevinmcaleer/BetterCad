/**
 * Mass properties (#174): what URDF needs of each link. Mass in grams, centre of mass in mm, and the inertia tensor about
 * the centre of mass in g·mm² as [ixx, iyy, izz, ixy, ixz, iyz] (tensor entries, so the products carry their minus
 * sign, as URDF's ixy does). Pure maths, shared by the kernel worker, the editor and URDF export.
 */
import type { V3 } from "./joints";

export type Inertia = [number, number, number, number, number, number];

export interface MassProps {
  mass: number;
  com: V3;
  inertia: Inertia;
}

/** How a body's mass was found: printed shell and infill, uniform (the shell couldn't be made), or a datasheet's. */
export type MassMethod = "shell" | "uniform" | "datasheet";

/** A body's exact volume properties at unit density: volume (mm³), centroid, and inertia about it (mm⁵). */
export interface VolumeProps {
  volume: number;
  centroid: V3;
  inertia: Inertia;
}

export const NO_MASS: MassProps = { mass: 0, com: [0, 0, 0], inertia: [0, 0, 0, 0, 0, 0] };

/** A solid of uniform density (g/cm³). */
export function uniform(v: VolumeProps, density: number): MassProps {
  const rho = density / 1000;
  return { mass: v.volume * rho, com: [...v.centroid], inertia: v.inertia.map((x) => x * rho) as Inertia };
}

/** The same shape and spread, made to weigh `mass` grams: a datasheet's mass, or the estimate when the shell fails. */
export function scaledTo(v: VolumeProps, mass: number): MassProps {
  if (!(v.volume > 0)) return { ...NO_MASS, com: [...v.centroid] };
  return uniform(v, (mass / v.volume) * 1000);
}

/** The tensor about the centre of mass moved to a point `d` away from it (parallel axis theorem). */
function shift(i: Inertia, m: number, d: V3): Inertia {
  const [x, y, z] = d;
  return [i[0] + m * (y * y + z * z), i[1] + m * (x * x + z * z), i[2] + m * (x * x + y * y), i[3] - m * x * y, i[4] - m * x * z, i[5] - m * y * z];
}

/** Several bodies as one: masses add, centres of mass average by mass, and each tensor moves to the new centre. */
export function combine(list: MassProps[]): MassProps {
  const mass = list.reduce((a, p) => a + p.mass, 0);
  if (!(mass > 0)) return { ...NO_MASS };
  const com: V3 = [0, 1, 2].map((k) => list.reduce((a, p) => a + p.mass * p.com[k]!, 0) / mass) as V3;
  const inertia: Inertia = [0, 0, 0, 0, 0, 0];
  for (const p of list) {
    const s = shift(p.inertia, p.mass, [p.com[0] - com[0], p.com[1] - com[1], p.com[2] - com[2]]);
    for (let k = 0; k < 6; k++) inertia[k]! += s[k]!;
  }
  return { mass, com, inertia };
}

/** `a` with `b` taken away (b lies inside a): what's left of a solid once its core is hollowed. */
export function subtract(a: MassProps, b: MassProps): MassProps {
  const neg: MassProps = { mass: -b.mass, com: b.com, inertia: b.inertia.map((x) => -x) as Inertia };
  return combine([a, neg]);
}

/**
 * A printed body as a slicer makes it: a solid shell at full density, and the core (the body offset inward by the
 * shell's thickness) at the infill fraction. `infill` is a percentage.
 */
export function shellAndInfill(full: VolumeProps, core: VolumeProps, density: number, infill: number): MassProps {
  const solid = uniform(full, density);
  const f = 1 - Math.max(0, Math.min(100, infill)) / 100;
  return subtract(solid, uniform(core, density * f));
}

/** "about 42 g", "12.5 g" under 20 g: rounding hides false precision. */
export function formatMass(g: number): string {
  if (!(g > 0)) return "0 g";
  if (g < 1) return "under 1 g";
  return g < 20 ? `about ${Math.round(g * 10) / 10} g` : `about ${Math.round(g)} g`;
}
