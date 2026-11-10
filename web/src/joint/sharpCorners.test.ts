import { describe, expect, it } from "vitest";
import { sharpCorners, type FaceGeom } from "./sharpCorners";
import type { V3 } from "./snapPoints";

/**
 * A 20 × 20 × 10 mm block whose top's +X edge is chamfered 2 mm: the top stops at x = 8, the chamfer runs down to
 * the +X side at z = 8. Only the faces and edges round the top are here.
 */
function chamfered(round = false) {
  const edges: V3[][] = [
    [
      [-10, -10, 10],
      [8, -10, 10],
    ], // 0 top front
    [
      [8, -10, 10],
      [8, 10, 10],
    ], // 1 top / chamfer
    [
      [8, 10, 10],
      [-10, 10, 10],
    ], // 2 top back
    [
      [-10, 10, 10],
      [-10, -10, 10],
    ], // 3 top left
    [
      [10, -10, 8],
      [10, 10, 8],
    ], // 4 chamfer / side
    [
      [-10, -10, 0],
      [10, -10, 0],
    ], // 5 front bottom
    [
      [10, -10, 0],
      [10, 10, 0],
    ], // 6 side bottom
  ];
  const faces: FaceGeom[] = [
    { flat: true, normal: [0, 0, 1], centroid: [-1, 0, 10] }, // 0 top
    { flat: !round, normal: [Math.SQRT1_2, 0, Math.SQRT1_2], centroid: [9, 0, 9] }, // 1 chamfer or round
    { flat: true, normal: [1, 0, 0], centroid: [10, 0, 4] }, // 2 +X side
    { flat: true, normal: [0, -1, 0], centroid: [0, -10, 5] }, // 3 front
    { flat: true, normal: [0, 0, -1], centroid: [0, 0, 0] }, // 4 bottom
  ];
  return {
    faceEdges: [
      [0, 1, 2, 3],
      [1, 4],
      [4, 6],
      [0, 5],
      [5, 6],
    ],
    face: (i: number) => faces[i] ?? null,
    edge: (i: number) => edges[i] ?? null,
  };
}

describe("sharpCorners", () => {
  for (const round of [false, true]) {
    it(`finds the corners a ${round ? "round" : "chamfer"} cut away, and the edge between them`, () => {
      const r = sharpCorners(chamfered(round), 0, [0, 0, 1], [1, 0, 0]);
      expect(r.snaps.map((s) => s.point)).toEqual([
        [10, -10, 10],
        [10, 10, 10],
        [10, 0, 10],
      ]);
      expect(r.snaps.every((s) => s.sharp)).toBe(true);
      expect(r.ghosts).toEqual([
        [
          [10, -10, 10],
          [10, 10, 10],
        ],
      ]);
    });
  }

  it("gives nothing for a face whose edges are all real", () => {
    const g = chamfered();
    expect(sharpCorners(g, 3, [0, -1, 0], [1, 0, 0]).snaps).toEqual([]);
  });
});
