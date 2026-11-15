import { describe, expect, it } from "vitest";
import {
  addJoint,
  addLink,
  addPart,
  build,
  changeParts,
  featureSummary,
  insertedId,
  newDoc,
  removeFeature,
  setLook,
  type ModelDoc,
  type ModelSource,
} from "./document";
import { loadBcad, saveBcad } from "./bcad";
import { insertModel } from "./insertmodel";

/** A servo horn: a 20 × 6 × 3 mm arm on a 6 mm round hub, coloured, standing on the origin. */
function horn(): ModelDoc {
  let d = changeParts(addPart(newDoc("Servo horn"), "box", "arm"), ["arm"], "size", { x: 20, y: 6, z: 3 });
  d = changeParts(d, ["arm"], "position", { x: 5, y: 0, z: 0 });
  d = changeParts(addPart(d, "cylinder", "hub"), ["hub"], "size", { x: 6, y: 6, z: 3 });
  d = changeParts(d, ["hub"], "position", { x: 0, y: 0, z: 0 });
  d = setLook(d, ["arm"], () => ({ colour: "#ff8800", name: "Arm" }));
  return d;
}
const SRC: ModelSource = { kind: "account", id: "m1", version: 3, name: "Servo horn" };

describe("Insert model step (#482, #483)", () => {
  it("brings every body in, named, coloured and placed, as one component", () => {
    const d = insertModel(newDoc(), SRC, horn(), { position: { x: 100, y: 0, z: 10 } }, "ins");
    const b = build(d);
    const arm = b.parts.find((p) => p.id === insertedId("ins", "arm"))!;
    const hub = b.parts.find((p) => p.id === insertedId("ins", "hub"))!;
    expect(arm.name).toBe("Arm");
    expect(arm.colour).toBe("#ff8800");
    expect(arm.position).toEqual({ x: 105, y: 0, z: 10 });
    expect(hub.position).toEqual({ x: 100, y: 0, z: 10 });
    expect(b.components).toEqual([{ id: "ins", name: "Servo horn", parts: [arm.id, hub.id] }]);
    expect(b.failed.size).toBe(0);
    expect(featureSummary(d, d.features[0]!)).toBe("version 3 of Servo horn, 2 bodies, one component");
  });

  it("turns the model about its own origin", () => {
    const d = insertModel(newDoc(), SRC, horn(), { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 90 } }, "ins");
    const arm = build(d).parts.find((p) => p.id === insertedId("ins", "arm"))!;
    expect(arm.position.x).toBeCloseTo(0, 9);
    expect(arm.position.y).toBeCloseTo(5, 9);
    expect(arm.rotation!.z).toBeCloseTo(90, 9);
  });

  it("keeps two copies of one model apart, each with its own name", () => {
    let d = insertModel(newDoc(), SRC, horn(), { position: { x: 0, y: 0, z: 0 } }, "a");
    d = insertModel(d, SRC, horn(), { position: { x: 40, y: 0, z: 0 } }, "b");
    const b = build(d);
    expect(b.parts.map((p) => p.id)).toEqual(["a/arm", "a/hub", "b/arm", "b/hub"]);
    expect(b.components.map((c) => c.name)).toEqual(["Servo horn", "Servo horn 2"]);
  });

  it("can be jointed to the rest of the model, and its looks changed here without touching the copy", () => {
    let d = addLink(addPart(newDoc(), "box", "base"), ["base"], "baseLink");
    d = insertModel(d, SRC, horn(), { position: { x: 0, y: 0, z: 20 } }, "ins");
    d = addJoint(d, { kind: "revolute", child: "ins", parent: "baseLink", origin: [0, 0, 20], axis: [0, 0, 1], lower: -90, upper: 90 }, "j");
    d = setLook(d, ["ins/arm"], () => ({ colour: "#0000ff" }));
    const b = build(d);
    expect(b.failed.size).toBe(0);
    expect(b.joints.map((j) => j.child)).toEqual(["ins"]);
    expect(b.parts.find((p) => p.id === "ins/arm")!.colour).toBe("#0000ff");
    const step = d.features.find((f) => f.id === "ins")!;
    expect(step.type === "model" && step.model.looks.arm?.colour).toBe("#ff8800");
  });

  it("sits in the component it was inserted into", () => {
    let d = addLink(newDoc(), [], "arm");
    d = insertModel(d, SRC, horn(), { position: { x: 0, y: 0, z: 0 } }, "ins", undefined, "arm");
    expect(build(d).components.find((c) => c.id === "ins")!.parent).toBe("arm");
  });

  it("keeps the inserted model's files in this model, and leaves its cameras behind", () => {
    const inner: ModelDoc = {
      ...horn(),
      blobs: { h1: "AAAA" },
      views: [{ id: "v", name: "Top", camera: { target: [0, 0, 0], azimuth: 0, elevation: 90, distance: 50, ortho: true } }],
    };
    const d = insertModel(newDoc(), SRC, inner, { position: { x: 0, y: 0, z: 0 } }, "ins");
    expect(d.blobs).toEqual({ h1: "AAAA" });
    const step = d.features[0]!;
    expect(step.type === "model" && step.model.blobs).toBeUndefined();
    expect(step.type === "model" && step.model.views).toBeUndefined();
  });

  it("holds a model that holds a model", () => {
    const sub = insertModel(newDoc("Arm"), SRC, horn(), { position: { x: 0, y: 0, z: 5 } }, "h");
    const d = insertModel(newDoc(), { kind: "file", name: "Arm" }, sub, { position: { x: 10, y: 0, z: 0 } }, "arm");
    const b = build(d);
    expect(b.parts.map((p) => [p.id, p.position])).toEqual([
      ["arm/h/arm", { x: 15, y: 0, z: 5 }],
      ["arm/h/hub", { x: 10, y: 0, z: 5 }],
    ]);
    expect(b.parts.every((p) => p.link === "arm")).toBe(true);
  });

  it("says so when the model has no bodies, and goes when its step is deleted", () => {
    let d = insertModel(newDoc(), { kind: "file", name: "Empty" }, newDoc("Empty"), { position: { x: 0, y: 0, z: 0 } }, "ins");
    expect(build(d).failed.get("ins")).toBe("Empty has no bodies to bring in");
    d = insertModel(d, SRC, horn(), { position: { x: 0, y: 0, z: 0 } }, "ins2");
    expect(build(removeFeature(d, "ins2")).parts).toEqual([]);
  });

  it("saves and opens again with its copy", () => {
    const d = insertModel(newDoc(), SRC, horn(), { position: { x: 1, y: 2, z: 3 } }, "ins");
    const back = loadBcad(saveBcad(d));
    if (back instanceof Error) throw back;
    expect(back.warning).toBeUndefined();
    expect(build(back.doc).parts.map((p) => p.id)).toEqual(["ins/arm", "ins/hub"]);
  });
});
