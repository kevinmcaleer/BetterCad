import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { simpleBody } from "./body";
import { buildPack, expand, packageLabel, type Manifest, type Sources } from "./build";
import { BREAKOUTS, breakout } from "./modules";
import { categoriesOf, checkPinMap, inflate, searchPack, type LibraryPack } from "./pack";

const data = join(__dirname, "../kicad/testdata");
// The few real KiCad files the reader tests use stand in for the whole library.
const src: Sources = {
  symbols: () => readFileSync(join(data, "sample.kicad_sym"), "utf8"),
  footprint: (_lib, name) => {
    try {
      return readFileSync(join(data, `${name}.kicad_mod`), "utf8");
    } catch {
      return undefined;
    }
  },
};
const starter = JSON.parse(readFileSync(join(__dirname, "../../library/starter.json"), "utf8")) as LibraryPack;
const manifest = JSON.parse(readFileSync(join(__dirname, "../../library/starter.manifest.json"), "utf8")) as Manifest;

describe("building a pack", () => {
  const made = buildPack(
    {
      kicad: "9.0.0",
      parts: [
        {
          id: "resistor",
          category: "Passives",
          symbol: "Device:R",
          name: "Resistor",
          value: "10 kΩ",
          footprints: ["Resistor_SMD:R_0603_1608Metric"],
          keywords: ["ohm"],
        },
        { id: "bc817", category: "Transistors", symbol: "Transistor_BJT:BC817" },
        { id: "gnd", category: "Power symbols", symbol: "power:GND" },
        { id: "sonar", category: "Sensors", symbol: "module:hc-sr04" },
        { id: "led", category: "LEDs", symbol: "Device:LED", footprints: ["LED_THT:LED_D5.0mm"] },
        { id: "npn-wrong", category: "Transistors", symbol: "Device:Q_NPN_BEC", footprints: ["LED_THT:LED_D5.0mm", "Package_TO_SOT_SMD:SOT-23"] },
        { id: "lost", category: "Passives", symbol: "Device:R", footprints: ["Nowhere:Nothing"] },
        { id: "ghost", category: "Passives", symbol: "Device:Unobtainium" },
      ],
    },
    src,
  );

  it("makes whole parts, with the symbol's own footprint when none is named", () => {
    expect(made.pack.parts.map((p) => p.id)).toEqual(["resistor", "bc817", "gnd", "sonar", "led", "npn-wrong"]);
    const bc = inflate(made.pack, made.pack.parts[1]!);
    expect(bc).toMatchObject({ name: "BC817", prefix: "Q", value: "BC817" });
    expect(bc.packages.map((p) => p.footprint.name)).toEqual(["SOT-23"]);
    expect(bc.source).toEqual({ library: "KiCad libraries 9.0.0", licence: "CC-BY-SA 4.0 with exception", url: "https://www.kicad.org/libraries/license/" });
    expect(made.pack.parts[1]!.packages[0]!.label).toBe("SOT-23");
  });

  it("says what it left out and why, and never guesses", () => {
    expect(made.problems).toEqual([
      "npn-wrong: in LED_D5.0mm, no pad for pin 3",
      "lost: footprint Nowhere:Nothing not found",
      "lost: no footprint",
      "ghost: symbol Device:Unobtainium not found",
    ]);
    // The transistor keeps the package that fits.
    expect(inflate(made.pack, made.pack.parts[5]!).packages.map((p) => p.footprint.name)).toEqual(["SOT-23"]);
    expect(made.pack.parts[5]!.packages.map((p) => p.label)).toEqual(["SOT-23"]);
  });

  it("gives every package a simple body, sized from its outline", () => {
    const r = inflate(made.pack, made.pack.parts[0]!);
    expect(r.packages[0]!.model).toEqual({ source: { kind: "box", size: [1.6, 0.83, 0.45] } });
    const led = inflate(made.pack, made.pack.parts[4]!);
    expect(led.packages[0]!.model?.source).toEqual({ kind: "cylinder", diameter: 5, height: 8.6 });
  });

  it("credits modules drawn for BetterCad to BetterCad", () => {
    expect(inflate(made.pack, made.pack.parts[3]!).source?.library).toBe("BetterCad");
  });

  it("makes one part per number from a repeat", () => {
    const three = expand([
      { id: "header-1x{nn}", category: "Connectors", symbol: "Connector_Generic:Conn_01x{nn}", name: "Pin header, 1 × {n}", repeat: { from: 9, to: 11 } },
    ]);
    expect(three.map((p) => [p.id, p.symbol, p.name])).toEqual([
      ["header-1x09", "Connector_Generic:Conn_01x09", "Pin header, 1 × 9"],
      ["header-1x10", "Connector_Generic:Conn_01x10", "Pin header, 1 × 10"],
      ["header-1x11", "Connector_Generic:Conn_01x11", "Pin header, 1 × 11"],
    ]);
  });

  it("names packages shortly", () => {
    expect(packageLabel("Resistor_SMD:R_0603_1608Metric")).toBe("0603");
    expect(packageLabel("Package_SO:SOIC-8_3.9x4.9mm_P1.27mm")).toBe("SOIC-8");
    expect(packageLabel("Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical")).toBe("PinHeader 1x04");
  });
});

describe("simple bodies", () => {
  it("makes a header for pin headers and nothing for holes", () => {
    const fp = { name: "x", pads: [], shapes: [] };
    expect(simpleBody("Connector_PinHeader_2.54mm:PinHeader_2x20_P2.54mm_Vertical", fp)?.source).toEqual({
      kind: "header",
      rows: 2,
      pins: 20,
      pitch: 2.54,
      height: 2.5,
    });
    expect(simpleBody("Connector_PinSocket_2.54mm:PinSocket_1x04_P2.54mm_Vertical", fp)?.source).toMatchObject({ kind: "header", height: 8.5 });
    expect(simpleBody("MountingHole:MountingHole_3.2mm_M3", fp)).toBeUndefined();
  });
});

describe("modules we draw", () => {
  it("draws a breakout as a named box and a row of pins inside the board's outline", () => {
    const sonar = breakout(BREAKOUTS["hc-sr04"]!);
    expect(sonar.symbol.pins.map((p) => `${p.number} ${p.name} ${p.type}`)).toEqual(["1 VCC power_in", "2 Trig input", "3 Echo output", "4 GND power_in"]);
    const fp = sonar.packages[0]!.footprint;
    expect(fp.pads.map((p) => [p.number, p.x, p.y])).toEqual([
      ["1", 0, 0],
      ["2", 2.54, 0],
      ["3", 5.08, 0],
      ["4", 7.62, 0],
    ]);
    expect(checkPinMap(sonar)).toEqual([]);
    const outline = fp.shapes.find((s) => s.layer === "fab")!;
    expect(outline).toMatchObject({ kind: "rect", x1: -18.7, x2: 26.3, y2: 18.5, y1: -1.5 });
  });
});

describe("the pin map check", () => {
  it("passes a pin that a pin map sends to a pad with another name, and names a pin with nowhere to go", () => {
    const sonar = breakout(BREAKOUTS["hc-sr04"]!);
    const renamed = {
      ...sonar,
      packages: [
        { footprint: { ...sonar.packages[0]!.footprint, pads: sonar.packages[0]!.footprint.pads.map((p) => (p.number === "4" ? { ...p, number: "G" } : p)) } },
      ],
    };
    expect(checkPinMap(renamed)).toEqual([{ package: renamed.packages[0]!.footprint.name, missing: ["4"] }]);
    expect(checkPinMap({ ...renamed, packages: [{ ...renamed.packages[0]!, pinMap: { "4": ["G"] } }] })).toEqual([]);
  });
});

describe("the starter library", () => {
  it("holds every part the manifest lists", () => {
    expect(starter.parts.map((p) => p.id)).toEqual(expand(manifest.parts).map((p) => p.id));
    expect(starter.parts.length).toBeGreaterThan(200);
    expect(new Set(starter.parts.map((p) => p.id)).size).toBe(starter.parts.length);
  });

  it("has only whole parts: a symbol, a package with a pad for every pin, and where it came from", () => {
    for (const part of starter.parts) {
      const def = inflate(starter, part);
      expect(def.symbol, part.id).toBeDefined();
      // A mounting hole or a fiducial has no pins: it is only a footprint.
      if (part.category !== "Mechanical") expect(def.symbol.pins.length, part.id).toBeGreaterThan(0);
      if (!def.symbol.power) expect(def.packages.length, part.id).toBeGreaterThan(0);
      expect(checkPinMap(def), part.id).toEqual([]);
      expect(def.source?.licence, part.id).toMatch(/^CC-BY-SA 4\.0/);
    }
  });

  it("carries its credits and licence", () => {
    expect(starter.licence).toMatch(/CC-BY-SA 4\.0/);
    expect(starter.credits[0]).toMatchObject({ name: "KiCad libraries", version: manifest.kicad, url: "https://www.kicad.org/libraries/license/" });
  });

  it("has the parts a robot board needs, on shelves", () => {
    expect(categoriesOf(starter)).toEqual([
      "Passives",
      "Diodes and LEDs",
      "Power symbols",
      "Connectors",
      "Switches and sound",
      "Power",
      "Transistors",
      "Motor drivers",
      "Microcontrollers and modules",
      "Chips",
      "Sensors and displays",
      "Mechanical",
    ]);
    const ids = new Set(starter.parts.map((p) => p.id));
    for (const id of [
      "resistor",
      "capacitor",
      "led",
      "pico",
      "pico-w",
      "pico-2",
      "esp32-wroom-32e",
      "drv8833pw",
      "tb6612fng",
      "usb-c",
      "jst-sh-4",
      "servo-header",
      "ams1117-3.3",
      "hc-sr04",
      "mounting-hole",
      "header-2x20",
    ])
      expect(ids.has(id), id).toBe(true);
    const r = starter.parts.find((p) => p.id === "resistor")!;
    expect(r.packages.map((p) => p.label)).toEqual(["0603", "0402", "0805", "1206", "R Axial DIN0207 L6.3mm D2.5mm"]);
  });

  it("finds parts by name, value, package, keyword and shelf, best match first", () => {
    const names = (q: string, cat?: string) => searchPack(starter, q, cat).map((p) => p.name);
    expect(names("resistor")[0]).toBe("Resistor");
    expect(names("pico").slice(0, 4)).toEqual(["Raspberry Pi Pico", "Raspberry Pi Pico W", "Raspberry Pi Pico 2", "Raspberry Pi Pico 2 W"]);
    expect(names("qwiic")).toEqual(["JST SH, 4 pins (Qwiic, STEMMA QT)"]);
    expect(names("sot-23 mosfet")).toContain("AO3400A");
    expect(names("0402")).toEqual(expect.arrayContaining(["Resistor", "Capacitor"]));
    expect(names("", "Motor drivers")).toHaveLength(8);
    expect(names("zzzz")).toEqual([]);
  });
});
