import type { ElectronicsDesign } from "@bettercad/electronics";
import { checkBoard, type BoardResult } from "@bettercad/electronics/drc";
import { autoroute, type AutorouteOptions, type RouteProgress } from "@bettercad/electronics/pcb/autoroute";

/**
 * The board's rules check, off the page (#644): a big board takes a moment to measure, and the board stays smooth to
 * work on meanwhile. A design is plain data, so it is sent as it is.
 */
export interface CheckAsk {
  id: number;
  design: ElectronicsDesign;
}
export type CheckAnswer = { id: number; results: BoardResult[] } | { id: number; error: string };

/**
 * The autorouter, off the page too (#647): finding a way for every connection takes a while. Each route is sent back
 * as it is found, so stopping (ending the worker) keeps what is done so far.
 */
export interface RouteAsk {
  design: ElectronicsDesign;
  route: Omit<AutorouteOptions, "onProgress">;
}
export type RouteAnswer = { progress: RouteProgress } | { done: true } | { error: string };

const scope = self as unknown as { onmessage: ((ev: MessageEvent<CheckAsk | RouteAsk>) => void) | null; postMessage(msg: CheckAnswer | RouteAnswer): void };
scope.onmessage = (ev) => {
  const ask = ev.data;
  if ("route" in ask) {
    try {
      autoroute(ask.design, { ...ask.route, onProgress: (progress) => scope.postMessage({ progress }) });
      scope.postMessage({ done: true });
    } catch (e) {
      scope.postMessage({ error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  try {
    scope.postMessage({ id: ask.id, results: checkBoard(ask.design) });
  } catch (e) {
    scope.postMessage({ id: ask.id, error: e instanceof Error ? e.message : String(e) });
  }
};
