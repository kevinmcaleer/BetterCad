import { describe, expect, it } from "vitest";
import { meshSnaps, splitOutline, type TriMesh } from "./meshSnaps";
import type { V3 } from "./snapPoints";

const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Triangles as an STL comes in: each its own face, no corners shared. */
function soup(tris: [V3, V3, V3][]): TriMesh {
  return {
    positions: Float32Array.from(tris.flat(2)),
    indices: Uint32Array.from(tris.flatMap((_, t) => [t * 3, t * 3 + 1, t * 3 + 2])),
    faceTris: Uint32Array.from({ length: tris.length + 1 }, (_, i) => i),
  };
}

/** A closed cylinder of radius r from z0 to z1, in `n` sides, round (cx, cy). */
function cylinder(n: number, r: number, z0: number, z1: number, cx = 0, cy = 0): [V3, V3, V3][] {
  const at = (i: number, z: number): V3 => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n), z];
  const out: [V3, V3, V3][] = [];
  for (let i = 0; i < n; i++) {
    out.push([at(i, z0), at(i + 1, z0), at(i + 1, z1)], [at(i, z0), at(i + 1, z1), at(i, z1)]);
    out.push([[cx, cy, z1], at(i, z1), at(i + 1, z1)], [[cx, cy, z0], at(i + 1, z0), at(i, z0)]);
  }
  return out;
}

function cube(s: number): [V3, V3, V3][] {
  const p = (x: number, y: number, z: number): V3 => [x * s, y * s, z * s];
  const quads = [
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)],
    [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)],
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)],
    [p(1, 1, 0), p(0, 1, 0), p(0, 1, 1), p(1, 1, 1)],
    [p(0, 1, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)],
    [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)],
  ];
  return quads.flatMap(([a, b, c, d]) => [[a!, b!, c!] as [V3, V3, V3], [a!, c!, d!] as [V3, V3, V3]]);
}

const near = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3;

describe("meshSnaps", () => {
  it("grows a cube's top from its two triangles: middle, corners and edge middles", () => {
    const m = soup(cube(10));
    // Triangle 2 is the first of the top's two.
    const r = meshSnaps(m, ID, 2, [0, 0, 1])!;
    expect(r.faces).toEqual(new Set([2, 3]));
    const middle = r.snaps.find((s) => s.kind === "middle")!;
    expect(near(middle.point, [5, 5, 10])).toBe(true);
    expect(middle.normal).toEqual([0, 0, 1]);
    expect(r.snaps.filter((s) => s.kind === "corner")).toHaveLength(4);
    expect(r.snaps.filter((s) => s.kind === "edge")).toHaveLength(4);
  });

  it("gives a peg's side the centres of its round ends, facing out of it", () => {
    const m = soup(cylinder(32, 3, 0, 12, 20, 10));
    const r = meshSnaps(m, ID, 0, [1, 0, 0])!;
    const centres = r.snaps.filter((s) => s.kind === "centre");
    expect(centres).toHaveLength(2);
    const top = centres.find((s) => s.point[2] > 6)!;
    const bottom = centres.find((s) => s.point[2] < 6)!;
    expect(near(top.point, [20, 10, 12])).toBe(true);
    expect(top.normal[2]).toBeCloseTo(1);
    expect(near(bottom.point, [20, 10, 0])).toBe(true);
    expect(bottom.normal[2]).toBeCloseTo(-1);
    // The whole side is the run: both triangles of every side.
    expect(r.faces.size).toBe(64);
  });

  it("gives a peg's flat end its centre, as a hole of its radius", () => {
    const m = soup(cylinder(32, 3, 0, 12));
    const r = meshSnaps(m, ID, 2, [0, 0, 1])!;
    const c = r.snaps.find((s) => s.kind === "centre")!;
    expect(near(c.point, [0, 0, 12])).toBe(true);
    expect(c.hole).toBeCloseTo(3, 3);
  });

  it("places the snaps where the body is drawn", () => {
    const m = soup(cube(10));
    const moved = [...ID];
    moved[12] = 100;
    const r = meshSnaps(m, moved, 2, [0, 0, 1])!;
    expect(near(r.snaps.find((s) => s.kind === "middle")!.point, [105, 5, 10])).toBe(true);
  });
});

describe("splitOutline", () => {
  it("keeps a round outline whole and cuts a square at its corners", () => {
    const ring = Array.from({ length: 24 }, (_, i): V3 => [Math.cos((i * Math.PI) / 12), Math.sin((i * Math.PI) / 12), 0]);
    expect(splitOutline(ring)).toHaveLength(1);
    const square: V3[] = [
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
    ];
    expect(splitOutline(square)).toHaveLength(4);
  });
});
