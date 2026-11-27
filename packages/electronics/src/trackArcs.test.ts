import { describe, expect, it } from "vitest";
import type { P2 } from "./model";
import { arcMid, bulgeOfTurn, bulgeThrough, pathLength, roundCorners, trackBits, trackPath, turnOf } from "./trackArcs";

const close = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4;

describe("curved tracks (#755)", () => {
  it("finds the arc through three points, and its middle again", () => {
    // A half circle anticlockwise from (0,0) to (2,0) goes down through (1,-1).
    expect(bulgeThrough([0, 0], [1, -1], [2, 0])).toBeCloseTo(1, 9);
    expect(arcMid([0, 0], [2, 0], 1)).toEqual([1, -1]);
    expect(bulgeThrough([0, 0], [1, 1], [2, 0])).toBeCloseTo(-1, 9);
    const b = bulgeOfTurn(90);
    expect(turnOf(b)).toBeCloseTo(90, 9);
    const m = arcMid([5, 0], [0, 5], b);
    expect(bulgeThrough([5, 0], m, [0, 5])).toBeCloseTo(b, 6);
    // A quarter circle of radius 5 about the origin, anticlockwise from (5,0) to (0,5).
    expect(close(m, [5 * Math.SQRT1_2, 5 * Math.SQRT1_2])).toBe(true);
    expect(bulgeThrough([0, 0], [1, 0], [2, 0])).toBe(0);
  });

  it("measures and cuts a curve along its length", () => {
    const t = {
      pts: [
        [5, 0],
        [0, 5],
      ] as P2[],
      arcs: [bulgeOfTurn(90)],
    };
    expect(pathLength(t)).toBeCloseTo((Math.PI * 5) / 2, 9);
    const path = trackPath(t);
    expect(path.length).toBeGreaterThan(10);
    for (const p of path) expect(Math.hypot(p[0], p[1])).toBeCloseTo(5, 4);
    expect(new Set(trackBits(t).map((b) => b.piece))).toEqual(new Set([0]));
    // Bulges that don't line up with the pieces are ignored.
    expect(trackPath({ pts: t.pts, arcs: [1, 1] })).toEqual(t.pts);
  });

  it("rounds a run's corners with arcs that meet both pieces", () => {
    const t = { pts: [[0, 0], [10, 0], [10, 10]] as P2[] }; // prettier-ignore
    const r = roundCorners(t, 2);
    expect(r.pts).toEqual([[0, 0], [8, 0], [10, 2], [10, 10]]); // prettier-ignore
    expect(r.arcs[0]).toBe(0);
    expect(turnOf(r.arcs[1]!)).toBeCloseTo(90, 6);
    // The arc's middle is 2 mm from its centre at (8, 2).
    const m = arcMid(r.pts[1]!, r.pts[2]!, r.arcs[1]!);
    expect(Math.hypot(m[0] - 8, m[1] - 2)).toBeCloseTo(2, 4);
    expect(pathLength(r)).toBeCloseTo(8 + Math.PI + 8, 6);
    // A 45° bend, and a corner too tight for the radius, which takes half the shorter piece.
    const bend = roundCorners({ pts: [[0, 0], [10, 0], [11, 1]] as P2[] }, 5); // prettier-ignore
    expect(bend.pts[2]).toEqual([10.5, 0.5]);
    expect(turnOf(bend.arcs[1]!)).toBeCloseTo(45, 6);
    // A turn the other way bends the other way.
    expect(
      turnOf(
        roundCorners(
          {
            pts: [
              [0, 0],
              [10, 0],
              [10, -10],
            ] as P2[],
          },
          2,
        ).arcs[1]!,
      ),
    ).toBeCloseTo(-90, 6);
  });
});
