import { beforeAll, describe, expect, it } from "vitest";
import {
  GEAR_DEFAULTS,
  addGear,
  addRack,
  build,
  fitBelt,
  meshedWith,
  newDoc,
  updateGear,
  type GearFeature,
  type GearParamsStep,
  type ModelDoc,
} from "./document";
import { GT2_BELTS, beltLength, centreForBelt, gt2Outside, gt2Pitch, nearestBelt, polyArea, rackOutline, rackProblem } from "./gears";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { boolean, measure, valid } from "./occt/shapes";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
});

const flat = { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
const step = (change: Partial<GearParamsStep> = {}): GearParamsStep => ({
  gear: GEAR_DEFAULTS,
  width: 4,
  bore: { kind: "none", diameter: 0 },
  frame: flat,
  ...change,
});

function solid(doc: ModelDoc, id: string) {
  return new ModelBuilder(oc).solid(build(doc).parts.find((p) => p.id === id)!).shape;
}
function overlap(doc: ModelDoc, a: string, b: string): number {
  try {
    return measure(oc, boolean(oc, "intersect", solid(doc, a), [solid(doc, b)])).volume;
  } catch {
    return 0;
  }
}

describe("racks (#193)", () => {
  it("spaces the teeth πm apart, thinned by the backlash at the pitch line", () => {
    const p = { ...GEAR_DEFAULTS, module: 1.5, backlash: 0 };
    const pts = rackOutline(p, { length: 60, height: 5 });
    expect(polyArea(pts)).toBeGreaterThan(0);
    // Tips sit at y = m; their middles are a pitch apart.
    const tips = pts.filter((q) => Math.abs(q[1] - 1.5) < 1e-9);
    const mids: number[] = [];
    for (let i = 0; i < tips.length; i += 2) mids.push((tips[i]![0] + tips[i + 1]![0]) / 2);
    mids.sort((a, b) => a - b);
    for (let i = 1; i < mids.length; i++) expect(mids[i]! - mids[i - 1]!).toBeCloseTo(Math.PI * 1.5, 9);
    expect(mids).toContainEqual(0);
    // At the pitch line the tooth is half the pitch.
    const left = (y: number) => {
      const [a, b] = [
        pts.find((q) => Math.abs(q[1] - 1.5) < 1e-9 && q[0] < 0 && q[0] > -2)!,
        pts.find((q) => Math.abs(q[1] + 1.875) < 1e-9 && q[0] < 0 && q[0] > -3)!,
      ];
      return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
    };
    expect(-2 * left(0)).toBeCloseTo((Math.PI * 1.5) / 2, 9);
    expect(rackProblem(p, { length: 5, height: 5 })).toMatch(/at least 10 mm/);
  });

  it("meshes under a gear without touching, and slid half a tooth it clashes", () => {
    for (const [teeth, turn] of [
      [20, 0],
      [13, 11],
    ] as const) {
      let doc = addGear(newDoc(), step({ gear: { ...GEAR_DEFAULTS, teeth, module: 1.5 }, turn }), "a", "A");
      doc = addRack(doc, "a", -90, "r", "R");
      expect(doc.features[1]!.name).toBe("Rack");
      expect(valid(oc, solid(doc, "R"))).toBe(true);
      expect(overlap(doc, "A", "R"), `${teeth}`).toBeLessThan(1e-6);
      const [a, r] = doc.features as GearFeature[];
      const placed = meshedWith(a!, r!);
      const half = (Math.PI * 1.5) / 2;
      const slid = { ...placed.frame, origin: [placed.frame.origin[0] + half, placed.frame.origin[1], 0] as [number, number, number] };
      const clash = addGear(newDoc(), step({ gear: a!.gear, turn }), "a", "A");
      const doc2 = addGear(clash, { ...placed, mesh: undefined, frame: slid }, "c", "C");
      expect(overlap(doc2, "A", "C"), `${teeth} clash`).toBeGreaterThan(1);
    }
  }, 60_000);
});

describe("GT2 pulleys (#193)", () => {
  it("has a 12.73 mm pitch diameter at 20 teeth, the outside 0.254 mm in each side", () => {
    expect(gt2Pitch(20)).toBeCloseTo(12.732, 3);
    expect(gt2Outside(20)).toBeCloseTo(12.224, 3);
  });

  it("builds a flanged pulley the right size", () => {
    const doc = addGear(
      newDoc(),
      step({ form: "gt2", gear: { ...GEAR_DEFAULTS, teeth: 20 }, width: 7, flanges: true, bore: { kind: "round", diameter: 5 } }),
      "p",
      "P",
    );
    expect(doc.features[0]!.name).toBe("Pulley 20T");
    const m = measure(oc, solid(doc, "P"));
    expect(m.bbox.max[2] - m.bbox.min[2]).toBeCloseTo(9, 6);
    expect(m.bbox.max[0] - m.bbox.min[0]).toBeCloseTo(gt2Outside(20) + 3, 3);
  });

  it("works out a belt's length and the centre distance for a stock belt", () => {
    // Equal pulleys: two runs and one pulley's circumference.
    expect(beltLength(50, 20, 20)).toBeCloseTo(100 + 40, 9);
    expect(centreForBelt(200, 20, 20)).toBeCloseTo(80, 6);
    const c = centreForBelt(400, 20, 60)!;
    expect(beltLength(c, 20, 60)).toBeCloseTo(400, 6);
    expect(centreForBelt(40, 20, 60)).toBeNull();
    expect(nearestBelt(197)).toBe(200);
    expect(GT2_BELTS).toContain(1000);
  });

  it("fits the nearest stock belt round two pulleys and moves the second to suit", () => {
    let doc = addGear(newDoc(), step({ form: "gt2", gear: { ...GEAR_DEFAULTS, teeth: 20 } }), "a", "A");
    doc = addGear(doc, step({ form: "gt2", gear: { ...GEAR_DEFAULTS, teeth: 20 }, frame: { ...flat, origin: [0, 78, 0] } }), "b", "B");
    const r = fitBelt(doc, "a", "b");
    expect(r.error).toBeUndefined();
    expect(r.needed).toBeCloseTo(196, 6);
    expect(r.length).toBe(200);
    const o = build(r.doc).parts.find((p) => p.id === "B")!.prism!.frame.origin;
    expect(o[0]).toBeCloseTo(0, 6);
    expect(o[1]).toBeCloseTo(80, 6);
    // A longer belt moves it out; one too short is refused.
    const longer = updateGear(r.doc, "b", { belt: { pulley: "a", angle: 90, length: 300 } });
    expect(build(longer).parts.find((p) => p.id === "B")!.prism!.frame.origin[1]).toBeCloseTo(130, 6);
    expect(fitBelt(doc, "a", "b", 40).error).toBe("A 40 mm belt is too short for these pulleys");
    expect(fitBelt(doc, "a", "a").error).toBe("Pick two GT2 pulleys");
  });
});
