import { blobHash, toBase64, type Call, type CataloguePart, type Methods } from "@bettercad/kernel";
import { BcadError, loadBcad } from "@bettercad/kernel/bcad";
import { insertCatalogue, newDoc, type ModelDoc } from "@bettercad/kernel/document";
import { bytesOf, textOf } from "./fileText";

/** Any call to the geometry engine; null when it is off. */
export type KernelCall = <M extends keyof Methods>(method: M, params: Methods[M]["params"]) => Call<Methods[M]["result"]> | null;

/** A file read as a part's body (#628): its bytes by hash, and what the geometry engine found in it. */
export interface BodyFile {
  blob: string;
  /** The bytes, base64, to keep with your parts. */
  data: string;
  name: string;
  bodies: number;
  /** The whole file's box, mm: across, deep and tall. */
  size: [number, number, number];
}

const OFF = "The geometry engine is off, so the file can't be read.";

/** A model's bodies as one STEP file: a copy of the model as it is now, which does not follow it when it changes. */
async function stepOf(doc: ModelDoc, name: string, call: KernelCall): Promise<Uint8Array> {
  const made = call("export", { doc, bodies: null, format: "step", deflection: 0, name: doc.name || "Model" });
  if (!made) throw new Error(OFF);
  const out = (await made).files[0];
  if (!out) throw new Error(`${name} has no bodies to use.`);
  return new Uint8Array(out.data);
}

async function read(bytes: Uint8Array, name: string, call: KernelCall): Promise<BodyFile> {
  const blob = blobHash(bytes);
  const data = toBase64(bytes);
  const asked = call("inspect", { name, format: "step", blob, data });
  if (!asked) throw new Error(OFF);
  const info = await asked;
  if (!info.bodies.length || !info.size) throw new Error(`${name} has no solid bodies in it.`);
  return { blob, data, name, bodies: info.bodies.length, size: info.size };
}

/**
 * Reads a STEP file, or a BetterCad model (.bcad), as a part's body. A model is built and kept as STEP: a copy of it
 * as it is now, which does not follow the model when it changes.
 */
export async function readBodyFile(file: File, call: KernelCall | undefined): Promise<BodyFile> {
  if (!call) throw new Error(OFF);
  if (/\.bcad$/i.test(file.name)) {
    const got = loadBcad(await textOf(file));
    if (got instanceof BcadError) throw new Error(`${file.name}: ${got.message}`);
    return read(await stepOf(got.doc, file.name, call), file.name, call);
  }
  if (/\.(step|stp)$/i.test(file.name)) return read(await bytesOf(file), file.name, call);
  throw new Error("Pick a STEP file (.step or .stp) or a BetterCad model (.bcad).");
}

/** One of your saved models as a part's body (#628), kept as STEP the way a model's file is. */
export async function readBodyModel(doc: ModelDoc, name: string, call: KernelCall | undefined): Promise<BodyFile> {
  if (!call) throw new Error(OFF);
  return read(await stepOf(doc, name, call), name, call);
}

/**
 * A robot catalogue part as a model of its own, to use as a part's body (#628). In a model a catalogue part is a
 * reference body, which is never exported, so here it is an ordinary one.
 */
export function catalogueDoc(part: CataloguePart): ModelDoc {
  const doc = insertCatalogue(newDoc(part.name), part, { position: { x: 0, y: 0, z: 0 } }, "pcat", "fcat");
  return { ...doc, looks: { ...doc.looks, pcat: { reference: false } } };
}
