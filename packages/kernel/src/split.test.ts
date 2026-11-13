import { beforeAll, describe, expect, it } from "vitest";
import { addConstruct, addPart, addSplit, build, dependsOn, featureSummary, newDoc, updateSplit, type ModelDoc, type SplitParams } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { loadBcad, saveBcad } from "./bcad";
import { mirrorFace } from "./pattern";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const built = (d: ModelDoc) => new ModelBuilder(oc).build(d);
/** A 20 mm box standing on the ground, centred on Z. */
const boxDoc = () => addPart(newDoc(), "box", "box1");
const params = (p: Partial<SplitParams> = {}): SplitParams => ({ part: "box1", plane: "YZ", offset: 0, keep: "both", ...p });
const volumes = (d: ModelDoc) => {
  const r = built(d);
  expect(r.failed).toEqual([]);
  return new Map(r.bodies.map((b) => [b.id, b.measure.volume]));
};

describe("split body (#406)", () => {
  it("splits a box down the middle: two halves, each a body", () => {
    const d = addSplit(boxDoc(), params(), "s1", "half");
    const v = volumes(d);
    expect(v.get("box1")).toBeCloseTo(4000, 3);
    expect(v.get("half")).toBeCloseTo(4000, 3);
    expect(build(d).parts.map((p) => p.name)).toEqual(["Box 1", "Box 1 (2)"]);
    expect(d.features[1]!.name).toBe("Split 1");
    expect(featureSummary(d, d.features[1]!)).toBe("Box 1 along YZ, both halves kept");
    expect(dependsOn(d, "s1")).toEqual([d.features[0]!.id]);
  });

  it("splits a box along a construction plane at 30°: the halves add up to the box", () => {
    let d = addConstruct(boxDoc(), { kind: "angle", refs: [{ origin: "Y" }], value: 30 }, "pl");
    d = addSplit(d, params({ step: "pl" }), "s1", "half");
    const v = volumes(d);
    const a = v.get("box1")!;
    const b = v.get("half")!;
    expect(a).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
    expect(a + b).toBeCloseTo(8000, 2);
    expect(dependsOn(d, "s1")).toEqual(expect.arrayContaining([d.features[0]!.id, "pl"]));
    expect(featureSummary(d, d.features[2]!)).toMatch(/^Box 1 along Plane 1/);
  });

  it("keeps one half and throws the other away", () => {
    const front = addSplit(boxDoc(), params({ offset: 5, keep: "front" }), "s1", "half");
    let v = volumes(front);
    expect([...v.keys()]).toEqual(["box1"]);
    // x from 5 to 10 of a box from −10 to 10.
    expect(v.get("box1")).toBeCloseTo(5 * 20 * 20, 3);
    const back = updateSplit(front, "s1", { keep: "back" });
    v = volumes(back);
    expect([...v.keys()]).toEqual(["box1"]);
    expect(v.get("box1")).toBeCloseTo(15 * 20 * 20, 3);
    expect(featureSummary(back, back.features[1]!)).toBe("Box 1 along YZ at 5 mm, back half kept");
  });

  it("splits along a flat face of another body, where that body is", () => {
    let d = addPart(boxDoc(), "box", "box2");
    const b2 = build(d).parts.find((p) => p.id === "box2")!;
    // A face of Box 2 facing −X, on the plane x = 4 (kept in Box 2's own coordinates).
    d = addSplit(d, params({ face: mirrorFace(b2, 0, { x: 4, y: 0, z: 10 }, { x: -1, y: 0, z: 0 }) }), "s1", "half");
    const v = volumes(d);
    // The front is where the face looks: x below 4.
    expect(v.get("half")).toBeCloseTo(14 * 20 * 20, 3);
    expect(v.get("box1")).toBeCloseTo(6 * 20 * 20, 3);
    expect(dependsOn(d, "s1")).toEqual(expect.arrayContaining(d.features.slice(0, 2).map((f) => f.id)));
    expect(featureSummary(d, d.features[2]!)).toBe("Box 1 along a face of Box 2, both halves kept");
  });

  it("says when the plane misses the body", () => {
    const d = addSplit(boxDoc(), params({ offset: 50 }), "s1", "half");
    const r = built(d);
    expect(r.failed).toContainEqual(["s1", "The plane misses the body, so there is nothing on one side of it"]);
  });

  it("saves and loads", () => {
    const d = addSplit(boxDoc(), params({ keep: "front" }), "s1", "half");
    const back = loadBcad(saveBcad(d));
    expect("doc" in back && back.doc.features[1]).toMatchObject({ type: "split", part: "box1", keep: "front" });
  });
});
