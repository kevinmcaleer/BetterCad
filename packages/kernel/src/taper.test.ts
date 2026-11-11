import { beforeAll, describe, expect, it } from "vitest";
import { drawCentreRectangle, type Sketch } from "@bettercad/sketch";
import { addExtrude, addSketch, featureSummary, newDoc, updateExtrude, updateSketch, type ExtrudeParams, type ModelDoc } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A 20 mm square on the ground, s1. */
function square(): ModelDoc {
  const d = addSketch(newDoc(), { kind: "world", plane: "XY", offset: 0 }, "s1");
  return updateSketch(d, "s1", (s: Sketch) => drawCentreRectangle(s, [0, 0], [10, 10]).sketch);
}
const params = (p: Partial<ExtrudeParams> = {}): ExtrudeParams => ({ sketch: "s1", seeds: [[0, 0]], distance: 10, direction: "one", operation: "new", ...p });
const volume = (d: ModelDoc) => {
  const r = new ModelBuilder(oc).build(d);
  expect(r.failed).toEqual([]);
  return r.bodies[0]!.measure.volume;
};
/** A square frustum's volume: `a` mm at the bottom, `b` at the top, `h` tall. */
const frustum = (a: number, b: number, h: number) => (h / 3) * (a * a + b * b + a * b);
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

describe("Extrude's taper (#402)", () => {
  it("leans a 20 mm square in 10° over 10 mm: a frustum", () => {
    const d = addExtrude(square(), params({ taper: 10 }), "x1");
    expect(volume(d)).toBeCloseTo(frustum(20, 20 - 20 * tan(10), 10), 3);
    expect(featureSummary(d, d.features[1]!)).toBe("10 mm, 10° taper, new body");
  });

  it("leans out with a negative angle, and both ways from the sketch when symmetric", () => {
    const out = addExtrude(square(), params({ taper: -5 }), "x1");
    expect(volume(out)).toBeCloseTo(frustum(20, 20 + 20 * tan(5), 10), 3);
    const both = addExtrude(square(), params({ direction: "symmetric", taper: 5 }), "x1");
    expect(volume(both)).toBeCloseTo(2 * frustum(20, 20 - 10 * tan(5), 5), 3);
    expect(featureSummary(both, both.features[1]!)).toBe("10 mm, both ways, 5° taper, new body");
  });

  it("is full size where an offset start puts it", () => {
    const d = addExtrude(square(), params({ start: "offset", startOffset: 5, taper: 10 }), "x1");
    const r = new ModelBuilder(oc).build(d);
    expect(r.bodies[0]!.measure.bbox.min[2]).toBeCloseTo(5, 6);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(frustum(20, 20 - 20 * tan(10), 10), 3);
  });

  it("goes when set back to 0°", () => {
    let d = addExtrude(square(), params({ taper: 10 }), "x1");
    d = updateExtrude(d, "x1", { taper: undefined });
    expect(volume(d)).toBeCloseTo(4000, 6);
    expect(featureSummary(d, d.features[1]!)).toBe("10 mm, new body");
  });
});
