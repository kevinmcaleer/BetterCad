import { beforeAll, describe, expect, it } from "vitest";
import { addCombine, addPart, changeParts, cutTool, fixMate, newDoc, type ModelDoc } from "./document";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A 6 mm pin cut out of a 30 mm plate, the pin kept: a pin in its own hole. */
function pinInPlate(fit: "sliding" | null): ModelDoc {
  let d = addPart(newDoc(), "box", "plate");
  d = changeParts(d, ["plate"], "size", { x: 30, y: 30, z: 10 });
  d = addPart(d, "cylinder", "pin");
  d = changeParts(d, ["pin"], "size", { x: 6, y: 6, z: 20 });
  d = changeParts(d, ["pin"], "position", { x: 0, y: 0, z: -5 });
  return addCombine(d, { mode: "combine", target: "plate", tools: [cutTool("pin", fit, 0)], keepTools: true }, "c1");
}

function plates(apart: number): ModelDoc {
  let d = addPart(newDoc(), "box", "a");
  d = addPart(d, "box", "b");
  return changeParts(d, ["b"], "position", { x: 20 + apart, y: 0, z: 0 });
}

describe("mating faces (#184)", () => {
  it("finds a pin in a hole with no gap", () => {
    const m = new ModelBuilder(oc).mates(pinInPlate(null));
    const pin = m.find((x) => x.kind === "pin")!;
    expect(pin).toMatchObject({ a: "plate", b: "pin" });
    expect(pin.gap).toBeCloseTo(0, 6);
  });

  it("measures a sliding fit's gap", () => {
    const pin = new ModelBuilder(oc).mates(pinInPlate("sliding")).find((x) => x.kind === "pin")!;
    expect(pin.gap).toBeCloseTo(0.25, 4);
  });

  it("finds facing flat faces close together, and not far apart", () => {
    const near = new ModelBuilder(oc).mates(plates(0.1));
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ kind: "faces" });
    expect(near[0]!.gap).toBeCloseTo(0.1, 6);
    expect(new ModelBuilder(oc).mates(plates(5))).toEqual([]);
  });

  it("leaves out holes and hidden bodies", () => {
    let d = plates(0);
    d = { ...d, looks: { b: { hidden: true } } };
    expect(new ModelBuilder(oc).mates(d)).toEqual([]);
  });
});

describe("fixing a mate (#184)", () => {
  it("gives the pin's cut a sliding fit", () => {
    const b = new ModelBuilder(oc);
    const d = pinInPlate(null);
    const pin = b.mates(d).find((x) => x.kind === "pin")!;
    const fixed = fixMate(d, pin, "sliding");
    if (typeof fixed === "string") throw new Error(fixed);
    expect(b.mates(fixed).find((x) => x.kind === "pin")!.gap).toBeCloseTo(0.25, 4);
    expect(fixed.features).toHaveLength(d.features.length);
  });

  it("pushes a flat face back to the fit's gap", () => {
    const b = new ModelBuilder(oc);
    const d = plates(0.1);
    const [m] = b.mates(d);
    const fixed = fixMate(d, m!, "sliding");
    if (typeof fixed === "string") throw new Error(fixed);
    expect(fixed.features.at(-1)).toMatchObject({ type: "pushpull", part: m!.a });
    expect(b.mates(fixed)[0]!.gap).toBeCloseTo(0.25, 4);
  });

  it("says what to do when the pin didn't cut its hole", () => {
    let d = addPart(newDoc(), "box", "plate");
    d = addPart(d, "cylinder", "pin");
    expect(fixMate(d, { kind: "pin", a: "plate", b: "pin", faceA: 0, gap: 0 }, "sliding")).toMatch(/widen it by 0.5 mm/);
  });
});
