import { blobHash, toBase64, type Call, type Methods } from "@bettercad/kernel";
import { BcadError, loadBcad } from "@bettercad/kernel/bcad";
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

/**
 * Reads a STEP file, or a BetterCad model (.bcad), as a part's body. A model is built and kept as STEP: a copy of it
 * as it is now, which does not follow the model when it changes.
 */
export async function readBodyFile(file: File, call: KernelCall | undefined): Promise<BodyFile> {
  if (!call) throw new Error(OFF);
  let bytes: Uint8Array;
  if (/\.bcad$/i.test(file.name)) {
    const read = loadBcad(await textOf(file));
    if (read instanceof BcadError) throw new Error(`${file.name}: ${read.message}`);
    const made = call("export", { doc: read.doc, bodies: null, format: "step", deflection: 0, name: read.doc.name || "Model" });
    if (!made) throw new Error(OFF);
    const out = (await made).files[0];
    if (!out) throw new Error(`${file.name} has no bodies to use.`);
    bytes = new Uint8Array(out.data);
  } else if (/\.(step|stp)$/i.test(file.name)) bytes = await bytesOf(file);
  else throw new Error("Pick a STEP file (.step or .stp) or a BetterCad model (.bcad).");
  const blob = blobHash(bytes);
  const data = toBase64(bytes);
  const asked = call("inspect", { name: file.name, format: "step", blob, data });
  if (!asked) throw new Error(OFF);
  const info = await asked;
  if (!info.bodies.length || !info.size) throw new Error(`${file.name} has no solid bodies in it.`);
  return { blob, data, name: file.name, bodies: info.bodies.length, size: info.size };
}
