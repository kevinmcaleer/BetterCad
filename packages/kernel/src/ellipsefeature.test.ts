import { beforeAll, describe, expect, it } from "vitest";
import { Draft, drawEllipse, type Sketch } from "@bettercad/sketch";
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

describe("ellipses in solids (#401)", () => {
  it("extrudes a 20 × 8 mm ellipse, turned or not, wider either way", () => {
    for (const [end, other] of [
      [
        [10, 0],
        [0, 4],
      ],
      [
        [0, 4],
        [10, 0],
      ],
      [
        [6, 8],
        [-3.2, 2.4],
      ],
    ] as [number, number][][]) {
      const d = sketched("XY", (s) => drawEllipse(s, [0, 0], end!, other!)!.sketch);
      const [v] = volumes(addExtrude(d, { sketch: "s1", seeds: [[0, 0]], distance: 5, direction: "one", operation: "new", split: true }, "x1"));
      expect(v).toBeCloseTo(Math.PI * 10 * 4 * 5, 3);
    }
  });

  it("cuts an elliptical hole through a plate", () => {
    const d = sketched("XY", (s) => {
      const r = new Draft(s);
      r.line([-20, -10], [20, -10]);
      r.line([20, -10], [20, 10]);
      r.line([20, 10], [-20, 10]);
      r.line([-20, 10], [-20, -10]);
      return drawEllipse(r.done().sketch, [0, 0], [10, 0], [0, 4])!.sketch;
    });
    const [v] = volumes(addExtrude(d, { sketch: "s1", seeds: [[15, 0]], distance: 2, direction: "one", operation: "new", split: true }, "x1"));
    expect(v).toBeCloseTo((800 - Math.PI * 40) * 2, 3);
  });

  it("revolves half an ellipse into an egg: a spheroid 8 wide and 20 tall", () => {
    const d = sketched("XZ", (s) => {
      const r = drawEllipse(s, [0, 15], [0, 25], [4, 15])!;
      const dr = new Draft(r.sketch);
      dr.line([0, 0], [0, 30]);
      return dr.done().sketch;
    });
    const [v] = volumes(addRevolve(d, { sketch: "s1", seeds: [[2, 15]], split: true, axis: { kind: "y" }, angle: 360, operation: "new" }, "r1"));
    expect(v).toBeCloseTo((4 / 3) * Math.PI * 4 * 4 * 10, 2);
  });
});
