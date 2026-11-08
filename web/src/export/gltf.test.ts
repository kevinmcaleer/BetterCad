import { describe, expect, it } from "vitest";
import { Box3, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { writeGlb } from "@bettercad/kernel/gltf";

/** A 10 × 20 × 30 mm block, Z up, as two triangles per side. */
function block(): Float32Array {
  const [a, b, c] = [10, 20, 30];
  const v = (x: number, y: number, z: number) => [x * a, y * b, z * c];
  const q = (p: number[], r: number[], s: number[], t: number[]) => [...p, ...r, ...s, ...p, ...s, ...t];
  return Float32Array.from([
    ...q(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)),
    ...q(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
    ...q(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)),
    ...q(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)),
    ...q(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)),
    ...q(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)),
  ]);
}

describe("GLB export read by three's GLTFLoader (#195)", () => {
  it("loads with the body's name, its PBR look, in metres and Y up", async () => {
    const data = writeGlb("Block", [{ name: "Body", triangles: block(), look: { color: [0.2, 0.4, 0.8], roughness: 0.4, metalness: 0.7 } }]);
    const gltf = await new GLTFLoader().parseAsync(data, "");
    const names: string[] = [];
    gltf.scene.traverse((o: Object3D) => names.push(o.name));
    expect(names).toContain("Block");
    const body = gltf.scene.getObjectByName("Body") as Mesh;
    expect(body).toBeInstanceOf(Mesh);
    const mat = body.material as MeshStandardMaterial;
    expect(mat.roughness).toBeCloseTo(0.4);
    expect(mat.metalness).toBeCloseTo(0.7);
    // 30 mm tall along Z is 0.03 m along Y; 20 mm deep along Y is 0.02 m along -Z.
    const size = new Box3().setFromObject(gltf.scene).getSize(body.position.clone());
    expect(size.x).toBeCloseTo(0.01, 6);
    expect(size.y).toBeCloseTo(0.03, 6);
    expect(size.z).toBeCloseTo(0.02, 6);
  });
});
