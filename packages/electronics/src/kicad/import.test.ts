import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPinMap } from "../library/pack";
import { importKicad, unstack } from "./import";
import { readKicadFootprint } from "./footprint";

const file = (name: string) => ({ name: name.replace(/^.*\//, ""), text: readFileSync(join(__dirname, "testdata", name), "utf8") });
const cc = { licence: "CC-BY-SA 4.0 with exception" };

describe("importing KiCad files", () => {
  it("pairs a symbol with the footprint it names, and sends a stacked pin to all its pads (Espressif, KiCad 7 and 10 files)", () => {
    const got = importKicad([file("external/Espressif.kicad_sym"), file("external/ESP32-C3-MINI-1.kicad_mod")], cc);
    expect(got.found).toEqual({ symbols: 1, footprints: 1 });
    expect(got.notes).toEqual([]);
    const part = got.parts[0]!;
    expect(part).toMatchObject({ name: "ESP32-C3-MINI-1", prefix: "U", source: { library: "Espressif", licence: "CC-BY-SA 4.0 with exception" } });
    expect(part.packages[0]!.footprint.name).toBe("ESP32-C3-MINI-1");
    const gnd = part.symbol.pins.find((p) => p.name === "GND")!;
    expect(gnd.number).toBe("1");
    expect(part.packages[0]!.pinMap!["1"]).toEqual(["1", "2", "11", "14", ...Array.from({ length: 18 }, (_, i) => String(36 + i))]);
    expect(checkPinMap(part)).toEqual([]);
    expect(part.packages[0]!.model?.source.kind).toBe("box");
  });

  it("brings a symbol in with no footprint when its footprint is not there, and says so (SparkFun)", () => {
    const got = importKicad([file("external/SparkFun-LED.kicad_sym")], { licence: "CC-BY 4.0", library: "SparkFun" });
    expect(got.parts.map((p) => [p.name, p.prefix, p.symbol.pins.length, p.packages.length, p.source])).toEqual([
      ["APA102 2020 6Pin", "D", 6, 0, { library: "SparkFun", licence: "CC-BY 4.0" }],
    ]);
    expect(got.notes).toEqual([{ name: "APA102 2020 6Pin", why: "Its footprint APA102_2020_6Pin was not among the files, so it came in with no footprint" }]);
  });

  it("takes a footprint the files leave out from the library it is given", () => {
    const sot = readKicadFootprint(file("SOT-23.kicad_mod").text).footprint;
    const got = importKicad([file("sample.kicad_sym")], cc, (name) => (name === "SOT-23" ? sot : undefined));
    const bc = got.parts.find((p) => p.name === "BC817")!;
    expect(bc.packages.map((p) => p.footprint.name)).toEqual(["SOT-23"]);
    expect(got.notes).toContainEqual({ name: "BC817", why: "Its footprint SOT-23 came from the starter library" });
    expect(got.notes).toContainEqual({ name: "GND", why: "A power symbol. BetterCad has its own, so it was left out" });
  });

  it("pairs by the symbol's footprint filters when the name differs (a Digi-Key footprint in KiCad 5 format)", () => {
    const got = importKicad([file("sample.kicad_sym"), file("external/SOT-23-3.kicad_mod")], cc);
    const bc = got.parts.find((p) => p.name === "BC817")!;
    expect(bc.packages.map((p) => `${p.footprint.name}: ${p.footprint.pads.map((x) => x.number).join(" ")}`)).toEqual(["SOT-23-3: 3 2 1"]);
    expect(got.notes).toContainEqual({ name: "BC817", why: "Its footprint SOT-23 was not among the files, so it uses SOT-23-3" });
    // A resistor's filters do not fit a SOT-23, so it is not forced onto it.
    expect(got.parts.find((p) => p.name === "R")!.packages).toEqual([]);
  });

  it("leaves out what it cannot use, and says why", () => {
    const got = importKicad(
      [file("external/SOT-23-3.kicad_mod"), { name: "notes.txt", text: "hello" }, { name: "broken.kicad_sym", text: "(not a library)" }],
      cc,
    );
    expect(got.parts).toEqual([]);
    expect(got.notes).toEqual([
      { name: "notes.txt", why: "Not a KiCad symbol library (.kicad_sym) or footprint (.kicad_mod)" },
      { name: "broken.kicad_sym", why: "This is not a KiCad symbol library (.kicad_sym)." },
      { name: "SOT-23-3", why: "A footprint needs a symbol to be a part. Add its .kicad_sym file too" },
    ]);
  });
});

describe("stacked pins", () => {
  it("leaves plain numbers alone", () => {
    const symbol = { name: "x", units: 1, shapes: [], pins: [{ number: "A1", name: "A", type: "input" as const, x: 0, y: 0, length: 2.54, dir: 0 as const }] };
    expect(unstack(symbol)).toEqual({ symbol, pinMap: {} });
  });
});
