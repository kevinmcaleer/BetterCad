import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASICS, emptyDesign, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import { checkBoard, type BoardResult } from "@bettercad/electronics/drc";
import { addTrack } from "@bettercad/electronics/pcb/route";
import { BoardChecker, useBoardCheck } from "./boardCheck";
import type { CheckAnswer, CheckAsk } from "./boardCheck.worker";

/** A stand-in worker: it keeps what it is sent, and answers when the test says. */
class FakeWorker {
  asks: CheckAsk[] = [];
  onmessage: ((ev: MessageEvent<CheckAnswer>) => void) | null = null;
  onerror: (() => void) | null = null;
  ended = false;
  postMessage(ask: CheckAsk) {
    this.asks.push(ask);
  }
  terminate() {
    this.ended = true;
  }
  answer(msg: CheckAnswer) {
    this.onmessage?.({ data: msg } as MessageEvent<CheckAnswer>);
  }
}

const clean: ElectronicsDesign = pushToBoard(placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 }).design).design;
/** The same board with a track that runs off its edge. */
const off: ElectronicsDesign = addTrack(clean, "", "top", [
  [-5, 2],
  [3, 2],
]);

describe("the board check's worker", () => {
  it("is started once and gives each ask its own answer", async () => {
    const made: FakeWorker[] = [];
    const checker = new BoardChecker(() => {
      made.push(new FakeWorker());
      return made[0] as unknown as Worker;
    });
    const a = checker.check(off);
    const b = checker.check(emptyDesign());
    expect(made).toHaveLength(1);
    expect(made[0]!.asks.map((x) => x.id)).toEqual([1, 2]);
    expect(made[0]!.asks[0]!.design).toBe(off);
    // Answered out of order.
    made[0]!.answer({ id: 2, results: [] });
    made[0]!.answer({ id: 1, results: checkBoard(off) });
    expect(await b).toEqual([]);
    expect((await a).some((r) => r.rule === "edge")).toBe(true);
  });

  it("tells everyone waiting when the worker breaks, and starts a new one next time", async () => {
    const made: FakeWorker[] = [];
    const checker = new BoardChecker(() => {
      made.push(new FakeWorker());
      return made.at(-1) as unknown as Worker;
    });
    const a = checker.check(off);
    made[0]!.onerror?.();
    await expect(a).rejects.toThrow("The check could not run.");
    expect(made[0]!.ended).toBe(true);
    const b = checker.check(off);
    made[1]!.answer({ id: 2, error: "No board" });
    await expect(b).rejects.toThrow("No board");
  });
});

describe("the board check in the page", () => {
  afterEach(() => vi.unstubAllGlobals());

  function Probe(p: { design: ElectronicsDesign; ask: (d: ElectronicsDesign) => Promise<BoardResult[]> }) {
    const { results, checking } = useBoardCheck(p.design, p.ask);
    return <p role="status">{results ? `${results.length} found${checking ? ", checking again" : ""}` : "Checking"}</p>;
  }

  it("keeps the last answer up while a newer board is checked", async () => {
    vi.stubGlobal("Worker", class {});
    const asked: { d: ElectronicsDesign; done: (r: BoardResult[]) => void }[] = [];
    const ask = (d: ElectronicsDesign) => new Promise<BoardResult[]>((done) => asked.push({ d, done }));
    const ui = render(<Probe design={off} ask={ask} />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking");
    await act(async () => asked[0]!.done(checkBoard(off)));
    const n = checkBoard(off).length;
    expect(screen.getByRole("status")).toHaveTextContent(`${n} found`);
    ui.rerender(<Probe design={clean} ask={ask} />);
    expect(screen.getByRole("status")).toHaveTextContent(`${n} found, checking again`);
    expect(asked).toHaveLength(2);
    await act(async () => asked[1]!.done(checkBoard(clean)));
    expect(screen.getByRole("status")).toHaveTextContent(`${checkBoard(clean).length} found`);
    expect(checkBoard(clean).length).toBeLessThan(n);
  });

  it("runs in the page when the worker fails, or where there are none", async () => {
    vi.stubGlobal("Worker", class {});
    render(<Probe design={off} ask={() => Promise.reject(new Error("no"))} />);
    expect(await screen.findByText(`${checkBoard(off).length} found`)).toBeInTheDocument();
    vi.unstubAllGlobals();
    const ui = render(<Probe design={off} ask={() => new Promise(() => {})} />);
    expect(ui.getAllByRole("status").at(-1)).toHaveTextContent(`${checkBoard(off).length} found`);
  });
});
