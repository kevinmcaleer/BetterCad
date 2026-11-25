import { GRID, emptyDesign, placePart, pushToBoard, resistor } from "@bettercad/electronics";
import { beforeAll, describe, expect, it } from "vitest";
import { addBoard, boardBodyId } from "./board";
import { build as parts, newDoc } from "./document";
import { meshBounds, moveMesh } from "./mesh";
import { ModelBuilder } from "./occt/model";
import { tessellate } from "./occt/tessellate";
import { loadOCCT, type OC } from "./occt/oc";
import { placeMatrix } from "./pose";
import { boxMesh } from "./primitives";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** Repeated parts on a board share one mesh (#650): 50 resistors are meshed once and set down 50 times. */
describe("a board with the same part many times", () => {
  const doc = () => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    for (let i = 0; i < 50; i++) d = placePart(d, sheet, resistor(), { x: (i % 10) * 8 * GRID, y: Math.floor(i / 10) * 8 * GRID }).design;
    d = pushToBoard(d).design;
    // Turned and on both sides, as a laid out board has them.
    const board = d.board!;
    d = {
      ...d,
      board: { ...board, placements: board.placements.map((p, i) => ({ ...p, rot: (i % 4) * 90, side: i % 5 ? ("top" as const) : ("bottom" as const) })) },
    };
    return addBoard({ ...newDoc("Many"), electronics: d }, {}, "pcb");
  };

  it("meshes the part once, and each body is where a mesh of its own would be", () => {
    const builder = new ModelBuilder(oc);
    const d = doc();
    const r = builder.build(d);
    expect(r.failed).toEqual([]);
    const made = r.bodies.filter((b) => b.id !== boardBodyId("pcb"));
    expect(made).toHaveLength(50);
    expect(r.shared).toBe(49);
    // The same triangles, in the same order, for every one.
    expect(new Set(made.map((b) => b.mesh.indices.join())).size).toBe(1);
    for (const b of [made[0]!, made[5]!, made[17]!, made[49]!]) {
      const own = meshBounds(tessellate(oc, builder.solid(build(b.id)).shape));
      const got = meshBounds(b.mesh);
      for (const k of [0, 1, 2]) {
        expect(got.min[k]).toBeCloseTo(own.min[k]!, 4);
        expect(got.max[k]).toBeCloseTo(own.max[k]!, 4);
      }
      // As much inside as its solid holds.
      expect(b.measure.volume).toBeGreaterThan(0);
    }
    function build(id: string) {
      return parts(d).parts.find((p) => p.id === id)!;
    }
  });

  it("a second build takes every body from the cache", () => {
    const builder = new ModelBuilder(oc);
    const d = doc();
    builder.build(d);
    expect(builder.build(d).shared).toBe(0);
  });
});

describe("moveMesh", () => {
  it("moves the points and turns the normals", () => {
    const m = moveMesh(boxMesh({ x: 2, y: 4, z: 6 }), placeMatrix([10, 0, 0], [0, 0, 90]));
    const b = meshBounds(m);
    expect(b.min.map((v) => Math.round(v))).toEqual([8, -1, 0]);
    expect(b.max.map((v) => Math.round(v))).toEqual([12, 1, 6]);
    for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!)).toBeCloseTo(1, 5);
  });
});
