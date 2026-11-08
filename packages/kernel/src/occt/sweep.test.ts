import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { ModelBuilder } from "./model";
import { addJoint, addLink, addPart, changeParts, newDoc, updateJoint, type ModelDoc } from "../document";

let oc: OC;
let m: ModelBuilder;
beforeAll(async () => {
  oc = await loadOCCT();
  m = new ModelBuilder(oc);
}, 60_000);

describe("clash sweep in the kernel (#179)", () => {
  // A 20 mm base at the origin and a 20 mm block 30 mm out on a slider that runs back towards it up to 20 mm: past
  // 10 mm the block runs into the base.
  const doc = (): ModelDoc => {
    let d: ModelDoc = newDoc("Slide");
    d = addPart(d, "box", "base");
    d = addPart(d, "box", "block");
    d = changeParts(d, ["block"], "position", { x: 30 });
    d = addLink(d, ["block"], "carriage");
    return addJoint(d, { kind: "prismatic", child: "carriage", parent: null, origin: [0, 0, 0], axis: [-1, 0, 0], lower: 0, upper: 20 }, "slide");
  };

  it("finds where the slider runs the block into the base, and a limit that clears it", () => {
    const d = doc();
    const r = m.sweep(d);
    expect(r.ranges).toHaveLength(1);
    const [hit] = r.ranges;
    expect(hit).toMatchObject({ joint: "slide", a: "base", b: "block", to: 20 });
    expect(hit!.from).toBeGreaterThan(10);
    expect(hit!.from).toBeLessThan(10.2);
    const limit = r.limits[0]!;
    expect(limit.joint).toBe("slide");
    expect(limit.upper).toBeGreaterThanOrEqual(9);
    expect(limit.upper).toBeLessThanOrEqual(10);
    // With the suggested limit, neither the sweep nor the clash check at the limit finds an overlap.
    const fixed = updateJoint(d, "slide", { upper: limit.upper });
    expect(m.sweep(fixed).ranges).toEqual([]);
    expect(m.clashes({ ...fixed, pose: { slide: limit.upper! } }).filter((c) => c.kind === "overlap")).toEqual([]);
  });

  it("samples the joints together", () => {
    const r = m.sweep(doc(), undefined, { joint: "together", samples: 40 });
    expect(r.samples).toBe(40);
    expect(r.together).toHaveLength(1);
    expect(r.together[0]!.at.slide).toBeGreaterThan(10);
  });
});
