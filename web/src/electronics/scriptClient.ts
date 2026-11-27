import type { ElectronicsDesign } from "@bettercad/electronics";
import { cleanRun } from "@bettercad/electronics/script/api";
import type { ScriptRun } from "@bettercad/electronics/script/run";

/** How long a script may run (#764). */
export const SCRIPT_TIMEOUT = 10_000;

let running: { worker: Worker; done: (r: ScriptRun) => void; timer: ReturnType<typeof setTimeout> } | null = null;

/** Ends the script that is running: its worker goes, and nothing it did is kept. */
export function stopScript(why = "Stopped. Nothing was changed."): void {
  if (!running) return;
  const r = running;
  running = null;
  clearTimeout(r.timer);
  r.worker.terminate();
  r.done({ changes: [], output: [], error: why });
}

/** Runs a script on a copy of the design in a worker made for this one run, and hands back what it would change. */
export function runInSandbox(design: ElectronicsDesign, source: string): Promise<ScriptRun> {
  stopScript();
  const worker = new Worker(new URL("./script.worker.ts", import.meta.url), { type: "module", name: "script" });
  return new Promise((done) => {
    const timer = setTimeout(() => stopScript(`The script ran for over ${SCRIPT_TIMEOUT / 1000} s, so it was stopped. Nothing was changed.`), SCRIPT_TIMEOUT);
    running = { worker, done, timer };
    worker.onmessage = (e: MessageEvent<ScriptRun>) => {
      if (running?.worker !== worker) return;
      clearTimeout(timer);
      running = null;
      worker.terminate();
      // Only the fields a run has, each the shape the API makes, whatever else came back.
      const { changes, output, error } = (e.data ?? {}) as Partial<ScriptRun>;
      done({ ...cleanRun(changes, output), ...(error ? { error: String(error) } : {}) });
    };
    worker.onerror = (e) => {
      e.preventDefault();
      if (running?.worker === worker) stopScript(e.message || "The script could not start");
    };
    worker.postMessage({ design, source });
  });
}
