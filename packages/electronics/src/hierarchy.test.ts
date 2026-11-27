import { describe, expect, it } from "vitest";
import { BASICS } from "./basics";
import { check } from "./erc";
import { addLabel, addWire, moveOnSheet, placePart } from "./edit";
import { boxPins, copiesOf, keepUsesInStep, localName, placeSheetBox, portsOf, removeBox, repeatLayout, setPorts } from "./hierarchy";
import { emptyDesign, type ElectronicsDesign } from "./model";
import { netlist, placedPins } from "./nets";
import { setPlacement } from "./pcb/route";
import { addSheet } from "./sheets";
import { pushToBoard } from "./sync";
import { kicadProject } from "./kicad/export";
import { importKicadProject } from "./kicad/project";

/** A top sheet, and a "Driver" sheet with a resistor from its pin IN to its pin OUT. */
function design(): { d: ElectronicsDesign; driver: string } {
  let d = emptyDesign();
  const added = addSheet(d, "sh1", "drv");
  d = { ...added.design, sheets: added.design.sheets.map((s) => (s.id === "drv" ? { ...s, name: "Driver" } : s)) };
  d = placePart(d, "drv", BASICS.resistor!(), { x: 0, y: 0 }).design;
  const [a, b] = placedPins(d).filter((p) => p.sheet === "drv");
  d = addLabel(d, "drv", "IN", a!.at[0], a!.at[1]);
  d = addLabel(d, "drv", "OUT", b!.at[0], b!.at[1]);
  d = setPorts(
    d,
    "drv",
    d.sheets.find((s) => s.id === "drv")!.labels.map((l) => l.id),
    true,
  );
  return { d, driver: "drv" };
}

/** The driver placed twice on the top sheet, each IN wired out to a label of its own. */
function twice() {
  let { d } = design();
  d = placeSheetBox(d, "sh1", "drv", [0, 0])!.design;
  d = placeSheetBox(d, "sh1", "drv", [0, -30])!.design;
  for (const [box, name] of d.sheets[0]!.boxes!.map((b, i) => [b, i ? "B" : "A"] as const)) {
    const pin = boxPins(d, box).find((p) => p.name === "IN")!;
    const end: [number, number] = [pin.at[0] - 10.16, pin.at[1]];
    d = addWire(d, "sh1", end, pin.at);
    d = addLabel(d, "sh1", name, end[0], end[1]);
  }
  return d;
}
const netOf = (d: ElectronicsDesign, ref: string, pin: string) => {
  const part = d.parts.find((p) => p.ref === ref)!;
  return netlist(d).of.get(`${part.id}:${pin}`);
};

describe("hierarchy (#757)", () => {
  it("places a sheet as a box with a pin for each of its sheet pins", () => {
    const { d } = design();
    expect(portsOf(d.sheets[1]!)).toEqual(["IN", "OUT"]);
    const placed = placeSheetBox(d, "sh1", "drv", [0, 0])!;
    const box = placed.design.sheets[0]!.boxes![0]!;
    expect(boxPins(placed.design, box).map((p) => `${p.name} ${p.side}`)).toEqual(["IN left", "OUT right"]);
    // Its labels now carry the use's name, and show without it.
    const used = placed.design.sheets[1]!;
    expect(used.use?.prefix).toBe("Driver");
    expect(used.labels.map((l) => l.name)).toEqual(["Driver/IN", "Driver/OUT"]);
    expect(used.labels.map((l) => localName(l.name, used))).toEqual(["IN", "OUT"]);
    // A sheet can't go inside itself.
    expect(placeSheetBox(placed.design, "drv", "drv", [0, 0])).toBeNull();
  });

  it("gives each use its own parts and nets, joined through the box's pins", () => {
    const d = twice();
    expect(copiesOf(d, "drv")).toHaveLength(1);
    const refs = d.parts.map((p) => p.ref).sort();
    expect(refs).toEqual(["R1", "R2"]);
    expect(netOf(d, "R1", "1")).toBe("A");
    expect(netOf(d, "R2", "1")).toBe("B");
    expect(netOf(d, "R1", "2")).not.toBe(netOf(d, "R2", "2"));
    // Joining a pin is not a net with two names.
    expect(check(d).filter((r) => r.rule === "net-two-names")).toEqual([]);
  });

  it("is one drawing: a change to the master shows on the copy, which keeps its own references", () => {
    const d = twice();
    const sym = d.sheets[1]!.symbols[0]!;
    const moved = keepUsesInStep(d, moveOnSheet(d, "drv", [sym.id], 2.54, 0));
    const copy = copiesOf(moved, "drv")[0]!;
    expect(copy.symbols[0]!.x).toBe(sym.x + 2.54);
    expect(moved.parts.find((p) => p.id === copy.symbols[0]!.part)!.ref).toBe("R2");
    // A part added to the master gets a part of its own on the copy.
    const more = keepUsesInStep(moved, placePart(moved, "drv", BASICS.resistor!(), { x: 20, y: 0 }).design);
    expect(copiesOf(more, "drv")[0]!.symbols).toHaveLength(2);
    expect(more.parts.map((p) => p.ref).sort()).toEqual(["R1", "R2", "R3", "R4"]);
    // Taking the copy's box away takes its sheet and parts.
    const box = more.sheets[0]!.boxes![1]!;
    const gone = removeBox(more, box.id);
    expect(copiesOf(gone, "drv")).toEqual([]);
    expect(gone.parts).toHaveLength(2);
  });

  it("repeats the master's layout on the board for the copy", () => {
    let d = pushToBoard(twice()).design;
    const r1 = d.parts.find((p) => p.ref === "R1")!;
    d = setPlacement(d, r1.id, { x: 10, y: 20, rot: 90, side: "top" });
    const out = repeatLayout(d, "drv");
    const r2 = out.parts.find((p) => p.ref === "R2")!;
    const at = out.board!.placements.find((p) => p.part === r2.id)!;
    expect(at.y).toBe(20);
    expect(at.rot).toBe(90);
    expect(at.x).toBeGreaterThan(10);
  });

  it("goes out to KiCad as hierarchy, one file for the block, and comes back as boxes that follow it", () => {
    const d = twice();
    const out = kicadProject(d, "hier");
    const sch = out.files.filter((f) => f.name.endsWith(".kicad_sch"));
    // The top sheet and the block's one file, used twice.
    expect(sch).toHaveLength(2);
    const top = sch.find((f) => f.name === "hier.kicad_sch")!.text;
    expect(top.match(/\(sheet\b/g)).toHaveLength(2);
    expect(top).toMatch(/\(pin "IN" passive/);
    const block = sch.find((f) => f.name !== "hier.kicad_sch")!.text;
    expect(block).toMatch(/\(hierarchical_label "IN"/);
    // Each use keeps its own reference.
    expect(block).toMatch(/\(reference "R1"\)/);
    expect(block).toMatch(/\(reference "R2"\)/);

    const back = importKicadProject(out.files.map((f) => ({ name: f.name, text: f.text }))).design;
    expect(back.sheets[0]!.boxes).toHaveLength(2);
    expect(copiesOf(back, back.sheets.find((s) => s.use && !s.use.master)!.id)).toHaveLength(1);
    expect(back.parts.map((p) => p.ref).sort()).toEqual(["R1", "R2"]);
    expect(netOf(back, "R1", "1")).toBe("A");
    expect(netOf(back, "R2", "1")).toBe("B");
    expect(netOf(back, "R1", "2")).not.toBe(netOf(back, "R2", "2"));
  });

  it("keeps a block's label for a net of the sheet above joined to it in KiCad, as a global label", () => {
    // A bus on a sheet pin brings the sheet above's names in: the label inside carries no prefix of the use's.
    let d = twice();
    d = placePart(d, "drv", BASICS.resistor!(), { x: 20, y: 0 }).design;
    const inner = placedPins(d)
      .filter((p) => p.sheet === "drv")
      .at(-1)!;
    d = addLabel(d, "drv", "VCC", inner.at[0], inner.at[1]);
    d = placePart(d, "sh1", BASICS.resistor!(), { x: 40, y: 40 }).design;
    const outer = placedPins(d)
      .filter((p) => p.sheet === "sh1")
      .at(-1)!;
    d = addLabel(d, "sh1", "VCC", outer.at[0], outer.at[1]);
    const ref = (sheet: string) =>
      d.parts.find(
        (p) =>
          p.id ===
          placedPins(d)
            .filter((q) => q.sheet === sheet)
            .at(-1)!.part,
      )!.ref;
    const [inRef, outRef] = [ref("drv"), ref("sh1")];
    expect(netOf(d, inRef, "2")).toBe(netOf(d, outRef, "2"));
    const out = kicadProject(d, "hier");
    expect(out.files.find((f) => f.name === "hier.kicad_sch")!.text).toMatch(/\(global_label "VCC"/);
    const back = importKicadProject(out.files.map((f) => ({ name: f.name, text: f.text }))).design;
    expect(netOf(back, inRef, "2")).toBe(netOf(back, outRef, "2"));
  });
});
