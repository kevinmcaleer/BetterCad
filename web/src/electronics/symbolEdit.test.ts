import { describe, expect, it } from "vitest";
import type { SymbolDef } from "@bettercad/electronics";
import {
  addPin,
  addShape,
  arcFrom,
  checkSymbol,
  copyUnitDrawing,
  deleteItems,
  hitSymbol,
  itemBox,
  moveItems,
  nextPinNumber,
  onArc,
  pinInner,
  setPin,
  setPinSide,
  setShape,
  setUnits,
  sideOf,
} from "./symbolEdit";

const empty = (): SymbolDef => ({ name: "Part", units: 1, shapes: [], pins: [] });

/** A box with a pin on the left and one on the right. */
function gate(): SymbolDef {
  let d = addShape(empty(), { kind: "rect", x1: -2.54, y1: -2.54, x2: 2.54, y2: 2.54, fill: true }, 1).def;
  d = addPin(d, [-5.08, 0], "left", 1).def;
  return addPin(d, [5.08, 0], "right", 1).def;
}

describe("drawing a symbol by hand", () => {
  it("numbers new pins on from the largest, and points each at the body", () => {
    const d = gate();
    expect(d.pins.map((p) => p.number)).toEqual(["1", "2"]);
    expect(d.pins.map(sideOf)).toEqual(["left", "right"]);
    expect(d.pins.map(pinInner)).toEqual([
      [-2.54, 0],
      [2.54, 0],
    ]);
    expect(nextPinNumber(setPin(d, "p1", { number: "A7" }))).toBe("2");
    expect(nextPinNumber(setPin(d, "p1", { number: "14" }))).toBe("15");
  });

  it("moves, changes and deletes what is picked, and leaves the rest", () => {
    const d = gate();
    const moved = moveItems(d, ["p0", "s0"], 2.54, -2.54);
    expect(moved.pins[0]).toMatchObject({ x: -2.54, y: -2.54 });
    expect(moved.pins[1]).toEqual(d.pins[1]);
    expect(moved.shapes[0]).toMatchObject({ x1: 0, y1: -5.08, x2: 5.08, y2: 0 });
    expect(moveItems(d, ["p0"], 0, 0)).toBe(d);
    expect(setShape(d, "s0", { fill: false }).shapes[0]).toMatchObject({ fill: false });
    const less = deleteItems(d, ["p0", "s0"]);
    expect(less.shapes).toEqual([]);
    expect(less.pins.map((p) => p.number)).toEqual(["2"]);
  });

  it("moves a pin to another side with its inner end kept on the body", () => {
    const d = setPinSide(gate(), "p0", "top");
    expect(sideOf(d.pins[0]!)).toBe("top");
    expect(pinInner(d.pins[0]!)).toEqual([-2.54, 0]);
    expect(d.pins[0]).toMatchObject({ x: -2.54, y: 2.54 });
  });

  it("finds pins before line work, on the unit that is showing", () => {
    const d = gate();
    expect(hitSymbol(d, 1, [-4, 0.1], 0.5)).toEqual(["p0"]);
    expect(hitSymbol(d, 1, [-2.54, 0.1], 0.5)).toEqual(["p0", "s0"]);
    expect(hitSymbol(d, 1, [0, 2.6], 0.5)).toEqual(["s0"]);
    expect(hitSymbol(d, 1, [0, 0], 0.5)).toEqual([]);
    const two = setUnits(d, 2);
    expect(hitSymbol(two, 2, [-4, 0], 0.5)).toEqual([]);
    expect(itemBox(d, "p0")).toEqual({ x1: -5.08, y1: 0, x2: -2.54, y2: 0 });
  });

  it("makes an arc from a centre, a start and an end, anticlockwise", () => {
    expect(arcFrom([0, 0], [2.54, 0], [0, 5])).toEqual({ kind: "arc", cx: 0, cy: 0, r: 2.54, a0: 0, a1: 90 });
    expect(arcFrom([0, 0], [0, 0], [1, 1])).toBeNull();
    expect(onArc(45, 0, 90)).toBe(true);
    expect(onArc(180, 0, 90)).toBe(false);
    expect(onArc(10, 270, 90)).toBe(true);
    const d = addShape(empty(), arcFrom([0, 0], [2.54, 0], [0, 5])!, 1).def;
    expect(hitSymbol(d, 1, [1.8, 1.8], 0.3)).toEqual(["s0"]);
    expect(hitSymbol(d, 1, [-1.8, -1.8], 0.3)).toEqual([]);
  });

  it("gives a symbol several units, each with its own drawing and pins", () => {
    let d = setUnits(gate(), 2);
    expect(d.units).toBe(2);
    expect(d.pins.every((p) => p.unit === 1)).toBe(true);
    expect(d.shapes.every((s) => s.unit === 1)).toBe(true);
    d = copyUnitDrawing(d, 1, 2);
    d = addPin(d, [-5.08, 0], "left", 2).def;
    expect(d.shapes.map((s) => s.unit)).toEqual([1, 2]);
    expect(d.pins.map((p) => [p.number, p.unit])).toEqual([
      ["1", 1],
      ["2", 1],
      ["3", 2],
    ]);
    // Back to one unit: the second unit's things go, and nothing says "unit" any more.
    const one = setUnits(d, 1);
    expect(one.pins.map((p) => p.number)).toEqual(["1", "2"]);
    expect(one.shapes).toHaveLength(1);
    expect(one.pins.some((p) => "unit" in p)).toBe(false);
    expect(setUnits(d, 2)).toBe(d);
  });

  it("says what stops a drawing being used, and what deserves a look", () => {
    expect(checkSymbol(empty()).problems).toEqual(["Add at least one pin to the symbol."]);
    expect(checkSymbol(gate())).toEqual({ problems: [], notes: [] });
    const twice = setPin(gate(), "p1", { number: "1" });
    expect(checkSymbol(twice).problems).toEqual(["Pin 1 is on the drawing more than once."]);
    expect(checkSymbol(setPin(gate(), "p1", { number: "" })).problems).toEqual(["1 pin has no number."]);
    expect(checkSymbol(moveItems(gate(), ["p0"], 1.27, 0)).notes).toEqual(["Pin 1 is off the 2.54 mm grid, so wires may not meet it."]);
    expect(checkSymbol(setPin(gate(), "p1", { x: -5.08, dir: 0 })).notes).toEqual(["Pins 1 and 2 end at the same place, so one wire joins them all."]);
    expect(checkSymbol(setUnits(gate(), 2)).notes).toEqual(["Unit B has no pins."]);
  });
});
