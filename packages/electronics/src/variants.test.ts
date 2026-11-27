import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importEagleProject } from "./eagle/project";
import { fabBoard } from "./fab/fixture";
import { orderPack } from "./fab/pack";
import { bom, placeList } from "./fab/parts";
import type { ElectronicsDesign } from "./model";
import { addVariant, removeVariant, renameVariant, setVariantFitted, setVariantValue, variantChanges, withVariant } from "./variants";

const ref = (d: ElectronicsDesign, r: string) => d.parts.find((p) => p.ref === r)!;

describe("design variants (#758)", () => {
  it("names sets of fitted parts and changed values, each on top of the drawing", () => {
    const { d: start } = fabBoard();
    const [a, b] = start.parts.filter((p) => !p.ref.startsWith("#"));
    let made = addVariant(start, "Lite");
    let d = made.design;
    const lite = made.id;
    expect(addVariant(d, "Lite").design.variants!.map((v) => v.name)).toEqual(["Lite", "Lite 2"]);
    d = setVariantFitted(d, lite, [a!.id], false);
    d = setVariantValue(d, lite, b!.id, "47k");
    expect(variantChanges(d, lite)).toEqual([`${a!.ref} not fitted`, `${b!.ref} 47k`].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })));
    // Asking for what the drawing already has takes the change away.
    expect(setVariantValue(setVariantFitted(d, lite, [a!.id], true), lite, b!.id, b!.value).variants![0]).toEqual({ id: lite, name: "Lite" });
    // The drawing is untouched; the variant's build has its own.
    expect(ref(d, a!.ref).fitted).toBeUndefined();
    const built = withVariant(d, lite);
    expect(ref(built, a!.ref).fitted).toBe(false);
    expect(ref(built, b!.ref).value).toBe("47k");
    expect(withVariant(d, null)).toBe(d);
    d = renameVariant(d, lite, "Basic");
    expect(d.variants![0]!.name).toBe("Basic");
    made = addVariant(d);
    expect(removeVariant(removeVariant(made.design, made.id), lite).variants).toBeUndefined();
  });

  it("makes the parts list, pick and place and order pack for the chosen build", () => {
    const { d: start } = fabBoard();
    const a = start.parts.find((p) => !p.ref.startsWith("#"))!;
    const made = addVariant(start, "Lite");
    const d = setVariantFitted(made.design, made.id, [a.id], false);
    expect(bom(d).unfitted).toEqual([]);
    expect(bom(withVariant(d, made.id)).unfitted).toEqual([a.ref]);
    expect(placeList(withVariant(d, made.id)).some((r) => r.ref === a.ref)).toBe(false);
    const pack = orderPack(d, "jlcpcb", "Blinky", null, made.id)!;
    expect(pack.bom.unfitted).toEqual([a.ref]);
    expect(pack.bomName).toMatch(/Blinky-Lite/);
    expect(orderPack(d, "jlcpcb", "Blinky")!.bom.unfitted).toEqual([]);
  });

  it("brings Eagle's assembly variants in", () => {
    const dir = join(__dirname, "eagle/fixtures");
    const sch = readFileSync(join(dir, "turns.sch"), "utf8")
      .replace("<variantdefs/>", '<variantdefs><variantdef name="Lite" current="yes"/></variantdefs>')
      .replace(
        '<part name="R2" library="test" deviceset="R" device="0805" value="10k"/>',
        '<part name="R2" library="test" deviceset="R" device="0805" value="10k"><variant name="Lite" populate="no"/></part>',
      )
      .replace(
        '<part name="R3" library="test" deviceset="R" device="0805" value="1k"/>',
        '<part name="R3" library="test" deviceset="R" device="0805" value="1k"><variant name="Lite" value="2k2"/></part>',
      );
    const got = importEagleProject([{ name: "turns.sch", text: sch }]).design;
    expect(got.variants).toHaveLength(1);
    const lite = got.variants![0]!;
    expect(lite.name).toBe("Lite");
    expect(variantChanges(got, lite.id)).toEqual(["R2 not fitted", "R3 2k2"]);
  });
});
