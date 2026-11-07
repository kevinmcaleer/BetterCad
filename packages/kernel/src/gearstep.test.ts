import { describe, expect, it } from "vitest";
import { GEAR_DEFAULTS, addGear, build, featureSummary, gearSpec, newDoc, updateGear, type GearFeature, type GearParamsStep } from "./document";

const step = (change: Partial<GearParamsStep> = {}): GearParamsStep => ({
  gear: GEAR_DEFAULTS,
  width: 5,
  bore: { kind: "round", diameter: 5 },
  frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] },
  ...change,
});

describe("the Gear step (#191)", () => {
  it("makes a new body named for its teeth", () => {
    let doc = addGear(newDoc(), step(), "g1", "b1");
    doc = addGear(doc, step(), "g2", "b2");
    const b = build(doc);
    expect(b.parts.map((p) => p.name)).toEqual(["Gear 20T", "Gear 20T 2"]);
    expect(b.parts[0]!.prism?.to).toBe(5);
    expect(featureSummary(doc, doc.features[0]!)).toBe("20 teeth, module 1, 5 mm wide");
  });

  it("renames the gear when its teeth change, unless you named it", () => {
    let doc = addGear(newDoc(), step(), "g", "b");
    doc = updateGear(doc, "g", { gear: { ...GEAR_DEFAULTS, teeth: 32 } });
    expect(build(doc).parts[0]!.name).toBe("Gear 32T");
    doc = { ...doc, features: doc.features.map((f) => (f.type === "gear" ? { ...f, name: "Drive", body: { ...f.body, name: "Drive" } } : f)) };
    doc = updateGear(doc, "g", { gear: { ...GEAR_DEFAULTS, teeth: 40 } });
    expect(build(doc).parts[0]!.name).toBe("Drive");
  });

  it("cuts the bore and joins the hub", () => {
    const f = addGear(newDoc(), step({ hub: { diameter: 10, length: 4 } })).features[0] as GearFeature;
    const r = gearSpec(f);
    if (typeof r === "string") throw new Error(r);
    expect(r.ops.map((o) => o.op)).toEqual(["join", "cut"]);
    const horn = gearSpec({ ...f, hub: undefined, bore: { kind: "horn", diameter: 7, arm: 7 } });
    if (typeof horn === "string") throw new Error(horn);
    expect(horn.ops.map((o) => (o.op === "cut" ? (o.tool?.profiles.length ?? 0) : 0))).toEqual([5]);
  });

  it("says why a gear can't be made, and the step shows it", () => {
    let doc = addGear(newDoc(), step(), "g");
    expect(build(doc).failed.size).toBe(0);
    doc = updateGear(doc, "g", { bore: { kind: "round", diameter: 30 } });
    expect(build(doc).failed.get("g")).toMatch(/bore/);
    doc = updateGear(doc, "g", { bore: { kind: "none", diameter: 0 }, gear: { ...GEAR_DEFAULTS, teeth: 3 } });
    expect(build(doc).failed.get("g")).toMatch(/6 teeth/);
    doc = updateGear(doc, "g", { gear: GEAR_DEFAULTS, hub: { diameter: 30, length: 3 } });
    expect(build(doc).failed.get("g")).toMatch(/hub/);
  });
});
