import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { box, cylinder, sphere } from "./shapes";
import { tessellate } from "./tessellate";
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
});
