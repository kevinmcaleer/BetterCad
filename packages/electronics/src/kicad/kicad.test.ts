import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readKicadFootprint } from "./footprint";
import { Str, arcFrom3, parseSexpr, writeSexpr } from "./sexpr";
import { readKicadSymbols } from "./symbol";

// Real files from the KiCad libraries, release 9.0.0 (see testdata/README.md).
const file = (name: string) => readFileSync(join(__dirname, "testdata", name), "utf8");

describe("s-expressions", () => {
  it("reads lists, words, numbers and quoted strings with escapes", () => {
    const [n] = parseSexpr('(pad "1" smd (at 0 -1.5) (name "a \\"b\\"\\n(c)"))');
    expect(n).toEqual(["pad", new Str("1"), "smd", ["at", "0", "-1.5"], ["name", new Str('a "b"\n(c)')]]);
  });

  it("says when the brackets do not balance", () => {
    expect(() => parseSexpr("(a (b)")).toThrow(/ends before its brackets close/);
    expect(() => parseSexpr("(a))")).toThrow(/too many/);
  });

  it("writes a tree back so that it reads the same", () => {
    const tree = parseSexpr(file("SOT-23.kicad_mod"));
    expect(parseSexpr(writeSexpr(tree[0]!))).toEqual(tree);
  });

  it("turns three points into an arc that runs anticlockwise", () => {
    expect(arcFrom3([1, 0], [0, 1], [-1, 0])).toEqual({ cx: 0, cy: 0, r: 1, a0: 0, a1: 180 });
    // The same three points the other way round are the same arc.
    expect(arcFrom3([-1, 0], [0, 1], [1, 0])).toEqual({ cx: 0, cy: 0, r: 1, a0: 0, a1: 180 });
    // Through the bottom: from 180° round to 360°.
    expect(arcFrom3([-1, 0], [0, -1], [1, 0])).toEqual({ cx: 0, cy: 0, r: 1, a0: 180, a1: 360 });
    expect(arcFrom3([0, 0], [1, 1], [2, 2])).toBeNull();
  });
});

describe("KiCad symbols", () => {
  const all = readKicadSymbols(file("sample.kicad_sym"));
  const get = (name: string) => all.find((s) => s.name === name)!;

  it("reads every symbol in the library", () => {
    expect(all.map((s) => s.name)).toEqual(["R", "LED", "Q_NPN_BEC", "BC817", "74LS00", "74HC00", "GND"]);
  });

  it("reads a resistor: a box, two passive pins on the grid, its prefix and keywords", () => {
    const r = get("R");
    expect(r).toMatchObject({ prefix: "R", value: "R", keywords: ["R", "res", "resistor"], footprintFilters: ["R_*"] });
    expect(r.symbol.units).toBe(1);
    expect(r.symbol.shapes).toEqual([{ kind: "rect", x1: -1.016, y1: -2.54, x2: 1.016, y2: 2.54, fill: false, width: 0.254 }]);
    expect(r.symbol.pins).toEqual([
      { number: "1", name: "", type: "passive", x: 0, y: 3.81, length: 1.27, dir: 270 },
      { number: "2", name: "", type: "passive", x: 0, y: -3.81, length: 1.27, dir: 90 },
    ]);
    expect(r.description).toBe("Resistor");
  });

  it("reads an LED's lines and arrows, with its anode and cathode named", () => {
    const led = get("LED").symbol;
    expect(led.pins.map((p) => [p.number, p.name, p.dir])).toEqual([
      ["1", "K", 0],
      ["2", "A", 180],
    ]);
    expect(led.shapes.every((s) => s.kind === "line")).toBe(true);
  });

  it("a symbol that extends another takes its drawing and keeps its own name, footprint and description", () => {
    const bc = get("BC817");
    const base = get("Q_NPN_BEC");
    expect(bc.symbol.pins).toEqual(base.symbol.pins);
    expect(bc.symbol.shapes).toEqual(base.symbol.shapes);
    expect(bc.symbol.pins.map((p) => `${p.number}${p.name}`).sort()).toEqual(["1B", "2E", "3C"]);
    expect(bc).toMatchObject({ prefix: "Q", value: "BC817", footprint: "Package_TO_SOT_SMD:SOT-23" });
    expect(bc.description).toMatch(/NPN/);
    expect(bc.datasheet).toMatch(/^https?:/);
    // The transistor's circle and its filled arrow head.
    expect(base.symbol.shapes.some((s) => s.kind === "circle")).toBe(true);
    expect(base.symbol.shapes.some((s) => s.kind === "line" && s.fill === "solid")).toBe(true);
  });

  it("reads a chip with several units: four gates and a power unit, normal body style only", () => {
    const nand = get("74HC00").symbol;
    expect(nand.units).toBe(5);
    expect(nand.pins).toHaveLength(14);
    expect(nand.pins.filter((p) => p.unit === 1).map((p) => p.number)).toEqual(["1", "2", "3"]);
    expect(nand.pins.filter((p) => p.unit === 5).map((p) => [p.number, p.name, p.type])).toEqual([
      ["14", "VCC", "power_in"],
      ["7", "GND", "power_in"],
    ]);
    expect(nand.pins.find((p) => p.number === "3")).toMatchObject({ type: "output" });
    // Each gate is drawn once (an arc and its lines), not again in the De Morgan style.
    expect(nand.shapes.filter((s) => s.unit === 1 && s.kind === "arc")).toHaveLength(1);
  });

  it("knows a power symbol, whose value names its net", () => {
    const gnd = get("GND");
    expect(gnd.symbol.power).toBe(true);
    expect(gnd).toMatchObject({ prefix: "#PWR", value: "GND" });
    expect(gnd.symbol.pins).toHaveLength(1);
    expect(gnd.symbol.pins[0]).toMatchObject({ type: "power_in", x: 0, y: 0, length: 0 });
    // Its reference is hidden, so it has no place to draw.
    expect(gnd.symbol.refAt).toBeUndefined();
  });

  it("refuses a file that is not a symbol library", () => {
    expect(() => readKicadSymbols(file("SOT-23.kicad_mod"))).toThrow("This is not a KiCad symbol library (.kicad_sym).");
  });
});

describe("KiCad footprints", () => {
  it("reads a chip resistor: two rounded pads, with y turned to run up", () => {
    const r = readKicadFootprint(file("R_0603_1608Metric.kicad_mod"));
    expect(r.footprint.name).toBe("R_0603_1608Metric");
    expect(r.footprint.pads).toEqual([
      { number: "1", kind: "smd", shape: "roundrect", x: -0.825, y: 0, w: 0.8, h: 0.95, round: 0.25 },
      { number: "2", kind: "smd", shape: "roundrect", x: 0.825, y: 0, w: 0.8, h: 0.95, round: 0.25 },
    ]);
    expect(r).toMatchObject({ mount: "smd", keywords: ["resistor"] });
    expect(r.models[0]?.path).toMatch(/R_0603_1608Metric\.(wrl|step)$/);
    // The courtyard is one closed run, not four loose lines.
    const yard = r.footprint.shapes.filter((s) => s.layer === "courtyard");
    expect(yard).toHaveLength(1);
    expect(yard[0]).toMatchObject({ kind: "line" });
    expect((yard[0] as { pts: unknown[] }).pts).toHaveLength(5);
    // KiCad puts the reference above the part, at y -1.43 in its y-down sheet.
    expect(r.footprint.refAt).toEqual([0, 1.43]);
  });

  it("reads a SOT-23 with its three pads where the datasheet has them", () => {
    const { footprint } = readKicadFootprint(file("SOT-23.kicad_mod"));
    const at = Object.fromEntries(footprint.pads.map((p) => [p.number, [p.x, p.y]]));
    // Pins 1 and 2 on the left, 1 above 2; pin 3 alone on the right.
    expect(at["1"]![0]).toBeLessThan(0);
    expect(at["1"]![1]).toBeGreaterThan(at["2"]![1]!);
    expect(at["3"]).toEqual([0.9375, 0]);
  });

  it("reads a pin header: plated holes, pin 1 square, the rest going down", () => {
    const { footprint, mount } = readKicadFootprint(file("PinHeader_1x04_P2.54mm_Vertical.kicad_mod"));
    expect(mount).toBe("thru");
    expect(footprint.pads.map((p) => [p.number, p.kind, p.shape, p.x, p.y, p.drill])).toEqual([
      ["1", "thru", "rect", 0, 0, 1],
      ["2", "thru", "oval", 0, -2.54, 1],
      ["3", "thru", "oval", 0, -5.08, 1],
      ["4", "thru", "oval", 0, -7.62, 1],
    ]);
  });

  it("reads slots: a barrel jack's long holes keep their width and length", () => {
    const { footprint } = readKicadFootprint(file("BarrelJack_Horizontal.kicad_mod"));
    expect(footprint.pads).toHaveLength(3);
    for (const p of footprint.pads) {
      expect(p.kind).toBe("thru");
      expect(p.slot).toBeGreaterThan(p.drill!);
    }
  });

  it("reads arcs on the silkscreen, fabrication and courtyard layers", () => {
    const { footprint } = readKicadFootprint(file("LED_D5.0mm.kicad_mod"));
    const arcs = footprint.shapes.filter((s) => s.kind === "arc");
    expect(arcs.length).toBeGreaterThan(0);
    for (const a of arcs) if (a.kind === "arc") expect(a.a1).toBeGreaterThan(a.a0);
    expect(new Set(footprint.shapes.map((s) => s.layer))).toEqual(new Set(["silk", "fab", "courtyard"]));
  });

  it("refuses a file that is not a footprint", () => {
    expect(() => readKicadFootprint(file("sample.kicad_sym"))).toThrow("This is not a KiCad footprint (.kicad_mod).");
  });
});
