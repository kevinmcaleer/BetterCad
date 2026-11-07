import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE, CATALOGUE_CATEGORIES, cataloguePart, checkPart, partBounds, type CataloguePart } from "./catalogue";
import { loadOCCT, type OC } from "./occt/oc";
import { catalogueShape } from "./occt/catalogue";
import { measure, valid } from "./occt/shapes";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

describe("robot parts catalogue (#186)", () => {
  it("has the first parts, each with a unique id in a known category", () => {
    const ids = CATALOGUE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["sg90", "mg90s", "mg996r", "n20", "tt-motor", "pico", "pico-w", "pi-zero-2-w", "pi-4", "pi-5", "hc-sr04", "608", "623", "18650"])
      expect(cataloguePart(id), id).toBeDefined();
    const cats = new Set(CATALOGUE_CATEGORIES.map((c) => c.id));
    for (const p of CATALOGUE) expect(cats.has(p.category), p.id).toBe(true);
  });

  it.each(CATALOGUE.map((p) => [p.id, p] as const))("%s validates", (_, p) => {
    expect(checkPart(p)).toBeNull();
  });

  it.each(CATALOGUE.map((p) => [p.id, p] as const))("%s puts its screw holes on the part", (_, p) => {
    const [min, max] = partBounds(p);
    for (const h of p.cutout.holes) {
      expect(h.at[0]).toBeGreaterThan(min[0]);
      expect(h.at[0]).toBeLessThan(max[0]);
      expect(h.at[1]).toBeGreaterThan(min[1]);
      expect(h.at[1]).toBeLessThan(max[1]);
    }
  });

  it.each(CATALOGUE.map((p) => [p.id, p] as const))("%s builds a valid solid the size of its blocks", (_, p) => {
    const shape = catalogueShape(oc, p);
    expect(valid(oc, shape)).toBe(true);
    const m = measure(oc, shape);
    expect(m.volume).toBeGreaterThan(0);
    const [min, max] = partBounds(p);
    for (let i = 0; i < 3; i++) {
      expect(m.bbox.min[i]).toBeCloseTo(min[i]!, 1);
      expect(m.bbox.max[i]).toBeCloseTo(max[i]!, 1);
    }
  });

  it("catches a part that pokes out of its pocket", () => {
    const sg90 = cataloguePart("sg90")!;
    const bad: CataloguePart = { ...sg90, cutout: { ...sg90.cutout, pocket: [{ kind: "rect", at: [0, 0], size: [20, 11.8] }] } };
    expect(checkPart(bad)).toMatch(/outside its pocket/);
    expect(checkPart({ ...sg90, cutout: { ...sg90.cutout, depth: 10 } })).toMatch(/deeper than its pocket/);
  });

  it("catches unknown screws, odd cylinders and broken records", () => {
    const pico = cataloguePart("pico")!;
    expect(checkPart({ ...pico, cutout: { ...pico.cutout, holes: [{ at: [0, 0], screw: "M1" }] } })).toMatch(/screw table/);
    expect(checkPart({ ...pico, model: [{ kind: "cylinder", size: [3, 4, 5], at: [0, 0, 0] }] })).toMatch(/isn't round/);
    expect(checkPart({ ...pico, licence: "CC-BY" })).toMatch(/licence/);
    expect(checkPart({ ...pico, id: "Pico" })).toMatch(/id/);
    expect(checkPart({ ...pico, category: "toy" })).toMatch(/category/);
  });
});
