import { beforeAll, describe, expect, it } from "vitest";
import { addCombine, addPart, build, changeParts, featureSummary, groupOf, groupParams, newDoc, removeFeature, setLook, type ModelDoc } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A 40 × 20 × 10 mm box with two 6 mm cylinders standing in it, the cylinders marked as holes. */
function plate(): ModelDoc {
  let d = addPart(newDoc(), "box", "box");
  d = changeParts(d, ["box"], "size", { x: 40, y: 20, z: 10 });
  d = changeParts(d, ["box"], "position", { x: 0 });
  for (const [id, x] of [
    ["h1", -10],
    ["h2", 10],
  ] as const) {
    d = addPart(d, "cylinder", id);
    d = changeParts(d, [id], "size", { x: 6, y: 6, z: 10 });
    d = changeParts(d, [id], "position", { x, y: 0, z: 0 });
  }
  return setLook(d, ["h1", "h2"], () => ({ hole: true }));
}

describe("group and combine on the timeline", () => {
  it("joins the solids and cuts the holes into the first solid", () => {
    const d0 = plate();
    const params = groupParams(build(d0).parts, ["box", "h1", "h2"]);
    if (typeof params === "string") throw new Error(params);
    expect(params.target).toBe("box");
    expect(params.tools.map((t) => t.op)).toEqual(["cut", "cut"]);
    const d = addCombine(d0, params, "g1");
    const b = build(d);
    expect(b.parts.map((p) => p.id)).toEqual(["box"]);
    expect(b.parts[0]!.ops).toHaveLength(2);
    expect(d.features.at(-1)!.name).toBe("Group 1");
    expect(featureSummary(d, d.features.at(-1)!)).toBe("Box 1 with 2 bodies, 2 holes");
    expect(groupOf(d, "box")?.id).toBe("g1");
    // Ungroup is deleting the step: the originals come back.
    expect(build(removeFeature(d, "g1")).parts).toHaveLength(3);
  });

  it("refuses a group of holes only, or of one body", () => {
    const parts = build(plate()).parts;
    expect(groupParams(parts, ["h1", "h2"])).toBe("Pick at least one solid to cut the holes from");
    expect(groupParams(parts, ["box"])).toMatch(/two or more/);
  });

  it("keeps the tools when asked", () => {
    const d = addCombine(plate(), { mode: "combine", target: "box", tools: [{ id: "h1", op: "cut" }], keepTools: true }, "c1");
    expect(build(d).parts).toHaveLength(3);
    expect(build(addCombine(plate(), { mode: "combine", target: "box", tools: [{ id: "nope", op: "cut" }] }, "c1")).failed.get("c1")).toMatch(/gone/);
  });
});

describe("group and combine in the kernel", () => {
  it("cuts the holes out of the box", () => {
    const d0 = plate();
    const params = groupParams(build(d0).parts, ["box", "h1", "h2"]) as Exclude<ReturnType<typeof groupParams>, string>;
    const r = new ModelBuilder(oc).build(addCombine(d0, params, "g1"));
    expect(r.failed).toEqual([]);
    expect(r.bodies).toHaveLength(1);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(40 * 20 * 10 - 2 * Math.PI * 9 * 10, 1);
  });

  it("moves the cut with the body when the body moves later", () => {
    const d0 = plate();
    const params = groupParams(build(d0).parts, ["box", "h1", "h2"]) as Exclude<ReturnType<typeof groupParams>, string>;
    let d = addCombine(d0, params, "g1");
    d = changeParts(d, ["box"], "position", { x: 100 }, d.features.length);
    const r = new ModelBuilder(oc).build(d);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(40 * 20 * 10 - 2 * Math.PI * 9 * 10, 1);
    expect(r.bodies[0]!.measure.bbox.min[0]).toBeCloseTo(80, 3);
  });

  it("joins two boxes and builds the new primitives", () => {
    let d = addPart(newDoc(), "box", "a");
    d = addPart(d, "box", "b");
    d = changeParts(d, ["b"], "position", { x: 10, y: 0, z: 0 });
    d = addCombine(d, { mode: "combine", target: "a", tools: [{ id: "b", op: "join" }] }, "c1");
    d = addPart(d, "cone", "k");
    d = addPart(d, "torus", "t");
    d = addPart(d, "wedge", "w");
    const r = new ModelBuilder(oc).build(d);
    expect(r.failed).toEqual([]);
    const vol = Object.fromEntries(r.bodies.map((b) => [b.id, b.measure.volume]));
    expect(vol.a).toBeCloseTo(20 * 20 * 20 + 10 * 20 * 20, 1);
    expect(vol.k).toBeCloseTo((Math.PI * 100 * 20) / 3, 1);
    expect(vol.t).toBeCloseTo(2 * Math.PI * Math.PI * 10 * 9, 1);
    expect(vol.w).toBeCloseTo((20 * 20 * 20) / 2, 1);
  });
});
