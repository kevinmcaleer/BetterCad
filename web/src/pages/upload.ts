import { baseName, blobHash, importFormat, isBcad, meshName, toBase64, type Methods } from "@bettercad/kernel";
import { read3mf, readStl, type MeshBody } from "@bettercad/kernel/mesh-files";
import { loadBcad, saveBcad } from "@bettercad/kernel/bcad";
import { addImport, newDoc, newId, type ModelDoc } from "../state/document";
import { stripBlobs } from "../cloud/cloudDoc";
import { ApiError, type Api, type ModelSummary, type Place } from "../cloud/api";

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

/** How far the engine has got: still starting (downloading and compiling), or working on the call, 0 to 1. */
export type EngineProgress = (phase: "starting" | "working", fraction: number) => void;

/** The geometry engine's calls the upload needs: reading a STEP file's bodies, and building a model for its picture. */
export type Engine = <M extends "inspect" | "build">(method: M, params: Methods[M]["params"], progress?: EngineProgress) => Promise<Methods[M]["result"]>;

/** The engine this tab uses, started on first call. Its download is most of the wait the first time, so it says how far that has got. */
const browserEngine: Engine = async (method, params, progress) => {
  progress?.("starting", 0);
  const { kernel } = await import("@bettercad/kernel/browser");
  const k = kernel();
  const stop = progress ? k.subscribe((s) => s.status === "loading" && progress("starting", s.fraction)) : undefined;
  try {
    return await k.call(method, params, progress && ((f) => progress("working", f)));
  } finally {
    stop?.();
  }
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
export async function stepModel(file: string, bytes: Uint8Array, engine: Engine, progress?: EngineProgress): Promise<Prepared> {
  const base = baseName(file);
  const blob = blobHash(bytes);
  const data = toBase64(bytes);
  let info;
  try {
    info = await engine("inspect", { name: file, format: "step", blob, data }, progress);
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

/** One file's line on the upload card: waiting its turn, on its way (what it's doing, and how far), saved, or why it failed. */
export interface UploadRow {
  file: string;
  state: "waiting" | "working" | "done" | "failed";
  /** What it's doing now; once saved, the model's name; once failed, why. */
  stage: string;
  /** 0 to 1 while it works. */
  fraction?: number;
}

/** Where each stage sits on a file's bar. A STEP file spends most of its time in the engine; a mesh goes straight up. */
const BAR = { read: 0.05, engineStart: 0.05, engineWork: 0.4, upload: 0.8, save: 0.93 } as const;

/** Why a save to the account failed, in words: a proxy's bare refusal says its status, so the cause can be found. */
function saveError(e: unknown): string {
  if (e instanceof ApiError && e.noAnswer?.why === "no-server" && e.noAnswer.http >= 400 && e.noAnswer.http !== 404) {
    return `The server turned the file away (HTTP ${e.noAnswer.http}). Try again, or report a problem if it keeps happening.`;
  }
  return (e as Error)?.message || "That didn't work.";
}

async function prepare(file: File, engine: Engine, stage: (text: string, fraction: number) => void): Promise<Prepared> {
  stage("Reading the file", 0);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isBcad(file.name)) return bcadModel(file.name, new TextDecoder().decode(bytes));
  if (importFormat(file.name) === "step") {
    return stepModel(file.name, bytes, engine, (phase, f) =>
      phase === "starting"
        ? stage("Starting the geometry engine", BAR.engineStart + (BAR.engineWork - BAR.engineStart) * f)
        : stage("Finding the solids", BAR.engineWork + (BAR.upload - BAR.engineWork) * f),
    );
  }
  return meshModel(file.name, bytes);
}

export interface UploadResult {
  made: ModelSummary[];
  /** One line for each file that didn't go up. */
  failed: string[];
}

/**
 * Saves each file as a model in `place`, one after another. `report` hears every file's line each time one changes,
 * for the upload card. Files the library can't take are failed at once, with the reason.
 */
export async function uploadModels(
  api: Api,
  files: File[],
  place: Place,
  report: (rows: UploadRow[]) => void,
  engine: Engine = browserEngine,
): Promise<UploadResult> {
  const made: ModelSummary[] = [];
  const failed: string[] = [];
  const pictures: { model: ModelSummary; picture: NonNullable<Picture> }[] = [];
  const rows: UploadRow[] = files.map((f) =>
    canUpload(f.name)
      ? { file: f.name, state: "waiting", stage: "Waiting" }
      : { file: f.name, state: "failed", stage: "BetterCad takes .bcad, STL, 3MF and STEP files." },
  );
  const set = (i: number, row: Partial<UploadRow>) => {
    rows[i] = { ...rows[i]!, ...row };
    report(rows.map((r) => ({ ...r })));
  };
  report(rows.map((r) => ({ ...r })));
  for (const [i, file] of files.entries()) {
    if (rows[i]!.state === "failed") {
      failed.push(`${file.name} isn't a BetterCad, STL, 3MF or STEP file.`);
      continue;
    }
    const stage = (text: string, fraction: number) => set(i, { state: "working", stage: text, fraction });
    try {
      const m = await prepare(file, engine, stage);
      stage("Uploading the file", BAR.upload);
      let model: ModelSummary;
      try {
        const doc = await stripBlobs(api, m.doc);
        stage("Saving the model", BAR.save);
        model = await api.create(m.name, saveBcad(doc, { thumbnail: m.thumbnail }), `Uploaded ${file.name}`, place);
      } catch (e) {
        throw new Error(saveError(e));
      }
      made.push(model);
      set(i, { state: "done", stage: model.name, fraction: 1 });
      if (m.picture) pictures.push({ model, picture: m.picture });
    } catch (e) {
      const why = ((e as Error)?.message || "That file couldn't be read.").replace(`${file.name}: `, "");
      // Kept in the console too, with the error itself, so a report can say what went wrong.
      console.error(`Upload of ${file.name} failed:`, e);
      failed.push(`${file.name}: ${why}`);
      set(i, { state: "failed", stage: why, fraction: undefined });
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
