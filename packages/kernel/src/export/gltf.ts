/**
 * glTF 2.0 and GLB export (#195), for Blender and web viewers. Written by hand from the kernel's triangles, so it
 * runs in the worker and adds nothing to the app's bundle.
 *
 * glTF is metres and Y up; BetterCad is millimetres and Z up. Points go from (x, y, z) mm to (x, z, -y) / 1000 m,
 * which Blender's importer turns back into Z up, so a model lands the right way up and the right size.
 */
import type { MeshBody } from "./mesh";

/** A body's surface in a render: linear base colour (0..1), roughness and metalness, as glTF's PBR material. */
export interface PbrLook {
  color: [number, number, number];
  roughness: number;
  metalness: number;
}

/** A body with its triangles, mm, Z up, 9 numbers each, and how it looks. */
export interface GltfBody extends MeshBody {
  look?: PbrLook;
}

/** Matte PLA in a light grey, for bodies without a look of their own. */
export const DEFAULT_LOOK: PbrLook = { color: [0.6, 0.6, 0.6], roughness: 0.9, metalness: 0 };

/** Faces meeting at more than this are drawn with a hard edge; below it the shading runs smooth across. */
const CREASE = Math.cos((30 * Math.PI) / 180);

interface Indexed {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * Shares corners between triangles and gives each corner a normal: the area-weighted mean of the triangles at
 * that point whose faces turn less than 30° from its own. Curves come out smooth and box edges stay sharp.
 */
export function indexMesh(t: Float32Array): Indexed {
  const n = t.length / 9;
  const fn = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const ux = t[o + 3]! - t[o]!,
      uy = t[o + 4]! - t[o + 1]!,
      uz = t[o + 5]! - t[o + 2]!;
    const wx = t[o + 6]! - t[o]!,
      wy = t[o + 7]! - t[o + 1]!,
      wz = t[o + 8]! - t[o + 2]!;
    // Twice the area, unnormalised: the length weights the mean.
    fn[i * 3] = uy * wz - uz * wy;
    fn[i * 3 + 1] = uz * wx - ux * wz;
    fn[i * 3 + 2] = ux * wy - uy * wx;
  }
  const unit = (i: number): [number, number, number] => {
    const x = fn[i * 3]!,
      y = fn[i * 3 + 1]!,
      z = fn[i * 3 + 2]!;
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  const key = (o: number) => `${Math.round(t[o]! * 1e4)},${Math.round(t[o + 1]! * 1e4)},${Math.round(t[o + 2]! * 1e4)}`;

  // The triangles at each point.
  const at = new Map<string, number[]>();
  const corner: string[] = new Array(n * 3);
  for (let c = 0; c < n * 3; c++) {
    const k = key(c * 3);
    corner[c] = k;
    let list = at.get(k);
    if (!list) at.set(k, (list = []));
    list.push(Math.floor(c / 3));
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const seen = new Map<string, number>();
  for (let c = 0; c < n * 3; c++) {
    const tri = Math.floor(c / 3);
    // A triangle with no area (two corners welded together, as at a sphere's poles) has no normal: leave it out.
    if (corner[tri * 3] === corner[tri * 3 + 1] || corner[tri * 3 + 1] === corner[tri * 3 + 2] || corner[tri * 3] === corner[tri * 3 + 2]) continue;
    if (!fn[tri * 3] && !fn[tri * 3 + 1] && !fn[tri * 3 + 2]) continue;
    const own = unit(tri);
    let sx = 0,
      sy = 0,
      sz = 0;
    for (const j of at.get(corner[c]!)!) {
      const u = unit(j);
      if (u[0] * own[0] + u[1] * own[1] + u[2] * own[2] < CREASE) continue;
      sx += fn[j * 3]!;
      sy += fn[j * 3 + 1]!;
      sz += fn[j * 3 + 2]!;
    }
    const l = Math.hypot(sx, sy, sz);
    const nx = l ? sx / l : own[0],
      ny = l ? sy / l : own[1],
      nz = l ? sz / l : own[2];
    const vk = `${corner[c]}|${Math.round(nx * 1e3)},${Math.round(ny * 1e3)},${Math.round(nz * 1e3)}`;
    let v = seen.get(vk);
    if (v === undefined) {
      v = positions.length / 3;
      seen.set(vk, v);
      const o = c * 3;
      positions.push(t[o]!, t[o + 1]!, t[o + 2]!);
      normals.push(nx, ny, nz);
    }
    indices.push(v);
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) };
}

/** Millimetres, Z up, to metres, Y up. */
function toGltf(positions: Float32Array, normals: Float32Array): void {
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1]!,
      z = positions[i + 2]!;
    positions[i] = positions[i]! / 1000;
    positions[i + 1] = z / 1000;
    positions[i + 2] = -y / 1000;
    const ny = normals[i + 1]!,
      nz = normals[i + 2]!;
    normals[i + 1] = nz;
    normals[i + 2] = -ny;
  }
}

const pad4 = (n: number) => (n + 3) & ~3;

/** The glTF JSON and its one binary buffer. */
function build(name: string, bodies: GltfBody[], uri?: string): { json: Record<string, unknown>; bin: Uint8Array } {
  const parts: Uint8Array[] = [];
  let length = 0;
  const views: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const add = (data: Float32Array | Uint32Array, target: number, extra: Record<string, unknown>) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength, target });
    parts.push(bytes);
    length += bytes.byteLength;
    const fill = pad4(length) - length;
    if (fill) {
      parts.push(new Uint8Array(fill));
      length += fill;
    }
    accessors.push({ bufferView: views.length - 1, ...extra });
    return accessors.length - 1;
  };

  const meshes: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  for (const b of bodies) {
    const m = indexMesh(b.triangles);
    toGltf(m.positions, m.normals);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, m.positions[i]!);
      max[i % 3] = Math.max(max[i % 3]!, m.positions[i]!);
    }
    const count = m.positions.length / 3;
    if (!count) continue;
    const position = add(m.positions, 34962, { componentType: 5126, count, type: "VEC3", min, max });
    const normal = add(m.normals, 34962, { componentType: 5126, count, type: "VEC3" });
    const index = add(m.indices, 34963, { componentType: 5125, count: m.indices.length, type: "SCALAR" });
    const look = b.look ?? DEFAULT_LOOK;
    materials.push({
      name: b.name,
      pbrMetallicRoughness: { baseColorFactor: [...look.color, 1], roughnessFactor: look.roughness, metallicFactor: look.metalness },
    });
    meshes.push({ name: b.name, primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices: index, material: materials.length - 1 }] });
    nodes.push({ name: b.name, mesh: meshes.length - 1 });
  }
  const children = nodes.map((_, i) => i);
  nodes.push({ name, children });

  const bin = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    bin.set(p, at);
    at += p.byteLength;
  }
  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: "BetterCad" },
    scene: 0,
    scenes: [{ name, nodes: [nodes.length - 1] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: length, ...(uri ? { uri } : {}) }],
  };
  return { json, bin };
}

/** Binary glTF: one file, the JSON and the buffer in two chunks. */
export function writeGlb(name: string, bodies: GltfBody[]): ArrayBuffer {
  const { json, bin } = build(name, bodies);
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(text.byteLength);
  const binLen = pad4(bin.byteLength);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new ArrayBuffer(total);
  const v = new DataView(out);
  const u = new Uint8Array(out);
  v.setUint32(0, 0x46546c67, true); // "glTF"
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonLen, true);
  v.setUint32(16, 0x4e4f534a, true); // "JSON"
  u.set(text, 20);
  u.fill(0x20, 20 + text.byteLength, 20 + jsonLen);
  v.setUint32(20 + jsonLen, binLen, true);
  v.setUint32(24 + jsonLen, 0x004e4942, true); // "BIN"
  u.set(bin, 28 + jsonLen);
  return out;
}

/** glTF as two files: the JSON, and the buffer beside it as `<bin>`. */
export function writeGltf(name: string, bodies: GltfBody[], bin: string): { gltf: ArrayBuffer; bin: ArrayBuffer } {
  const r = build(name, bodies, encodeURIComponent(bin));
  const text = new TextEncoder().encode(JSON.stringify(r.json, null, 1));
  return { gltf: text.buffer.slice(text.byteOffset, text.byteOffset + text.byteLength) as ArrayBuffer, bin: r.bin.buffer as ArrayBuffer };
}

/** Reads a GLB back: its JSON and buffer. For tests and for checking a file. */
export function readGlb(data: ArrayBuffer): { json: GltfJson; bin: DataView } {
  const v = new DataView(data);
  if (v.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file.");
  const jsonLen = v.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, jsonLen))) as GltfJson;
  const binLen = v.getUint32(20 + jsonLen, true);
  return { json, bin: new DataView(data, 28 + jsonLen, binLen) };
}

/** The parts of the glTF JSON the tests read. */
export interface GltfJson {
  asset: { version: string };
  scenes: { nodes: number[] }[];
  nodes: { name: string; mesh?: number; children?: number[] }[];
  meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: { name: string; pbrMetallicRoughness: { baseColorFactor: number[]; roughnessFactor: number; metallicFactor: number } }[];
  accessors: { bufferView: number; count: number; min?: number[]; max?: number[] }[];
  bufferViews: { byteOffset: number; byteLength: number }[];
  buffers: { byteLength: number; uri?: string }[];
}

/** About how big a glTF of `n` triangles is: shared corners (about 0.7 per triangle) with normals, and the indices. */
export const gltfBytes = (n: number) => Math.round(n * (12 + 0.7 * 24) + 2000);
