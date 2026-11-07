import { describe, expect, it } from "vitest";
import { measureRows } from "./MeasureBar";

describe("measureRows", () => {
  it("shows one face's area and perimeter", () => {
    const rows = measureRows({ items: [{ kind: "face", area: 400, perimeter: 80, centre: [0, 0, 20], normal: [0, 0, 1] }] });
    expect(rows.slice(0, 2)).toEqual([
      { label: "Area", value: "400 mm²" },
      { label: "Perimeter", value: "80 mm" },
    ]);
  });

  it("shows a circle's diameter to 2 decimals", () => {
    const rows = measureRows({
      items: [
        {
          kind: "edge",
          length: 50.26548,
          ends: [
            [8, 0, 0],
            [8, 0, 0],
          ],
          circle: { radius: 8.004, centre: [0, 0, 0] },
        },
      ],
    });
    expect(rows).toContainEqual({ label: "Diameter", value: "16.01 mm" });
  });

  it("shows the distance, angle and the parts of it for two picks", () => {
    const rows = measureRows({
      items: [],
      pair: { distance: 30, from: [-15, 0, 5], to: [15, 0, 5], delta: [30, 0, 0], angle: 180 },
    });
    expect(rows.map((r) => `${r.label} ${r.value}`)).toEqual(["Distance 30 mm", "Angle 180°", "ΔX 30 mm", "ΔY 0 mm", "ΔZ 0 mm"]);
  });
});
