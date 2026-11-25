import { GRID, addWire, emptyDesign, placePart, power, pushToBoard, resistor } from "@bettercad/electronics";
import { describe, expect, it } from "vitest";
import { addBoard, boardBodyId, boardStep } from "./board";
import { boardPartOf, holesOnBoard, moveBoardStep, moveOnBoard } from "./boardmove";
import { build, newDoc, type BoardFeature } from "./document";

const design = () => {
  let d = emptyDesign();
  const sheet = d.sheets[0]!.id;
  d = placePart(d, sheet, resistor(), { x: 0, y: 0 }).design;
  d = placePart(d, sheet, power("GND"), { x: 0, y: -3 * GRID }).design;
  d = addWire(d, sheet, [0, -1.5 * GRID], [0, -3 * GRID]);
  return pushToBoard(d).design;
};
const doc = (place = {}) => addBoard({ ...newDoc("Controller"), electronics: design() }, place, "pcb");

/** The board and the model in step from the 3D side (#651). */
describe("a board part moved in 3D", () => {
  it("knows which part a body stands for", () => {
    const parts = [{ id: "pa1" }, { id: "pa10" }];
    expect(boardPartOf("pcb", "pcb/pa1", parts)).toBe("pa1");
    expect(boardPartOf("pcb", "pcb/pa10", parts)).toBe("pa10");
    expect(boardPartOf("pcb", "pcb/pa1.2", parts)).toBe("pa1");
    expect(boardPartOf("pcb", "pcb/board", parts)).toBeNull();
    expect(boardPartOf("pcb", "b7", parts)).toBeNull();
  });

  it("slides along the board and turns about its normal, wherever the board stands", () => {
    // A board stood on end and pushed away: its x along the world's y, its normal along the world's x.
    const d = doc({ position: { x: 30, y: 5, z: 2 }, rotation: { x: 90, y: 0, z: 90 } });
    const b = build(d);
    const board = b.parts.find((p) => p.id === boardBodyId("pcb"))!;
    const r1 = b.parts.find((p) => p.name === "R1")!;
    const at = d.electronics!.board!.placements[0]!;
    // 4 mm along the world's y is 4 mm along the board's x; 3 mm up the world's z is 3 mm up the board's y.
    const slid = moveOnBoard(board, r1, { position: { x: r1.position.x, y: r1.position.y + 4, z: r1.position.z + 3 }, rotation: r1.rotation }, at);
    expect(slid).toEqual({ x: at.x + 4, y: at.y + 3, rot: at.rot });
    // Pulled off the face: held to the board, it has not moved.
    const lifted = moveOnBoard(board, r1, { position: { ...r1.position, x: r1.position.x + 9 }, rotation: r1.rotation }, at);
    expect(lifted).toEqual({ x: at.x, y: at.y, rot: at.rot });
    // Put where the layout says, the body is where the 3D move left it.
    const next = { ...d, electronics: { ...d.electronics!, board: { ...d.electronics!.board!, placements: [{ ...at, ...slid }] } } };
    const moved = build(next).parts.find((p) => p.name === "R1")!;
    expect(moved.position.x).toBeCloseTo(r1.position.x, 6);
    expect(moved.position.y).toBeCloseTo(r1.position.y + 4, 6);
    expect(moved.position.z).toBeCloseTo(r1.position.z + 3, 6);
  });

  it("takes a turn about the board's normal and drops a tilt", () => {
    const d = doc();
    const b = build(d);
    const board = b.parts.find((p) => p.id === boardBodyId("pcb"))!;
    const r1 = b.parts.find((p) => p.name === "R1")!;
    const at = d.electronics!.board!.placements[0]!;
    const z = r1.rotation?.z ?? 0;
    expect(moveOnBoard(board, r1, { position: r1.position, rotation: { x: 0, y: 0, z: z + 90 } }, at).rot).toBeCloseTo((at.rot + 90) % 360, 6);
    expect(moveOnBoard(board, r1, { position: r1.position, rotation: { x: 30, y: 0, z } }, at).rot).toBeCloseTo(at.rot, 6);
  });
});

describe("the board moved in 3D", () => {
  it("moves its step, so its parts come with it", () => {
    const d = doc({ position: { x: 10, y: 0, z: 5 } });
    const board = build(d).parts.find((p) => p.id === boardBodyId("pcb"))!;
    const r1 = build(d).parts.find((p) => p.name === "R1")!;
    const next = moveBoardStep(d, "pcb", board, { position: { x: 10, y: 20, z: 8 }, rotation: { x: 0, y: 0, z: 90 } });
    expect((boardStep(next) as BoardFeature).position).toEqual({ x: 10, y: 20, z: 8 });
    expect((boardStep(next) as BoardFeature).rotation).toEqual({ x: 0, y: 0, z: 90 });
    const after = build(next);
    expect(after.parts.find((p) => p.id === boardBodyId("pcb"))!.position).toEqual({ x: 10, y: 20, z: 8 });
    // R1 was (dx, dy) from the board's corner; a quarter turn on, it is (-dy, dx) from it.
    const [dx, dy] = [r1.position.x - 10, r1.position.y];
    const now = after.parts.find((p) => p.name === "R1")!;
    expect(now.position.x).toBeCloseTo(10 - dy, 6);
    expect(now.position.y).toBeCloseTo(20 + dx, 6);
    expect(now.position.z).toBeCloseTo(8 + 1.6, 6);
  });

  it("keeps a board on its sketch or face: only the step's own place takes the move", () => {
    const e = design();
    const frame = { origin: [30, 0, 0], x: [0, 1, 0], normal: [1, 0, 0] } as {
      origin: [number, number, number];
      x: [number, number, number];
      normal: [number, number, number];
    };
    const on = { ...e, board: { ...e.board!, outlineFrom: { face: "b1|side", frame, at: [4, 6] as [number, number] } } };
    const d = addBoard({ ...newDoc("Case"), electronics: on }, {}, "pcb");
    const board = build(d).parts.find((p) => p.id === boardBodyId("pcb"))!;
    // Pulled 3 mm off the wall, along the world's x: that is 3 mm up the board's own z.
    const next = moveBoardStep(d, "pcb", board, { position: { ...board.position, x: board.position.x + 3 }, rotation: board.rotation });
    const own = (boardStep(next) as BoardFeature).position;
    expect(own.x).toBeCloseTo(0, 6);
    expect(own.y).toBeCloseTo(0, 6);
    expect(own.z).toBeCloseTo(3, 6);
    expect(build(next).parts.find((p) => p.id === boardBodyId("pcb"))!.position.x).toBeCloseTo(33, 6);
  });
});

describe("holes made in the board's face in 3D", () => {
  it("are board holes where they were put, from the top or the bottom", () => {
    const d = doc({ position: { x: 10, y: 0, z: 5 } });
    const board = build(d).parts.find((p) => p.id === boardBodyId("pcb"))!;
    const top = { origin: [35, 20, 6.6], x: [1, 0, 0], normal: [0, 0, 1] };
    expect(
      holesOnBoard(board, top, [
        [-20, -15],
        [0, 0],
      ]),
    ).toEqual([
      [5, 5],
      [25, 20],
    ]);
    // From underneath the face's y runs the other way, and the hole is still where it was drilled.
    const bottom = { origin: [35, 20, 5], x: [1, 0, 0], normal: [0, 0, -1] };
    expect(holesOnBoard(board, bottom, [[-20, 15]])).toEqual([[5, 5]]);
  });

  it("are not made in the board's edge", () => {
    const board = build(doc()).parts.find((p) => p.id === boardBodyId("pcb"))!;
    expect(holesOnBoard(board, { origin: [0, 20, 0.8], x: [0, 1, 0], normal: [-1, 0, 0] }, [[0, 0]])).toBeNull();
  });
});
