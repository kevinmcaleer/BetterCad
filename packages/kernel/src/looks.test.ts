import { describe, expect, it } from "vitest";
import { addPart, build, newDoc, setLook } from "./document";
import { loadBcad, saveBcad } from "./bcad";
import { CATALOGUE } from "./catalogue/list";
import { FINISHES, finishOf, linearRgb, parseHex, pbrOf } from "./looks";

describe("colours and finishes (#196)", () => {
  it("has the five finishes, Matte PLA first", () => {
    expect(FINISHES.map((f) => f.label)).toEqual(["Matte PLA", "Glossy PETG", "Silk", "Metal", "Rubber (TPU)"]);
    for (const f of FINISHES) {
      expect(f.roughness).toBeGreaterThanOrEqual(0);
      expect(f.roughness).toBeLessThanOrEqual(1);
      expect(f.metalness).toBeGreaterThanOrEqual(0);
      expect(f.metalness).toBeLessThanOrEqual(1);
    }
  });

  it("turns sRGB hex into linear colour, and ignores text that isn't a colour", () => {
    expect(linearRgb("#ffffff")).toEqual([1, 1, 1]);
    expect(linearRgb("#000000")).toEqual([0, 0, 0]);
    expect(linearRgb("#808080")[0]).toBeCloseTo(0.2159, 3);
    expect(parseHex("#ABCDEF")).toBe("#abcdef");
    expect(parseHex("red")).toBeUndefined();
  });

  it("gives catalogue parts a sensible finish: bearings metal, servos matte", () => {
    const bearing = CATALOGUE.find((p) => p.category === "bearing")!;
    const servo = CATALOGUE.find((p) => p.category === "servo")!;
    expect(finishOf({ catalogue: bearing })).toBe("metal");
    expect(finishOf({ catalogue: servo })).toBe("matte-pla");
    expect(finishOf({ catalogue: bearing, finish: "silk" })).toBe("silk");
    expect(finishOf({})).toBe("matte-pla");
  });

  it("puts a body's colour and finish on its part and keeps them through a .bcad round trip", () => {
    let d = addPart(newDoc("Bot"), "box", "b");
    d = setLook(d, ["b"], () => ({ colour: "#d2332e", finish: "glossy-petg" }));
    const part = build(d).parts[0]!;
    expect(part).toMatchObject({ colour: "#d2332e", finish: "glossy-petg" });
    const back = loadBcad(saveBcad(d));
    if (back instanceof Error) throw back;
    expect(back.doc.looks.b).toMatchObject({ colour: "#d2332e", finish: "glossy-petg" });
    expect(pbrOf(build(back.doc).parts[0]!)).toEqual({ color: linearRgb("#d2332e"), roughness: 0.25, metalness: 0 });
  });
});
