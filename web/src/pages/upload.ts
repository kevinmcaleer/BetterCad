import { baseName, blobHash, importFormat, meshName, toBase64 } from "@bettercad/kernel";
import { read3mf, readStl, type MeshBody } from "@bettercad/kernel/mesh-files";
import { saveBcad } from "@bettercad/kernel/bcad";
import { addImport, newDoc, newId, type ModelDoc } from "../state/document";
import { stripBlobs } from "../cloud/cloudDoc";
import type { Api, ModelSummary, Place } from "../cloud/api";

/**
 * Uploads STL and 3MF files to My models: each file becomes a saved model of its own, in the folder or project on
 * show, holding one Import step, the same step the editor makes when a file is dropped on the view. The file's bytes
 * go up once, by hash, like any imported file; the picture follows from the path tracer once the models are saved.
 *
 * It loads when someone uploads, apart from the library page.
 */

/** The file kinds the library takes: meshes the app can read without the geometry engine. */
export const UPLOAD_ACCEPT = ".stl,.3mf";

export const canUpload = (name: string) => {
  const f = importFormat(name);
  return f === "stl" || f === "3mf";
};

export interface MeshModel {
  name: string;
  doc: ModelDoc;
  /** Each body's triangles, for the thumbnail. */
  meshes: Float32Array[];
}

/** A new model holding `file` as one Import step, or why it can't be. */
export function meshModel(file: string, bytes: Uint8Array): MeshModel {
  const format = importFormat(file);
  if (format !== "stl" && format !== "3mf") throw new Error(`${file} isn't an STL or 3MF file.`);
  const base = baseName(file);
  let meshes: MeshBody[];
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    meshes = format === "stl" ? [{ name: base, triangles: readStl(buffer) }] : read3mf(buffer);
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message || "that file couldn't be read."}`);
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
  return { name: base, doc, meshes: meshes.map((m) => m.triangles) };
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
export async function uploadModels(api: Api, files: File[], place: Place, say: (text: string) => void): Promise<UploadResult> {
  const made: ModelSummary[] = [];
  const failed: string[] = [];
  const pictures: { model: ModelSummary; meshes: Float32Array[] }[] = [];
  for (const [i, file] of files.entries()) {
    if (!canUpload(file.name)) {
      failed.push(`${file.name} isn't an STL or 3MF file.`);
      continue;
    }
    say(files.length > 1 ? `Uploading ${file.name} (${i + 1} of ${files.length})` : `Uploading ${file.name}`);
    try {
      const m = meshModel(file.name, new Uint8Array(await file.arrayBuffer()));
      const doc = await stripBlobs(api, m.doc);
      const model = await api.create(m.name, saveBcad(doc), `Uploaded ${file.name}`, place);
      made.push(model);
      pictures.push({ model, meshes: m.meshes });
    } catch (e) {
      failed.push((e as Error).message);
    }
  }
  if (pictures.length) void drawPictures(api, pictures);
  return { made, failed };
}

/** The path tracer's settings for thumbnails, or null to keep none (browser tests turn it on themselves). */
const thumbOptions = (): { samples?: number; timeout?: number } | null =>
  navigator.webdriver ? ((window as unknown as { __bcRenderThumbs?: { samples?: number; timeout?: number } }).__bcRenderThumbs ?? null) : {};

/** Renders each uploaded model's picture in turn and gives it to the server. A picture that fails leaves the cube. */
async function drawPictures(api: Api, list: { model: ModelSummary; meshes: Float32Array[] }[]): Promise<void> {
  const o = thumbOptions();
  if (!o) return;
  try {
    const t = await import("./uploadThumb");
    for (const { model, meshes } of list) {
      const url = await t.meshThumbnail(meshes, o).catch(() => null);
      if (url) await api.setThumbnail(model.id, model.version, url).catch(() => undefined);
      window.dispatchEvent(new Event(PICTURE_EVENT));
    }
  } catch {
    // No renderer: the models keep the cube.
  }
}

/** Fired on window as each uploaded model's picture arrives, so the library can show it. */
export const PICTURE_EVENT = "bc-upload-picture";
