import { baseName, blobHash, importFormat, toBase64, type Call, type Methods } from "@bettercad/kernel";
import { addImport, newId, setLook, type ModelDoc, type Vec3 } from "../state/document";

/**
 * Brings STL, STEP and 3MF files into the open model (#82): the kernel reads each one, then an Import step keeps the
 * file's bytes in the document so the model rebuilds without it.
 */
export interface ImportContext {
  call: <M extends keyof Methods>(method: M, params: Methods[M]["params"]) => Call<Methods[M]["result"]> | null;
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string) => void;
  say: (text: string, bad?: boolean) => void;
  select: (ids: string[]) => void;
  /** Bring the bodies in as reference bodies (#185): to design around, never printed. */
  reference?: boolean;
}

/** Above this, a mesh still imports but slows the view. */
export const BIG_MESH = 500_000;

export async function importFiles(files: File[], at: Vec3 | undefined, ctx: ImportContext): Promise<void> {
  const made: string[] = [];
  const notes: string[] = [];
  for (const [i, file] of files.entries()) {
    const format = importFormat(file.name);
    if (!format) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const data = toBase64(bytes);
    const blob = blobHash(bytes);
    const call = ctx.call("inspect", { name: file.name, format, blob, data });
    if (!call) return ctx.say("The geometry engine is off, so files can't be imported.", true);
    let info;
    try {
      info = await call;
    } catch (e) {
      ctx.say(`${file.name}: ${(e as Error).message || "that file couldn't be read."}`, true);
      continue;
    }
    const bodies = info.bodies.map((b) => ({ id: newId(), name: b.name || baseName(file.name) }));
    // Several files dropped together stand side by side.
    const p = at ?? { x: 0, y: 0, z: 0 };
    const position = { x: p.x + i * 10, y: p.y, z: p.z };
    const ids = bodies.map((b) => b.id);
    ctx.record(
      (d, m) => {
        const added = addImport(d, { file: file.name, format, blob, data, bodies, position }, newId("f"), m);
        return ctx.reference ? setLook(added, ids, () => ({ reference: true })) : added;
      },
      ctx.reference ? `Import ${file.name} as a reference` : `Import ${file.name}`,
    );
    made.push(...bodies.map((b) => b.id));
    if (info.bodies.some((b) => b.open)) notes.push(`${file.name} has holes in its mesh, so it can't be combined.`);
    const tris = info.bodies.reduce((n, b) => n + (b.triangles ?? 0), 0);
    if (tris > BIG_MESH) notes.push(`${file.name} has ${tris.toLocaleString("en-GB")} triangles and may slow the view.`);
  }
  if (!made.length) return;
  ctx.select(made);
  ctx.say(
    notes.length
      ? notes.join(" ")
      : `Imported ${made.length === 1 ? "1 body" : `${made.length} bodies`} from ${files.length === 1 ? files[0]!.name : `${files.length} files`}${ctx.reference ? " to design around" : ""}`,
  );
}
