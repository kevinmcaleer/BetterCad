/**
 * Materials and the print-weight estimate (#105). Densities in g/cm³ are typical filament datasheet values
 * (Prusament, Bambu Lab and Polymaker sheets agree to within a few percent).
 */
export interface Material {
  id: string;
  name: string;
  density: number;
}

export const MATERIALS: readonly Material[] = [
  { id: "pla", name: "PLA", density: 1.24 },
  { id: "petg", name: "PETG", density: 1.27 },
  { id: "abs", name: "ABS", density: 1.04 },
  { id: "tpu", name: "TPU", density: 1.21 },
  { id: "asa", name: "ASA", density: 1.07 },
];
export const DEFAULT_MATERIAL = "pla";
export const DEFAULT_INFILL = 15;

export const materialOf = (id: string | undefined) => MATERIALS.find((m) => m.id === id) ?? MATERIALS[0]!;

/** The slicer defaults the estimate assumes: 3 walls of a 0.42 mm line, about 1 mm of solid top and bottom. */
const SHELL_MM = 3 * 0.42 + 1.0;

/**
 * Grams of plastic, as a slicer would roughly count it: a solid shell over the surface (capped at the volume, for thin
 * parts), and the inside at the infill percentage. Volume in mm³, area in mm². Within about 20 % of a slicer.
 */
export function estimateWeight(p: { volume: number; area: number; density: number; infill: number }): number {
  const volume = Math.max(0, p.volume);
  const shell = Math.min(volume, Math.max(0, p.area) * SHELL_MM);
  const infill = Math.max(0, Math.min(100, p.infill)) / 100;
  const cm3 = (shell + (volume - shell) * infill) / 1000;
  return cm3 * p.density;
}

/** "about 18 g": false precision would mislead. */
export function formatWeight(g: number): string {
  if (g < 1) return "under 1 g";
  if (g < 10) return `about ${Math.round(g * 10) / 10} g`;
  if (g < 1000) return `about ${Math.round(g)} g`;
  return `about ${Math.round(g / 100) / 10} kg`;
}
