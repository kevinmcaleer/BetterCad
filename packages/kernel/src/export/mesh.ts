/**
 * Mesh exports (#80): binary STL and 3MF, written from triangles the kernel made from the exact B-rep.
 * A body is a flat list of triangles, 9 numbers (three corners) each, in millimetres, Z up.
 */
import { unzip, zip } from "./zip";

export interface MeshBody {
  name: string;
  triangles: Float32Array;
}

/** Moves bodies together so the lowest point sits on Z = 0, the slicer's bed. */
export function placeOnBed(bodies: MeshBody[]): MeshBody[] {
  let low = Infinity;
  for (const b of bodies) for (let i = 2; i < b.triangles.length; i += 3) low = Math.min(low, b.triangles[i]!);
  if (!Number.isFinite(low) || low === 0) return bodies;
  return bodies.map((b) => {
    const t = b.triangles.slice();
    for (let i = 2; i < t.length; i += 3) t[i]! -= low;
    return { ...b, triangles: t };
  });
}

export const triangleCount = (bodies: MeshBody[]) => bodies.reduce((n, b) => n + b.triangles.length / 9, 0);

/** Size of a binary STL of `n` triangles. */
export const stlBytes = (n: number) => 84 + 50 * n;

/** Binary STL: an 80-byte header naming the model, the count, then a normal and three corners per triangle. */
export function writeStl(name: string, bodies: MeshBody[]): ArrayBuffer {
  const n = triangleCount(bodies);
  const buf = new ArrayBuffer(stlBytes(n));
  const v = new DataView(buf);
  const head = new TextEncoder().encode(`BetterCad ${name}`.slice(0, 80));
  new Uint8Array(buf, 0, 80).set(head.subarray(0, 80));
  v.setUint32(80, n, true);
  let at = 84;
  for (const b of bodies) {
    const t = b.triangles;
    for (let i = 0; i < t.length; i += 9) {
      const ux = t[i + 3]! - t[i]!,
        uy = t[i + 4]! - t[i + 1]!,
        uz = t[i + 5]! - t[i + 2]!;
      const wx = t[i + 6]! - t[i]!,
        wy = t[i + 7]! - t[i + 1]!,
        wz = t[i + 8]! - t[i + 2]!;
      let nx = uy * wz - uz * wy,
        ny = uz * wx - ux * wz,
        nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      v.setFloat32(at, nx, true);
      v.setFloat32(at + 4, ny, true);
      v.setFloat32(at + 8, nz, true);
      for (let k = 0; k < 9; k++) v.setFloat32(at + 12 + k * 4, t[i + k]!, true);
      v.setUint16(at + 48, 0, true);
      at += 50;
    }
  }
  return buf;
}

/** Reads a binary or ASCII STL back into triangles. */
export function readStl(data: ArrayBuffer): Float32Array {
  const v = new DataView(data);
  if (data.byteLength >= 84) {
    const n = v.getUint32(80, true);
    if (84 + 50 * n === data.byteLength) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = v.getFloat32(84 + i * 50 + 12 + k * 4, true);
      return out;
    }
  }
  const text = new TextDecoder().decode(data);
  if (!/^\s*solid/.test(text)) throw new Error("That is not an STL file.");
  const nums: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!nums.length || nums.length % 9 || nums.some((x) => !Number.isFinite(x))) throw new Error("That STL file is damaged.");
  return Float32Array.from(nums);
}

/** The volume a closed triangle mesh holds (divergence theorem), for checking an export against the B-rep. */
export function meshVolume(t: Float32Array): number {
  let v = 0;
  for (let i = 0; i < t.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [t[i]!, t[i + 1]!, t[i + 2]!, t[i + 3]!, t[i + 4]!, t[i + 5]!, t[i + 6]!, t[i + 7]!, t[i + 8]!];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Welds a triangle soup into shared vertices, as 3MF stores them. */
function indexed(t: Float32Array) {
  const map = new Map<string, number>();
  const verts: number[] = [];
  const tris: number[] = [];
  for (let i = 0; i < t.length; i += 3) {
    const k = `${t[i]},${t[i + 1]},${t[i + 2]}`;
    let n = map.get(k);
    if (n === undefined) {
      n = verts.length / 3;
      map.set(k, n);
      verts.push(t[i]!, t[i + 1]!, t[i + 2]!);
    }
    tris.push(n);
  }
  return { verts, tris };
}

const num = (x: number) => String(Math.round(x * 1e5) / 1e5);

/** 3MF: millimetres, the model's title, and one object per body (named) so a slicer shows the parts separately. */
export function write3mf(name: string, bodies: MeshBody[]): ArrayBuffer {
  const objects: string[] = [];
  const items: string[] = [];
  bodies.forEach((b, i) => {
    const id = i + 1;
    const { verts, tris } = indexed(b.triangles);
    const vs: string[] = [];
    for (let k = 0; k < verts.length; k += 3) vs.push(`<vertex x="${num(verts[k]!)}" y="${num(verts[k + 1]!)}" z="${num(verts[k + 2]!)}"/>`);
    const ts: string[] = [];
    for (let k = 0; k < tris.length; k += 3) ts.push(`<triangle v1="${tris[k]}" v2="${tris[k + 1]}" v3="${tris[k + 2]}"/>`);
    objects.push(
      `<object id="${id}" type="model" name="${xml(b.name)}"><mesh><vertices>${vs.join("")}</vertices><triangles>${ts.join("")}</triangles></mesh></object>`,
    );
    items.push(`<item objectid="${id}"/>`);
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-GB" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${xml(name)}</metadata>
<metadata name="Application">BetterCad</metadata>
<resources>${objects.join("\n")}</resources>
<build>${items.join("")}</build>
</model>
`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>
`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>
`;
  const enc = new TextEncoder();
  const z = zip([
    { name: "[Content_Types].xml", data: enc.encode(types) },
    { name: "_rels/.rels", data: enc.encode(rels) },
    { name: "3D/3dmodel.model", data: enc.encode(model) },
  ]);
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer;
}

/** Reads the meshes of a 3MF back (for tests, and to import a 3MF like an STL). */
export function read3mf(data: ArrayBuffer): MeshBody[] {
  const files = unzip(new Uint8Array(data));
  const model = [...files].find(([n]) => n.toLowerCase().endsWith(".model"));
  if (!model) throw new Error("That 3MF file has no model in it.");
  const text = new TextDecoder().decode(model[1]);
  const out: MeshBody[] = [];
  for (const m of text.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const name = /name="([^"]*)"/.exec(m[1]!)?.[1] ?? `Imported ${out.length + 1}`;
    const vs = [...m[2]!.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g)].map((v) => [Number(v[1]), Number(v[2]), Number(v[3])]);
    const tris: number[] = [];
    for (const t of m[2]!.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g)) for (const k of [t[1], t[2], t[3]]) tris.push(...vs[Number(k)]!);
    if (tris.length)
      out.push({
        name: name
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&"),
        triangles: Float32Array.from(tris),
      });
  }
  return out;
}
