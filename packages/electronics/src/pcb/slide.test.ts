import { describe, expect, it } from "vitest";
import type { ElectronicsDesign, P2 } from "../model";
import { bigBoard } from "./big";
import { addTrack, addVia } from "./route";
import { slidePiece, slideTrack } from "./slide";

/** The angle between each pair of pieces that meet, in degrees. */
const turns = (pts: P2[]): number[] =>
  pts.slice(1, -1).map((p, i) => {
    const a = Math.atan2(p[1] - pts[i]![1], p[0] - pts[i]![0]);
    const b = Math.atan2(pts[i + 2]![1] - p[1], pts[i + 2]![0] - p[0]);
    return Math.round(Math.abs((((b - a) * 180) / Math.PI + 540) % 360) - 180);
  });

// Along, up at 45°, along, down at 45°, along.
const dog: P2[] = [
  [0, 0],
  [4, 0],
  [6, 2],
  [10, 2],
  [12, 0],
  [16, 0],
];

describe("sliding a piece of a track", () => {
  it("keeps the pieces either side on their own lines, so 45° corners stay 45°", () => {
    const up = slidePiece(dog, 2, [0.3, 1])!;
    expect(up.pts).toEqual([
      [0, 0],
      [4, 0],
      [7, 3],
      [9, 3],
      [12, 0],
      [16, 0],
    ]);
    expect(turns(up.pts)).toEqual(turns(dog));
    expect(up.moved).toEqual([
      [
        [6, 2],
        [7, 3],
      ],
      [
        [10, 2],
        [9, 3],
      ],
    ]);
    // A slanted piece slides across itself; only the part of the pointer's move across it counts.
    const slant = slidePiece(dog, 1, [-2, 0])!;
    expect(slant.pts.slice(0, 4)).toEqual([
      [0, 0],
      [2, 0],
      [4, 2],
      [10, 2],
    ]);
    expect(turns(slant.pts)).toEqual([45, -45, -45, 45]);
  });

  it("leaves the ends of the track where they are, with a 45° piece to reach the slid one", () => {
    const end = slidePiece(dog, 0, [0, -1])!;
    expect(end.pts.slice(0, 4)).toEqual([
      [0, 0],
      [1, -1],
      [3, -1],
      [6, 2],
    ]);
    expect(end.moved).toEqual([
      [
        [4, 0],
        [3, -1],
      ],
    ]);
    // A single straight piece between two pads gains a 45° piece at each end.
    const straight = slidePiece(
      [
        [0, 0],
        [10, 0],
      ],
      0,
      [5, 2],
    )!;
    expect(straight.pts).toEqual([
      [0, 0],
      [2, 2],
      [8, 2],
      [10, 0],
    ]);
    expect(straight.moved).toEqual([]);
  });

  it("stops where a piece would have to turn back on itself", () => {
    // The middle piece is 4 long; 2 up and its two 45° neighbours meet in a point.
    expect(slidePiece(dog, 2, [0, 2])!.pts).toEqual([
      [0, 0],
      [4, 0],
      [8, 4],
      [12, 0],
      [16, 0],
    ]);
    expect(slidePiece(dog, 2, [0, 2.5])).toBeNull();
    // Down past the pieces it hangs from.
    expect(slidePiece(dog, 2, [0, -2.5])).toBeNull();
    expect(slidePiece(dog, 9, [0, 1])).toBeNull();
    expect(slidePiece(dog, 2, [3, 0])!.pts).toBe(dog);
  });

  const withTrack = (): { d: ElectronicsDesign; id: string } => {
    const d = addTrack(bigBoard(2), "N", "top", dog, 0.25);
    return { d, id: d.board!.tracks.at(-1)!.id };
  };

  it("goes as far as it can on the board when asked for more", () => {
    const { d, id } = withTrack();
    const far = slideTrack(d, id, 2, [0, 9]).board!.tracks.at(-1)!.pts;
    expect(far[2]![0]).toBeCloseTo(8, 2);
    expect(far[2]![1]).toBeCloseTo(4, 2);
    expect(slideTrack(d, id, 2, [1, 0])).toBe(d);
    expect(slideTrack(d, "nothing", 2, [0, 1])).toBe(d);
  });

  it("takes along a track of the net that ends on a moved corner, and a via on it", () => {
    const start = withTrack();
    const id = start.id;
    let d = start.d;
    d = addTrack(
      d,
      "N",
      "top",
      [
        [6, 2],
        [6, 8],
      ],
      0.25,
    );
    d = addTrack(
      d,
      "OTHER",
      "top",
      [
        [10, 2],
        [10, 8],
      ],
      0.25,
    );
    d = addVia(d, "N", 10, 2);
    const slid = slideTrack(d, id, 2, [0, 1]).board!;
    expect(slid.tracks.find((t) => t.id === id)!.pts[2]).toEqual([7, 3]);
    expect(slid.tracks.at(-2)!.pts).toEqual([
      [7, 3],
      [6, 8],
    ]);
    // Another net's track is not this one's to move.
    expect(slid.tracks.at(-1)!.pts[0]).toEqual([10, 2]);
    expect(slid.vias.at(-1)).toMatchObject({ x: 9, y: 3 });
  });
});
