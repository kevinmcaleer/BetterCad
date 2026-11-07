/// <reference lib="webworker" />
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { KernelError, isKernelError } from "./errors";
import type { Methods, Request, Response } from "./protocol";

/**
 * The kernel worker (#44). It loads OpenCascade once, then answers calls one at a time. A cancel marks the call, and
 * the build checks the mark between parts. Nothing here touches the DOM.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: Response) => scope.postMessage(msg);

let builder: ModelBuilder | null = null;
const cancelled = new Set<number>();
const queue: Request[] = [];
let busy = false;

const t0 = performance.now();
const ready: Promise<OC> = loadOCCT({ wasmUrl, onProgress: (fraction) => post({ kind: "load", fraction }) });
ready.then(
  (oc) => {
    builder = new ModelBuilder(oc);
    post({ kind: "ready", ms: performance.now() - t0 });
  },
  (e) =>
    post({
      kind: "load-error",
      error: { code: "kernel-crashed", message: "The geometry engine could not start. Reload the page to try again.", detail: String(e) },
    }),
);

const handlers: { [M in keyof Methods]: (params: Methods[M]["params"], id: number) => Methods[M]["result"] } = {
  ping: () => ({ ok: true, engine: "opencascade.js" }),
  build: ({ doc, upTo, quality }, id) => builder!.build(doc, upTo, quality, () => cancelled.has(id)),
  measure: ({ doc, upTo, refs }) => builder!.measure(doc, refs, upTo),
};

async function pump() {
  if (busy) return;
  busy = true;
  await ready.catch(() => undefined);
  while (queue.length) {
    const req = queue.shift()!;
    if (req.kind !== "call") continue;
    if (cancelled.delete(req.id)) {
      post({ kind: "error", id: req.id, error: { code: "cancelled", message: "Stopped." } });
      continue;
    }
    try {
      if (!builder) throw new KernelError("kernel-crashed", "The geometry engine is not running.");
      const result = (handlers[req.method] as (p: unknown, id: number) => unknown)(req.params, req.id);
      post({ kind: "result", id: req.id, result } as Response);
    } catch (e) {
      const error = isKernelError(e)
        ? { code: e.code, message: e.message, detail: e.detail }
        : { code: "failed" as const, message: "Something went wrong in the geometry engine.", detail: String(e) };
      post({ kind: "error", id: req.id, error });
    }
    cancelled.delete(req.id);
  }
  busy = false;
}

scope.onmessage = (ev: MessageEvent<Request>) => {
  const req = ev.data;
  if (req.kind === "cancel") cancelled.add(req.id);
  else queue.push(req);
  void pump();
};
