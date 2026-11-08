import { describe, expect, it } from "vitest";
import { Draft, SketchIndex, newSketch } from "@bettercad/sketch";
import { dimensionArt, directionAt, isPlaced, offsetTo, placeAt } from "./dimensions";

/** Two points 20 mm apart at 45°, and the line between them. */
function slanted() {
  const d = new Draft(newSketch());
  const p = d.point([0, 0]);
  const q = d.point([20, 20]);
  const l = d.line(p, q);
  return { sketch: d.done().sketch, p, q, l };
}

describe("placing a size", () => {
  it("picks its direction from where the pointer is, as in Fusion", () => {
    // Inside the box the points span, or past a corner: along the line.
    expect(directionAt([0, 0], [20, 20], [10, 10])).toBe("aligned");
    expect(directionAt([0, 0], [20, 20], [25, -5])).toBe("aligned");
    // Above or below: level, across.
    expect(directionAt([0, 0], [20, 20], [10, 30])).toBe("x");
    expect(directionAt([0, 0], [20, 20], [5, -8])).toBe("x");
    // Left or right: upright.
    expect(directionAt([0, 0], [20, 20], [30, 10])).toBe("y");
    expect(directionAt([0, 0], [20, 20], [-4, 15])).toBe("y");
    // Points already level only size along the line.
    expect(directionAt([0, 0], [20, 0], [10, 30])).toBe("aligned");
  });

  it("turns two points into an across or up size, and back", () => {
    const { sketch, p, q } = slanted();
    const across = placeAt(sketch, "distance", [p, q], [10, 30]);
    expect(across).toMatchObject({ kind: "distanceX", refs: [p, q] });
    expect(across.value).toBeCloseTo(20);
    const up = placeAt(sketch, "distanceX", [p, q], [30, 10]);
    expect(up.kind).toBe("distanceY");
    const along = placeAt(sketch, "distanceY", [p, q], [10, 10]);
    expect(along.kind).toBe("distance");
    expect(along.value).toBeCloseTo(Math.hypot(20, 20));
  });

  it("does the same for a line's length", () => {
    const { sketch, l } = slanted();
    expect(placeAt(sketch, "length", [l], [10, 30])).toMatchObject({ kind: "distanceX", refs: [l] });
    expect(placeAt(sketch, "length", [l], [30, 10])).toMatchObject({ kind: "distanceY", refs: [l] });
    expect(placeAt(sketch, "distanceY", [l], [12, 8])).toMatchObject({ kind: "length", refs: [l] });
  });

  it("keeps other sizes as they are and only moves the label", () => {
    const d = new Draft(newSketch());
    const c = d.circle([0, 0], 5);
    const sketch = d.done().sketch;
    const dia = placeAt(sketch, "diameter", [c], [12, 0]);
    expect(dia.kind).toBe("diameter");
    expect(dia.value).toBeCloseTo(10);
  });

  it("starts unplaced until the pointer moves", () => {
    const { sketch, p, q } = slanted();
    expect(isPlaced(placeAt(sketch, "distance", [p, q], null))).toBe(false);
  });

  it("puts the label where it was placed, and the dimension line through it", () => {
    const { sketch, p, q, l } = slanted();
    const idx = new SketchIndex(sketch);
    const across = placeAt(sketch, "distance", [p, q], [10, 30]);
    const art = dimensionArt(idx, across, 0.1, [10, 10]);
    expect(art.text[0]).toBeCloseTo(10);
    expect(art.text[1]).toBeCloseTo(30);
    // The level dimension line runs at the label's height, from x 0 to x 20.
    const dimLine = art.lines[art.lines.length - 1]!;
    expect(dimLine[0][1]).toBeCloseTo(30);
    expect(dimLine[1][1]).toBeCloseTo(30);
    expect(Math.abs(dimLine[1][0] - dimLine[0][0])).toBeCloseTo(20);

    // A line's length dragged out: the label lands under the pointer and the line follows it, parallel.
    const len = placeAt(sketch, "length", [l], [8, 12]);
    const moved = { ...len, labelOffset: offsetTo(idx, len, [5, 15]) };
    const a2 = dimensionArt(idx, moved, 0.1, [10, 10]);
    expect(a2.text[0]).toBeCloseTo(5);
    expect(a2.text[1]).toBeCloseTo(15);
  });

  it("stays where it was put when zoomed, unlike an unplaced one", () => {
    const { sketch, l } = slanted();
    const idx = new SketchIndex(sketch);
    const placed = placeAt(sketch, "length", [l], [5, 15]);
    expect(dimensionArt(idx, placed, 0.1, [0, 0]).text).toEqual(dimensionArt(idx, placed, 1, [0, 0]).text);
    const auto = placeAt(sketch, "length", [l], null);
    expect(dimensionArt(idx, auto, 0.1, [0, 0]).text).not.toEqual(dimensionArt(idx, auto, 1, [0, 0]).text);
  });
});
