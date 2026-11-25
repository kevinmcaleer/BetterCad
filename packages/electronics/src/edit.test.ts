import { GRID, capacitor, header, power, resistor } from "./basics";
import {
  addLabel,
  addNoConnect,
  addWire,
  addWires,
  changePart,
  clipOrigin,
  copyFromSheet,
  flipOnBoard,
  flipOnSheet,
  mirrorOnSheet,
  moveOnBoard,
  moveOnSheet,
  nextRef,
  pasteOnSheet,
  placePart,
  removeFromSheet,
  renameLabel,
  renumber,
  rotateOnBoard,
  rotateOnSheet,
  tidyValue,
} from "./edit";
import { placeOnSheet } from "./geom";
import { emptyDesign } from "./model";
import { netlist } from "./nets";
import { replacePart } from "./replace";
import { boardChanges, pushToBoard } from "./sync";

const G = GRID;

function wired() {
  let d = emptyDesign();
  const sheet = d.sheets[0]!.id;
  const r = placePart(d, sheet, resistor(), { x: 0, y: 0 });
  d = r.design;
  const j = placePart(d, sheet, header(2), { x: 10 * G, y: 0 });
  d = addWires(j.design, sheet, [
    [0, 1.5 * G],
    [8 * G, 1.5 * G],
    [8 * G, 0.5 * G],
  ]);
  return { d, sheet, r, j };
}
const pins = (d: ReturnType<typeof wired>["d"]) => netlist(d).nets.map((n) => n.pins.map((p) => `${p.ref}.${p.pin}`).join(" "));

describe("editing a sheet", () => {
  it("keeps a part wired when it moves, turns or flips", () => {
    const { d, sheet, r } = wired();
    expect(pins(d)).toEqual(["J1.1 R1.1"]);
    expect(pins(moveOnSheet(d, sheet, [r.symbol.id], -2 * G, 3 * G))).toEqual(["J1.1 R1.1"]);
    expect(pins(rotateOnSheet(d, sheet, [r.symbol.id]))).toEqual(["J1.1 R1.1"]);
    expect(pins(mirrorOnSheet(rotateOnSheet(d, sheet, [r.symbol.id]), sheet, [r.symbol.id]))).toEqual(["J1.1 R1.1"]);
    // Top to bottom: a point above the part's middle ends up as far below it, and across stays where it was.
    const flipped = flipOnSheet(d, sheet, [r.symbol.id]);
    expect(pins(flipped)).toEqual(["J1.1 R1.1"]);
    const s = flipped.sheets[0]!.symbols.find((y) => y.id === r.symbol.id)!;
    expect(placeOnSheet([1, 2], s)).toEqual([s.x + 1, s.y - 2]);
    expect(flipOnSheet(flipped, sheet, [r.symbol.id]).sheets[0]!.symbols.find((y) => y.id === r.symbol.id)).toEqual(r.symbol);
  });

  it("moves wires and labels that are picked themselves", () => {
    const made = wired();
    const sheet = made.sheet;
    let d = made.d;
    d = addLabel(d, sheet, "SIG", 4 * G, 1.5 * G);
    const label = d.sheets[0]!.labels[0]!.id;
    const moved = moveOnSheet(d, sheet, [label], 0, 5 * G);
    expect(moved.sheets[0]!.labels[0]).toMatchObject({ x: 4 * G, y: 6.5 * G });
    expect(netlist(moved).nets.find((n) => n.name === "SIG")!.pins).toEqual([]);
    expect(renameLabel(d, sheet, label, " OUT ").sheets[0]!.labels[0]!.name).toBe("OUT");
    expect(renameLabel(d, sheet, label, "  ")).toBe(d);
  });

  it("deletes a part with its last symbol and frees its reference", () => {
    const { d, sheet, r } = wired();
    const gone = removeFromSheet(d, sheet, [r.symbol.id, d.sheets[0]!.wires[0]!.id]);
    expect(gone.parts.map((p) => p.ref)).toEqual(["J1"]);
    expect(Object.keys(gone.defs)).toHaveLength(1);
    expect(gone.sheets[0]!.wires).toHaveLength(1);
    expect(nextRef(gone, "R")).toBe("R1");
  });

  it("changes a part's value and refuses a reference already in use", () => {
    const made = wired();
    const { sheet, r } = made;
    let d = made.d;
    d = placePart(d, sheet, resistor(), { x: 0, y: 10 * G }).design;
    expect(changePart(d, r.part.id, { value: "4.7 kΩ", pkg: 1 }).parts[0]).toMatchObject({ value: "4.7 kΩ", pkg: 1 });
    expect(changePart(d, r.part.id, { ref: "R2" })).toBe(d);
    expect(changePart(d, r.part.id, { ref: "R9" }).parts[0]!.ref).toBe("R9");
  });

  it("drops a wire that a move shrinks to nothing, and adds one no-connect mark per pin", () => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    const g = placePart(d, sheet, power("GND"), { x: 0, y: 0 });
    d = addWire(g.design, sheet, [0, 0], [0, G]);
    expect(moveOnSheet(d, sheet, [g.symbol.id], 0, G).sheets[0]!.wires).toEqual([]);
    d = addNoConnect(addNoConnect(d, sheet, 5, 5), sheet, 5, 5);
    expect(d.sheets[0]!.noConnects).toHaveLength(1);
  });
});

describe("editing the board", () => {
  it("moves, turns and flips parts, and leaves locked ones alone", () => {
    const made = pushToBoard(wired().d).design;
    const [j1, r1] = made.board!.placements;
    let d = moveOnBoard(made, [r1!.part], 1.5, -2);
    expect(d.board!.placements[1]!.x).toBeCloseTo(r1!.x + 1.5, 6);
    expect(d.board!.placements[1]!.y).toBeCloseTo(r1!.y - 2, 6);
    d = flipOnBoard(rotateOnBoard(d, [r1!.part], 45), [r1!.part]);
    expect(d.board!.placements[1]).toMatchObject({ rot: 45, side: "bottom" });
    const locked = { ...made, board: { ...made.board!, placements: made.board!.placements.map((p) => ({ ...p, locked: true })) } };
    expect(moveOnBoard(locked, [j1!.part], 5, 5).board!.placements[0]).toMatchObject({ x: j1!.x, y: j1!.y });
  });
});

describe("copy, paste and tidy", () => {
  const two = () => {
    let d = emptyDesign();
    const a = placePart(d, "sh1", resistor(), { x: 0, y: 0 });
    const b = placePart(a.design, "sh1", resistor(), { x: 10 * GRID, y: 0 });
    d = addWire(b.design, "sh1", [0, -1.5 * GRID], [10 * GRID, -1.5 * GRID]);
    return { d, a: a.symbol.id, b: b.symbol.id, wire: d.sheets[0]!.wires[0]!.id };
  };

  it("pastes a copy with fresh names and its wires", () => {
    const { d, a, wire } = two();
    const clip = copyFromSheet(d, "sh1", [a, wire])!;
    expect(clipOrigin(clip)).toEqual([0, 0]);
    const pasted = pasteOnSheet(d, "sh1", clip, 0, -10 * GRID);
    expect(pasted.design.parts.map((p) => p.ref)).toEqual(["R1", "R2", "R3"]);
    expect(pasted.ids).toHaveLength(2);
    expect(pasted.design.sheets[0]!.wires[1]).toMatchObject({ a: [0, -11.5 * GRID], b: [10 * GRID, -11.5 * GRID] });
    expect(Object.keys(pasted.design.defs)).toHaveLength(1);
    expect(netlist(pasted.design).of.get(`${pasted.design.parts[2]!.id}:2`)).toBeDefined();
    expect(copyFromSheet(d, "sh1", [])).toBeNull();
  });

  it("pastes into another design, bringing the component along", () => {
    const { d, a } = two();
    const other = placePart(emptyDesign(), "sh1", resistor(), { x: 0, y: 0 }).design;
    const pasted = pasteOnSheet(other, "sh1", copyFromSheet(d, "sh1", [a])!, 5 * GRID, 0);
    expect(pasted.design.parts.map((p) => p.ref)).toEqual(["R1", "R2"]);
    expect(pasteOnSheet(emptyDesign(), "sh1", copyFromSheet(d, "sh1", [a])!, 0, 0).design.defs).toEqual(d.defs);
  });

  it("drags a wire and keeps the wires on its ends joined", () => {
    let d = addWires(emptyDesign(), "sh1", [
      [0, 0],
      [0, 5],
      [10, 5],
      [10, 0],
    ]);
    const mid = d.sheets[0]!.wires[1]!.id;
    d = moveOnSheet(d, "sh1", [mid], 0, 2.54);
    expect(d.sheets[0]!.wires.map((w) => [w.a, w.b])).toEqual([
      [
        [0, 0],
        [0, 7.54],
      ],
      [
        [0, 7.54],
        [10, 7.54],
      ],
      [
        [10, 7.54],
        [10, 0],
      ],
    ]);
  });

  it("renumbers by position in one go, and the board follows", () => {
    let d = emptyDesign();
    d = placePart(d, "sh1", resistor(), { x: 20, y: 0 }).design;
    d = placePart(d, "sh1", capacitor(), { x: 0, y: -20 }).design;
    d = placePart(d, "sh1", resistor(), { x: 0, y: 0 }).design;
    d = placePart(d, "sh1", resistor(), { x: 0, y: 20 }).design;
    d = pushToBoard(d).design;
    const next = renumber(d);
    expect(next.parts.map((p) => p.ref)).toEqual(["R3", "C1", "R2", "R1"]);
    expect(next.board!.placements.map((p) => p.ref).sort()).toEqual(["C1", "R1", "R2", "R3"]);
    expect(boardChanges(next)).toEqual([]);
    expect(renumber(next)).toBe(next);
  });

  it("reads engineering shorthand", () => {
    expect(tidyValue("4k7", "R")).toBe("4.7 kΩ");
    expect(tidyValue("10k", "R")).toBe("10 kΩ");
    expect(tidyValue("2R2", "R")).toBe("2.2 Ω");
    expect(tidyValue("330", "R")).toBe("330 Ω");
    expect(tidyValue("1M", "R")).toBe("1 MΩ");
    expect(tidyValue("100n", "C")).toBe("100 nF");
    expect(tidyValue("0.1u", "C")).toBe("0.1 µF");
    expect(tidyValue("4u7", "C")).toBe("4.7 µF");
    expect(tidyValue("22p", "C")).toBe("22 pF");
    expect(tidyValue("10u", "L")).toBe("10 µH");
    // Already tidy, not a number, or not a part with a unit: left as typed.
    expect(tidyValue("4.7 kΩ", "R")).toBe("4.7 kΩ");
    expect(tidyValue("100 nF", "C")).toBe("100 nF");
    expect(tidyValue("100", "C")).toBe("100");
    expect(tidyValue("10k 1%", "R")).toBe("10k 1%");
    expect(tidyValue("red", "D")).toBe("red");
    expect(tidyValue("NE555", "U")).toBe("NE555");
  });
});

describe("replace", () => {
  it("keeps the wires on pins that match and lists the ones it could not keep", () => {
    let d = emptyDesign();
    const r = placePart(d, "sh1", resistor(), { x: 0, y: 0 });
    d = addWire(r.design, "sh1", [0, 1.5 * GRID], [0, 4 * GRID]);
    d = addWire(d, "sh1", [0, -1.5 * GRID], [0, -4 * GRID]);
    const swapped = replacePart(d, r.part.id, capacitor());
    expect(swapped.lost).toEqual([]);
    expect(swapped.design.parts[0]).toMatchObject({ ref: "C1", value: capacitor().value });
    expect(Object.keys(swapped.design.defs)).toHaveLength(1);
    expect(netlist(swapped.design).floating).toEqual([]);
    const same = replacePart(changePart(d, r.part.id, { value: "4.7 kΩ" }), r.part.id, { ...resistor(), name: "Resistor, small" });
    expect(same.design.parts[0]).toMatchObject({ ref: "R1", value: "4.7 kΩ" });
    const one = header(1);
    const less = replacePart(d, r.part.id, one);
    expect(less.lost).toEqual(["2"]);
  });
});
