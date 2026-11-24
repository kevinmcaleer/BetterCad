import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingDimension, type DrawingRef, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingPaper, DrawingRibbon, sheetChange, type DrawingApi, type ViewCall } from "./DrawingView";
import SheetCard from "./SheetCard";

const edge = (index: number) => ({ body: "b1", kind: "edge" as const, index });
const line = (index: number, a: V2, b: V2) => ({ curve: { kind: "line", a, b }, visible: true, type: "sharp", source: edge(index) });
/** A 60 by 40 mm plate about the origin, its bottom edge in two halves. */
const plate = {
  edges: [
    line(0, [-30, -20], [0, -20]),
    line(1, [0, -20], [30, -20]),
    line(2, [30, -20], [30, 20]),
    line(3, [30, 20], [-30, 20]),
    line(4, [-30, 20], [-30, -20]),
  ],
  box: { min: [-30, -20], max: [30, 20] },
  rounds: [],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 180] };
const under: DrawingView = { ...front, id: "v2", direction: "top", at: [150, 125] };
const doc = { ...newDoc(), name: "Plate" };
const e = (index: number, at?: DrawingRef["at"]): DrawingRef => ({ view: "v1", ...edge(index), ...(at ? { at } : {}) });
const half: DrawingDimension = { id: "d1", view: "v1", kind: "linear", refs: [e(0)], across: "aligned", at: [-15, -27] };
const whole: DrawingDimension = { id: "d2", view: "v1", kind: "linear", refs: [e(0, "start"), e(1, "end")], across: "aligned", at: [5, -23] };
const say = vi.fn();

function Harness({ dimensions = [], views = [front] }: { dimensions?: DrawingDimension[]; views?: DrawingView[] }) {
  const [drawing, setDrawing] = useState<Drawing>({
    id: "dr1",
    name: "Drawing 1",
    decimals: 2,
    sheets: [{ ...newSheet("Sheet 1", { size: "A3" }), views, dimensions }],
  });
  const [call] = useState(() => vi.fn<ViewCall>(() => Promise.resolve(plate)));
  const api = useRef<DrawingApi | null>(null);
  return (
    <>
      <button onClick={() => api.current?.arrange()}>Arrange all</button>
      <div data-testid="sheet">{JSON.stringify(drawing.sheets[0])}</div>
      <DrawingPaper
        drawing={drawing}
        onTitle={vi.fn()}
        doc={doc}
        call={call}
        api={api}
        say={say}
        onSheet={(change) => setDrawing((d) => ({ ...d, sheets: [change(d.sheets[0]!)] }))}
      />
    </>
  );
}
const sheetNow = () => JSON.parse(screen.getByTestId("sheet").textContent!) as DrawingSheet;

describe("Arrange dimensions", () => {
  it("is on a view's right-click menu: its sizes go into rows, the shorter nearer the part", async () => {
    render(<Harness dimensions={[whole, half]} />);
    await screen.findByRole("button", { name: "Dimension, 60 mm" });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Front view, 1:1" }), { clientX: 300, clientY: 200 });
    await userEvent.click(within(screen.getByRole("menu", { name: "View actions" })).getByRole("menuitem", { name: "Arrange dimensions" }));
    expect(sheetNow().dimensions.map((d) => d.at)).toEqual([
      [0, -38],
      [-15, -30],
    ]);
    expect(say).toHaveBeenLastCalledWith("Arranged 2 sizes.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tidies every view when none is selected, and says when there is nothing to tidy", async () => {
    render(<Harness dimensions={[half]} />);
    await screen.findByRole("button", { name: "Dimension, 30 mm" });
    await userEvent.click(screen.getByRole("button", { name: "Arrange all" }));
    expect(sheetNow().dimensions[0]!.at).toEqual([-15, -30]);
    expect(say).toHaveBeenLastCalledWith("Arranged 1 size.");
  });

  it("says so when there are no sizes", async () => {
    render(<Harness />);
    await screen.findByRole("button", { name: "Front view, 1:1" });
    await userEvent.click(screen.getByRole("button", { name: "Arrange all" }));
    expect(say).toHaveBeenLastCalledWith("There are no sizes to arrange here.");
  });

  it("offers to move a neighbouring view the rows run into", async () => {
    render(<Harness dimensions={[whole, half]} views={[front, under]} />);
    await screen.findByRole("button", { name: "Dimension, 60 mm" });
    await userEvent.click(screen.getByRole("button", { name: "Arrange all" }));
    // The rows reach 40 mm under the front view's middle, and the top view's outline starts 35 mm under it.
    const ask = within(screen.getByRole("dialog", { name: "Make room for the sizes?" }));
    expect(ask.getByText("The sizes on the front view run into the top view. It can move out of their way.")).toBeTruthy();
    await userEvent.click(ask.getByRole("button", { name: "Move it" }));
    expect(sheetNow().views[1]!.at).toEqual([150, 115]);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Leave it keeps the view where it is.
    await userEvent.click(screen.getByRole("button", { name: "Arrange all" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a dragged size drops into a row when it is let go near one", async () => {
    render(<Harness dimensions={[{ ...half, at: [-15, -33] }]} />);
    const dim = await screen.findByRole("button", { name: "Dimension, 30 mm" });
    fireEvent.pointerDown(dim, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(dim, { pointerId: 1, clientX: 100, clientY: 96 });
    fireEvent.pointerUp(dim, { pointerId: 1, clientX: 100, clientY: 96 });
    expect(sheetNow().dimensions[0]!.at).toEqual([-15, -30]);
  });

  it("is on the Drawing tab beside Dimension", async () => {
    const p = { onSettings: vi.fn(), onFit: vi.fn(), onFinish: vi.fn(), onDimension: vi.fn(), onArrange: vi.fn() };
    render(<DrawingRibbon {...p} />);
    await userEvent.click(within(screen.getByRole("group", { name: "Dimensions" })).getByRole("button", { name: "Arrange dimensions" }));
    expect(p.onArrange).toHaveBeenCalled();
  });
});

describe("row spacing in Sheet settings", () => {
  const sheet = { ...newSheet("Sheet 1", { size: "A3" }), views: [front] };
  const drawing: Drawing = { id: "dr1", name: "Drawing 1", decimals: 2, sheets: [sheet] };

  it("shows the standard's rows, and keeps yours only when they differ", async () => {
    const onDone = vi.fn();
    const { unmount } = render(<SheetCard sheet={sheet} onCancel={vi.fn()} onDone={onDone} />);
    const first = screen.getByRole("combobox", { name: "First row from the view" }) as HTMLSelectElement;
    const next = screen.getByRole("combobox", { name: "Between rows" }) as HTMLSelectElement;
    expect([first.value, next.value]).toEqual(["10", "8"]);
    expect(within(first).getByRole("option", { name: "12 mm" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone.mock.calls[0]![0].rows).toBeUndefined();
    unmount();
    render(<SheetCard sheet={sheet} onCancel={vi.fn()} onDone={onDone} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "First row from the view" }), "12 mm");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Between rows" }), "10 mm");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone.mock.calls[1]![0].rows).toEqual({ first: 12, next: 10 });
  });

  it("is saved with the sheet, and left out again when it goes back to the standard's", () => {
    const model = { ...doc, drawings: [drawing] };
    const choice = { size: sheet.size, landscape: sheet.landscape, border: sheet.border, standard: sheet.standard };
    const set = sheetChange(drawing, { ...choice, rows: { first: 12, next: 10 } })[0](model);
    expect(set.drawings![0]!.sheets[0]!.rows).toEqual({ first: 12, next: 10 });
    const back = sheetChange(set.drawings![0]!, choice)[0](set);
    expect("rows" in back.drawings![0]!.sheets[0]!).toBe(false);
  });
});
