import { describe, expect, it } from "vitest";
import { indexMesh, readGlb, writeGlb, writeGltf, DEFAULT_LOOK, type GltfBody } from "./gltf";

/** A 10 mm cube from (0, 0, 0), 12 triangles wound outward, Z up. */
function cube(s = 10): Float32Array {
  const v = (x: number, y: number, z: number) => [x * s, y * s, z * s];
  const q = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
  return Float32Array.from([
    ...q(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)), // bottom, -Z
    ...q(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)), // top, +Z
    ...q(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)), // front, -Y
    ...q(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)), // back, +Y
    ...q(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)), // left, -X
    ...q(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)), // right, +X
  ]);
}

const floats = (bin: DataView, json: ReturnType<typeof readGlb>["json"], accessor: number) => {
  const a = json.accessors[accessor]!;
  const view = json.bufferViews[a.bufferView]!;
  return new Float32Array(bin.buffer.slice(bin.byteOffset + view.byteOffset, bin.byteOffset + view.byteOffset + view.byteLength));
};

describe("glTF export (#195)", () => {
  it("keeps a box's edges sharp: 24 corners, one normal per face", () => {
    const m = indexMesh(cube());
    expect(m.indices.length).toBe(36);
    expect(m.positions.length / 3).toBe(24);
  });

  it("writes a GLB in metres with Y up, a node and a material per body under the model's node", () => {
    const red = { color: [1, 0, 0] as [number, number, number], roughness: 0.3, metalness: 0.1 };
    const bodies: GltfBody[] = [
      { name: "Base", triangles: cube() },
      { name: "Lid", triangles: cube(5), look: red },
    ];
    const { json, bin } = readGlb(writeGlb("Box", bodies));
    expect(json.asset.version).toBe("2.0");
    const root = json.nodes[json.scenes[0]!.nodes[0]!]!;
    expect(root.name).toBe("Box");
    expect(root.children!.map((i) => json.nodes[i]!.name)).toEqual(["Base", "Lid"]);

    // 10 mm along Z becomes 0.01 m along Y; 10 mm along Y becomes -0.01 m along Z.
    const pos = json.accessors[json.meshes[0]!.primitives[0]!.attributes.POSITION!]!;
    const r = (a: number[]) => a.map((x) => Math.round(x * 1e6) / 1e6 + 0);
    expect(r(pos.min!)).toEqual([0, 0, -0.01]);
    expect(r(pos.max!)).toEqual([0.01, 0.01, 0]);

    // The top face's normal points up the glTF Y axis.
    const p = floats(bin, json, json.meshes[0]!.primitives[0]!.attributes.POSITION!);
    const n = floats(bin, json, json.meshes[0]!.primitives[0]!.attributes.NORMAL!);
    let tops = 0;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 1]! - 0.01) < 1e-9 && n[i + 1]! > 0.99) tops++;
    expect(tops).toBe(4);

    expect(json.materials.map((m) => m.name)).toEqual(["Base", "Lid"]);
    expect(json.materials[0]!.pbrMetallicRoughness).toEqual({
      baseColorFactor: [...DEFAULT_LOOK.color, 1],
      roughnessFactor: DEFAULT_LOOK.roughness,
      metallicFactor: DEFAULT_LOOK.metalness,
    });
    expect(json.materials[1]!.pbrMetallicRoughness).toEqual({ baseColorFactor: [1, 0, 0, 1], roughnessFactor: 0.3, metallicFactor: 0.1 });
  });

  it("writes glTF as JSON that names its .bin, with the same buffer", () => {
    const out = writeGltf("Box", [{ name: "Base", triangles: cube() }], "Box.bin");
    const json = JSON.parse(new TextDecoder().decode(out.gltf)) as { buffers: { uri: string; byteLength: number }[] };
    expect(json.buffers).toEqual([{ uri: "Box.bin", byteLength: out.bin.byteLength }]);
    expect(out.bin.byteLength % 4).toBe(0);
  });
});
