import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPinMap, inflate, type LibraryPack } from "@bettercad/electronics";
import { build, draftFrom, liftOntoBoard, newDraft, tableOf, turnedBox } from "./partDraft";

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
    expect(made.notes).toEqual(["Pin 4 is not on the drawing. Choose a box from a pin list, or draw it by hand, to add pins."]);
  });

  it("uses a symbol drawn by hand as it is, checks it, and gives the pin table back when you stop", () => {
    const start = build(newDraft()).symbol;
    const drawn = { ...start, pins: start.pins.map((p) => (p.number === "4" ? { ...p, name: "0V" } : p)) };
    const made = build({ ...newDraft(), name: "Hand", drawn });
    expect(made.def!.symbol).toEqual({ ...drawn, name: "Hand" });
    expect(tableOf(drawn).split("\n")[3]).toBe("4\t0V\tpower in");
    // A pin the footprint has no pad for still stops the save, and so does a drawing with no pins.
    const five = { ...drawn, pins: [...drawn.pins, { ...drawn.pins[0]!, number: "5", y: 12.7 }] };
    expect(build({ ...newDraft(), name: "Hand", drawn: five }).problems).toEqual(["Hand SO-4 has no pad for pin 5. Change the pin numbers or the footprint."]);
    expect(build({ ...newDraft(), drawn: { ...drawn, pins: [] }, pins: "junk" }).problems).toEqual([
      "Give the part a name.",
      "Add at least one pin to the symbol.",
    ]);
  });

  it("uses a footprint changed pad by pad, under a name of its own, and checks it", () => {
    const start = build({ ...newDraft(), name: "Hand" }).footprint!;
    const land = { ...start, pads: start.pads.map((p) => (p.number === "1" ? { ...p, maskMargin: 0.1, pasteMargin: -0.05 } : p)) };
    const made = build({ ...newDraft(), name: "Hand", land });
    expect(made.def!.packages).toHaveLength(1);
    expect(made.def!.packages[0]!.footprint).toEqual({ ...land, name: "Hand SO-4" });
    expect(made.def!.packages[0]!.model).toBeDefined();
    // Taking a pad away leaves a pin with nowhere to go, and taking the courtyard away is worth a note.
    const three = { ...land, pads: land.pads.slice(0, 3), shapes: land.shapes.filter((s) => s.layer !== "courtyard") };
    const short = build({ ...newDraft(), name: "Hand", land: three });
    expect(short.problems).toEqual(["Hand SO-4 has no pad for pin 4. Change the pin numbers or the footprint."]);
    expect(short.notes).toEqual(["It has no courtyard, so the board cannot tell when parts overlap."]);
    // A library part's footprint, edited, is saved beside the part and keeps its other packages and its body.
    const base = part("bc817");
    const kept = build({ ...draftFrom(base), land: base.packages[0]!.footprint });
    expect(kept.def!.packages[0]!.footprint.name).toBe(`BC817 copy ${base.packages[0]!.footprint.name.split(":").pop()}`);
    expect(kept.def!.packages[0]!.model).toEqual(base.packages[0]!.model);
    expect(kept.def!.packages.slice(1)).toEqual(base.packages.slice(1));
  });

  it("takes a STEP file as the body, placed and turned, and opens it again as it was left", () => {
    const step = { blob: "b0123456789abcdef", name: "relay.step", bodies: 2, size: [10, 4, 6] as [number, number, number] };
    const none = build({ ...newDraft(), name: "Relay", body: "step" });
    expect(none.def!.packages[0]).not.toHaveProperty("model");
    expect(none.notes).toEqual(["Pick a file for the body."]);
    const made = build({ ...newDraft(), name: "Relay", body: "step", step, stepAt: [1, 2, 0.5], stepTurn: [90, 0, 0] });
    expect(made.def!.packages[0]!.model).toEqual({ source: { kind: "step", ...step }, offset: [1, 2, 0.5], rotate: [90, 0, 0] });
    expect(build({ ...newDraft(), name: "Relay", body: "step", step }).def!.packages[0]!.model).toEqual({
      source: { kind: "step", ...step },
      offset: [0, 0, 0],
    });
    expect(draftFrom(made.def!, { id: "relay" })).toMatchObject({ body: "step", step, stepAt: [1, 2, 0.5], stepTurn: [90, 0, 0], family: "keep" });
    // A library part keeps its footprints and takes the file for its first package.
    const base = part("bc817");
    const kept = build({ ...draftFrom(base), body: "step", step });
    expect(kept.def!.packages[0]!.footprint).toBe(base.packages[0]!.footprint);
    expect(kept.def!.packages[0]!.model?.source).toMatchObject({ kind: "step", blob: step.blob });
  });

  it("knows the box round a turned body, to sit it on the board", () => {
    // Standing: 10 across, 4 deep, 6 tall, its bottom centre on the origin.
    expect(turnedBox([10, 4, 6], [0, 0, 0])).toEqual({ min: [-5, -2, 0], max: [5, 2, 6] });
    // Tipped a quarter turn about X it lies on its back: 6 deep now, and half its old depth under the board.
    expect(turnedBox([10, 4, 6], [90, 0, 0])).toEqual({ min: [-5, -6, -2], max: [5, 0, 2] });
    expect(liftOntoBoard([10, 4, 6], [90, 0, 0])).toBe(2);
    expect(liftOntoBoard([10, 4, 6], [0, 0, 45])).toBe(0);
    // A quarter turn about Z swaps across and deep.
    expect(turnedBox([10, 4, 6], [0, 0, 90])).toEqual({ min: [-2, -5, 0], max: [2, 5, 6] });
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
