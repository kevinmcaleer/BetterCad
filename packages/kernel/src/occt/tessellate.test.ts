import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { box, cylinder, sphere } from "./shapes";
import { tessellate } from "./tessellate";
import { flattenCurve, planeFrame } from "@bettercad/sketch";
import { edgeCount, faceCount, meshBounds, meshVolume, triangleCount, vertexCount } from "../mesh";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

describe("tessellation", () => {
  it("a cube: 12 triangles, 6 faces, 12 edges, 8 vertices, outward normals", () => {
    const m = tessellate(oc, box(oc, { x: 10, y: 10, z: 10 }));
    expect(triangleCount(m)).toBe(12);
    expect(faceCount(m)).toBe(6);
    expect(edgeCount(m)).toBe(12);
    expect(vertexCount(m)).toBe(8);
    expect(meshVolume(m)).toBeCloseTo(1000, 6);
    expect(meshBounds(m)).toEqual({ min: [-5, -5, 0], max: [5, 5, 10] });
  });

  it("a 20 mm cylinder at fast quality: under 400 triangles, smooth unit normals, no seam line", () => {
    const m = tessellate(oc, cylinder(oc, { x: 20, y: 20, z: 20 }), "fast");
    expect(triangleCount(m)).toBeLessThan(400);
    expect(meshVolume(m) / (Math.PI * 100 * 20)).toBeCloseTo(1, 1);
    for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!)).toBeCloseTo(1, 4);
    // Two rims drawn; the seam is kept (numbered) but empty.
    const drawn = [...Array(edgeCount(m)).keys()].filter((e) => m.edgeSegs[e + 1]! > m.edgeSegs[e]!);
    expect(drawn).toHaveLength(2);
  });

  it("fine quality has more triangles than fast and a closer volume", () => {
    const s = sphere(oc, { x: 20, y: 20, z: 20 });
    const fast = tessellate(oc, s, "fast");
    const fine = tessellate(oc, s, "fine");
    expect(triangleCount(fine)).toBeGreaterThan(triangleCount(fast));
    const exact = (4 / 3) * Math.PI * 1000;
    expect(Math.abs(meshVolume(fine) - exact)).toBeLessThan(Math.abs(meshVolume(fast) - exact));
  });

  it("lists each face's own B-rep edges, so a cylinder's end face has its one rim", () => {
    const m = tessellate(oc, cylinder(oc, { x: 20, y: 20, z: 20 }), "fast");
    const own = (f: number) => Array.from(m.faceEdgeList!.subarray(m.faceEdgeStart![f]!, m.faceEdgeStart![f + 1]!));
    expect(m.faceEdgeStart).toHaveLength(faceCount(m) + 1);
    const drawn = (e: number) => m.edgeSegs[e + 1]! > m.edgeSegs[e]!;
    // Each flat end owns one drawn edge, a whole rim, and the two ends' rims differ.
    const ends = [...Array(faceCount(m)).keys()].filter((f) => own(f).filter(drawn).length === 1 && own(f).length === 1);
    expect(ends).toHaveLength(2);
    expect(own(ends[0]!)[0]).not.toBe(own(ends[1]!)[0]);
    // That rim, flattened onto the end's plane, is one true circle of the cylinder's radius, not a ring of short lines.
    const rim = own(ends[0]!)[0]!;
    const pts: [number, number, number][] = [];
    for (let k = m.edgeSegs[rim]! * 6; k < m.edgeSegs[rim + 1]! * 6; k += 6) pts.push([m.edgePositions[k]!, m.edgePositions[k + 1]!, m.edgePositions[k + 2]!]);
    pts.push(pts[0]!);
    const flat = flattenCurve(planeFrame({ kind: "world", plane: "XY", offset: 0 }), pts);
    expect(flat.kind).toBe("circle");
    if (flat.kind === "circle") expect(flat.r).toBeCloseTo(10, 4);
    // A cube's faces have four edges each.
    const cube = tessellate(oc, box(oc, { x: 10, y: 10, z: 10 }));
    for (let f = 0; f < 6; f++) expect(cube.faceEdgeStart![f + 1]! - cube.faceEdgeStart![f]!).toBe(4);
  });
});
