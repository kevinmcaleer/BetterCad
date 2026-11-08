import { beforeAll, describe, expect, it } from "vitest";
import {
  GEAR_DEFAULTS,
  addGear,
  addMatingGear,
  build,
  featureSummary,
  meshGears,
  meshedWith,
  newDoc,
  updateGear,
  type GearFeature,
  type GearParamsStep,
  type ModelDoc,
} from "./document";
import { centreDistance, ratioText } from "./gears";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { boolean, measure } from "./occt/shapes";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
});

const step = (change: Partial<GearParamsStep> = {}): GearParamsStep => ({
  gear: GEAR_DEFAULTS,
  width: 4,
  bore: { kind: "none", diameter: 0 },
  frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] },
  ...change,
});

/** The volume two gears' solids share, mm³. */
function overlap(doc: ModelDoc, a: string, b: string): number {
  const parts = build(doc).parts;
  const mb = new ModelBuilder(oc);
  const s = (id: string) => mb.solid(parts.find((p) => p.id === id)!).shape;
  try {
    return measure(oc, boolean(oc, "intersect", s(a), [s(b)])).volume;
  } catch {
    // An empty intersection is refused: they don't overlap.
    return 0;
  }
}

describe("meshing two gears (#192)", () => {
  it("puts 12 and 36 teeth at module 1.5 36 mm apart, 3 : 1", () => {
    const g = { ...GEAR_DEFAULTS, module: 1.5 };
    expect(centreDistance({ ...g, teeth: 12 }, { ...g, teeth: 36 })).toBe(36);
    let doc = addGear(newDoc(), step({ gear: { ...g, teeth: 12 } }), "a", "A");
    doc = addMatingGear(doc, "a", 36, 0, "b", "B");
    const b = build(doc).parts.find((p) => p.id === "B")!;
    expect(b.prism!.frame.origin).toEqual([36, 0, 0]);
    expect(featureSummary(doc, doc.features[1]!)).toBe("36 teeth, meshes with Gear 12T, 3 : 1");
    // A mating gear starts as "Gear 12T 2"; its new tooth count takes the plain name when it's free.
    doc = addMatingGear(doc, "a", 12, 180, "c", "C");
    expect(doc.features[2]!.name).toBe("Gear 12T 2");
    doc = updateGear(doc, "c", { gear: { ...g, teeth: 36 } });
    expect(doc.features[2]!.name).toBe("Gear 36T 2");
    doc = updateGear(doc, "c", { gear: { ...g, teeth: 24 } });
    expect(doc.features[2]!.name).toBe("Gear 24T");
    expect(ratioText(12, 36)).toBe("3 : 1, the small gear turns three times as fast");
    expect(ratioText(20, 40)).toBe("2 : 1, the small gear turns twice as fast");
  });

  it("follows the first gear when its teeth or place change", () => {
    let doc = addGear(newDoc(), step(), "a", "A");
    doc = addMatingGear(doc, "a", 20, 90, "b", "B");
    doc = updateGear(doc, "a", { gear: { ...GEAR_DEFAULTS, teeth: 30 }, frame: { origin: [10, 0, 5], x: [1, 0, 0], normal: [0, 0, 1] } });
    const o = build(doc).parts.find((p) => p.id === "B")!.prism!.frame.origin;
    expect(o[0]).toBeCloseTo(10, 9);
    expect(o[1]).toBeCloseTo(25, 9);
    expect(o[2]).toBe(5);
  });

  it("refuses gears of different module or pressure angle", () => {
    let doc = addGear(newDoc(), step(), "a", "A");
    doc = addGear(doc, step({ gear: { ...GEAR_DEFAULTS, module: 2 } }), "b", "B");
    expect(meshGears(doc, "a", "b").error).toBe("These gears have different modules (1 and 2), so their teeth won't mesh");
    doc = updateGear(doc, "b", { gear: { ...GEAR_DEFAULTS, pressure: 14.5 } });
    expect(meshGears(doc, "a", "b").error).toMatch(/pressure angles \(20° and 14.5°\)/);
  });

  it("meshes two placed gears on the side the second was on", () => {
    let doc = addGear(newDoc(), step(), "a", "A");
    doc = addGear(doc, step({ frame: { origin: [0, -50, 0], x: [1, 0, 0], normal: [0, 0, 1] } }), "b", "B");
    const r = meshGears(doc, "b", "a");
    expect(r.error).toBeUndefined();
    const o = build(r.doc).parts.find((p) => p.id === "B")!.prism!.frame.origin;
    expect(o[0]).toBeCloseTo(0, 9);
    expect(o[1]).toBeCloseTo(-20, 9);
  });

  it("says when the gear it meshed with is gone", () => {
    let doc = addGear(newDoc(), step(), "a", "A");
    doc = addMatingGear(doc, "a", 20, 0, "b", "B");
    doc = { ...doc, features: doc.features.slice(1) };
    expect(build(doc).failed.get("b")).toMatch(/meshes with is gone/);
  });

  it("interleaves the teeth without them touching, and a half-tooth turn would clash", () => {
    for (const [z1, z2, angle, turn] of [
      [12, 36, 0, 0],
      [20, 20, 37, 5],
      [17, 31, 200, 13],
    ] as const) {
      let doc = addGear(newDoc(), step({ gear: { ...GEAR_DEFAULTS, teeth: z1, module: 1.5 }, turn }), "a", "A");
      doc = addMatingGear(doc, "a", z2, angle, "b", "B");
      expect(overlap(doc, "A", "B"), `${z1} + ${z2}`).toBeLessThan(1e-6);
      // The same gear standing on its own, turned half a tooth more, lands its teeth on the first's.
      const [a, b] = doc.features as GearFeature[];
      const placed = meshedWith(a!, b!);
      const wrong = addGear(newDoc(), step({ gear: a!.gear, turn }), "a", "A");
      const clash = addGear(wrong, { ...placed, mesh: undefined, turn: placed.turn! + 180 / z2 }, "c", "C");
      expect(overlap(clash, "A", "C"), `${z1} + ${z2} clash`).toBeGreaterThan(1);
      // Turning the first gear turns the second with it, still meshed.
      doc = updateGear(doc, "a", { turn: turn + 7 });
      expect(overlap(doc, "A", "B"), `${z1} + ${z2} turned`).toBeLessThan(1e-6);
    }
  }, 60_000);
});
