import { describe, expect, it } from "vitest";
import { power, resistor } from "./basics";
import { addLabel, addWire, placePart } from "./edit";
import { check } from "./erc";
import { tangle } from "./kicad/fixture";
import { emptyDesign, withFixedIds, type ElectronicsDesign } from "./model";
import { elsewhere, netlist } from "./nets";
import { addSheet, duplicateSheet, moveSheet, removeSheet, renameSheet } from "./sheets";

/** A resistor between IN and MID, MID on to a second resistor and OUT, with a ground symbol: one channel of something. */
function channel(): ElectronicsDesign {
  return withFixedIds(() => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    d = placePart(d, sheet, resistor(), { x: 0, y: 0 }).design;
    d = placePart(d, sheet, resistor(), { x: 0, y: -12.7 }).design;
    d = placePart(d, sheet, power("GND"), { x: 0, y: -20.32 }).design;
    d = addWire(d, sheet, [0, -3.81], [0, -8.89]);
    d = addLabel(d, sheet, "IN", 0, 3.81);
    d = addLabel(d, sheet, "MID", 0, -6.35);
    d = addWire(d, sheet, [0, -16.51], [0, -20.32]);
    return d;
  });
}

describe("a schematic's sheets (#636)", () => {
  it("adds, names, moves and deletes sheets", () => {
    let d = channel();
    const two = addSheet(d);
    d = two.design;
    expect(d.sheets.map((s) => s.name)).toEqual(["Sheet 1", "Sheet 2"]);
    const three = addSheet(d, d.sheets[0]!.id);
    d = three.design;
    expect(d.sheets.map((s) => s.name)).toEqual(["Sheet 1", "Sheet 3", "Sheet 2"]);
    d = renameSheet(d, three.id, "  Motor   driver ");
    expect(d.sheets[1]!.name).toBe("Motor driver");
    expect(renameSheet(d, three.id, "   ")).toBe(d);
    d = moveSheet(d, three.id, 2);
    expect(d.sheets.map((s) => s.name)).toEqual(["Sheet 1", "Sheet 2", "Motor driver"]);
    expect(moveSheet(d, three.id, 9)).toBe(d);

    // Deleting a sheet takes its parts with it, and the last sheet stays.
    const first = d.sheets[0]!.id;
    d = removeSheet(d, first);
    expect(d.sheets.map((s) => s.name)).toEqual(["Sheet 2", "Motor driver"]);
    expect(d.parts).toEqual([]);
    expect(d.defs).toEqual({});
    d = removeSheet(d, two.id);
    expect(removeSheet(d, three.id)).toBe(d);
  });

  it("copies a sheet as a block: its own references, its own inside nets, shared names still joined", () => {
    let d = channel();
    // IN comes from another sheet, so it is the block's way in; MID is only inside it.
    const top = addSheet(d);
    d = addLabel(top.design, top.id, "IN", 0, 0);
    const copy = duplicateSheet(d, d.sheets[0]!.id)!;
    d = copy.design;
    expect(d.sheets.map((s) => s.name)).toEqual(["Sheet 1", "Sheet 3", "Sheet 2"]);
    expect(copy.renamed).toEqual([["MID", "MID_2"]]);
    expect(d.parts.filter((p) => p.ref.startsWith("R")).map((p) => p.ref)).toEqual(["R1", "R2", "R3", "R4"]);
    const nets = new Map(netlist(d).nets.map((n) => [n.name, n.pins.map((p) => p.ref).sort()]));
    expect(nets.get("MID")).toEqual(["R1", "R2"]);
    expect(nets.get("MID_2")).toEqual(["R3", "R4"]);
    expect(nets.get("IN")).toEqual(["R1", "R3"]);
    // Ground is one rail, whichever sheet its symbol is on.
    expect(nets.get("GND")!.filter((r) => r.startsWith("R"))).toEqual(["R2", "R4"]);

    // A second copy takes the next number.
    expect(duplicateSheet(d, d.sheets[0]!.id)!.renamed).toEqual([["MID", "MID_3"]]);
  });

  it("says which other sheets a name is on, and checks every sheet together", () => {
    const d = tangle();
    const [a, b] = d.sheets;
    const shared = elsewhere(d, a!.id);
    expect(shared.size).toBeGreaterThan(0);
    for (const [name, sheets] of shared) {
      expect(a!.labels.some((l) => l.name === name)).toBe(true);
      expect(sheets).toEqual([{ id: b!.id, name: b!.name }]);
    }
    expect(elsewhere(channel(), "sh1").size).toBe(0);

    // A name used once, on the second sheet, is found by the one check, which says where.
    const odd = addLabel(d, b!.id, "ONLY_HERE", 50.8, 50.8);
    const found = check(odd).find((r) => r.text.includes("ONLY_HERE"));
    expect(found).toMatchObject({ sheet: b!.id });
  });
});
