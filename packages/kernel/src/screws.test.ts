import { describe, expect, it } from "vitest";
import { FITS, SCREWS, fitLabel, fitNote, holeDiameter, screw } from "./screws";
import { resolveHole } from "./holes";

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
    expect(FITS.map((f) => f.id)).toEqual(["printed", "insert", "normal", "close", "tap"]);
  });

  it("adds the printer's offset to a printed clearance, and says what it comes to", () => {
    const m3 = screw("M3")!;
    expect(holeDiameter(m3, "printed", 0.25)).toBe(3.25);
    expect(fitLabel(m3, "printed")).toBe("Clearance for printing (3.4 mm)");
    expect(fitLabel(m3, "printed", 0.6)).toBe("Clearance for printing (3.6 mm)");
    expect(fitNote(m3, "printed")).toBe("Printed holes come out small. M3 → 3.4 mm so a screw slides in.");
  });

  it("sizes heat-set insert holes from the table", () => {
    const want: Record<string, number> = { M2: 3.2, "M2.5": 3.5, M3: 4, M4: 5.6, M5: 6.4 };
    for (const [id, d] of Object.entries(want)) {
      expect(holeDiameter(screw(id)!, "insert")).toBe(d);
      // The offset is for clearances, not inserts.
      expect(holeDiameter(screw(id)!, "insert", 0.6)).toBe(d);
      expect(screw(id)!.insert!.depth).toBeGreaterThan(2);
    }
    expect(fitLabel(screw("M3")!, "insert")).toBe("Heat-set insert (4 mm)");
    expect(holeDiameter(screw("M6")!, "insert")).toBeNull();
    expect(fitLabel(screw("M6")!, "insert")).toBe("Heat-set insert (none for M6)");
    expect(resolveHole({ size: "M6", fit: "insert", head: "none", depth: 8 })).toEqual({ error: "There's no heat-set insert for M6 in the table" });
  });

  it("carries a hole step's offset into its diameter", () => {
    expect(resolveHole({ size: "M4", fit: "printed", offset: 0.3, head: "none", depth: null })).toEqual({ diameter: 4.3 });
    // Steps from before #104 have no offset: the old 0.4 mm.
    expect(resolveHole({ size: "M4", fit: "printed", head: "none", depth: null })).toEqual({ diameter: 4.4 });
    for (const s of SCREWS) for (const f of FITS) expect(fitNote(s, f.id).length).toBeGreaterThan(10);
  });
});
