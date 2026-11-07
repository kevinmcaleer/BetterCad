import { describe, expect, it } from "vitest";
import { GAP_FITS, fitGap, gapFitNote, gapLabel, gapsFromCoupon, isGapFit } from "./fits";

describe("named fits (#181)", () => {
  it("has press, sliding and loose, tightest first", () => {
    expect(GAP_FITS.map((f) => f.id)).toEqual(["press", "sliding", "loose"]);
    expect(GAP_FITS.map((f) => f.gap)).toEqual([0.15, 0.25, 0.4]);
  });

  it("uses the printer's tuned gap when there is one", () => {
    expect(fitGap("sliding")).toBe(0.25);
    expect(fitGap("sliding", { sliding: 0.3 })).toBe(0.3);
    expect(fitGap("press", { sliding: 0.3 })).toBe(0.15);
    expect(fitGap("loose", { loose: -1 })).toBe(0.4);
  });

  it("always says the gap is on each side", () => {
    expect(gapLabel(0.25, "sliding")).toBe("Sliding fit, 0.25 mm gap each side");
    expect(gapLabel(0.3)).toBe("0.3 mm gap each side");
  });

  it("explains each fit in a sentence", () => {
    for (const f of GAP_FITS) expect(gapFitNote(f.id)).toMatch(/^[A-Z].*\.$/);
    expect(isGapFit("sliding")).toBe(true);
    expect(isGapFit("tight")).toBe(false);
  });
});

describe("gaps from the fit coupon (#182)", () => {
  it("sets press and sliding from the slots, and loose a little wider", () => {
    expect(gapsFromCoupon(0.1, 0.2)).toEqual({ press: 0.1, sliding: 0.2, loose: 0.35 });
  });
  it("never makes press looser than sliding", () => {
    expect(gapsFromCoupon(0.3, 0.15)).toEqual({ press: 0.15, sliding: 0.3, loose: 0.45 });
  });
});
