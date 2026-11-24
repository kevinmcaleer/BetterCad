import { describe, expect, it } from "vitest";
import { addCombine, addJoint, addLink, addParam, addPart, build, changeParts, insertedId, newDoc, setLook, type ModelDoc, type ModelSource } from "./document";
import { makeExternal } from "./insertmodel";

const SRC: ModelSource = { kind: "account", id: "m9", version: 1, name: "Wheel" };

/** A base plate, and a wheel component (tyre and hub) that a joint turns on it. */
function rover(): ModelDoc {
  let d = addPart(newDoc("Rover"), "box", "plate");
  d = addLink(d, ["plate"], "base", undefined, undefined, "Base");
  d = addLink(d, [], "wheel", undefined, undefined, "Wheel");
  d = addPart(d, "cylinder", "tyre");
  d = addPart(d, "cylinder", "hub");
  // Made while the wheel was active.
  d = { ...d, features: d.features.map((f) => (f.type === "add" && f.part.id !== "plate" ? { ...f, component: "wheel" } : f)) };
  d = changeParts(d, ["tyre"], "position", { x: 40, y: 0, z: 10 });
  d = setLook(d, ["tyre"], () => ({ colour: "#222222", name: "Tyre" }));
  d = addJoint(d, { kind: "continuous", child: "wheel", parent: "base", origin: [40, 0, 10], axis: [0, 1, 0], lower: 0, upper: 0 }, "spin");
  return d;
}

describe("makeExternal", () => {
  it("takes a component's steps into a model of its own", () => {
    const d = rover();
    const plan = makeExternal(d, "wheel");
    if (typeof plan === "string") throw new Error(plan);
    const model = build(plan.model);
    expect(model.parts.map((p) => p.id).sort()).toEqual(["hub", "tyre"]);
    expect(model.parts.find((p) => p.id === "tyre")).toMatchObject({ colour: "#222222", name: "Tyre" });
    expect(plan.model.features.some((f) => f.component === "wheel")).toBe(false);
    expect(plan.model.features.some((f) => f.type === "joint" || f.type === "link")).toBe(false);
  });

  it("puts it back as a linked insert in the same place, joints kept", () => {
    const d = rover();
    const was = build(d);
    const plan = makeExternal(d, "wheel");
    if (typeof plan === "string") throw new Error(plan);
    const out = plan.link(SRC);
    const step = out.features.find((f) => f.id === "wheel")!;
    expect(step).toMatchObject({ type: "model", name: "Wheel", source: SRC });
    const b = build(out);
    expect(b.failed.size).toBe(0);
    const tyre = b.parts.find((p) => p.id === insertedId("wheel", "tyre"))!;
    expect(tyre.position).toEqual(was.parts.find((p) => p.id === "tyre")!.position);
    expect(tyre.link).toBe("wheel");
    expect(b.joints.map((j) => [j.child, j.parent])).toEqual([["wheel", "base"]]);
    expect(b.parts).toHaveLength(was.parts.length);
    expect(out.looks.tyre).toBeUndefined();
  });

  it("takes the parameters its steps use", () => {
    let d = rover();
    d = addParam(d, { name: "r", expression: "12 mm", unit: "mm" }, "pr");
    d = addParam(d, { name: "w", expression: "r * 2", unit: "mm" }, "pw");
    d = addParam(d, { name: "other", expression: "3 mm", unit: "mm" }, "po");
    d = { ...d, features: d.features.map((f) => (f.type === "add" && f.part.id === "hub" ? { ...f, exprs: { "size.x": "w" } } : f)) };
    const plan = makeExternal(d, "wheel");
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.model.params?.map((p) => p.name).sort()).toEqual(["r", "w"]);
  });

  it("says why when a step inside reads a body outside", () => {
    let d = rover();
    d = addCombine(d, { mode: "join", target: "hub", tools: [{ id: "plate" }] } as never, "c1");
    d = { ...d, features: d.features.map((f) => (f.id === "c1" ? { ...f, component: "wheel" } : f)) };
    expect(makeExternal(d, "wheel")).toMatch(/isn't in Wheel/);
  });

  it("refuses what isn't a component of this model", () => {
    expect(makeExternal(rover(), "tyre")).toMatch(/Only a component/);
    let d = rover();
    d = addLink(d, [], "empty", undefined, undefined, "Empty");
    expect(makeExternal(d, "empty")).toMatch(/no bodies/);
  });

  it("takes nested components and the joints between them", () => {
    let d = addPart(newDoc("Arm"), "box", "a");
    d = addPart(d, "box", "b");
    d = addLink(d, [], "arm", undefined, undefined, "Arm");
    d = addLink(d, ["a"], "upper", undefined, "arm", "Upper");
    d = addLink(d, ["b"], "lower", undefined, "arm", "Lower");
    d = addJoint(d, { kind: "revolute", child: "lower", parent: "upper", origin: [0, 0, 0], axis: [0, 0, 1], lower: -90, upper: 90 }, "elbow");
    const plan = makeExternal(d, "arm");
    if (typeof plan === "string") throw new Error(plan);
    const inner = build(plan.model);
    expect(inner.components.map((c) => [c.id, c.parent])).toEqual([
      ["upper", undefined],
      ["lower", undefined],
    ]);
    expect(inner.joints.map((j) => j.id)).toEqual(["elbow"]);
    const out = build(plan.link(SRC));
    expect(out.failed.size).toBe(0);
    expect(out.parts.map((p) => p.id).sort()).toEqual([insertedId("arm", "a"), insertedId("arm", "b")]);
  });
});
