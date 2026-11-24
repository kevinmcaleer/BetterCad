import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readKicadFootprint } from "../kicad/footprint";
import type { FootprintDef } from "../model";
import {
  bgaFootprint,
  bgaRow,
  checkFootprint,
  chipFootprint,
  dipFootprint,
  dualFootprint,
  formatPinTable,
  headerPins,
  icSymbol,
  parsePinTable,
  quadFootprint,
} from "./wizards";

const kicad = (name: string): FootprintDef => readKicadFootprint(readFileSync(join(__dirname, "../kicad/testdata", `${name}.kicad_mod`), "utf8")).footprint;
/** Pads as "number x y w h", to hold a wizard's footprint against KiCad's own. */
const pads = (fp: FootprintDef) =>
  fp.pads.map((p) => {
    const turned = Math.abs(((p.angle ?? 0) % 180) - 90) < 1;
    return `${p.number} ${p.x.toFixed(3)} ${p.y.toFixed(3)} ${(turned ? p.h : p.w).toFixed(2)} ${(turned ? p.w : p.h).toFixed(2)}`;
  });

describe("a pin table", () => {
  it("reads tabs from a spreadsheet, with plain words for what a pin does", () => {
    const t = parsePinTable("Pin\tName\tType\n1\tVCC\tPower\n2\tIN\tInput\n3\tOUT\tOutput\tright\n4\tGND\tpower in\tbottom\n5\tNC\tnot connected\n");
    expect(t.skipped).toEqual([]);
    expect(t.pins).toEqual([
      { number: "1", name: "VCC", type: "power_in" },
      { number: "2", name: "IN", type: "input" },
      { number: "3", name: "OUT", type: "output", side: "right" },
      { number: "4", name: "GND", type: "power_in", side: "bottom" },
      { number: "5", name: "NC", type: "no_connect" },
    ]);
  });

  it("reads spaces from a datasheet, either way round, and says which lines it could not read", () => {
    const t = parsePinTable("1 SDA io\n2 SCL in\nVDD 3 power in left\nA1  D0  out\nlonely\n");
    expect(t.pins).toEqual([
      { number: "1", name: "SDA", type: "bidirectional" },
      { number: "2", name: "SCL", type: "input" },
      { number: "3", name: "VDD", type: "power_in", side: "left" },
      { number: "A1", name: "D0", type: "output" },
    ]);
    expect(t.skipped).toEqual([{ line: "lonely", why: "It needs a pin number and a name" }]);
  });

  it("goes back to text and reads the same", () => {
    const t = parsePinTable("1\tVCC\tpower in\n2\tQ\toutput\tright\n3\tX");
    expect(parsePinTable(formatPinTable(t.pins)).pins).toEqual(t.pins);
  });
});

describe("a symbol from a pin table", () => {
  it("sets the pins out like the package, on the grid, round a box", () => {
    const s = icSymbol("NE555", parsePinTable("1 GND power\n2 TRIG in\n3 OUT out\n4 RESET in\n5 CTRL in\n6 THRES in\n7 DISCH oc\n8 VCC power").pins);
    expect(s.pins.map((p) => `${p.number}@${p.x},${p.y}>${p.dir}`)).toEqual([
      "1@-12.7,5.08>0",
      "2@-12.7,2.54>0",
      "3@-12.7,0>0",
      "4@-12.7,-2.54>0",
      "8@12.7,5.08>180",
      "7@12.7,2.54>180",
      "6@12.7,0>180",
      "5@12.7,-2.54>180",
    ]);
    expect(s.shapes[0]).toMatchObject({ kind: "rect", x1: -10.16, x2: 10.16, y1: -7.62, y2: 7.62 });
    for (const p of s.pins) for (const v of [p.x, p.y]) expect(Math.abs(v / 2.54 - Math.round(v / 2.54))).toBeLessThan(1e-6);
  });

  it("puts a pin on the side it was given", () => {
    const s = icSymbol("Reg", [
      { number: "1", name: "IN", type: "power_in", side: "left" },
      { number: "2", name: "GND", type: "power_in", side: "bottom" },
      { number: "3", name: "OUT", type: "power_out", side: "right" },
    ]);
    expect(s.pins.map((p) => `${p.name}@${p.x},${p.y}>${p.dir}`)).toEqual(["IN@-10.16,0>0", "OUT@10.16,0>180", "GND@0,-7.62>90"]);
  });
});

describe("footprint wizards against KiCad's own footprints", () => {
  it("makes a 0603 chip", () => {
    const k = kicad("R_0603_1608Metric");
    const ours = chipFootprint("0603", { bodyL: 1.6, bodyW: 0.8, padW: 0.8, padH: 0.95, pitch: 1.65 });
    expect(pads(ours)).toEqual(pads(k));
    expect(checkFootprint(ours)).toEqual([]);
  });

  it("makes a SOIC-8", () => {
    const k = kicad("SOIC-8_3.9x4.9mm_P1.27mm");
    const ours = dualFootprint("SOIC-8", { pins: 8, pitch: 1.27, span: 4.95, padW: 1.95, padH: 0.6, bodyW: 3.9, bodyL: 4.9 });
    expect(pads(ours)).toEqual(pads(k));
    expect(checkFootprint(ours)).toEqual([]);
  });

  it("makes a DIP-8", () => {
    const k = kicad("DIP-8_W7.62mm");
    const ours = dipFootprint("DIP-8", { pins: 8, pitch: 2.54, span: 7.62, drill: 0.8, pad: 1.6 });
    expect(pads(ours)).toEqual(pads(k));
    expect(ours.pads.map((p) => `${p.shape} ${p.drill}`)).toEqual(k.pads.map((p) => `${p.shape} ${p.drill}`));
    expect(checkFootprint(ours)).toEqual([]);
  });

  it("makes a 1 × 4 pin header", () => {
    const k = kicad("PinHeader_1x04_P2.54mm_Vertical");
    const ours = headerPins("1 × 4", { rows: 1, pins: 4, pitch: 2.54, drill: 1, pad: 1.7 });
    expect(pads(ours)).toEqual(pads(k));
    expect(checkFootprint(ours)).toEqual([]);
  });

  it("makes a QFN-24 with its centre pad", () => {
    const k = kicad("QFN-24-1EP_4x4mm_P0.5mm_EP2.6x2.6mm");
    const edge = k.pads.filter((p) => /^\d+$/.test(p.number) && Number(p.number) <= 24);
    const ours = quadFootprint("QFN-24", { pins: 24, pitch: 0.5, span: Math.abs(edge[0]!.x) * 2, padW: 0.875, padH: 0.25, body: 4, centre: 2.6 });
    const centres = (fp: FootprintDef) => fp.pads.filter((p) => Number(p.number) <= 24).map((p) => `${p.number} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`);
    expect(centres(ours)).toEqual(centres({ ...k, pads: edge }));
    expect(ours.pads.at(-1)).toMatchObject({ number: "25", w: 2.6, h: 2.6, x: 0, y: 0 });
  });
});

describe("a ball grid", () => {
  it("letters the rows without the letters that read as digits", () => {
    expect([0, 7, 8, 19, 20, 21].map(bgaRow)).toEqual(["A", "H", "J", "Y", "AA", "AB"]);
    const fp = bgaFootprint("BGA-9", { rows: 3, cols: 3, pitch: 0.8, ball: 0.4, bodyW: 3, bodyL: 3 });
    expect(fp.pads.map((p) => `${p.number} ${p.x} ${p.y}`)).toEqual([
      "A1 -0.8 0.8",
      "A2 0 0.8",
      "A3 0.8 0.8",
      "B1 -0.8 0",
      "B2 0 0",
      "B3 0.8 0",
      "C1 -0.8 -0.8",
      "C2 0 -0.8",
      "C3 0.8 -0.8",
    ]);
    expect(checkFootprint(fp)).toEqual([]);
  });
});

describe("the footprint check", () => {
  it("says what is missing and which pads are too close", () => {
    const bare: FootprintDef = {
      name: "bare",
      pads: [
        { number: "1", kind: "smd", shape: "rect", x: 0, y: 0, w: 1, h: 1 },
        { number: "2", kind: "smd", shape: "rect", x: 1.1, y: 0, w: 1, h: 1 },
        { number: "", kind: "thru", shape: "circle", x: 5, y: 0, w: 1, h: 1, drill: 1 },
      ],
      shapes: [],
    };
    expect(checkFootprint(bare).map((p) => p.text)).toEqual([
      "It has no courtyard, so the board cannot tell when parts overlap.",
      "Nothing on the silkscreen shows where pin 1 is.",
      "1 pad has no number.",
      "Pad : the 1 mm hole leaves no copper round it.",
      "Two pads are closer than 0.2 mm. Pads 1 and 2 are 0.1 mm apart.",
    ]);
    expect(checkFootprint({ name: "empty", pads: [], shapes: [] })[0]!.text).toBe("It has no pads.");
  });
});
