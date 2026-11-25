import { describe, expect, it } from "vitest";
import { BASICS } from "../basics";
import { changePart, placePart } from "../edit";
import { emptyDesign, packageOf, type ElectronicsDesign } from "../model";
import { COMMON_CHECKED, COMMON_PARTS, commonFor, commonMatches, fillCommon } from "./common";
import { supplierOf } from "./parts";

/** R1 10 kΩ, R2 4.7 kΩ, R3 12 kΩ (not a common value), C1 100 nF and a ground symbol. */
function design(): ElectronicsDesign {
  let d = emptyDesign();
  for (const [i, value] of ["10 kΩ", "4k7", "12 kΩ"].entries()) {
    const r = placePart(d, "sh1", BASICS.resistor!(), { x: i * 10, y: 0 });
    d = changePart(r.design, r.part.id, { value });
  }
  d = placePart(d, "sh1", BASICS.capacitor!(), { x: 40, y: 0 }).design;
  return placePart(d, "sh1", BASICS.gnd!(), { x: 50, y: 0 }).design;
}
const part = (d: ElectronicsDesign, ref: string) => d.parts.find((p) => p.ref === ref)!;
/** Every part in the package of this size. */
function sized(d: ElectronicsDesign, size: string): ElectronicsDesign {
  return d.parts.reduce((next, p) => {
    const pkg = next.defs[p.def]?.packages.findIndex((k) => k.footprint.name.includes(size)) ?? -1;
    return pkg >= 0 ? changePart(next, p.id, { pkg }) : next;
  }, d);
}

describe("common parts and their LCSC numbers (#661)", () => {
  it("is a list read from the supplier's own pages, with the day it was read", () => {
    expect(COMMON_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(COMMON_PARTS.length).toBeGreaterThan(10);
    for (const c of COMMON_PARTS) {
      expect(c.lcsc).toMatch(/^C\d+$/);
      // The page a row was read from is that number's own page.
      expect(c.source).toMatch(new RegExp(`^https://jlcpcb\\.com/partdetail/(.+/)?${c.lcsc}$`));
      expect(["R", "C"]).toContain(c.prefix);
      expect(c.mpn && c.manufacturer && c.spec).toBeTruthy();
    }
    // One number for each kind, value and package, and no number twice.
    expect(new Set(COMMON_PARTS.map((c) => `${c.prefix} ${c.value} ${c.package}`)).size).toBe(COMMON_PARTS.length);
    expect(new Set(COMMON_PARTS.map((c) => c.lcsc)).size).toBe(COMMON_PARTS.length);
  });

  it("matches a part only when its kind, value and package are all the same", () => {
    const d = sized(design(), "0603");
    expect(packageOf(d, part(d, "R1"))?.footprint.name).toContain("0603");
    expect(commonFor(d, part(d, "R1"))).toMatchObject({ lcsc: "C25804", value: "10 kΩ", package: "0603" });
    // Shorthand is read as the value it means.
    expect(commonFor(d, part(d, "R2"))?.lcsc).toBe("C23162");
    expect(commonFor(d, part(d, "R3"))).toBeUndefined();
    expect(commonFor(d, part(d, "C1"))?.lcsc).toBe("C14663");
    // The same value in another package is another part.
    const big = sized(d, "0805");
    expect(commonFor(big, part(big, "R1"))?.lcsc).toBe("C17414");
    expect(commonFor(big, part(big, "R2"))).toBeUndefined();
    // A capacitor of 10 kΩ is nothing.
    const odd = changePart(d, part(d, "C1").id, { value: "10 kΩ" });
    expect(commonFor(odd, part(odd, "C1"))).toBeUndefined();
  });

  it("fills in the parts that have no number, and leaves the ones that do", () => {
    let d = sized(design(), "0603");
    d = changePart(d, part(d, "R2").id, { supplier: { lcsc: "C99999" } });
    expect(commonMatches(d).map((m) => [m.ref, m.common.lcsc])).toEqual([
      ["C1", "C14663"],
      ["R1", "C25804"],
    ]);
    const done = fillCommon(d);
    expect(supplierOf(done, part(done, "R1"))).toEqual({ lcsc: "C25804", mpn: "0603WAF1002T5E", manufacturer: "UNI-ROYAL" });
    expect(supplierOf(done, part(done, "R2"))).toEqual({ lcsc: "C99999" });
    expect(supplierOf(done, part(done, "R3"))).toEqual({});
    expect(commonMatches(done)).toEqual([]);
  });
});
