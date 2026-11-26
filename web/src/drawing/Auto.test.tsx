import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingDimension, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingBar, DrawingPaper, DrawingRibbon, type DrawingTool, type ViewCall } from "./DrawingView";

const TAU = Math.PI * 2;
const edge = (index: number) => ({ body: "b1", kind: "edge" as const, index });
const face = (index: number, name: string) => ({ body: "b1", kind: "face" as const, index, name });
const line = (index: number, a: V2, b: V2) => ({ curve: { kind: "line", a, b }, visible: true, type: "sharp", source: edge(index) });
/** A 60 by 40 mm plate with a step at 40 mm and two 5 mm holes. */
const plate = {
  edges: [
    line(0, [0, 0], [60, 0]),
    line(1, [60, 0], [60, 20]),
    line(2, [60, 20], [40, 20]),
    line(3, [40, 20], [40, 40]),
    line(4, [40, 40], [0, 40]),
    line(5, [0, 40], [0, 0]),
  ],
  box: { min: [0, 0], max: [60, 40] },
  rounds: [
    { seen: "end", c: [10, 10], r: 2.5, hole: true, sweep: TAU, source: face(20, "a") },
    { seen: "end", c: [50, 10], r: 2.5, hole: true, sweep: TAU, source: face(21, "b") },
  ],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const doc = { ...newDoc(), name: "Plate" };
const say = vi.fn();

function Harness({ views = [front], dimensions = [], readOnly }: { views?: DrawingView[]; dimensions?: DrawingDimension[]; readOnly?: boolean }) {
  const [drawing, setDrawing] = useState<Drawing>({
    id: "dr1",
    name: "Drawing 1",
    decimals: 2,
    sheets: [{ ...newSheet("Sheet 1", { size: "A3" }), views, dimensions }],
  });
  const [tool, setTool] = useState<DrawingTool | null>(null);
  const [call] = useState(() => vi.fn<ViewCall>(() => Promise.resolve(plate)));
  return (
    <>
      <div data-testid="sheet">{JSON.stringify(drawing.sheets[0])}</div>
      <DrawingBar
        name="Drawing 1"
        readOnly={readOnly}
        auto={tool === "auto"}
        onAuto={() => setTool(tool === "auto" ? null : "auto")}
        onSettings={vi.fn()}
        onFit={vi.fn()}
      />
      <DrawingPaper
        drawing={drawing}
        readOnly={readOnly}
        onTitle={vi.fn()}
        doc={doc}
        call={call}
        tool={tool}
        onTool={setTool}
        say={say}
        onSheet={(change) => setDrawing((d) => ({ ...d, sheets: [change(d.sheets[0]!)] }))}
      />
    </>
  );
}
const sheetNow = () => JSON.parse(screen.getByTestId("sheet").textContent!) as DrawingSheet;
const card = () => within(screen.getByRole("dialog", { name: "Auto dimension" }));
const open = async () => {
  await screen.findByRole("button", { name: "Front view, 1:1" });
  await userEvent.click(screen.getByRole("button", { name: "Auto dimension" }));
};
const slide = (to: number) => fireEvent.change(card().getByRole("slider", { name: "How many sizes" }), { target: { value: String(to) } });
const sizes = () => screen.queryAllByRole("button", { name: /^Dimension, / }).map((b) => b.getAttribute("aria-label"));

describe("Auto dimension", () => {
  it("opens from the bar with Baseline from the bottom left, and shows its sizes on the sheet before you keep them", async () => {
    render(<Harness />);
    await open();
    expect(screen.getByRole("button", { name: "Auto dimension", pressed: true })).toBeTruthy();
    const recipes = within(card().getByRole("radiogroup", { name: "Recipe" }));
    expect(recipes.getAllByRole("radio").map((r) => (r as HTMLInputElement).checked)).toEqual([true, false, false, false]);
    expect(recipes.getByRole("radio", { name: /^Baseline with centre marks/ })).toBeTruthy();
    expect((card().getByRole("combobox", { name: "Measure from" }) as HTMLSelectElement).value).toBe("bottom-left");
    // Two overall sizes, a hole each way, the holes' size, and the step each way: half way suggests all eight.
    expect(card().getByRole("status").textContent).toBe("8 of 8 dimensions");
    expect(sizes()).toHaveLength(8);
    expect(sizes()).toContain("Dimension, 60 mm");
    // Nothing is on the sheet yet.
    expect(sheetNow().dimensions).toEqual([]);
  });

  it("the slider goes from the overall sizes alone to everything, and says how many", async () => {
    render(<Harness />);
    await open();
    slide(0);
    expect(card().getByRole("status").textContent).toBe("2 of 8 dimensions");
    expect(sizes().sort()).toEqual(["Dimension, 40 mm", "Dimension, 60 mm"]);
    slide(1);
    expect(card().getByRole("status").textContent).toBe("8 of 8 dimensions");
    expect(card().getByRole("slider", { name: "How many sizes" }).getAttribute("aria-valuetext")).toBe("8 of 8 dimensions");
    expect(sizes()).toHaveLength(8);
    expect(sizes()).toContain("Dimension, 2× Ø5 mm");
  });

  it("each recipe says how many sizes it gives, and Chain measures one after another", async () => {
    render(<Harness />);
    await open();
    slide(1);
    await userEvent.click(card().getByRole("radio", { name: /^Chain\s*9 of 9/ }));
    // Along the bottom: the edge to the first hole, the hole to the step, the step to the second hole, and on to the end.
    expect(sizes().filter((s) => s === "Dimension, 10 mm").length).toBeGreaterThanOrEqual(3);
    expect(sizes()).toContain("Dimension, 30 mm");
    expect(card().getByRole("status").textContent).toBe("9 of 9 dimensions");
  });

  it("OK keeps the sizes as automatic ones in rows, with the holes marked when the recipe says so", async () => {
    render(<Harness />);
    await open();
    slide(0);
    await userEvent.click(card().getByRole("radio", { name: /^Baseline with centre marks/ }));
    await userEvent.selectOptions(card().getByRole("combobox", { name: "Measure from" }), "Top right");
    await userEvent.click(card().getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog", { name: "Auto dimension" })).toBeNull();
    const sheet = sheetNow();
    expect(sheet.dimensions.map((d) => [d.auto, d.across, d.at])).toEqual([
      [true, "x", [0, 30]],
      [true, "y", [40, 0]],
    ]);
    expect(sheet.marks).toHaveLength(2);
    expect(sheet.auto).toEqual({ recipe: "centre-baseline", datum: "top-right", density: 0 });
    expect(say).toHaveBeenLastCalledWith("Added 2 sizes.");
    // Kept sizes are ordinary ones: they can be picked and deleted.
    expect(sizes()).toHaveLength(2);
  });

  it("Cancel leaves the sheet as it was", async () => {
    render(<Harness />);
    await open();
    expect(sizes().length).toBeGreaterThan(0);
    await userEvent.click(card().getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Auto dimension" })).toBeNull();
    expect(sizes()).toEqual([]);
    expect(sheetNow().dimensions).toEqual([]);
    expect(sheetNow().auto).toBeUndefined();
  });

  it("opens again as you left it, replaces its own sizes and keeps yours", async () => {
    const mine: DrawingDimension = { id: "mine", view: "v1", kind: "linear", refs: [{ view: "v1", ...edge(3) }], across: "aligned", at: [20, 10] };
    render(<Harness dimensions={[mine]} />);
    await open();
    slide(0);
    await userEvent.click(card().getByRole("radio", { name: /^Chain\s*\d/ }));
    await userEvent.click(card().getByRole("button", { name: "OK" }));
    expect(sheetNow().dimensions.map((d) => d.id === "mine" || d.auto)).toEqual([true, true, true]);
    await userEvent.click(screen.getByRole("button", { name: "Auto dimension" }));
    expect((card().getByRole("radio", { name: /^Chain\s*\d/ }) as HTMLInputElement).checked).toBe(true);
    expect((card().getByRole("slider", { name: "How many sizes" }) as HTMLInputElement).value).toBe("0");
    slide(1);
    await userEvent.click(card().getByRole("button", { name: "OK" }));
    const after = sheetNow().dimensions;
    expect(after[0]).toEqual(mine);
    expect(after.filter((d) => d.auto)).toHaveLength(after.length - 1);
    expect(after.length).toBeGreaterThan(3);
  });

  it("says so when the sheet has no views", async () => {
    render(<Harness views={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Auto dimension" }));
    expect(card().getByRole("status").textContent).toBe("Put a view on the sheet first.");
    await userEvent.click(card().getByRole("button", { name: "OK" }));
    expect(say).toHaveBeenLastCalledWith("There was nothing to dimension.");
    expect(sheetNow().dimensions).toEqual([]);
  });

  it("is not offered on a drawing you can only read, and is on the ribbon's Drawing tab", () => {
    const { unmount } = render(<Harness readOnly />);
    expect(screen.queryByRole("button", { name: "Auto dimension" })).toBeNull();
    unmount();
    const onAuto = vi.fn();
    render(<DrawingRibbon onDimension={vi.fn()} onAuto={onAuto} auto onSettings={vi.fn()} onFit={vi.fn()} />);
    const button = within(screen.getByRole("group", { name: "Dimensions" })).getByRole("button", { name: /^Auto/, pressed: true });
    fireEvent.click(button);
    expect(onAuto).toHaveBeenCalled();
  });
});
