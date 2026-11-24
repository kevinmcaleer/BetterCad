import { GRID, header, power, resistor } from "./basics";
import {
  addLabel,
  addNoConnect,
  addWire,
  addWires,
  changePart,
  flipOnBoard,
  mirrorOnSheet,
  moveOnBoard,
  moveOnSheet,
  nextRef,
  placePart,
  removeFromSheet,
  renameLabel,
  rotateOnBoard,
  rotateOnSheet,
} from "./edit";
import { emptyDesign } from "./model";
import { netlist } from "./nets";
import { pushToBoard } from "./sync";

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
