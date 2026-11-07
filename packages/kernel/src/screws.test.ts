import { describe, expect, it } from "vitest";
import { FITS, SCREWS, holeDiameter, screw } from "./screws";

describe("screw table", () => {
  it("gives M3 a 3.4 mm printed fit", () => {
    expect(holeDiameter(screw("M3")!, "printed")).toBe(3.4);
  });

  it("orders the fits for every size: tap < close ≤ normal, and heads wider than the shank", () => {
    for (const s of SCREWS) {
      expect(s.tap).toBeLessThan(s.nominal);
      expect(s.close).toBeGreaterThan(s.nominal);
      expect(s.normal).toBeGreaterThanOrEqual(s.close);
      expect(s.printed).toBeCloseTo(s.nominal + 0.4);
      expect(s.socketHead.diameter).toBeGreaterThan(s.normal);
      expect(s.countersunkHead.diameter).toBeGreaterThan(s.normal);
    }
    expect(FITS.map((f) => f.id)).toEqual(["printed", "normal", "close", "tap"]);
  });
});
