import { beforeAll, describe, expect, it } from "vitest";
import { Draft, drawLine, drawSpline, fitSpline, polygonArea, regions, sampleSpline, type Sketch, type Vec2 } from "@bettercad/sketch";
import { addExtrude, addRevolve, addSketch, newDoc, updateSketch, type ModelDoc } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const sketched = (plane: "XY" | "XZ", fn: (s: Sketch) => Sketch): ModelDoc =>
  updateSketch(addSketch(newDoc(), { kind: "world", plane, offset: 0 }, "s1"), "s1", fn);
const volumes = (d: ModelDoc) => {
  const r = new ModelBuilder(oc).build(d);
  expect(r.failed).toEqual([]);
  return r.bodies.map((b) => b.measure.volume);
};

/** A pebble: a closed spline through five points round the origin. */
export const PEBBLE: Vec2[] = [
  [10, 0],
  [3, 9],
  [-8, 6],
  [-8, -6],
  [3, -9],
];
/** The area inside a closed spline, from a fine walk round it. */
const splineArea = (pts: Vec2[]) => Math.abs(polygonArea(sampleSpline(fitSpline(pts, true), 0, pts.length, 400)));

describe("splines in solids (#269)", () => {
  it("extrudes a closed 5-point spline 5 mm into a solid with smooth sides", () => {
    const d = sketched("XY", (s) => drawSpline(s, PEBBLE, true)!.sketch);
    const x = addExtrude(d, { sketch: "s1", seeds: [[0, 0]], distance: 5, direction: "one", operation: "new", split: true }, "x1");
    const r = new ModelBuilder(oc).build(x);
    expect(r.failed).toEqual([]);
    expect(Math.abs(r.bodies[0]!.measure.volume - splineArea(PEBBLE) * 5) / (splineArea(PEBBLE) * 5)).toBeLessThan(1e-3);
  });

  it("extrudes one side of a line across a closed spline", () => {
    const d = sketched("XY", (s) => drawLine(drawSpline(s, PEBBLE, true)!.sketch, [0, -20], [0, 20]).sketch);
    const sk = d.features.find((f) => f.type === "sketch")!;
    const right = regions((sk as { sketch: Sketch }).sketch, { split: true }).find((p) => p.points.some((q) => q[0] > 9))!;
    const [v] = volumes(addExtrude(d, { sketch: "s1", seeds: [[5, 0]], distance: 2, direction: "one", operation: "new", split: true }, "x1"));
    expect(v).toBeCloseTo(right.area * 2, 0);
  });

  it("revolves a spline and a line on the axis into a vase", () => {
    const d = sketched("XZ", (s) => {
      const r = drawSpline(s, [
        [0, 0],
        [8, 4],
        [5, 14],
        [7, 22],
        [0, 30],
      ])!;
      const dr = new Draft(r.sketch);
      const ends = r.sketch.entities.find((e) => e.id === r.ids[0]) as { pts: string[] };
      dr.line(ends.pts[4]!, ends.pts[0]!);
      return dr.done().sketch;
    });
    const [v] = volumes(addRevolve(d, { sketch: "s1", seeds: [[3, 10]], split: true, axis: { kind: "y" }, angle: 360, operation: "new" }, "r1"));
    expect(v).toBeGreaterThan(2000);
    expect(v).toBeLessThan(6000);
  });
});
