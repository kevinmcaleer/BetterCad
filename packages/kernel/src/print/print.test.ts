import { describe, expect, it } from "vitest";
import { PRINTERS, centreMove, fitCheck, fitMessage, outside, printerOf, unionBox, type Box3 } from "./printers";
import { estimateWeight, formatWeight, materialOf } from "./materials";

const bar = (x: number, y = 10, z = 10): Box3 => ({ min: [-x / 2, -y / 2, 0], max: [x / 2, y / 2, z] });

describe("printers", () => {
  it("a 300 mm bar fits no preset, but fits a big enough custom printer", () => {
    for (const p of PRINTERS) expect(fitCheck(bar(300), p)).toEqual([{ axis: "x", over: 300 - p.x }]);
    expect(fitCheck(bar(300), printerOf({ printer: "custom", custom: { x: 350, y: 350, z: 350 } }))).toEqual([]);
  });

  it("names the axis and the overshoot", () => {
    const mini = printerOf({ printer: "bambu-a1-mini" });
    expect(fitMessage(fitCheck(bar(192), mini), mini)).toBe("The model is 12 mm too wide for a Bambu A1 Mini. Rotate it or pick a bigger printer.");
    expect(fitMessage(fitCheck(bar(190, 181, 200), mini), mini)).toBe(
      "The model is 10 mm too wide, 1 mm too deep and 20 mm too tall for a Bambu A1 Mini. Rotate it or pick a bigger printer.",
    );
    expect(fitMessage([], mini)).toBeNull();
  });

  it("finds bodies off the bed, joins boxes and centres them", () => {
    const mini = printerOf({ printer: "bambu-a1-mini" });
    const boxes = new Map([
      ["a", bar(20)],
      ["b", { min: [80, 0, 0], max: [100, 10, 10] } as Box3],
      ["c", { min: [0, 0, -5], max: [10, 10, 5] } as Box3],
    ]);
    expect(outside(boxes, mini)).toEqual(["b", "c"]);
    const u = unionBox([...boxes.values()])!;
    expect(u).toEqual({ min: [-10, -5, -5], max: [100, 10, 10] });
    expect(centreMove(u)).toEqual({ x: -45, y: -2.5, z: 5 });
    expect(unionBox([])).toBeNull();
  });

  it("falls back to the default printer", () => {
    expect(printerOf(undefined).id).toBe("bambu-a1");
    expect(printerOf({ printer: "gone" }).id).toBe("bambu-a1");
    expect(printerOf({ printer: "ender-3" }).origin).toBe("corner");
  });
});

describe("weight", () => {
  it("a 10 cm³ PLA body at 100 % is 12.4 g", () => {
    expect(estimateWeight({ volume: 10_000, area: 2_800, density: materialOf("pla").density, infill: 100 })).toBeCloseTo(12.4, 5);
  });

  it("more infill never weighs less, and a thin part is all shell", () => {
    let last = 0;
    for (let i = 0; i <= 100; i += 5) {
      const w = estimateWeight({ volume: 64_000, area: 9_600, density: 1.24, infill: i });
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
    // A 1 mm plate: the shell is more than the volume, so infill changes nothing.
    const plate = { volume: 100 * 100 * 1, area: 2 * 100 * 100 + 400, density: 1.24 };
    expect(estimateWeight({ ...plate, infill: 0 })).toBeCloseTo(estimateWeight({ ...plate, infill: 100 }));
  });

  it("says about, not 12.437 g", () => {
    expect(formatWeight(0.4)).toBe("under 1 g");
    expect(formatWeight(4.26)).toBe("about 4.3 g");
    expect(formatWeight(18.4)).toBe("about 18 g");
    expect(formatWeight(1530)).toBe("about 1.5 kg");
  });
});
