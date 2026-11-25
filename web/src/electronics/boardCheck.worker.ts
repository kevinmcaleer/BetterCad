import type { ElectronicsDesign } from "@bettercad/electronics";
import { checkBoard, type BoardResult } from "@bettercad/electronics/drc";

/**
 * The board's rules check, off the page (#644): a big board takes a moment to measure, and the board stays smooth to
 * work on meanwhile. A design is plain data, so it is sent as it is.
 */
export interface CheckAsk {
  id: number;
  design: ElectronicsDesign;
}
export type CheckAnswer = { id: number; results: BoardResult[] } | { id: number; error: string };

const scope = self as unknown as { onmessage: ((ev: MessageEvent<CheckAsk>) => void) | null; postMessage(msg: CheckAnswer): void };
scope.onmessage = (ev) => {
  const { id, design } = ev.data;
  try {
    scope.postMessage({ id, results: checkBoard(design) });
  } catch (e) {
    scope.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
