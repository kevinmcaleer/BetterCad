import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASICS } from "../basics";
import { addLabel, placePart } from "../edit";
import { inflate, type LibraryPack } from "../library/pack";
import { emptyDesign, type ComponentDef, type ElectronicsDesign } from "../model";
import { placedPins } from "../nets";
import { isGround, parseQuantity, railVolts, railsOf, spiceDeck, tracesOf } from "./spice";

const starter = JSON.parse(readFileSync(join(__dirname, "../../library/starter.json"), "utf8")) as LibraryPack;
const lib = (id: string): ComponentDef =>
  inflate(
    starter,
    starter.parts.find((p) => p.id === id)!,
  );

/** Places a part with each pin on a named net, by a label on the pin. */
function put(d: ElectronicsDesign, def: ComponentDef, nets: Record<string, string>, value?: string): ElectronicsDesign {
  const x = d.parts.length * 20;
  const placed = placePart(d, "sh1", def, { x, y: 0 }, value ? { value } : {});
  let out = placed.design;
  for (const pin of placedPins(out).filter((p) => p.part === placed.part.id)) {
    const net = nets[pin.pin];
    if (net) out = addLabel(out, "sh1", net, pin.at[0], pin.at[1]);
  }
  return out;
}

/** A 5 V rail, a resistor and a capacitor to ground, and a red LED with its resistor. */
function rc(): ElectronicsDesign {
  let d = emptyDesign();
  d = put(d, BASICS["5v"]!(), { "1": "5V" });
  d = put(d, BASICS.gnd!(), { "1": "GND" });
  d = put(d, BASICS.resistor!(), { "1": "5V", "2": "OUT" }, "1 kΩ");
  d = put(d, BASICS.capacitor!(), { "1": "OUT", "2": "GND" }, "1 µF");
  return d;
}

describe("circuit simulation's netlist (#761)", () => {
  it("reads part values the way they are written", () => {
    expect(parseQuantity("10 kΩ")).toBe(10_000);
    expect(parseQuantity("4k7")).toBeCloseTo(4700);
    expect(parseQuantity("2R2")).toBeCloseTo(2.2);
    expect(parseQuantity("100nF")).toBeCloseTo(1e-7);
    expect(parseQuantity("4.7 µF")).toBeCloseTo(4.7e-6);
    expect(parseQuantity("1M")).toBe(1e6);
    expect(parseQuantity("5.1 V")).toBe(5.1);
    expect(parseQuantity("Red")).toBeNull();
  });

  it("knows rails and ground by name", () => {
    expect(railVolts("+5V")).toBe(5);
    expect(railVolts("3V3")).toBe(3.3);
    expect(railVolts("+12V")).toBe(12);
    expect(railVolts("VBUS")).toBe(5);
    expect(railVolts("VCC")).toBeNull();
    expect(["GND", "GNDA", "AGND", "0"].every(isGround)).toBe(true);
    expect(isGround("OUT")).toBe(false);
  });

  it("writes resistors, capacitors and rails as SPICE, with ground as node 0", () => {
    const deck = spiceDeck(rc());
    const r = deck.nodes.get("5V")!;
    const out = deck.nodes.get("OUT")!;
    expect(deck.nodes.get("GND")).toBe("0");
    expect(deck.text).toContain(`R1 ${r} ${out} 1000`);
    expect(deck.text).toContain(`C1 ${out} 0 0.000001`);
    expect(deck.text).toContain(`V_${r} ${r} 0 DC 5`);
    expect(deck.text).toMatch(/^\.tran 0\.00002 0\.01$/m);
    expect(deck.skipped).toEqual([]);
  });

  it("models the starter diodes, LEDs, transistors and batteries by their pins", () => {
    let d = rc();
    d = put(d, lib("led"), { "1": "GND", "2": "LED" }, "Green");
    d = put(d, lib("1n4148"), { "1": "OUT", "2": "GND" });
    d = put(d, lib("2n3904"), { "2": "B", "3": "C", "1": "GND" });
    d = put(d, lib("bc557"), { "2": "B", "1": "C", "3": "5V" });
    d = put(d, lib("ao3400a"), { "1": "B", "3": "C", "2": "GND" });
    d = put(d, lib("battery"), { "1": "BAT", "2": "GND" }, "9 V");
    d = put(d, lib("diode-zener"), { "1": "C", "2": "GND" });
    const deck = spiceDeck(d);
    const n = (net: string) => deck.nodes.get(net)!;
    expect(deck.text).toContain(`D1 ${n("LED")} 0 D_LED_GREEN`);
    expect(deck.text).toContain(`D2 0 ${n("OUT")} D_1N4148`);
    expect(deck.text).toContain(`Q1 ${n("C")} ${n("B")} 0 Q_NPN`);
    expect(deck.text).toContain(`Q2 ${n("C")} ${n("B")} ${n("5V")} Q_PNP`);
    expect(deck.text).toContain(`Q3 ${n("C")} ${n("B")} 0 0 M_N_LOGIC`);
    expect(deck.text).toContain(`VBT1 ${n("BAT")} 0 DC 9`);
    expect(deck.text).toContain(`D3 0 ${n("C")} D_ZENER_5V1`);
    expect(deck.text).toMatch(/^\.model D_ZENER_5V1 D\(.*BV=5\.1/m);
    for (const m of ["D_LED_GREEN", "D_1N4148", "Q_NPN", "Q_PNP", "M_N_LOGIC"]) expect(deck.text).toMatch(new RegExp(`^\\.model ${m} `, "m"));
    expect(deck.skipped).toEqual([]);
  });

  it("lists what it leaves out, and rails that need a voltage", () => {
    let d = rc();
    d = put(d, BASICS.vin!(), { "1": "VIN" });
    d = put(d, BASICS["header-2"]!(), { "1": "OUT", "2": "GND" });
    d = put(d, BASICS.resistor!(), { "1": "OUT", "2": "GND" }, "open");
    const deck = spiceDeck(d);
    expect(deck.skipped).toEqual([
      { ref: "J1", why: "The simulator has no model for it" },
      { ref: "R2", why: "Its value, open, isn't a number" },
    ]);
    expect(railsOf(d)).toEqual(["5V", "VIN"]);
    expect(deck.unknownRails).toEqual(["VIN"]);
    // Given one, it is a source.
    const given = spiceDeck(d, { rails: { VIN: 7.5 } });
    expect(given.unknownRails).toEqual([]);
    expect(given.text).toContain(`DC 7.5`);
  });

  it("leaves parts that aren't fitted out, and drives a net with a pulse or a sine", () => {
    const d = rc();
    const off = { ...d, parts: d.parts.map((p) => (p.ref === "C1" ? { ...p, fitted: false } : p)) };
    expect(spiceDeck(off).text).not.toContain("C1 ");
    const deck = spiceDeck(d, {
      stop: 0.002,
      drives: [
        { id: "a", net: "5V", wave: "pulse", low: 0, high: 5, freq: 1000 },
        { id: "b", net: "OUT", wave: "sine", low: 1, high: 3, freq: 50 },
      ],
    });
    const r = deck.nodes.get("5V")!;
    // A driven rail is the drive, not the rail's own source.
    expect(deck.text).not.toContain(`V_${r} `);
    expect(deck.text).toContain(`V_drive_${r} ${r} 0 PULSE(0 5 0 0.000001 0.000001 0.000499 0.001)`);
    expect(deck.text).toContain(`SIN(2 1 50)`);
    expect(deck.text).toMatch(/^\.tran 0\.000004 0\.002$/m);
  });

  it("reads the engine's vectors back as a trace per probed net", () => {
    const deck = spiceDeck(rc());
    const out = deck.nodes.get("OUT")!;
    const got = tracesOf(
      deck,
      [
        { name: "time", values: [0, 1, 2] },
        { name: `v(${out})`, values: [0, 2, 3] },
      ],
      ["OUT", "GND", "NOPE"],
    );
    expect(got).toEqual({
      time: [0, 1, 2],
      traces: [
        { net: "OUT", volts: [0, 2, 3] },
        { net: "GND", volts: [0, 0, 0] },
        { net: "NOPE", volts: [] },
      ],
    });
  });
});
