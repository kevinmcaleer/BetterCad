import { useEffect, useMemo, useState } from "react";
import type { ElectronicsDesign } from "@bettercad/electronics";
import { checkBoard, type BoardResult } from "@bettercad/electronics/drc";
import type { CheckAnswer, CheckAsk } from "./boardCheck.worker";

type Waiting = { done: (r: BoardResult[]) => void; fail: (e: Error) => void };

/** Asks a worker to check boards. Made once, when the first check is asked for; `make` is swapped in tests. */
export class BoardChecker {
  private worker: Worker | null = null;
  private waiting = new Map<number, Waiting>();
  private next = 1;
  constructor(private make: () => Worker) {}

  check(design: ElectronicsDesign): Promise<BoardResult[]> {
    return new Promise((done, fail) => {
      let w: Worker;
      try {
        w = this.start();
      } catch (e) {
        fail(e as Error);
        return;
      }
      const id = this.next++;
      this.waiting.set(id, { done, fail });
      w.postMessage({ id, design } satisfies CheckAsk);
    });
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const w = this.make();
    w.onmessage = (ev: MessageEvent<CheckAnswer>) => {
      const asked = this.waiting.get(ev.data.id);
      this.waiting.delete(ev.data.id);
      if (!asked) return;
      if ("results" in ev.data) asked.done(ev.data.results);
      else asked.fail(new Error(ev.data.error));
    };
    // The worker itself broke (it could not load, say): everyone waiting is told, and the next check starts afresh.
    w.onerror = () => {
      for (const asked of this.waiting.values()) asked.fail(new Error("The check could not run."));
      this.waiting.clear();
      w.terminate();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }
}

let shared: BoardChecker | null = null;
const inWorker = (d: ElectronicsDesign) =>
  (shared ??= new BoardChecker(() => new Worker(new URL("./boardCheck.worker.ts", import.meta.url), { type: "module", name: "bettercad-board-check" }))).check(
    d,
  );

/**
 * The board check's results for a design, found in a worker (#644). `results` is null until the first answer; while a
 * newer design is being checked the last answer stays up and `checking` is true. Where there are no workers, or the
 * worker fails, the check runs in the page as it used to.
 */
export function useBoardCheck(design: ElectronicsDesign, ask: (d: ElectronicsDesign) => Promise<BoardResult[]> = inWorker) {
  const inPage = typeof Worker === "undefined";
  const now = useMemo(() => (inPage ? checkBoard(design) : null), [design, inPage]);
  const [got, setGot] = useState<{ design: ElectronicsDesign; results: BoardResult[] } | null>(null);
  useEffect(() => {
    if (inPage) return;
    let live = true;
    ask(design)
      .catch(() => checkBoard(design))
      .then((results) => live && setGot({ design, results }));
    return () => {
      live = false;
    };
  }, [design, inPage, ask]);
  if (now) return { results: now, checking: false };
  return { results: got?.results ?? null, checking: got?.design !== design };
}
