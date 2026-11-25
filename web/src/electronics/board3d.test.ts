import { GRID, addWire, boardPads, emptyDesign, netlist, placePart, power, pushToBoard, resistor } from "@bettercad/electronics";
import { checkBoard } from "@bettercad/electronics/drc";
import { addTrack, setPlacement } from "@bettercad/electronics/pcb/route";
import { addBoard, boardBodyId, boardStep } from "@bettercad/kernel/board";
import { describe, expect, it } from "vitest";
import {
  addHole,
  build,
  featureSummary,
  newDoc,
  placeMatrix,
  type BoardFeature,
  type CombineFeature,
  type HoleFeature,
  type ModelDoc,
  type Part,
} from "../state/document";
import { boxMesh, moveMesh } from "@bettercad/kernel";
import { connectorOpening, holesIn3D, movedIn3D, rayHits } from "./board3d";

/** Two resistors joined by a wire and a track, on a board that stands 5 mm up in the model. */
const model = (): ModelDoc => {
  let d = emptyDesign();
  const sheet = d.sheets[0]!.id;
  d = placePart(d, sheet, resistor(), { x: 0, y: 0 }).design;
  d = placePart(d, sheet, resistor(), { x: 0, y: -6 * GRID }).design;
  d = addWire(d, sheet, [0, -1.5 * GRID], [0, -4.5 * GRID]);
  d = placePart(d, sheet, power("GND"), { x: 0, y: -9 * GRID }).design;
  d = addWire(d, sheet, [0, -7.5 * GRID], [0, -9 * GRID]);
  d = pushToBoard(d).design;
  const [r1, r2] = d.board!.placements;
  d = setPlacement(setPlacement(d, r1!.part, { x: 15, y: 20, rot: 0 }), r2!.part, { x: 35, y: 20, rot: 0 });
  // A track between the two pads the wire joins.
  const net = netlist(d).nets.find((n) => n.pins.length === 2)!;
  const ends = boardPads(d).filter((p) => p.net === net.name);
  d = addTrack(d, net.name, "top", [ends[0]!.at, ends[1]!.at]);
  return addBoard({ ...newDoc("Controller"), electronics: d }, { position: { x: 0, y: 0, z: 5 } }, "pcb");
};
const partsOf = (doc: ModelDoc) => build(doc).parts;
const body = (doc: ModelDoc, ref: string) => partsOf(doc).find((p) => p.name === ref)!;

describe("a board's part dragged in the 3D view (#651)", () => {
  it("moves on the board, keeps its tracks, and the board check says what is left to join", () => {
    const doc = model();
    const r1 = body(doc, "R1");
    const at = doc.electronics!.board!.placements[0]!;
    expect(checkBoard(doc.electronics!).some((r) => r.rule === "unrouted")).toBe(false);
    const r = movedIn3D(doc, partsOf(doc), r1.id, { ...r1.position, y: r1.position.y + 10 }, { x: 0, y: 0, z: 0, ...r1.rotation }, false)!;
    expect(r.label).toBe("Move R1 on the board");
    expect(r.say).toMatch(/^R1 moved on the board/);
    const board = r.doc.electronics!.board!;
    expect(board.placements[0]).toMatchObject({ x: at.x, y: at.y + 10 });
    // Nothing is dropped: the track stays where it was, and the check flags the pad it no longer reaches.
    expect(board.tracks).toEqual(doc.electronics!.board!.tracks);
    expect(checkBoard(r.doc.electronics!).some((x) => x.rule === "unrouted")).toBe(true);
    // The model follows: the body is where it was dragged to.
    expect(body(r.doc, "R1").position.y).toBeCloseTo(r1.position.y + 10, 6);
    expect(r.doc.features).toBe(doc.features);
  });

  it("turns on the board", () => {
    const doc = model();
    const r1 = body(doc, "R1");
    const r = movedIn3D(doc, partsOf(doc), r1.id, r1.position, { x: 0, y: 0, z: (r1.rotation?.z ?? 0) + 90 }, true)!;
    expect(r.label).toBe("Turn R1 on the board");
    expect(r.doc.electronics!.board!.placements[0]!.rot).toBe(90);
  });

  it("leaves a locked part, and a part only lifted, where they are, and says why", () => {
    const doc = model();
    const r1 = body(doc, "R1");
    const up = movedIn3D(doc, partsOf(doc), r1.id, { ...r1.position, z: r1.position.z + 4 }, { x: 0, y: 0, z: 0, ...r1.rotation }, false)!;
    expect(up.doc).toBe(doc);
    expect(up.say).toMatch(/stays on the board/);
    const locked = { ...doc, electronics: setPlacement(doc.electronics!, doc.electronics!.board!.placements[0]!.part, { locked: true }) };
    const no = movedIn3D(locked, partsOf(locked), r1.id, { ...r1.position, y: r1.position.y + 10 }, { x: 0, y: 0, z: 0, ...r1.rotation }, false)!;
    expect(no.doc).toBe(locked);
    expect(no.error).toBe(true);
    expect(no.say).toBe("R1 is locked where it is. Unlock it in the PCB view to move it.");
  });

  it("moves the Board step when the board itself is dragged, and leaves other bodies alone", () => {
    const doc = model();
    const parts = partsOf(doc);
    const r = movedIn3D(doc, parts, boardBodyId("pcb"), { x: 0, y: 12, z: 5 }, { x: 0, y: 0, z: 0 }, false)!;
    expect((boardStep(r.doc) as BoardFeature).position).toEqual({ x: 0, y: 12, z: 5 });
    expect(r.doc.electronics).toBe(doc.electronics);
    expect(movedIn3D(doc, parts, "b-other", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, false)).toBeNull();
  });
});

describe("holes made in the board's face with the Hole tool (#651)", () => {
  const holed = (frame: HoleFeature["frame"], part = boardBodyId("pcb")) => {
    const doc = addHole(
      model(),
      {
        part,
        frame,
        points: [
          [0, 0],
          [10, 0],
        ],
        size: "M3",
        fit: "printed",
        head: "none",
        depth: null,
        offset: 0.4,
      },
      "h1",
    );
    return { doc, f: doc.features.find((x) => x.id === "h1") as HoleFeature };
  };

  it("become board holes, and the Hole step is not kept", () => {
    const { doc, f } = holed({ origin: [10, 8, 6.6], x: [1, 0, 0], normal: [0, 0, 1] });
    const r = holesIn3D(doc, partsOf(doc), f)!;
    expect(r.doc.features.some((x) => x.id === "h1")).toBe(false);
    const holes = r.doc.electronics!.board!.holes;
    expect(holes.map((h) => [h.x, h.y])).toEqual([
      [10, 8],
      [20, 8],
    ]);
    // M3's ordinary clearance: a board is drilled, so the printer's hole offset is left off.
    expect(holes[0]!.drill).toBe(3.4);
    expect(r.say).toMatch(/^Made 2 holes of [\d.]+ mm in the board\. They are in the PCB view and the drill file too\.$/);
    // The board in 3D is drilled there, from its own layout.
    const prism = build(r.doc).parts.find((p) => p.id === boardBodyId("pcb"))!.prism!;
    expect(prism.profiles[0]!.holes.length).toBe(build(model()).parts.find((p) => p.id === boardBodyId("pcb"))!.prism!.profiles[0]!.holes.length + 2);
  });

  it("stay a Hole step on the board's edge or on another body", () => {
    const edge = holed({ origin: [0, 20, 5.8], x: [0, 1, 0], normal: [-1, 0, 0] });
    expect(holesIn3D(edge.doc, partsOf(edge.doc), edge.f)).toBeNull();
    const other = holed({ origin: [10, 8, 6.6], x: [1, 0, 0], normal: [0, 0, 1] }, "b-other");
    expect(holesIn3D(other.doc, partsOf(other.doc), other.f)).toBeNull();
  });
});

describe("a connector opening (#652)", () => {
  /** The board with a wall 2 mm thick standing 3 mm past R1, on its -x side: R1 is at x = 15 and 0 turn. */
  const cased = () => {
    const doc = model();
    const r1 = body(doc, "R1");
    const half = r1.size.x / 2;
    const face = r1.position.x - half;
    // The wall: x from face - 5 to face - 3, wide and tall enough to stand in front of R1.
    const wall: Part = { id: "wall", name: "Case", kind: "box", hidden: false, position: { x: face - 4, y: 20, z: 0 }, size: { x: 2, y: 60, z: 30 } };
    const withWall: ModelDoc = { ...doc, features: [{ id: "fw", type: "add", name: "Case", part: wall } as never, ...doc.features] };
    const meshes = new Map([["wall", { mesh: moveMesh(boxMesh(wall.size), placeMatrix([wall.position.x, wall.position.y, wall.position.z], [0, 0, 0])) }]]);
    return { doc: withWall, r1, meshes, face };
  };

  it("finds where a ray crosses a body", () => {
    const mesh = moveMesh(boxMesh({ x: 2, y: 10, z: 10 }), placeMatrix([10, 0, 0], [0, 0, 0]));
    expect(rayHits(mesh, [0, 1, 4], [1, 0, 0]).map((t) => Math.round(t * 1000) / 1000)).toEqual([9, 11]);
    expect(rayHits(mesh, [0, 1, 4], [-1, 0, 0])).toEqual([]);
    expect(rayHits(mesh, [0, 1, 40], [1, 0, 0])).toEqual([]);
  });

  it("cuts through the wall the part faces, out past its far side, with a sliding fit", () => {
    const { doc, r1, meshes } = cased();
    const r = connectorOpening(doc, build(doc).parts, meshes, r1.id, undefined, "op1");
    expect(r.error).toBeUndefined();
    const f = r.doc.features.find((x) => x.id === "op1") as CombineFeature;
    expect(f).toMatchObject({ type: "combine", name: "Connector opening 1", target: "wall", keepTools: true });
    // 3 mm to the wall, 2 mm through it, and half a millimetre out the far side.
    expect(f.tools[0]).toMatchObject({ id: r1.id, op: "cut", fit: "sliding", reach: { out: [-1, 0, 0], by: 5.5 } });
    expect(f.tools[0]!.gap).toBeGreaterThan(0);
    expect(r.say).toBe(`Cut an opening for R1 through Case, ${f.tools[0]!.gap} mm clear all round. It follows the part.`);
    expect(featureSummary(r.doc, f)).toMatch(/^An opening through Case, [\d.]+ mm clear all round$/);
    // The cut is a box round R1's body, from its middle out through the wall; R1 itself stays on the board.
    const b = build(r.doc);
    expect([...b.failed]).toEqual([]);
    const cut = b.parts.find((p) => p.id === "wall")!.ops!.find((o) => o.op === "cut")!;
    expect(cut.gap).toBe(f.tools[0]!.gap);
    expect(cut.body).toMatchObject({ kind: "box", size: { x: r1.size.x / 2 + 5.5, y: r1.size.y, z: r1.size.z } });
    expect(cut.body!.position.x + cut.body!.size.x / 2).toBeCloseTo(r1.position.x, 6);
    expect(b.parts.some((p) => p.id === r1.id)).toBe(true);
  });

  it("follows the part when it moves along the wall", () => {
    const { doc, r1, meshes } = cased();
    const made = connectorOpening(doc, build(doc).parts, meshes, r1.id, undefined, "op1").doc;
    const at = made.electronics!.board!.placements[0]!;
    const moved = { ...made, electronics: setPlacement(made.electronics!, at.part, { y: at.y + 6 }) };
    const before = build(made)
      .parts.find((p) => p.id === "wall")!
      .ops!.find((o) => o.op === "cut")!.body!;
    const after = build(moved)
      .parts.find((p) => p.id === "wall")!
      .ops!.find((o) => o.op === "cut")!.body!;
    expect(after.position.y).toBeCloseTo(before.position.y + 6, 6);
    expect(after.position.x).toBeCloseTo(before.position.x, 6);
  });

  it("says so when there is no wall near, or what is picked is not a part on the board", () => {
    const { doc, r1 } = cased();
    const none = connectorOpening(doc, build(doc).parts, new Map(), r1.id);
    expect(none).toMatchObject({ doc, error: true, say: "No wall within 30 mm of R1's sides. Make the case first, or move the board nearer its wall." });
    expect(connectorOpening(doc, build(doc).parts, new Map(), boardBodyId("pcb")).say).toBe("Pick a part on the board first, such as its USB socket");
    expect(connectorOpening(doc, build(doc).parts, new Map(), "wall").error).toBe(true);
  });
});
