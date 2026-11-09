import type { OpenCascadeInstance } from "replicad-opencascadejs";

/**
 * Loading OpenCascade. The WASM is replicad-opencascadejs, a trimmed opencascade.js build (LGPL 2.1, shipped
 * unmodified as its own file; see packages/kernel/VERSIONS.md). It loads once per worker (or Node process).
 */
export type OC = OpenCascadeInstance;

export interface LoadOptions {
  /** Where the .wasm file is served from (the browser). Node finds it next to the glue. */
  wasmUrl?: string;
  /** Called with 0…1 while the WASM downloads. */
  onProgress?: (fraction: number) => void;
}

let loading: Promise<OC> | null = null;

/** How long the last load took (#50, #97): fetching the WASM, then compiling and starting it, in ms. */
export const loadTimes: { download?: number; start?: number } = {};

export function loadOCCT(opts: LoadOptions = {}): Promise<OC> {
  if (!loading) {
    loading = (async () => {
      const { default: init } = await import("replicad-opencascadejs");
      const options: Record<string, unknown> = {};
      let t = performance.now();
      if (opts.wasmUrl) {
        const bytes = await download(opts.wasmUrl, opts.onProgress);
        options.wasmBinary = bytes;
        loadTimes.download = performance.now() - t;
        t = performance.now();
      }
      const oc = await init(options);
      loadTimes.start = performance.now() - t;
      opts.onProgress?.(1);
      return oc;
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

async function download(url: string, onProgress?: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`The geometry engine could not be downloaded (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!total || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(0.99, got / total));
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}
