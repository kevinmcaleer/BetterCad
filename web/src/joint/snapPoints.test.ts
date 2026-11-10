import { describe, expect, it } from "vitest";
import { across, between, boxSnaps, edgeCircle, faceSnaps, nearSnaps, nearestSnap, wiggle, type V3 } from "./snapPoints";

const ring = (c: V3, r: number, n = 24): V3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2]] as V3;
  });

/** The top of a 20 mm box at z = 10, with a 3 mm hole in the middle. */
const top = { flat: true, normal: [0, 0, 1] as V3, centroid: [0, 0, 10] as V3, edge: [1, 0, 0] as V3 };
const square: V3[][] = [
  [
    [-10, -10, 10],
    [10, -10, 10],
  ],
  [
    [10, -10, 10],
    [10, 10, 10],
  ],
  [
    [10, 10, 10],
    [-10, 10, 10],
  ],
  [
    [-10, 10, 10],
    [-10, -10, 10],
  ],
];

describe("faceSnaps", () => {
  it("gives a flat face its corners, edge middles, hole centre and middle, facing out", () => {
    const s = faceSnaps(top, [...square, ring([0, 0, 10], 3)], [0, 0, 1]);
    const kinds = s.map((x) => x.kind).sort();
    expect(kinds).toEqual(["centre", "corner", "corner", "corner", "corner", "edge", "edge", "edge", "edge"]);
    // The hole centre and the face middle are one point, so only the centre stays.
    expect(s.find((x) => x.kind === "centre")!.point).toEqual([0, 0, 10]);
    expect(s.find((x) => x.kind === "edge")!.point).toEqual([0, -10, 10]);
    for (const x of s) expect(x.normal).toEqual([0, 0, 1]);
  });

  it("turns a flat face's snaps toward the viewer", () => {
    const s = faceSnaps({ ...top, normal: [0, 0, -1] }, square, [0, 0.2, 1]);
    expect(s[0]!.normal).toEqual([0, 0, 1]);
  });

  it("gives a curved face the centres of its round edges, facing away from it", () => {
    const side = { flat: false, normal: [1, 0, 0] as V3, centroid: [3, 0, 5] as V3, edge: [0, 0, 1] as V3 };
    const s = faceSnaps(side, [ring([0, 0, 0], 3), ring([0, 0, 10], 3)], [1, 0, 0]);
    expect(s.map((x) => x.point)).toEqual([
      [0, 0, 0],
      [0, 0, 10],
    ]);
    expect(s[0]!.normal[2]).toBeCloseTo(-1);
    expect(s[1]!.normal[2]).toBeCloseTo(1);
  });

  it("keeps the face middle when nothing else sits there", () => {
    const s = faceSnaps(top, square, [0, 0, 1]);
    expect(s.find((x) => x.kind === "middle")!.point).toEqual([0, 0, 10]);
  });
});

describe("edgeCircle", () => {
  it("finds a circle and an arc, and turns down a straight line", () => {
    expect(edgeCircle(ring([1, 2, 3], 5), 1e-3)).toMatchObject({ radius: expect.closeTo(5), closed: true });
    expect(edgeCircle(ring([1, 2, 3], 5).slice(0, 8), 1e-3)?.closed).toBe(false);
    expect(
      edgeCircle(
        [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
          [3, 0, 0],
        ],
        1e-3,
      ),
    ).toBeNull();
  });
});

describe("across", () => {
  it("is square to the normal", () => {
    const x = across([0, 0, 1], [1, 1, 0]);
    expect(x[2]).toBeCloseTo(0);
    expect(Math.hypot(...x)).toBeCloseTo(1);
  });
});

describe("nearestSnap", () => {
  it("takes the closest within reach", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(nearestSnap(pts, { x: 7, y: 0 }, 12)).toBe(1);
    expect(nearestSnap(pts, { x: 40, y: 0 }, 12)).toBe(-1);
  });
});

describe("between", () => {
  it("halves two snap points", () => {
    expect(between({ point: [0, 0, 0], normal: [0, 0, 1], plane: false }, { point: [10, 4, 2], normal: [1, 0, 0], plane: false })).toEqual([5, 2, 1]);
  });
  it("finds the midplane of two parallel faces, level with the first", () => {
    const a = { point: [0, 3, 0] as V3, normal: [1, 0, 0] as V3, plane: true };
    expect(between(a, { point: [10, 0, 5], normal: [-1, 0, 0], plane: true })).toEqual([5, 3, 0]);
    expect(between(a, { point: [10, 0, 5], normal: [0, 1, 0], plane: true })).toBeNull();
  });
  it("goes halfway from a snap point to a face", () => {
    expect(between({ point: [0, 0, 0], normal: [0, 0, 1], plane: false }, { point: [3, 3, 8], normal: [0, 0, -1], plane: true })).toEqual([0, 0, 4]);
  });
});

describe("nearSnaps", () => {
  it("lists the snaps in reach, nearest first", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(nearSnaps(pts, { x: 4, y: 0 }, 12)).toEqual([1, 0]);
  });
});

describe("wiggle", () => {
  it("swings a hinge to each limit and back", () => {
    expect(wiggle("revolute", -90, 45, 0.25)).toBeCloseTo(45);
    expect(wiggle("revolute", -90, 45, 0.75)).toBeCloseTo(-90);
    expect(wiggle("revolute", -90, 45, 1)).toBeCloseTo(0);
  });
  it("slides a slider out and back, and leaves a fixed joint be", () => {
    expect(wiggle("prismatic", 0, 50, 0.5)).toBeCloseTo(50);
    expect(wiggle("prismatic", 0, 50, 1)).toBeCloseTo(0);
    expect(wiggle("fixed", 0, 0, 0.5)).toBeNull();
  });
});

describe("holes", () => {
  it("marks a whole circle on a flat face as a hole, and a corner round as not", () => {
    const s = faceSnaps(top, [...square, ring([0, 0, 10], 3), ring([5, 5, 10], 2).slice(0, 7)], [0, 0, 1]);
    expect(s.find((x) => x.point[0] === 0 && x.point[1] === 0)!.hole).toBeCloseTo(3);
    expect(s.find((x) => x.point[0] === 5 && x.point[1] === 5)!.hole).toBeUndefined();
  });
  it("marks a hole OCCT split into two halves", () => {
    const r = ring([0, 0, 10], 3);
    const s = faceSnaps(top, [...square, r.slice(0, 13), r.slice(12)], [0, 0, 1]);
    expect(s.filter((x) => x.hole).length).toBe(1);
  });
});

describe("boxSnaps", () => {
  it("gives a mesh's box face toward the viewer, its corners and the box centre", () => {
    const { snaps, ghosts } = boxSnaps([0, 0, 0], [10, 20, 30], [0.2, -0.9, 0.1]);
    expect(snaps.map((s) => s.kind)).toEqual(["middle", "corner", "corner", "corner", "corner", "centre"]);
    expect(snaps[0]!.point).toEqual([5, 0, 15]);
    expect(snaps[5]!.point).toEqual([5, 10, 15]);
    expect(snaps.every((s) => s.normal[1] === -1)).toBe(true);
    expect(snaps.filter((s) => s.kind === "corner").map((s) => s.point)).toContainEqual([10, 0, 30]);
    expect(ghosts).toHaveLength(12);
  });
});
