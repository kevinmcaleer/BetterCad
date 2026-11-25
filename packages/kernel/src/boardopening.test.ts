import { GRID, emptyDesign, placePart, pushToBoard, resistor } from "@bettercad/electronics";
import { setPlacement } from "@bettercad/electronics/pcb/route";
import { beforeAll, describe, expect, it } from "vitest";
import { addBoard } from "./board";
import { addCombine, build, newDoc, type ModelDoc, type Part } from "./document";
import { ModelBuilder } from "./occt/model";
import { loadOCCT, type OC } from "./occt/oc";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A connector opening (#652) in the real kernel: the box round a board part, pushed out through a wall, cut from it. */
describe("a connector opening through a wall", () => {
  const cased = () => {
    let d = emptyDesign();
    d = placePart(d, d.sheets[0]!.id, resistor(), { x: 0, y: 0 * GRID }).design;
    d = pushToBoard(d).design;
    d = setPlacement(d, d.board!.placements[0]!.part, { x: 15, y: 20, rot: 0 });
    const doc = addBoard({ ...newDoc("Case"), electronics: d }, { position: { x: 0, y: 0, z: 5 } }, "pcb");
    const r1 = build(doc).parts.find((p) => p.name === "R1")!;
    const face = r1.position.x - r1.size.x / 2;
    const wall: Part = { id: "wall", name: "Case", kind: "box", hidden: false, position: { x: face - 4, y: 20, z: 0 }, size: { x: 2, y: 60, z: 30 } };
    const withWall: ModelDoc = { ...doc, features: [{ id: "fw", type: "add", name: "Case", part: wall } as never, ...doc.features] };
    return { doc: withWall, r1 };
  };

  it("takes a hole the size of the part and its gap out of the wall, and leaves the part on the board", () => {
    const { doc, r1 } = cased();
    const gap = 0.2;
    const made = addCombine(
      doc,
      { mode: "combine", target: "wall", tools: [{ id: r1.id, op: "cut", fit: "sliding", gap, reach: { out: [-1, 0, 0], by: 5.5 } }], keepTools: true },
      "op1",
    );
    const builder = new ModelBuilder(oc);
    const before = builder.build(doc).bodies.find((b) => b.id === "wall")!.measure.volume;
    const r = builder.build(made);
    expect(r.failed).toEqual([]);
    const after = r.bodies.find((b) => b.id === "wall")!.measure.volume;
    // Right through the 2 mm wall: the part's side, grown by the gap all round.
    const hole = 2 * (r1.size.y + 2 * gap) * (r1.size.z + 2 * gap);
    expect(before - after).toBeGreaterThan(hole * 0.9);
    expect(before - after).toBeLessThan(hole * 1.1);
    expect(r.bodies.some((b) => b.id === r1.id)).toBe(true);
  });

  it("says why for a part whose body has no size to cut round", () => {
    const { doc } = cased();
    const made = addCombine(
      doc,
      { mode: "combine", target: "wall", tools: [{ id: "pcb/board", op: "cut", reach: { out: [-1, 0, 0], by: 5 } }], keepTools: true },
      "op1",
    );
    expect(build(made).failed.get("op1")).toBe("Board has no simple body to cut an opening for. Give its component a body size.");
  });
});
