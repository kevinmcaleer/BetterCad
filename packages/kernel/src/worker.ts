/// <reference lib="webworker" />
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { loadOCCT, loadTimes, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";
import { reorderWithPicks } from "./occt/repick";
import { Exporter } from "./occt/exporter";
import { KernelError, isKernelError } from "./errors";
import type { Methods, Request, Response } from "./protocol";
import { thickness } from "./print/checks";
import { suggestOrientations } from "./print/orient";

/**
 * The kernel worker (#44). It loads OpenCascade once, then answers calls one at a time. A cancel marks the call, and
 * the build checks the mark between parts. Nothing here touches the DOM.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: Response) => scope.postMessage(msg);

let builder: ModelBuilder | null = null;
let occt: OC | null = null;
let exporter: Exporter | null = null;
const cancelled = new Set<number>();
const queue: Request[] = [];
let busy = false;

const t0 = performance.now();
const ready: Promise<OC> = loadOCCT({ wasmUrl, onProgress: (fraction) => post({ kind: "load", fraction }) });
ready.then(
  (oc) => {
    occt = oc;
    builder = new ModelBuilder(oc);
    exporter = new Exporter(oc, builder);
    post({ kind: "ready", ms: performance.now() - t0, load: { ...loadTimes } });
  },
  (e) =>
    post({
      kind: "load-error",
      error: { code: "kernel-crashed", message: "The geometry engine could not start. Reload the page to try again.", detail: String(e) },
    }),
);

/** Passes progress on at most every 50 ms, so a long loop doesn't flood the app with messages. */
function every50ms(fn: (fraction: number) => void): (fraction: number) => void {
  let last = 0;
  return (f) => {
    const now = performance.now();
    if (now - last < 50) return;
    last = now;
    fn(f);
  };
}

const handlers: { [M in keyof Methods]: (params: Methods[M]["params"], id: number) => Methods[M]["result"] | Promise<Methods[M]["result"]> } = {
  ping: () => ({ ok: true, engine: "opencascade.js" }),
  build: ({ doc, upTo, quality }, id) => {
    // Say how far a long build has got (#76): after a moment, then at most every 50 ms.
    const start = performance.now();
    let last = start;
    return builder!.build(
      doc,
      upTo,
      quality,
      () => cancelled.has(id),
      (done, total) => {
        const now = performance.now();
        if (now - start < 150 || now - last < 50 || done >= total) return;
        last = now;
        post({ kind: "progress", id, fraction: done / total, steps: [done, total] });
      },
    );
  },
  measure: ({ doc, upTo, refs }) => builder!.measure(doc, refs, upTo),
  mates: ({ doc, upTo, limit }) => builder!.mates(doc, upTo, limit),
  mass: ({ doc, upTo }) => builder!.mass(doc, upTo),
  clashes: ({ doc, upTo, sameLink, references }, id) =>
    builder!.clashes(doc, upTo, {
      sameLink,
      references,
      cancelled: () => cancelled.has(id),
      progress: (fraction) => post({ kind: "progress", id, fraction }),
    }),
  sweep: ({ doc, upTo, joint, step, samples, references }, id) =>
    builder!.sweep(doc, upTo, {
      joint,
      step,
      samples,
      references,
      cancelled: () => cancelled.has(id),
      progress: (fraction) => post({ kind: "progress", id, fraction }),
    }),
  reorder: ({ doc, id, beforeId }) => reorderWithPicks(occt!, builder!, doc, id, beforeId),
  inspect: (params, id) =>
    builder!.inspect(
      params,
      every50ms((fraction) => post({ kind: "progress", id, fraction })),
    ),
  // The recogniser loads the first time it is asked for.
  recognise: async ({ doc, upTo, body, tol, flat, rough }) => {
    const { recognise, moved } = await import("./recognise");
    return builder!.recognise(doc, upTo, body, { tol, flat, rough }, recognise, moved);
  },
  estimate: (params, id) => exporter!.estimate(params, () => cancelled.has(id)),
  export: (params, id) => exporter!.export(params, () => cancelled.has(id)),
  thickness: ({ bodies, threshold }, id) =>
    bodies.map((b) => {
      if (cancelled.has(id)) throw new KernelError("cancelled", "Stopped.");
      const r = thickness(b, threshold);
      return { id: b.id, values: r.values, areas: r.areas, min: r.min };
    }),
  orient: ({ bodies, limit, weights }) => suggestOrientations(bodies, { limit, weights }),
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
      const result = await (handlers[req.method] as (p: unknown, id: number) => unknown)(req.params, req.id);
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
