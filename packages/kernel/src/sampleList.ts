/**
 * The sample models' names (#99), without the code that builds them, so the sample cards cost the first paint only
 * these few lines. `samples.ts` pairs each with its builder.
 */
export interface SampleCard {
  id: string;
  name: string;
  /** One line under the card, in the brand book's voice. */
  blurb: string;
  /** Shown on the sample cards; false for a utility, opened from where it's needed. */
  card?: boolean;
}

export const SAMPLE_CARDS: readonly SampleCard[] = [
  { id: "box-with-lid", name: "Box with a lid", blurb: "A box with a lid that fits" },
  { id: "bracket", name: "Bracket", blurb: "An L bracket with M4 screw holes" },
  { id: "phone-stand", name: "Phone stand", blurb: "Prints flat with no supports" },
  { id: "pico-servo-board", name: "Pico servo board", blurb: "A circuit board from schematic to order, on a printed base", card: false },
  { id: "robot-blocks", name: "Robot board from blocks", blurb: "A robot's circuit made from ready-made blocks", card: false },
  { id: "hole-calibration", name: "Hole calibration", blurb: "Find the hole offset your printer needs", card: false },
  { id: "fit-calibration", name: "Fit calibration", blurb: "Find the gaps your printer needs for parts that fit", card: false },
  { id: "track-wheels", name: "Track and wheels", blurb: "A track piece with two pins and two wheels to wrap it round", card: false },
];

/** Gaps each side the fit coupon tries, mm, one slot each from the left (#182). Here so the Print panel needs only this. */
export const FIT_CALIBRATION_GAPS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4] as const;
