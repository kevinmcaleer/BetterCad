// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BASICS, addLabel, emptyDesign, placePart, placedPins, type ComponentDef, type ElectronicsDesign } from "@bettercad/electronics";
import { spiceDeck, tracesOf } from "@bettercad/electronics/sim";
import { runDeck, type SpiceEngine } from "./simRun";

/** Places a part with each pin on a named net, by a label on the pin. */
function put(d: ElectronicsDesign, def: ComponentDef, nets: Record<string, string>, value?: string): ElectronicsDesign {
  const placed = placePart(d, "sh1", def, { x: d.parts.length * 20, y: 0 }, value ? { value } : {});
  let out = placed.design;
  for (const pin of placedPins(out).filter((p) => p.part === placed.part.id))
    if (nets[pin.pin]) out = addLabel(out, "sh1", nets[pin.pin]!, pin.at[0], pin.at[1]);
  return out;
}

let engine: Promise<SpiceEngine> | null = null;
/** The real ngspice, as the worker runs it. */
const sim = () =>
  (engine ??= import("eecircuit-engine").then(async ({ Simulation }) => {
    const s = new Simulation() as unknown as SpiceEngine;
    await s.start();
    return s;
  }));

describe("circuit simulation on ngspice (#761)", () => {
  it("charges a capacitor through a resistor: 63% of the step after one time constant", async () => {
    let d = emptyDesign();
    d = put(d, BASICS.gnd!(), { "1": "GND" });
    d = put(d, BASICS.resistor!(), { "1": "IN", "2": "OUT" }, "1 kΩ");
    d = put(d, BASICS.capacitor!(), { "1": "OUT", "2": "GND" }, "1 µF");
    // A 5 V step at the start, 10 ms high: the time constant is 1 ms.
    const deck = spiceDeck(d, { stop: 0.005, drives: [{ id: "s", net: "IN", wave: "pulse", low: 0, high: 5, freq: 50 }] });
    const answer = await runDeck(await sim(), deck.text);
    expect(answer.errors).toEqual([]);
    const { time, traces } = tracesOf(deck, answer.vectors, ["IN", "OUT"]);
    const at = (t: number) => traces[1]!.volts[time.findIndex((x) => x >= t)]!;
    expect(at(0.001)).toBeCloseTo(5 * (1 - Math.exp(-1)), 1);
    expect(at(0.005)).toBeCloseTo(5 * (1 - Math.exp(-5)), 1);
    expect(Math.max(...traces[0]!.volts)).toBeCloseTo(5, 3);
  }, 60_000);

  it("drops about 1.9 V across a red LED at 20 mA, and a transistor switches it", async () => {
    let d = emptyDesign();
    d = put(d, BASICS.gnd!(), { "1": "GND" });
    d = put(d, BASICS["5v"]!(), { "1": "5V" });
    // 5 V through 155 Ω and the LED: about 20 mA once it drops 1.9 V.
    d = put(d, BASICS.resistor!(), { "1": "5V", "2": "A" }, "155 Ω");
    d = put(d, BASICS.led!(), { "2": "A", "1": "K" }, "Red");
    // An NPN low side switch, its base fed from a 1 kHz square wave through 10 kΩ.
    const npn: ComponentDef = {
      name: "2N3904",
      prefix: "Q",
      value: "2N3904",
      packages: [],
      symbol: {
        name: "2N3904",
        units: 1,
        shapes: [],
        pins: [
          { number: "1", name: "E", type: "passive", x: 0, y: -2.54, length: 0, dir: 270 },
          { number: "2", name: "B", type: "input", x: -2.54, y: 0, length: 0, dir: 180 },
          { number: "3", name: "C", type: "passive", x: 0, y: 2.54, length: 0, dir: 90 },
        ],
      },
    };
    d = put(d, npn, { "1": "GND", "2": "BASE", "3": "K" });
    d = put(d, BASICS.resistor!(), { "1": "DRIVE", "2": "BASE" }, "10 kΩ");
    const deck = spiceDeck(d, { stop: 0.002, drives: [{ id: "s", net: "DRIVE", wave: "pulse", low: 0, high: 5, freq: 1000 }] });
    expect(deck.skipped).toEqual([]);
    const answer = await runDeck(await sim(), deck.text);
    expect(answer.errors).toEqual([]);
    const { time, traces } = tracesOf(deck, answer.vectors, ["A", "K"]);
    const i = (t: number) => time.findIndex((x) => x >= t);
    // Base high: the transistor is on, so K sits near ground and the LED drops about 1.9 V.
    const on = i(0.00025);
    expect(traces[1]!.volts[on]!).toBeLessThan(0.3);
    expect(traces[0]!.volts[on]! - traces[1]!.volts[on]!).toBeGreaterThan(1.7);
    expect(traces[0]!.volts[on]! - traces[1]!.volts[on]!).toBeLessThan(2.1);
    // Base low: no current, so the LED's anode rises to the rail.
    expect(traces[0]!.volts[i(0.00075)]!).toBeGreaterThan(4);
  }, 60_000);
});
