import type { ElectronicsDesign } from "@bettercad/electronics";
import type { AutorouteOptions, RouteProgress } from "@bettercad/electronics/pcb/autoroute";
import type { RouteAnswer, RouteAsk } from "./boardCheck.worker";
import { boardWorker } from "./boardWorker";

export interface RouteJob {
  /** Stops it where it is. Nothing more is heard from it. */
  stop(): void;
}

export interface RouteEvents {
  progress(p: RouteProgress): void;
  done(): void;
  fail(): void;
}

const worker = () => boardWorker("bettercad-autoroute");

/**
 * Starts the autorouter on a board (#647), in a worker of its own so it can be stopped at any moment. Where a worker
 * cannot be made it fails, a moment later.
 */
export function startRouting(design: ElectronicsDesign, options: Omit<AutorouteOptions, "onProgress">, on: RouteEvents, make: () => Worker = worker): RouteJob {
  let w: Worker;
  try {
    w = make();
  } catch {
    queueMicrotask(on.fail);
    return { stop: () => {} };
  }
  w.onmessage = (ev: MessageEvent<RouteAnswer>) => {
    if ("progress" in ev.data) return on.progress(ev.data.progress);
    w.terminate();
    if ("done" in ev.data) on.done();
    else on.fail();
  };
  w.onerror = () => {
    w.terminate();
    on.fail();
  };
  w.postMessage({ design, route: options } satisfies RouteAsk);
  return { stop: () => w.terminate() };
}
