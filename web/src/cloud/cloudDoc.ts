import { fromBase64, toBase64 } from "@bettercad/kernel";
import type { ModelDoc } from "../state/document";
import type { Api } from "./api";

/**
 * Imported files in the cloud (#90): a model saved to an account keeps each imported file once, by hash, under
 * /api/blobs. The stored .bcad lists the hashes with empty contents; opening it fetches them back.
 */

const MIME: Record<string, string> = { stl: "model/stl", step: "model/step", "3mf": "model/3mf" };

/** The blob hashes a document uses, with the format of the file each came from. */
function formats(doc: ModelDoc): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of doc.features) {
    const x = f as { type: string; blob?: string; format?: string };
    if (x.type === "import" && x.blob) out.set(x.blob, x.format ?? "");
  }
  return out;
}

/** Uploads the document's imported files the server doesn't have yet, and returns the document without them. */
export async function stripBlobs(api: Api, doc: ModelDoc): Promise<ModelDoc> {
  const blobs = doc.blobs;
  if (!blobs || !Object.keys(blobs).length) return doc;
  const kinds = formats(doc);
  const empty: Record<string, string> = {};
  for (const [hash, data] of Object.entries(blobs)) {
    empty[hash] = "";
    if (!data) continue;
    if (await api.hasBlob(hash)) continue;
    await api.putBlob(hash, fromBase64(data), MIME[kinds.get(hash) ?? ""] ?? "application/octet-stream");
  }
  return { ...doc, blobs: empty };
}

/** Fetches the imported files a cloud document lists by hash. `token` reads them through a share link. */
export async function fillBlobs(api: Api, doc: ModelDoc, token?: string): Promise<ModelDoc> {
  const blobs = doc.blobs;
  if (!blobs) return doc;
  const missing = Object.entries(blobs).filter(([, v]) => !v);
  if (!missing.length) return doc;
  const filled = { ...blobs };
  await Promise.all(
    missing.map(async ([hash]) => {
      filled[hash] = toBase64(await api.getBlob(hash, token));
    }),
  );
  return { ...doc, blobs: filled };
}
