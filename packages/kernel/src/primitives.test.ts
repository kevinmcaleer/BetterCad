import { describe, expect, it } from "vitest";
import { boxMesh, cylinderMesh, sphereMesh } from "./primitives";
import { edgeCount, faceCount, meshBounds, meshVolume, vertexCount } from "./mesh";

describe("primitive meshes", () => {
  it("a box has 6 faces, 12 edges, 8 vertices and the right volume", () => {
    const m = boxMesh({ x: 20, y: 10, z: 5 });
    expect(faceCount(m)).toBe(6);
    expect(edgeCount(m)).toBe(12);
    expect(vertexCount(m)).toBe(8);
    expect(meshVolume(m)).toBeCloseTo(1000, 6);
    expect(meshBounds(m)).toEqual({ min: [-10, -5, 0], max: [10, 5, 5] });
  });

  it("a cylinder has side, top and bottom faces and two rims", () => {
    const m = cylinderMesh({ x: 20, y: 20, z: 30 });
    expect(faceCount(m)).toBe(3);
    expect(edgeCount(m)).toBe(2);
    expect(vertexCount(m)).toBe(0);
    // A 96-gon prism is within 0.1% of the true cylinder.
    expect(meshVolume(m) / (Math.PI * 100 * 30)).toBeCloseTo(1, 2);
  });

  it("a sphere rests on z = 0 with one face", () => {
    const m = sphereMesh({ x: 20, y: 20, z: 20 });
    expect(faceCount(m)).toBe(1);
    const b = meshBounds(m);
    expect(b.min[2]).toBeCloseTo(0);
    expect(b.max[2]).toBeCloseTo(20);
    expect(meshVolume(m) / ((4 / 3) * Math.PI * 1000)).toBeCloseTo(1, 2);
  });

  it("faces own contiguous vertices and every triangle stays inside its face", () => {
    for (const m of [boxMesh({ x: 1, y: 2, z: 3 }), cylinderMesh({ x: 4, y: 4, z: 4 }, "draft")]) {
      for (let f = 0; f < faceCount(m); f++) {
        for (let t = m.faceTris[f]!; t < m.faceTris[f + 1]!; t++) {
          for (let k = 0; k < 3; k++) {
            const v = m.indices[t * 3 + k]!;
            expect(v).toBeGreaterThanOrEqual(m.faceVerts[f]!);
            expect(v).toBeLessThan(m.faceVerts[f + 1]!);
          }
        }
      }
    }
  });
});
