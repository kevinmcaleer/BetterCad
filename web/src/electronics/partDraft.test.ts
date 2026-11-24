import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPinMap, inflate, type LibraryPack } from "@bettercad/electronics";
import { build, draftFrom, newDraft } from "./partDraft";

const starter = JSON.parse(readFileSync(join(__dirname, "../../../packages/electronics/library/starter.json"), "utf8")) as LibraryPack;
const part = (id: string) =>
  inflate(
    starter,
    starter.parts.find((p) => p.id === id)!,
  );

describe("a part being made", () => {
  it("starts as something that only needs a name", () => {
    const d = newDraft();
    expect(build(d)).toMatchObject({ def: null, problems: ["Give the part a name."] });
    const made = build({ ...d, name: "Level shifter", value: "TXS0102", keywords: "i2c, Level" });
    expect(made.problems).toEqual([]);
    expect(made.def).toMatchObject({
      name: "Level shifter",
      prefix: "U",
      value: "TXS0102",
      keywords: ["i2c", "level"],
      source: { library: "You", licence: "CC0 1.0 (no rights kept)" },
    });
    expect(made.def!.symbol.pins.map((p) => `${p.number} ${p.name} ${p.type}`)).toEqual(["1 VCC power_in", "2 IN input", "4 GND power_in", "3 OUT output"]);
    expect(made.def!.packages[0]!.footprint.pads.map((p) => p.number)).toEqual(["1", "2", "3", "4"]);
    expect(made.def!.packages[0]!.model?.source.kind).toBe("box");
    expect(checkPinMap(made.def!)).toEqual([]);
  });

  it("will not save a pin with no pad, a pin listed twice or no pins", () => {
    const d = { ...newDraft(), name: "X" };
    expect(build({ ...d, pins: "1 A\n2 B\n9 C" }).problems).toEqual(["X SO-4 has no pad for pin 9. Change the pin numbers or the footprint."]);
    expect(build({ ...d, pins: "1 A\n1 B" }).problems).toEqual(["Pin 1 is in the list more than once."]);
    expect(build({ ...d, pins: "" }).problems).toEqual(["List at least one pin."]);
  });

  it("makes each family's footprint and warns about pads too close", () => {
    const d = { ...newDraft(), name: "X", pins: "1 A\n2 B" };
    expect(build({ ...d, family: "header" }).footprint!.pads).toHaveLength(4);
    expect(build({ ...d, family: "dip" }).footprint!.pads.map((p) => p.kind)).toEqual(Array(8).fill("thru"));
    expect(build({ ...d, pins: "A1 X\nB2 Y", family: "bga" }).problems).toEqual([]);
    const tight = build({ ...d, family: "dual", sizes: { ...d.sizes, dual: { ...d.sizes.dual, pitch: 0.65 } } });
    expect(tight.notes[0]).toMatch(/^\d+ pairs of pads are closer than 0.2 mm\./);
    expect(tight.def).not.toBeNull();
  });

  it("makes a body by the sizes given, or none", () => {
    const d = { ...newDraft(), name: "X" };
    expect(build({ ...d, body: "none" }).def!.packages[0]!.model).toBeUndefined();
    expect(build({ ...d, body: "cylinder", bodySize: { w: 5, l: 0, h: 8 } }).def!.packages[0]!.model?.source).toEqual({
      kind: "cylinder",
      diameter: 5,
      height: 8,
    });
    expect(build({ ...d, family: "header" }).def!.packages[0]!.model?.source).toMatchObject({ kind: "header", rows: 1, pins: 4 });
  });
});

describe("a copy of a library part", () => {
  it("keeps the drawing, the footprints and the credit, and lets pin names change", () => {
    const d = draftFrom(part("bc817"));
    expect(d).toMatchObject({
      name: "BC817 copy",
      prefix: "Q",
      box: false,
      family: "keep",
      licence: "CC-BY-SA 4.0 with exception",
      credit: "KiCad libraries 9.0.0",
    });
    expect(d.pins).toBe("1\tB\tinput\n2\tE\tpassive\n3\tC\tpassive");
    const made = build({ ...d, pins: "1\tBase\tinput\n2\tE\tpassive\n3\tC\tpassive\n4\tX" });
    expect(made.def!.symbol.shapes).toEqual(part("bc817").symbol.shapes);
    expect(made.def!.symbol.pins.map((p) => p.name)).toEqual(["Base", "C", "E"]);
    expect(made.def!.packages.map((p) => p.footprint.name)).toEqual(["SOT-23"]);
    expect(made.def!.source).toEqual({
      library: "KiCad libraries 9.0.0",
      licence: "CC-BY-SA 4.0 with exception",
      url: "https://www.kicad.org/libraries/license/",
    });
    expect(made.notes).toEqual(["Pin 4 is not on the drawing. Turn on Draw as a box to add pins."]);
  });

  it("redraws as a box when asked, with the same pins", () => {
    const made = build({ ...draftFrom(part("bc817")), box: true });
    expect(made.def!.symbol.shapes).toHaveLength(1);
    expect(made.def!.symbol.pins.map((p) => p.number).sort()).toEqual(["1", "2", "3"]);
  });

  it("opens one of your own parts under its own name and id", () => {
    expect(draftFrom({ ...part("bc817"), source: { library: "You", licence: "MIT" } }, { id: "mine", shelf: "Transistors" })).toMatchObject({
      id: "mine",
      name: "BC817",
      shelf: "Transistors",
      credit: "",
      licence: "MIT",
    });
  });
});
