import { GRID, capacitor, header, power, resistor } from "./basics";
import { addLabel, addWire, placePart } from "./edit";
import { emptyDesign, type ElectronicsDesign } from "./model";
import { netlist } from "./nets";
import { applyChanges, boardChanges, describeChange, pushToBoard } from "./sync";

const G = GRID;

/** R1 from 3V3 down to a node shared with C1, which goes to ground. A divider, more or less. */
function divider(): { d: ElectronicsDesign; sheet: string; r1: string; c1: string } {
  let d = emptyDesign();
  const sheet = d.sheets[0]!.id;
  const r = placePart(d, sheet, resistor(), { x: 0, y: 0 });
  d = r.design;
  const c = placePart(d, sheet, capacitor(), { x: 0, y: -4 * G });
  d = c.design;
  d = placePart(d, sheet, power("3V3"), { x: 0, y: 3 * G }).design;
  d = placePart(d, sheet, power("GND"), { x: 0, y: -7 * G }).design;
  d = addWire(d, sheet, [0, 1.5 * G], [0, 3 * G]); // R1.1 to 3V3
  d = addWire(d, sheet, [0, -1.5 * G], [0, -2.5 * G]); // R1.2 to C1.1
  d = addWire(d, sheet, [0, -5.5 * G], [0, -7 * G]); // C1.2 to GND
  return { d, sheet, r1: r.part.id, c1: c.part.id };
}

describe("nets", () => {
  it("names parts as they are placed", () => {
    const { d } = divider();
    expect(d.parts.map((p) => p.ref)).toEqual(["R1", "C1", "#PWR1", "#PWR2"]);
    expect(Object.keys(d.defs)).toHaveLength(4);
  });

  it("works out nets from wires and power symbols", () => {
    const { d } = divider();
    const nl = netlist(d);
    expect(nl.nets.map((n) => [n.name, n.pins.map((p) => `${p.ref}.${p.pin}`)])).toEqual([
      ["3V3", ["R1.1"]],
      ["GND", ["C1.2"]],
      ["Net-(C1-1)", ["C1.1", "R1.2"]],
    ]);
    expect(nl.floating).toEqual([]);
    expect(nl.nets.every((n) => n.openEnds.length === 0)).toBe(true);
  });

  it("joins labels with one name and reports open ends and floating pins", () => {
    const made = divider();
    const sheet = made.sheet;
    let d = made.d;
    const j = placePart(d, sheet, header(2), { x: 10 * G, y: 0 });
    d = j.design;
    // J1.1 sits at (8G, 0.5G): a short wire with a label; J1.2 is left hanging.
    d = addWire(d, sheet, [8 * G, 0.5 * G], [6 * G, 0.5 * G]);
    d = addLabel(d, sheet, "OUT", 6 * G, 0.5 * G);
    d = addWire(d, sheet, [0, -2 * G], [-3 * G, -2 * G]); // a branch off the R1-C1 wire, part way along it
    d = addLabel(d, sheet, "OUT", -3 * G, -2 * G);
    d = addWire(d, sheet, [20 * G, 0], [22 * G, 0]); // a stray wire
    const nl = netlist(d);
    const out = nl.nets.find((n) => n.name === "OUT")!;
    expect(out.pins.map((p) => `${p.ref}.${p.pin}`)).toEqual(["C1.1", "J1.1", "R1.2"]);
    expect(out.labels).toBe(2);
    expect(nl.floating.map((p) => `${p.ref}.${p.pin}`)).toEqual(["J1.2"]);
    expect(nl.nets.flatMap((n) => n.openEnds)).toEqual([]); // the stray wire has no pins or names, so it is no net
  });

  it("does not join wires that only cross, until there is a junction", () => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    const a = placePart(d, sheet, header(1), { x: 0, y: 0 }); // pin at (-2G, 0)
    d = a.design;
    const b = placePart(d, sheet, header(1), { x: 0, y: 5 * G, rot: 0 }); // pin at (-2G, 5G)
    d = b.design;
    d = addWire(d, sheet, [-2 * G, 0], [-6 * G, 0]);
    d = addWire(d, sheet, [-2 * G, 5 * G], [-4 * G, 5 * G]);
    d = addWire(d, sheet, [-4 * G, 5 * G], [-4 * G, -3 * G]); // crosses the first wire at (-4G, 0)
    expect(netlist(d).nets).toHaveLength(2);
    d = { ...d, sheets: d.sheets.map((s) => ({ ...s, junctions: [{ id: "j1", x: -4 * G, y: 0 }] })) };
    const nets = netlist(d).nets;
    expect(nets).toHaveLength(1);
    expect(nets[0]!.pins.map((p) => p.ref)).toEqual(["J1", "J2"]);
  });

  it("follows a part when it is turned or mirrored", () => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    const r = placePart(d, sheet, resistor(), { x: 0, y: 0, rot: 90 }); // pin 1 now at (-1.5G, 0)
    d = addWire(r.design, sheet, [-1.5 * G, 0], [-4 * G, 0]);
    d = addLabel(d, sheet, "A", -4 * G, 0);
    expect(netlist(d).nets.map((n) => [n.name, n.pins.map((p) => p.pin)])).toEqual([["A", ["1"]]]);
  });

  it("marks pins left open on purpose", () => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    const j = placePart(d, sheet, header(2), { x: 0, y: 0 });
    d = { ...j.design, sheets: j.design.sheets.map((s) => ({ ...s, noConnects: [{ id: "n1", x: -2 * G, y: 0.5 * G }] })) };
    const nl = netlist(d);
    expect([...nl.noConnect]).toEqual([`${j.part.id}:1`]);
    expect(nl.floating.map((p) => p.pin)).toEqual(["2"]);
  });
});

describe("pushing the schematic to the board", () => {
  it("makes a board and sets the parts out beside it", () => {
    const { d } = divider();
    const { design, changes } = pushToBoard(d);
    expect(changes.map(describeChange)).toEqual(["Make a 2-layer board, 1.6 mm thick", "Add C1 beside the board", "Add R1 beside the board"]);
    const board = design.board!;
    expect(board.placements.map((p) => p.ref)).toEqual(["C1", "R1"]);
    expect(board.placements.every((p) => p.x > 50)).toBe(true); // to the right of the 50 mm board
    expect(board.placements[0]!.x).not.toBe(board.placements[1]!.x);
    expect(boardChanges(design)).toEqual([]);
    expect(d.board).toBeUndefined(); // the design passed in is untouched
  });

  it("lists added and removed parts and keeps placements that are still good", () => {
    const { d, sheet, c1 } = divider();
    let design = pushToBoard(d).design;
    design = { ...design, board: { ...design.board!, placements: design.board!.placements.map((p) => ({ ...p, x: 10, y: 10 })) } };
    design = placePart(design, sheet, resistor(), { x: 10 * G, y: 0 }).design;
    design = {
      ...design,
      parts: design.parts.filter((p) => p.id !== c1),
      sheets: design.sheets.map((s) => ({ ...s, symbols: s.symbols.filter((y) => y.part !== c1) })),
    };
    const changes = boardChanges(design);
    expect(changes.map(describeChange)).toEqual(["Add R2 beside the board", "Remove C1 from the board"]);
    const after = applyChanges(design, changes).board!;
    expect(after.placements.map((p) => [p.ref, p.x])).toEqual([
      ["R1", 10],
      ["R2", expect.any(Number)],
    ]);
  });

  it("carries copper across a renamed net and flags copper on a net that is gone", () => {
    const { d, sheet } = divider();
    let design = pushToBoard(d).design;
    const track = (net: string, id: string) => ({
      id,
      net,
      layer: "top" as const,
      width: 0.25,
      pts: [
        [0, 0],
        [1, 0],
      ] as [number, number][],
    });
    design = { ...design, board: { ...design.board!, tracks: [track("Net-(C1-1)", "t1"), track("OLD", "t2")] } };
    design = addLabel(design, sheet, "MID", 0, -2 * G); // names the R1-C1 net
    const changes = boardChanges(design);
    expect(changes.map(describeChange)).toEqual(["Net Net-(C1-1) becomes MID, with 1 piece of copper", "Net OLD is gone but 1 piece of copper still use it"]);
    const after = applyChanges(design, changes);
    expect(after.board!.tracks.map((t) => t.net)).toEqual(["MID", "OLD"]);
    expect(boardChanges(after).map((c) => c.kind)).toEqual(["dead-net"]);
  });

  it("notices a changed footprint and stops for a part with none", () => {
    const { d, r1 } = divider();
    let design = pushToBoard(d).design;
    design = { ...design, parts: design.parts.map((p) => (p.id === r1 ? { ...p, pkg: 1 } : p)) };
    expect(boardChanges(design).map(describeChange)).toEqual(["R1: footprint changes from 0805 (2012 metric) to 0603 (1608 metric)"]);
    const key = design.parts.find((p) => p.id === r1)!.def;
    const bare = { ...design, defs: { ...design.defs, [key]: { ...design.defs[key]!, packages: [] } } };
    const changes = boardChanges(bare);
    expect(changes.map((c) => c.kind)).toContain("no-footprint");
    expect(applyChanges(bare, changes)).toBe(bare);
  });
});
