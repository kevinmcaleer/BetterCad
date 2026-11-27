import { describe, expect, it } from "vitest";
import { BASICS, addLabel, addWire, emptyDesign, placePart } from "./index";
import { findInDesign } from "./find";

function design() {
  let d = emptyDesign();
  const r1 = placePart(d, "sh1", BASICS.resistor!(), { x: 0, y: 0 });
  d = r1.design;
  const r2 = placePart(d, "sh1", BASICS.resistor!(), { x: 20, y: 0 });
  d = r2.design;
  d = { ...d, parts: d.parts.map((p) => (p.id === r2.part.id ? { ...p, value: "4.7 kΩ", supplier: { lcsc: "C25900" } } : p)) };
  d = addWire(d, "sh1", [0, 10], [10, 10]);
  d = addLabel(d, "sh1", "LED_DATA", 0, 10);
  return d;
}

describe("find in a design (#734)", () => {
  it("finds a part by its reference, best match first", () => {
    const got = findInDesign(design(), "r1");
    expect(got[0]).toMatchObject({ kind: "part", text: "R1" });
    expect(findInDesign(design(), "R").map((f) => f.text)).toEqual(["R1", "R2"]);
  });

  it("finds a part by its value or its part number", () => {
    expect(findInDesign(design(), "4.7k").map((f) => f.text)).toEqual(["R2"]);
    expect(findInDesign(design(), "C25900").map((f) => f.text)).toEqual(["R2"]);
  });

  it("finds a net by its name, and says how many pins it has", () => {
    const got = findInDesign(design(), "led_d");
    expect(got).toEqual([{ kind: "net", name: "LED_DATA", text: "LED_DATA", note: "Net · 0 pins" }]);
  });

  it("finds nothing for an empty query or one that matches nothing", () => {
    expect(findInDesign(design(), "  ")).toEqual([]);
    expect(findInDesign(design(), "zzz")).toEqual([]);
  });
});

describe("find a group (#766)", () => {
  it("finds a schematic group by its name, after parts", async () => {
    const { groupOnSheet } = await import("./groups");
    const d0 = design();
    const d = groupOnSheet(d0, "sh1", [d0.sheets[0]!.symbols[0]!.id], "Regulator").design;
    expect(findInDesign(d, "regul")).toEqual([{ kind: "group", id: d.sheets[0]!.groups![0]!.id, sheet: "sh1", text: "Regulator", note: "Group · Sheet 1" }]);
  });
});
