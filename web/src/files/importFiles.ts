import { baseName, blobHash, importFormat, meshName, toBase64, type BodyMesh, type Call, type Methods } from "@bettercad/kernel";
import { read3mf, readStl, type MeshBody } from "@bettercad/kernel/mesh-files";
import { addImport, newId, setLook, type ModelDoc, type Vec3 } from "../state/document";
import { quickKey, quickMeshes } from "../viewport/quickMeshes";

/**
 * Brings STL, STEP and 3MF files into the open model (#82): the kernel reads each one, then an Import step keeps the
 * file's bytes in the document so the model rebuilds without it.
 *
 * Reading a big mesh takes a while, so the import says how far it has got, and an STL or 3MF goes on the timeline
 * and shows its own triangles straight away while the kernel sews it into a solid behind them.
 */
export interface ImportContext {
  call: <M extends keyof Methods>(method: M, params: Methods[M]["params"], onProgress?: (fraction: number) => void) => Call<Methods[M]["result"]> | null;
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string) => void;
  say: (text: string, bad?: boolean, asToast?: boolean) => void;
  select: (ids: string[]) => void;
  /** Bring the bodies in as reference bodies (#185): to design around, never printed. */
  reference?: boolean;
  /** How far the import has got, for the progress toast; null once it's done. */
  progress?: (p: ImportProgress | null) => void;
  /** Resolves once the kernel's mesh for every one of `ids` is on show, or the step failed or was taken away. */
  ready?: (feature: string, ids: string[]) => Promise<void>;
}

export interface ImportProgress {
  file: string;
  /** This file's place in the files being imported, from 1, and how many there are. */
  n: number;
  of: number;
  /** What it's doing now, as the toast says it. */
  stage: string;
  /** 0 to 1; none while the step has no way to say how far it has got. */
  fraction?: number;
}

/** Above this, a mesh still imports but slows the view. */
export const BIG_MESH = 500_000;

/** Where each stage sits on the progress bar: reading the bytes, then the kernel's read. */
const READ = 0.05;
const KERNEL = 0.95;

export async function importFiles(files: File[], at: Vec3 | undefined, ctx: ImportContext): Promise<void> {
  const made: string[] = [];
  const notes: string[] = [];
  let meshFiles = 0;
  try {
    for (const [i, file] of files.entries()) {
      const format = importFormat(file.name);
      if (!format) continue;
      const show = (stage: string, fraction?: number) => ctx.progress?.({ file: file.name, n: i + 1, of: files.length, stage, fraction });
      show("Reading the file", 0);
      const bytes = new Uint8Array(await file.arrayBuffer());
      show("Reading the file", READ);
      const data = toBase64(bytes);
      const blob = blobHash(bytes);
      const base = baseName(file.name);
      // An STL or 3MF is read here too, so it can show while the kernel works.
      let meshes: MeshBody[] | null = null;
      if (format !== "step") {
        try {
          meshes = format === "stl" ? [{ name: base, triangles: readStl(bytes.buffer) }] : read3mf(bytes.buffer);
        } catch {
          // The kernel reads it again and says what's wrong.
        }
        if (!meshes?.length || meshes.some((m) => !m.triangles.length)) meshes = null;
      }
      const stage = format === "step" ? "Reading the solids" : "Joining the triangles";
      const call = ctx.call("inspect", { name: file.name, format, blob, data }, (f) => show(stage, READ + (KERNEL - READ) * f));
      if (!call) return ctx.say("The geometry engine is off, so files can't be imported.", true);
      show(stage, READ);
      const feature = newId("f");
      // Several files dropped together stand side by side.
      const p = at ?? { x: 0, y: 0, z: 0 };
      const position = { x: p.x + i * 10, y: p.y, z: p.z };
      const add = (bodies: { id: string; name: string }[]) => {
        const ids = bodies.map((b) => b.id);
        ctx.record(
          (d, m) => {
            const added = addImport(d, { file: file.name, format, blob, data, bodies, position }, feature, m);
            return ctx.reference ? setLook(added, ids, () => ({ reference: true })) : added;
          },
          ctx.reference ? `Import ${file.name} as a reference` : `Import ${file.name}`,
        );
        return ids;
      };
      let ids: string[] | null = null;
      if (meshes) {
        // The kernel keeps the file's layout: the whole file stands with its bottom centre on the origin.
        const all = meshes.map((m) => m.triangles);
        meshes.forEach((m, k) => quickMeshes.set(quickKey(blob, k), quickMesh(m.triangles, all)));
        ids = add(meshes.map((m) => ({ id: newId(), name: meshName(format, m.name, base) })));
        ctx.select(ids);
      }
      try {
        let info;
        try {
          info = await call;
        } catch (e) {
          ctx.say(`${file.name}: ${(e as Error).message || "that file couldn't be read."}`, true);
          continue;
        }
        ids ??= add(info.bodies.map((b) => ({ id: newId(), name: b.name || base })));
        made.push(...ids);
        if (format === "stl" || format === "3mf") meshFiles++;
        if (info.bodies.some((b) => b.open)) notes.push(`${file.name} has holes in its mesh, so it can't be combined.`);
        const tris = info.bodies.reduce((n, b) => n + (b.triangles ?? 0), 0);
        if (tris > BIG_MESH) notes.push(`${file.name} has ${tris.toLocaleString("en-GB")} triangles and may slow the view.`);
        show(meshes ? "Getting it ready to edit" : "Drawing it");
        await ctx.ready?.(feature, ids);
      } finally {
        meshes?.forEach((_, k) => quickMeshes.delete(quickKey(blob, k)));
      }
    }
  } finally {
    ctx.progress?.(null);
  }
  if (!made.length) return;
  ctx.select(made);
  if (notes.length) return ctx.say(notes.join(" "));
  const what = `${made.length === 1 ? "1 body" : `${made.length} bodies`} from ${files.length === 1 ? files[0]!.name : `${files.length} files`}`;
  // A mesh's holes can be made editable (#446): say where to find it, once the import has nothing else to say.
  if (meshFiles && !ctx.reference) return ctx.say(`Imported ${what}. To change its holes, right-click it and choose Recognise features`);
  ctx.say(`Imported ${what}${ctx.reference ? " to design around" : ""}`, false, true);
}

/**
 * A file's own triangles as a mesh the view can draw, shifted as the kernel stands an import: the bottom centre of
 * `file` (every body's triangles; this body's alone when left out) on the origin. One face, flat-shaded, no edges: it's
 * only on show until the kernel's mesh is ready.
 */
export function quickMesh(t: Float32Array, file: Float32Array[] = [t]): BodyMesh {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const f of file)
    for (let i = 0; i < f.length; i++) {
      const k = i % 3;
      if (f[i]! < lo[k]!) lo[k] = f[i]!;
      if (f[i]! > hi[k]!) hi[k] = f[i]!;
    }
  const shift = [-(lo[0]! + hi[0]!) / 2, -(lo[1]! + hi[1]!) / 2, -lo[2]!];
  const positions = new Float32Array(t.length);
  const normals = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 9) {
    for (let k = 0; k < 9; k++) positions[i + k] = t[i + k]! + shift[k % 3]!;
    const ux = t[i + 3]! - t[i]!,
      uy = t[i + 4]! - t[i + 1]!,
      uz = t[i + 5]! - t[i + 2]!;
    const vx = t[i + 6]! - t[i]!,
      vy = t[i + 7]! - t[i + 1]!,
      vz = t[i + 8]! - t[i + 2]!;
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (let k = 0; k < 9; k += 3) {
      normals[i + k] = nx;
      normals[i + k + 1] = ny;
      normals[i + k + 2] = nz;
    }
  }
  const verts = t.length / 3;
  const indices = new Uint32Array(verts);
  for (let i = 0; i < verts; i++) indices[i] = i;
  return {
    positions,
    normals,
    indices,
    faceTris: Uint32Array.of(0, verts / 3),
    faceVerts: Uint32Array.of(0, verts),
    edgePositions: new Float32Array(0),
    edgeSegs: Uint32Array.of(0),
    vertices: new Float32Array(0),
  };
}
