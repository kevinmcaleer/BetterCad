import { describe, expect, it } from "vitest";
import type { V3 } from "./camera";
import { edgesOnOutline } from "./faceEdges";

describe("edges on a face's outline", () => {
  // The front of a 40 × 20 box (y = 0), with a square hole's outline, and edges on the faces round it.
  const rect = (x0: number, z0: number, x1: number, z1: number): V3[] => [
    [x0, 0, z0],
    [x1, 0, z0],
    [x1, 0, z1],
    [x0, 0, z1],
  ];
  const loop = (pts: V3[]): [V3, V3][] => pts.map((p, i) => [p, pts[(i + 1) % pts.length]!]);
  const outer = rect(0, 0, 40, 20);
  const hole = rect(18, 8, 22, 12);
  // Triangle edges split the long bottom edge in two, as a mesh does.
  const outline: [V3, V3][] = [
    [
      [0, 0, 0],
      [20, 0, 0],
    ],
    [
      [20, 0, 0],
      [40, 0, 0],
    ],
    ...loop(outer).slice(1),
    ...loop(hole),
  ];

  it("keeps the edges that run round the face and drops the ones that only touch it", () => {
    const edges: V3[][] = [
      [outer[0]!, outer[1]!],
      [outer[1]!, outer[2]!],
      [outer[2]!, outer[3]!],
      [outer[3]!, outer[0]!],
      // A side edge, running back from a corner.
      [outer[0]!, [0, 10, 0]],
      [hole[0]!, hole[1]!, hole[2]!, hole[3]!, hole[0]!],
    ];
    const r = edgesOnOutline(edges, outline);
    expect(r.edges).toEqual([0, 1, 2, 3, 5]);
    expect(r.rest).toEqual([]);
  });

  it("returns what no edge covers", () => {
    const r = edgesOnOutline([[outer[0]!, outer[1]!]], outline);
    expect(r.edges).toEqual([0]);
    expect(r.rest).toHaveLength(3 + 4);
  });
});
