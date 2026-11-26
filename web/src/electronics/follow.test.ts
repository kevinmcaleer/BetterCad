import { describe, expect, it } from "vitest";
import { emptyDesign, type ElectronicsDesign } from "@bettercad/electronics";
import type { BodyMesh } from "@bettercad/kernel";
import { drawCircle, drawRectangle, newSketch } from "@bettercad/sketch";
import { biggestFlatFace, catchUp, profileChange } from "./follow";

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

/** A w by h rectangle at height z, looking up, or down when `down`. */
const rect = (w: number, h: number, z: number, down = false): V3[][] => {
  const [a, b, c, d]: V3[] = [
    [0, 0, z],
    [w, 0, z],
    [w, h, z],
    [0, h, z],
  ];
  return down
    ? [
        [a, c, b],
        [a, d, c],
      ]
    : [
        [a, b, c],
        [a, c, d],
      ];
};
/** A small wall, looking along -Y. */
const wall: V3[][] = [
  [
    [0, 0, 0],
    [5, 0, 0],
    [5, 0, 2],
  ],
  [
    [0, 0, 0],
    [5, 0, 2],
    [0, 0, 2],
  ],
];

const size = (d: ElectronicsDesign | string | null) => {
  if (!d || typeof d === "string") return null;
  const xs = d.board!.outline.map((c) => c.x);
  const ys = d.board!.outline.map((c) => c.y);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};

describe("Use as PCB profile", () => {
  it("takes a body's biggest flat face, the top one of two the same size", () => {
    expect(biggestFlatFace(meshOf([wall, rect(60, 30, 0, true), rect(60, 30, 2)]))).toBe(2);
    expect(biggestFlatFace(meshOf([rect(60, 30, 2), wall, rect(80, 30, 0, true)]))).toBe(2);
    expect(biggestFlatFace(meshOf([]))).toBe(-1);
  });

  it("makes a board shaped by the body when there is none, following its face by name", () => {
    const bodies = new Map([["b1", { mesh: meshOf([wall, rect(60, 30, 2)]), names: { faces: ["side", "top"] } }]]);
    const change = profileChange({ body: "b1" }, bodies);
    if (typeof change === "string") throw new Error(change);
    const d = change(emptyDesign());
    expect(size(d)).toEqual([60, 30]);
    expect(d.board!.outlineFrom?.face).toBe("b1|top");
    // A face right-clicked is used as it is.
    const side = profileChange({ body: "b1", face: 0 }, bodies);
    expect(typeof side === "string" ? side : side(emptyDesign()).board!.outlineFrom?.face).toBe("b1|side");
  });

  it("says why a body or face can't be a board", () => {
    expect(profileChange({ body: "gone" }, new Map())).toBe("That body is still being built. Try again in a moment.");
    const bent = meshOf([
      [
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
      ],
    ]);
    expect(profileChange({ body: "b", face: 0 }, new Map([["b", { mesh: bent }]]))).toBe("That face is not flat, so it can't be a board's shape.");
    expect(profileChange({ body: "b" }, new Map([["b", { mesh: bent }]]))).toBe("That body has no flat face to make a board from.");
  });

  it("follows the face as the model changes, and says when it is gone", () => {
    const named = (mesh: BodyMesh) => new Map([["b1", { mesh, names: { faces: ["side", "top"] } }]]);
    const first = profileChange({ body: "b1" }, named(meshOf([wall, rect(60, 30, 2)])));
    if (typeof first === "string") throw new Error(first);
    const d = first(emptyDesign());
    const ids = new Set(["b1"]);
    expect(catchUp(d, [], named(meshOf([wall, rect(60, 30, 2)])), ids)).toBeNull();
    // Made longer.
    expect(size(catchUp(d, [], named(meshOf([wall, rect(90, 30, 2)])), ids))).toEqual([90, 30]);
    // Raised: the same shape, and the board goes with it.
    expect((catchUp(d, [], named(meshOf([wall, rect(60, 30, 7)])), ids) as ElectronicsDesign).board!.outlineFrom!.frame!.origin).toEqual([0, 0, 7]);
    // Still being built: nothing to do yet.
    expect(catchUp(d, [], new Map(), ids)).toBeNull();
    // The face or the body is gone.
    expect(catchUp(d, [], new Map([["b1", { mesh: meshOf([wall]), names: { faces: ["side"] } }]]), ids)).toBe("gone");
    expect(catchUp(d, [], new Map(), new Set())).toBe("gone");
    expect(catchUp(emptyDesign(), [], new Map(), ids)).toBeNull();
  });

  it("follows a sketch: a bigger rectangle makes a bigger board, its circle a cut-out", () => {
    const plate = (w: number) => ({ id: "s1", sketch: drawCircle(drawRectangle(newSketch(), [0, 0], [w, 30]).sketch, [10, 10], 3).sketch });
    const first = profileChange({ sketch: plate(50) }, new Map());
    if (typeof first === "string") throw new Error(first);
    const d = first(emptyDesign());
    expect(size(d)).toEqual([50, 30]);
    expect(d.board!.cutouts).toHaveLength(1);
    expect(catchUp(d, [plate(50)], new Map(), new Set())).toBeNull();
    expect(size(catchUp(d, [plate(65)], new Map(), new Set()))).toEqual([65, 30]);
    expect(catchUp(d, [], new Map(), new Set())).toBe("gone");
    expect(profileChange({ sketch: { id: "s2", sketch: newSketch() } }, new Map())).toBe("That sketch has no closed shape to make a board from.");
  });
});
