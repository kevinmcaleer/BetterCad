/**
 * Named fits (#181): how much gap two printed parts need to go together. Each is a gap on every side, so a 10 mm peg in a
 * sliding pocket leaves a 10.5 mm pocket. Typical FDM starting points; the printer profile (#180) can tune them after a
 * calibration print (#182). Not the same number as the hole offset (#104), which is added to a hole's diameter.
 */
export type FitId = "press" | "sliding" | "loose";

export interface GapFit {
  id: FitId;
  name: string;
  /** Default gap on each side, mm. */
  gap: number;
}

export const GAP_FITS: readonly GapFit[] = [
  { id: "press", name: "Press fit", gap: 0.15 },
  { id: "sliding", name: "Sliding fit", gap: 0.25 },
  { id: "loose", name: "Loose fit", gap: 0.4 },
];

export const DEFAULT_GAP_FIT: FitId = "sliding";

/** The gaps a printer profile has tuned away from the defaults. */
export type FitGaps = Partial<Record<FitId, number>>;

export const isGapFit = (id: unknown): id is FitId => GAP_FITS.some((f) => f.id === id);

export const gapFitOf = (id: FitId): GapFit => GAP_FITS.find((f) => f.id === id)!;

/** The gap on each side for a named fit, mm: the tuned one, else the default. */
export function fitGap(id: FitId, tuned?: FitGaps): number {
  const g = tuned?.[id];
  return typeof g === "number" && g >= 0 ? g : gapFitOf(id).gap;
}

/** What each fit is for, in a sentence the Learn course can quote. */
export function gapFitNote(id: FitId): string {
  switch (id) {
    case "press":
      return "The parts push together by hand and stay put. Good for pins, bearings and magnets.";
    case "sliding":
      return "The parts slide together without forcing and without wobble. Start here for lids, slots and shafts that turn.";
    case "loose":
      return "The parts drop together with room to spare. Good for hinges, quick-release parts and big prints that warp.";
  }
}

const mm = (n: number) => `${Math.round(n * 100) / 100} mm`;

/** "Sliding fit, 0.25 mm gap each side", or "0.3 mm gap each side" for a custom gap. */
export function gapLabel(gap: number, fit?: FitId): string {
  const each = `${mm(gap)} gap each side`;
  return fit ? `${gapFitOf(fit).name}, ${each}` : each;
}
