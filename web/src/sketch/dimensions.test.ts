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

  it("runs a diameter's line through the centre to its label, which follows the circle", () => {
    const d = new Draft(newSketch());
    const c = d.circle([0, 0], 5);
    const sketch = d.done().sketch;
    const idx = new SketchIndex(sketch);
    // Placed up and to the left, 3 mm past the rim.
    const dia = placeAt(sketch, "diameter", [c], [-8, 0]);
    const art = dimensionArt(idx, dia, 0.1, [0, 0]);
    expect(art.text[0]).toBeCloseTo(-8);
    expect(art.text[1]).toBeCloseTo(0);
    // Across the circle through the centre, then a leader out to the label.
    expect(art.lines[0]![0]).toEqual([expect.closeTo(5), expect.closeTo(0)]);
    expect(art.lines[0]![1]).toEqual([expect.closeTo(-5), expect.closeTo(0)]);
    expect(art.lines[1]![1]).toEqual([expect.closeTo(-8), expect.closeTo(0)]);
    expect(art.arrows.map((a) => a.tip[0])).toEqual([expect.closeTo(-5), expect.closeTo(5)]);

    // The circle moves and shrinks: the label stays 3 mm past its rim, the same way out.
    const moved = {
      ...sketch,
      entities: sketch.entities.map((e) => (e.kind === "circle" ? { ...e, r: 2 } : e.kind === "point" ? { ...e, x: e.x + 20, y: e.y + 10 } : e)),
    };
    const a2 = dimensionArt(new SketchIndex(moved), dia, 0.1, [0, 0]);
    expect(a2.text[0]).toBeCloseTo(15);
    expect(a2.text[1]).toBeCloseTo(10);
  });

  it("keeps a radius label outside its arc's rim even when dropped inside", () => {
    const d = new Draft(newSketch());
    const c = d.circle([0, 0], 5);
    const sketch = d.done().sketch;
    const idx = new SketchIndex(sketch);
    const r = { ...placeAt(sketch, "diameter", [c], null), kind: "radius" as const };
    const inside = { ...r, labelOffset: offsetTo(idx, r, [0, 2]) };
    const art = dimensionArt(idx, inside, 0.1, [0, 0]);
    expect(art.text[0]).toBeCloseTo(0);
    expect(art.text[1]).toBeCloseTo(5);
    expect(art.lines[0]![0]).toEqual([0, 0]);
  });

  it("draws a point-to-line size with extension lines parallel to the line and the size between them", () => {
    const d = new Draft(newSketch());
    const p = d.point([5, 8]);
    const a = d.point([0, 0]);
    const b = d.point([20, 0]);
    const l = d.line(a, b);
    const sketch = d.done().sketch;
    const idx = new SketchIndex(sketch);
    // Dragged out to the right of the point, past the end of the line.
    const dim = { ...placeAt(sketch, "distance", [p, l], null) };
    dim.labelOffset = offsetTo(idx, dim, [30, 4]);
    const art = dimensionArt(idx, dim, 0.1, [10, 4]);
    expect(art.text[0]).toBeCloseTo(30);
    expect(art.text[1]).toBeCloseTo(4);
    // The arrowed dimension line is upright at x 30, from the line (y 0) to the point's height (y 8).
    expect(art.arrows.map((x) => x.tip)).toEqual([
      [expect.closeTo(30), expect.closeTo(8)],
      [expect.closeTo(30), expect.closeTo(0)],
    ]);
    // Both extension lines run level, from the point and from the line, out to it.
    const level = art.lines.filter(([u, v]) => Math.abs(u[1] - v[1]) < 1e-9 && Math.abs(u[0] - v[0]) > 1);
    expect(level.map(([u]) => u[1]).sort()).toEqual([expect.closeTo(0), expect.closeTo(8)]);
  });

  it("runs the dimension line on out to a label dragged past its end", () => {
    const { sketch, p, q } = slanted();
    const idx = new SketchIndex(sketch);
    const placed = placeAt(sketch, "distance", [p, q], [10, 30]);
    expect(placed.kind).toBe("distanceX");
    const across = { ...placed, labelOffset: offsetTo(idx, placed, [40, 30]) };
    const art = dimensionArt(idx, across, 0.1, [10, 10]);
    // The level line from x 0 to 20 at y 30, then on out to the label at x 40.
    const out = art.lines.find(([, v]) => Math.abs(v[0] - 40) < 1e-6 && Math.abs(v[1] - 30) < 1e-6);
    expect(out?.[0][0]).toBeCloseTo(20);
  });
});
