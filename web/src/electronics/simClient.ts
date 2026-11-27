import { simEnginePath } from "./simEngine";
import type { SpiceAnswer } from "./simRun";

/** How long a run may take before it is stopped. */
export const SIM_TIMEOUT = 30_000;

let worker: Worker | null = null;
let next = 0;
let pending: { id: number; done: (a: SpiceAnswer) => void; timer: ReturnType<typeof setTimeout> } | null = null;

/** Ends the run under way, if any: the worker goes, and the next run starts a new one. */
export function stopSim(why = "Stopped"): void {
  worker?.terminate();
  worker = null;
  if (pending) {
    clearTimeout(pending.timer);
    pending.done({ vectors: [], errors: [why] });
    pending = null;
  }
}

/** Runs a netlist on ngspice in a worker (#761). The engine downloads the first time, about 5 MB. */
export function runSpice(text: string): Promise<SpiceAnswer> {
  // One run at a time; the worker, with ngspice started, is kept for the next.
  if (pending) stopSim();
  worker ??= new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
  const url = new URL(simEnginePath(), new URL(import.meta.env.BASE_URL, document.baseURI)).href;
  const id = (next += 1);
  return new Promise((done) => {
    const timer = setTimeout(() => stopSim(`The run took over ${SIM_TIMEOUT / 1000} s, so it was stopped`), SIM_TIMEOUT);
    pending = { id, done, timer };
    worker!.onmessage = (e: MessageEvent<SpiceAnswer & { id: number }>) => {
      if (e.data.id !== pending?.id) return;
      clearTimeout(pending.timer);
      pending = null;
      done({ vectors: e.data.vectors, errors: e.data.errors });
    };
    worker!.onerror = (e) => stopSim(e.message || "The simulator could not start");
    worker!.postMessage({ id, url, text });
  });
}
