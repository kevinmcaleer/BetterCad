/// <reference lib="webworker" />
import { runDeck, type SpiceEngine } from "./simRun";

/**
 * The circuit simulator's worker (#761): ngspice, loaded from the URL the page sends the first time, then kept for
 * the next runs. It is given a netlist and sends back the voltages.
 */
let engine: Promise<SpiceEngine> | null = null;

self.onmessage = async (e: MessageEvent<{ id: number; url: string; text: string }>) => {
  const { id, url, text } = e.data;
  try {
    engine ??= (async () => {
      const mod = (await import(/* @vite-ignore */ url)) as { Simulation: new () => SpiceEngine };
      const sim = new mod.Simulation();
      await sim.start();
      return sim;
    })();
    const answer = await runDeck(await engine, text);
    self.postMessage({ id, ...answer });
  } catch (err) {
    engine = null;
    self.postMessage({ id, vectors: [], errors: [err instanceof Error ? err.message : String(err)] });
  }
};
