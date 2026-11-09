import { describe, expect, it } from "vitest";
import { newSketch, type Sketch } from "@bettercad/sketch";
import { fitDiagram } from "./sketchDiagram";

function rect(w: number, h: number, sized: boolean): Sketch {
  const s = newSketch({ kind: "world", plane: "XY", offset: 0 }, "Sketch 1", "s1");
  const pts = [
    ["a", 0, 0],
    ["b", w, 0],
    ["c", w, h],
    ["d", 0, h],
  ] as const;
  for (const [id, x, y] of pts) s.entities.push({ id, kind: "point", x, y });
  s.entities.push(
    { id: "l1", kind: "line", a: "a", b: "b" },
    { id: "l2", kind: "line", a: "b", b: "c" },
    { id: "l3", kind: "line", a: "c", b: "d" },
    { id: "l4", kind: "line", a: "d", b: "a" },
  );
  if (sized)
    s.dimensions.push(
      { id: "d1", kind: "length", refs: ["l1"], expression: String(w), value: w, driving: true, labelOffset: [0, 0] },
      { id: "d2", kind: "length", refs: ["l2"], expression: String(h), value: h, driving: true, labelOffset: [0, 0] },
    );
  return s;
}

const width = (t: string) => t.length * 12;

describe("sketch diagram", () => {
  it("zooms a small sketch to fill the picture, whatever its size in mm", () => {
    const small = fitDiagram(rect(4, 3, false), 1200, 900, 75, width)!;
    const big = fitDiagram(rect(400, 300, false), 1200, 900, 75, width)!;
    // Both fill the picture's height inside the margins: 3 mm up fills 750 px.
    expect(small.scale * 3).toBeCloseTo(750);
    expect(big.scale * 300).toBeCloseTo(750);
    expect(small.centre).toEqual([2, 1.5]);
  });

  it("leaves room for the sizes and keeps every label inside the picture", () => {
    const fit = fitDiagram(rect(40, 20, true), 1200, 900, 75, width)!;
    expect(fit.art.map((a) => a.text)).toEqual(["40 mm", "20 mm"]);
    expect(fit.scale * 40).toBeLessThan(1050);
    for (const { art } of fit.art) {
      const x = 600 + (art.text[0] - fit.centre[0]) * fit.scale;
      const y = 450 - (art.text[1] - fit.centre[1]) * fit.scale;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1200);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(900);
    }
  });

  it("has nothing to draw for an empty sketch", () => {
    expect(fitDiagram(newSketch(), 1200, 900, 75, width)).toBeNull();
  });
});
