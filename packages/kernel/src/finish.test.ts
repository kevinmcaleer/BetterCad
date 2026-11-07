import { beforeAll, describe, expect, it } from "vitest";
import { addFinish, addPart, build, changeParts, featureSummary, newDoc, updateFinish, type ModelDoc } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const ALL = [...Array(12).keys()];
const cube = (): ModelDoc => addPart(newDoc(), "box", "b");

describe("fillet, chamfer and shell on the timeline", () => {
  it("records the step on the part", () => {
    const d = addFinish(cube(), { type: "fillet", part: "b", refs: [0, 1], size: 2 }, "f1");
    expect(build(d).parts[0]!.ops).toEqual([{ op: "fillet", refs: [0, 1], size: 2, outside: undefined, feature: "f1" }]);
    expect(featureSummary(d, d.features[1]!)).toBe("R 2 mm, 2 edges of Box 1");
    const c = updateFinish(d, "f1", { type: "chamfer" });
    expect(c.features[1]).toMatchObject({ type: "chamfer", name: "Chamfer 1" });
  });

  it("says why it cannot apply", () => {
    expect(build(addFinish(cube(), { type: "fillet", part: "b", refs: [], size: 2 }, "f1")).failed.get("f1")).toMatch(/Pick at least one edge/);
    expect(build(addFinish(cube(), { type: "shell", part: "x", refs: [], size: 2 }, "f1")).failed.get("f1")).toMatch(/gone/);
  });
});

describe("fillet, chamfer and shell in the kernel", () => {
  it("rounds every edge of a 20 mm cube", () => {
    const r = new ModelBuilder(oc).build(addFinish(cube(), { type: "fillet", part: "b", refs: ALL, size: 2 }, "f1"));
    expect(r.failed).toEqual([]);
    // A cube less its sharp edges and corners: 20³ − (12 · 16 · (4 − π) + 8 · (8 − 4π/3)).
    const want = 8000 - 12 * 16 * (4 - Math.PI) - 8 * (8 - (4 * Math.PI) / 3);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(want, 0);
    expect(r.bodies[0]!.measure.faces).toBe(26);
  });

  it("bevels every edge at 1 mm: each edge loses a 1 mm prism, each corner 5/6 mm³", () => {
    const r = new ModelBuilder(oc).build(addFinish(cube(), { type: "chamfer", part: "b", refs: ALL, size: 1 }, "f1"));
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(8000 - 12 * 18 * 0.5 - 8 * (5 / 6), 1);
  });

  it("hollows a box with the top open, and moves with it", () => {
    let d = addPart(newDoc(), "box", "b");
    const r0 = new ModelBuilder(oc).build(d);
    const faces = r0.bodies[0]!.measure.faces;
    expect(faces).toBe(6);
    // Face 5 is the box's top.
    d = addFinish(d, { type: "shell", part: "b", refs: [5], size: 1.2 }, "s1");
    d = changeParts(d, ["b"], "position", { x: 50 }, d.features.length);
    const r = new ModelBuilder(oc).build(d);
    expect(r.failed).toEqual([]);
    const inner = (20 - 2.4) * (20 - 2.4) * (20 - 1.2);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(8000 - inner, 0);
    expect(r.bodies[0]!.measure.bbox.min[0]).toBeCloseTo(40, 3);
  });

  it("keeps the part when a fillet does not fit, and says what does", () => {
    const r = new ModelBuilder(oc).build(addFinish(cube(), { type: "fillet", part: "b", refs: [0], size: 30 }, "f1"));
    expect(r.bodies).toHaveLength(1);
    expect(r.failed.find(([id]) => id === "f1")?.[1]).toMatch(/does not fit here. Try .* or less/);
  });
});
