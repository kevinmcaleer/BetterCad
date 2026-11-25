import { describe, expect, it } from "vitest";
import type { BodyMesh } from "@bettercad/kernel";
import { boardFaces, faceShape } from "./faceOutline";

type V3 = [number, number, number];

/** A mesh of faces, each a list of triangles. Only what the outline reads is filled in. */
function meshOf(faces: V3[][][]): BodyMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const faceTris = [0];
  for (const tris of faces) {
    for (const tri of tris) for (const p of tri) indices.push(positions.push(...p) / 3 - 1);
    faceTris.push(indices.length / 3);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), faceTris: new Uint32Array(faceTris) } as unknown as BodyMesh;
}

/** A 40 by 20 plate at height `z` with a 10 by 10 hole, as eight triangles round the hole. Looks up (+Z). */
function plate(z: number): V3[][] {
  const o: [number, number][] = [
    [0, 0],
    [40, 0],
    [40, 20],
    [0, 20],
  ];
  const h: [number, number][] = [
    [10, 5],
    [20, 5],
    [20, 15],
    [10, 15],
  ];
  const tris: V3[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const [a, b, c, d] = [o[i]!, o[(i + 1) % 4]!, h[(i + 1) % 4]!, h[i]!];
    tris.push(
      [
        [...a, z],
        [...b, z],
        [...c, z],
      ],
      [
        [...a, z],
        [...c, z],
        [...d, z],
      ],
    );
  }
  return tris;
}
const span = (pts: [number, number][]) => [
  Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])),
  Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])),
];

describe("a face as a board's shape", () => {
  // Face 0: the plate. Face 1: a wall standing on the X axis, 30 wide and 8 tall, looking along -Y. Face 2: bent.
  const wall: V3[][] = [
    [
      [0, 0, 0],
      [30, 0, 0],
      [30, 0, 8],
    ],
    [
      [0, 0, 0],
      [30, 0, 8],
      [0, 0, 8],
    ],
  ];
  const bent: V3[][] = [
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [1, 0, 0],
      [1, 1, 1],
      [0, 1, 0],
    ],
  ];
  const mesh = meshOf([plate(3), wall, bent]);

  it("takes the face's edge, and a hole through it as a cut-out", () => {
    const shape = faceShape(mesh, 0)!;
    expect(shape.outer).toHaveLength(4);
    expect(span(shape.outer)).toEqual([40, 20]);
    expect(shape.holes).toHaveLength(1);
    expect(span(shape.holes[0]!)).toEqual([10, 10]);
    // A level face keeps the model's X and Y.
    expect(shape.outer).toContainEqual([40, 20]);
  });

  it("lays a standing face flat, and passes over one that is not flat", () => {
    expect(span(faceShape(mesh, 1)!.outer)).toEqual([30, 8]);
    expect(faceShape(mesh, 2)).toBeNull();
    expect(faceShape(mesh, 9)).toBeNull();
  });

  it("offers the face the board follows and the faces picked in the model", () => {
    const model = {
      bodies: new Map([["b1", { mesh, names: { faces: ["top", "front", "bend"] } }]]),
      picks: [
        { body: "b1", kind: "face", index: 1 },
        { body: "b1", kind: "face", index: 2 },
        { body: "b1", kind: "edge", index: 0 },
        { body: "gone", kind: "face", index: 0 },
      ],
      names: [{ id: "b1", name: "Lid" }],
    };
    expect(boardFaces(model, "b1|top").map((f) => [f.id, f.name])).toEqual([
      ["b1|top", "a face of Lid"],
      ["b1|front", "a face of Lid"],
    ]);
    // The followed face is found by its name, wherever the kernel now numbers it.
    const renumbered = { ...model, picks: [], bodies: new Map([["b1", { mesh, names: { faces: ["front", "top", "bend"] } }]]) };
    expect(span(boardFaces(renumbered, "b1|front")[0]!.shape.outer)).toEqual([40, 20]);
    expect(boardFaces(renumbered, "b1|lost")).toEqual([]);
    expect(boardFaces(undefined, "b1|top")).toEqual([]);
  });
});
