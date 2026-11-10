import { describe, expect, it } from "vitest";
import { across, edgeCircle, faceSnaps, nearestSnap, type V3 } from "./snapPoints";

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
