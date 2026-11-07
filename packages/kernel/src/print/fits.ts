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

/**
 * The gaps from the fit coupon (#182): the slot the peg pressed into sets press, the one it slid freely in sets
 * sliding, and loose is 0.15 mm more than sliding.
 */
export function gapsFromCoupon(pressed: number, slid: number): Required<FitGaps> {
  const sliding = Math.max(pressed, slid);
  return { press: Math.min(pressed, slid), sliding, loose: Math.round((sliding + 0.15) * 100) / 100 };
}

/** What a gap between two printed parts comes to (#184), and the fit to make it when it won't print well. */
export function mateStatus(gap: number, tuned?: FitGaps): { text: string; fix?: FitId; fixName?: string; fixGap?: number } {
  const g = Math.round(gap * 100) / 100;
  const sliding = fitGap("sliding", tuned);
  const offer = { fix: "sliding" as const, fixName: "sliding fit", fixGap: sliding };
  if (gap < -1e-6) return { text: `they overlap by ${mm(-gap)}`, ...offer };
  const press = fitGap("press", tuned);
  if (gap < press / 2) return { text: `gap ${mm(g)}, too tight to print`, ...offer };
  const near = [...GAP_FITS].sort((a, b) => Math.abs(fitGap(a.id, tuned) - gap) - Math.abs(fitGap(b.id, tuned) - gap))[0]!;
  return { text: `${near.name.toLowerCase()}, ${mm(g)}` };
}
