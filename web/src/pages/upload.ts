import { baseName, blobHash, importFormat, isBcad, meshName, toBase64, type Methods } from "@bettercad/kernel";
import { read3mf, readStl, type MeshBody } from "@bettercad/kernel/mesh-files";
import { loadBcad, saveBcad } from "@bettercad/kernel/bcad";
import { addImport, newDoc, newId, type ModelDoc } from "../state/document";
import { stripBlobs } from "../cloud/cloudDoc";
import type { Api, ModelSummary, Place } from "../cloud/api";

/**
 * Uploads files to My models: each file becomes a saved model of its own, in the folder or project on show. A .bcad
 * goes in as it is; an STL, 3MF or STEP file becomes a model holding one Import step, the same step the editor makes
 * when a file is dropped on the view. Imported bytes go up once, by hash, like any imported file; the picture follows
 * from the path tracer once the models are saved.
 *
 * STL and 3MF are read here. A STEP file needs the geometry engine to find its bodies, so the engine starts in the
 * background for the first one. All of it loads when someone uploads, apart from the library page.
 */

/** The file kinds the library takes. */
export const UPLOAD_ACCEPT = ".bcad,.stl,.3mf,.step,.stp";

export const canUpload = (name: string) => isBcad(name) || importFormat(name) !== null;

/** The geometry engine's calls the upload needs: reading a STEP file's bodies, and building a model for its picture. */
export type Engine = <M extends "inspect" | "build">(method: M, params: Methods[M]["params"]) => Promise<Methods[M]["result"]>;

/** The engine this tab uses, started on first call. */
const browserEngine: Engine = async (method, params) => {
  const { kernel } = await import("@bettercad/kernel/browser");
  return kernel().call(method, params);
};

/** How an uploaded model gets its picture: its own, its triangles as they are, or built by the engine. */
export type Picture = { meshes: Float32Array[] } | { doc: ModelDoc } | null;

export interface Prepared {
  name: string;
  doc: ModelDoc;
  /** The picture a .bcad brings with it. */
  thumbnail?: string;
  picture: Picture;
}

const readError = (file: string, e: unknown) => new Error(`${file}: ${(e as Error).message || "that file couldn't be read."}`);

/** A new model holding an STL or 3MF `file` as one Import step, or why it can't be. */
export function meshModel(file: string, bytes: Uint8Array): Prepared & { picture: { meshes: Float32Array[] } } {
  const format = importFormat(file);
  if (format !== "stl" && format !== "3mf") throw new Error(`${file} isn't an STL or 3MF file.`);
  const base = baseName(file);
  let meshes: MeshBody[];
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    meshes = format === "stl" ? [{ name: base, triangles: readStl(buffer) }] : read3mf(buffer);
  } catch (e) {
    throw readError(file, e);
  }
  meshes = meshes.filter((m) => m.triangles.length);
  if (!meshes.length) throw new Error(`${file} has no triangles in it.`);
  const doc = addImport(newDoc(base), {
    file,
    format,
    blob: blobHash(bytes),
    data: toBase64(bytes),
    bodies: meshes.map((m) => ({ id: newId(), name: meshName(format, m.name, base) })),
    position: { x: 0, y: 0, z: 0 },
  });
  return { name: base, doc, picture: { meshes: meshes.map((m) => m.triangles) } };
}

/** A new model holding a STEP `file` as one Import step: the engine reads it to find its bodies. */
export async function stepModel(file: string, bytes: Uint8Array, engine: Engine): Promise<Prepared> {
  const base = baseName(file);
  const blob = blobHash(bytes);
  const data = toBase64(bytes);
  let info;
  try {
    info = await engine("inspect", { name: file, format: "step", blob, data });
  } catch (e) {
    throw readError(file, e);
  }
  if (!info.bodies.length) throw new Error(`${file} has no solids in it.`);
  const doc = addImport(newDoc(base), {
    file,
    format: "step",
    blob,
    data,
    bodies: info.bodies.map((b) => ({ id: newId(), name: b.name || base })),
    position: { x: 0, y: 0, z: 0 },
  });
  return { name: base, doc, picture: { doc } };
}

/** A .bcad as it is, named as it was saved; a picture is built only when it has none. */
export function bcadModel(file: string, text: string): Prepared {
  const loaded = loadBcad(text);
  if (loaded instanceof Error) throw new Error(`${file}: ${loaded.message}`);
  const name = loaded.meta.name || loaded.doc.name || baseName(file);
  const thumbnail = loaded.meta.thumbnail;
  return { name, doc: loaded.doc, thumbnail, picture: thumbnail ? null : { doc: loaded.doc } };
}

async function prepare(file: File, engine: Engine): Promise<Prepared> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isBcad(file.name)) return bcadModel(file.name, new TextDecoder().decode(bytes));
  if (importFormat(file.name) === "step") return stepModel(file.name, bytes, engine);
  return meshModel(file.name, bytes);
}

export interface UploadResult {
  made: ModelSummary[];
  /** One line for each file that didn't go up. */
  failed: string[];
}

/**
 * Saves each file as a model in `place`, one after another. `say` hears how far it has got. Files the library can't
 * take are skipped and named in `failed`.
 */
export async function uploadModels(api: Api, files: File[], place: Place, say: (text: string) => void, engine: Engine = browserEngine): Promise<UploadResult> {
  const made: ModelSummary[] = [];
  const failed: string[] = [];
  const pictures: { model: ModelSummary; picture: NonNullable<Picture> }[] = [];
  for (const [i, file] of files.entries()) {
    if (!canUpload(file.name)) {
      failed.push(`${file.name} isn't a BetterCad, STL, 3MF or STEP file.`);
      continue;
    }
    say(files.length > 1 ? `Uploading ${file.name} (${i + 1} of ${files.length})` : `Uploading ${file.name}`);
    try {
      const m = await prepare(file, engine);
      const doc = await stripBlobs(api, m.doc);
      const model = await api.create(m.name, saveBcad(doc, { thumbnail: m.thumbnail }), `Uploaded ${file.name}`, place);
      made.push(model);
      if (m.picture) pictures.push({ model, picture: m.picture });
    } catch (e) {
      failed.push((e as Error).message);
    }
  }
  if (pictures.length) void drawPictures(api, pictures, engine);
  return { made, failed };
}

/** The path tracer's settings for thumbnails, or null to keep none (browser tests turn it on themselves). */
const thumbOptions = (): { samples?: number; timeout?: number } | null =>
  navigator.webdriver ? ((window as unknown as { __bcRenderThumbs?: { samples?: number; timeout?: number } }).__bcRenderThumbs ?? null) : {};

/** Renders each uploaded model's picture in turn and gives it to the server. A picture that fails leaves the cube. */
async function drawPictures(api: Api, list: { model: ModelSummary; picture: NonNullable<Picture> }[], engine: Engine): Promise<void> {
  const o = thumbOptions();
  if (!o) return;
  try {
    const t = await import("./uploadThumb");
    for (const { model, picture } of list) {
      const url = await ("meshes" in picture ? t.meshThumbnail(picture.meshes, o) : t.docThumbnail(picture.doc, engine, o)).catch(() => null);
      if (url) await api.setThumbnail(model.id, model.version, url).catch(() => undefined);
      window.dispatchEvent(new Event(PICTURE_EVENT));
    }
  } catch {
    // No renderer: the models keep the cube.
  }
}

/** Fired on window as each uploaded model's picture arrives, so the library can show it. */
export const PICTURE_EVENT = "bc-upload-picture";
