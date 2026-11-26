import { describe, expect, it } from "vitest";
import { bandsFor, e24Up, ledResistor, ohmsFromBands, ohmsText, trackCurrent, trackWidth, viaCurrent } from "./calc";

describe("calculators (#739)", () => {
  it("works out a track's width for a current, as IPC-2221's charts give it", () => {
    // 1 A with 10 °C of rise on 1 oz outer copper: about 0.3 mm (11.9 mil), the figure every calculator gives.
    expect(trackWidth({ current: 1, rise: 10, oz: 1, outer: true })).toBeCloseTo(0.302, 2);
    // Inside the board it runs hotter, so it needs to be wider; twice the copper halves the width.
    expect(trackWidth({ current: 1, rise: 10, oz: 1, outer: false })).toBeCloseTo(0.302 * 2 ** (1 / 0.725), 2);
    expect(trackWidth({ current: 1, rise: 10, oz: 2, outer: true })).toBeCloseTo(0.151, 2);
    // And back again.
    expect(trackCurrent(0.302, { rise: 10, oz: 1, outer: true })).toBeCloseTo(1, 2);
    expect(trackWidth({ current: 0, rise: 10, oz: 1, outer: true })).toBe(0);
  });

  it("works out what a via carries", () => {
    // A 0.3 mm hole with 25 µm of plating: a ring of about 40 square mils, near 1.9 A at 10 °C.
    const i = viaCurrent({ drill: 0.3, rise: 10 });
    expect(i).toBeCloseTo(1.9, 1);
    expect(viaCurrent({ drill: 0.6, rise: 10 })).toBeGreaterThan(i);
  });

  it("picks an LED's resistor, rounded up to E24 so the current only falls", () => {
    const r = ledResistor({ supply: 5, forward: 2, current: 0.01 })!;
    expect(r.exact).toBeCloseTo(300, 6);
    expect(r.fit).toBe(300);
    expect(ledResistor({ supply: 5, forward: 2.1, current: 0.02 })!.fit).toBe(150);
    const odd = ledResistor({ supply: 3.3, forward: 2, current: 0.005 })!;
    expect(odd.fit).toBe(270);
    expect(odd.current).toBeLessThan(0.005);
    expect(odd.power).toBeCloseTo(odd.current ** 2 * 270, 9);
    expect(ledResistor({ supply: 2, forward: 2, current: 0.01 })).toBeNull();
    expect([e24Up(1000), e24Up(1001), e24Up(9.2), e24Up(0.47)]).toEqual([1000, 1100, 10, 0.47]);
  });

  it("reads and writes resistor colour bands", () => {
    expect(bandsFor(4700, 5)).toEqual(["yellow", "violet", "red", "gold"]);
    expect(bandsFor(10, 5)).toEqual(["brown", "black", "black", "gold"]);
    expect(bandsFor(4.7, 1)).toEqual(["yellow", "violet", "gold", "brown"]);
    expect(bandsFor(1020, 1)).toEqual(["brown", "black", "red", "brown", "brown"]);
    expect(bandsFor(1234, 5)).toBeNull();
    expect(bandsFor(1000, 3)).toBeNull();
    expect(ohmsFromBands(["yellow", "violet", "red", "gold"])).toEqual({ ohms: 4700, tolerance: 5 });
    expect(ohmsFromBands(["brown", "black", "red", "brown", "brown"])).toEqual({ ohms: 1020, tolerance: 1 });
    expect(ohmsFromBands(["gold", "violet", "red", "gold"])).toBeNull();
    for (const v of [0.1, 1, 22, 330, 4700, 56000, 1e6]) expect(ohmsFromBands(bandsFor(v, 5)!)!.ohms).toBe(v);
    expect([ohmsText(470), ohmsText(4700), ohmsText(1e6), ohmsText(2.2)]).toEqual(["470 Ω", "4.7 kΩ", "1 MΩ", "2.2 Ω"]);
  });
});
