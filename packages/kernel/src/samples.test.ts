import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { build, paramScope, updateParam } from "./document";
import { saveBcad } from "./bcad";
import { FIT_CALIBRATION_GAPS, FIT_PEG, SAMPLES } from "./samples";

/** The samples (#99) are regression fixtures too: each builds clean, fast and to the size it should. */
let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.build();

describe("samples", () => {
  it.each(SAMPLES.map((s) => [s.id]))("%s builds with no failed steps, quickly", (id) => {
    const doc = sample(id);
    expect(build(doc).failed.size).toBe(0);
    const t = performance.now();
    const r = new ModelBuilder(oc).build(doc);
    // The coupons are 20 to 40 cuts; shared CI runners are slower than a laptop.
    expect(performance.now() - t).toBeLessThan(id.endsWith("-calibration") ? 6000 : 2000);
    expect(r.failed).toEqual([]);
    for (const b of r.bodies) expect(b.measure.volume).toBeGreaterThan(0);
    // Small enough to ship beside the app, with room for a thumbnail.
    expect(saveBcad(doc).length).toBeLessThan(id.endsWith("-calibration") ? 80_000 : 15_000);
    // Every sample has parameters, and every step that sizes a part uses them.
    expect(doc.params!.length).toBeGreaterThanOrEqual(3);
  });

  it("the calibration coupon has M2 to M6 holes at each offset, and notches that count the columns", () => {
    const doc = sample("hole-calibration");
    const r = new ModelBuilder(oc).build(doc);
    expect(r.bodies.map((b) => b.id)).toEqual(["plate"]);
    const v = paramScope(doc);
    const plate = (4 * v.pitch! + 2 * v.edge! + 6) * (4 * v.pitch! + 2 * v.edge! + 10) * v.thickness!;
    let holes = 0;
    for (const d of [2, 3, 4, 5, 6]) for (const o of [0.2, 0.3, 0.4, 0.5, 0.6]) holes += Math.PI * ((d + o) / 2) ** 2 * v.thickness!;
    // 15 notches, 1 mm wide, cutting 1.5 mm into the front edge.
    const notches = 15 * 1 * 1.5 * v.thickness!;
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(plate - holes - notches, -1);
  });

  it("the fit coupon has slots 0.05 to 0.4 mm each side wider than its peg (#182)", () => {
    const doc = sample("fit-calibration");
    const r = new ModelBuilder(oc).build(doc);
    expect(r.bodies.map((b) => b.id).sort()).toEqual(["peg", "plate"]);
    const v = paramScope(doc);
    const t = v.thickness!;
    const plate = (5 * v.pitch! + 10 + 2 * v.edge!) * (10 + 2 * v.edge! + 4) * t;
    const slots = FIT_CALIBRATION_GAPS.reduce((a, g) => a + (FIT_PEG + 2 * g) ** 2 * t, 0);
    // 21 notches, 1 mm wide, cutting 1.5 mm into the front edge.
    const notches = 21 * 1.5 * t;
    expect(r.bodies.find((b) => b.id === "plate")!.measure.volume).toBeCloseTo(plate - slots - notches, 0);
    expect(r.bodies.find((b) => b.id === "peg")!.measure.volume).toBeCloseTo(10 * 10 * (t + 8), 3);
  });

  it("the box is hollow with an open top, and the lid's lip fits inside it", () => {
    const doc = sample("box-with-lid");
    const r = new ModelBuilder(oc).build(doc);
    const box = r.bodies.find((b) => b.id === "box")!;
    const lid = r.bodies.find((b) => b.id === "lid")!;
    expect(r.bodies.map((b) => b.id).sort()).toEqual(["box", "lid"]);
    // 60 × 40 × 30 outside, 2 mm walls and floor, open at the top.
    expect(box.measure.volume).toBeCloseTo(60 * 40 * 30 - 56 * 36 * 28, -1);
    const v = paramScope(doc);
    expect(v.width! - 2 * v.wall! - (v.width! - 2 * v.wall! - 2 * v.gap!)).toBeCloseTo(0.6);
    expect(lid.measure.volume).toBeCloseTo(60 * 40 * 2 + 55.4 * 35.4 * 4, -1);
  });

  it("the bracket has an upright and two holes through it", () => {
    const r = new ModelBuilder(oc).build(sample("bracket"));
    expect(r.bodies).toHaveLength(1);
    const solid = 40 * 30 * 4 + 4 * 30 * 36;
    const holes = 2 * Math.PI * 2.25 ** 2 * 4;
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(solid - holes, -1);
  });

  it("the phone stand is one body, and changing a parameter reshapes it", () => {
    const doc = sample("phone-stand");
    const one = new ModelBuilder(oc).build(doc);
    expect(one.bodies).toHaveLength(1);
    const base = 68 * 70 * 4;
    const rest = (50 * 50 * 70) / 2;
    const lip = 4 * 70 * 8;
    expect(one.bodies[0]!.measure.volume).toBeCloseTo(base + rest + lip, -1);
    const wider = updateParam(doc, "p_width", { expression: "80" });
    expect(new ModelBuilder(oc).build(wider).bodies[0]!.measure.volume).toBeCloseTo(((base + rest + lip) * 80) / 70, -1);
  });
});
