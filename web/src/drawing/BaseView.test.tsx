import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingSheet } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingBar, DrawingPaper, DrawingRibbon, type DrawingTool, type ViewCall } from "./DrawingView";

/** A 40 × 20 mm plate: two edges you see and a hole behind. */
const plate: ModelView = {
  edges: [
    { curve: { kind: "line", a: [0, 0], b: [40, 0] }, visible: true, type: "sharp" },
    { curve: { kind: "line", a: [40, 0], b: [40, 20] }, visible: true, type: "sharp" },
    { curve: { kind: "circle", c: [20, 10], r: 4 }, visible: false, type: "sharp" },
  ],
  box: { min: [0, 0], max: [40, 20] },
  rounds: [],
  bodies: ["b1"],
  ms: 1,
};
const doc = { ...newDoc(), name: "Plate" };

/** The sheet with the editor's part of the work done here: it keeps the sheet and the armed tool. */
function Harness({
  call,
  start,
  tool: first = null,
  readOnly,
}: {
  call?: ViewCall;
  start?: Partial<DrawingSheet>;
  tool?: DrawingTool | null;
  readOnly?: boolean;
}) {
  const [drawing, setDrawing] = useState<Drawing>({
    id: "dr1",
    name: "Drawing 1",
    decimals: 2,
    sheets: [{ ...newSheet("Sheet 1", { size: "A3" }), ...start }],
  });
  const [tool, setTool] = useState<DrawingTool | null>(first);
  return (
    <>
      <DrawingBar name="Drawing 1" baseView={tool === "base"} onBaseView={() => setTool("base")} onSettings={vi.fn()} onFit={vi.fn()} />
      <div data-testid="sheet">{JSON.stringify(drawing.sheets[0])}</div>
      <DrawingPaper
        drawing={drawing}
        readOnly={readOnly}
        onTitle={vi.fn()}
        doc={doc}
        call={call}
        tool={tool}
        onTool={setTool}
        onSheet={(change) => setDrawing((d) => ({ ...d, sheets: [change(d.sheets[0]!)] }))}
        components={[{ id: "c1", name: "Arm" }]}
        bodies={[
          { id: "b1", name: "Plate" },
          { id: "b2", name: "Pin" },
        ]}
      />
    </>
  );
}
const sheetNow = () => JSON.parse(screen.getByTestId("sheet").textContent!) as DrawingSheet;
const kernel = (view: ModelView = plate) => vi.fn<ViewCall>(() => Promise.resolve(view));
const placed = {
  id: "v1",
  kind: "base" as const,
  shows: { all: true as const },
  direction: "front" as const,
  hidden: true,
  tangent: false,
  at: [100, 150] as [number, number],
};

describe("Base view", () => {
  it("opens its card with the whole model from the front, hidden edges on, and Fit worked out from the view", async () => {
    const call = kernel();
    render(<Harness call={call} />);
    await userEvent.click(screen.getByRole("button", { name: "Base view" }));
    const card = within(screen.getByRole("dialog", { name: "Base view" }));
    expect((card.getByRole("combobox", { name: "Show" }) as HTMLSelectElement).value).toBe("all");
    expect((card.getByRole("combobox", { name: "Direction" }) as HTMLSelectElement).value).toBe("front");
    expect((card.getByRole("checkbox", { name: "Hidden edges, dashed" }) as HTMLInputElement).checked).toBe(true);
    expect((card.getByRole("checkbox", { name: /Tangent edges/ }) as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect(card.getByRole("option", { name: "Fit, 2:1" })).toBeTruthy());
    // The view that follows the pointer is the quick kind: no hidden edges, no tracing.
    expect(call).toHaveBeenLastCalledWith(
      expect.objectContaining({ shows: { all: true }, hidden: false, trace: false, frame: { toEye: [0, -1, 0], up: [0, 0, 1] } }),
    );
    expect(card.getByRole("status").textContent).toMatch(/Click the sheet/);
  });

  it("Place puts the view in the middle of the clear space; the first view sets the sheet's scale", async () => {
    const call = kernel();
    render(<Harness call={call} tool="base" />);
    const card = within(screen.getByRole("dialog", { name: "Base view" }));
    await waitFor(() => expect(card.getByRole("option", { name: "Fit, 2:1" })).toBeTruthy());
    await userEvent.click(card.getByRole("button", { name: "Place" }));
    const s = sheetNow();
    expect(s.scale).toBe(2);
    expect(s.views).toHaveLength(1);
    expect(s.views[0]).toMatchObject({ kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false });
    expect(s.views[0]!.at[0]).toBeCloseTo(215);
    expect(screen.queryByRole("dialog", { name: "Base view" })).toBeNull();
    // The placed view is asked for in full, and drawn: what you see, and the hole behind dashed.
    const view = await screen.findByRole("button", { name: "Front view, 2:1" });
    expect(call).toHaveBeenLastCalledWith(expect.objectContaining({ hidden: true, trace: true }));
    expect(view.querySelector(".bc-view-visible")!.getAttribute("d")).toBe("M-40 20L40 20M40 20L40 -20");
    expect(view.querySelector(".bc-view-hidden")!.getAttribute("d")).toContain("A8 8");
    expect(view.getAttribute("aria-pressed")).toBe("true");
  });

  it("a click on the sheet puts the view down there, with what the card chose", async () => {
    render(<Harness call={kernel()} tool="base" />);
    const card = within(screen.getByRole("dialog", { name: "Base view" }));
    await userEvent.selectOptions(card.getByRole("combobox", { name: "Show" }), "Pin");
    await userEvent.selectOptions(card.getByRole("combobox", { name: "Direction" }), "Isometric, back left");
    await userEvent.selectOptions(card.getByRole("combobox", { name: "Scale" }), "1:2");
    await userEvent.click(card.getByRole("checkbox", { name: "Hidden edges, dashed" }));
    await waitFor(() => expect(card.getByRole("option", { name: "Fit, 2:1" })).toBeTruthy());
    const region = screen.getByRole("region", { name: "Drawing: Drawing 1" });
    fireEvent.pointerDown(region, { pointerId: 1, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(region, { pointerId: 1, clientX: 300, clientY: 200 });
    const s = sheetNow();
    expect(s.scale).toBe(0.5);
    expect(s.views[0]).toMatchObject({ shows: { bodies: ["b2"] }, direction: { toEye: [-1, 1, 1], up: [0, 0, 1] }, hidden: false });
    expect(await screen.findByRole("button", { name: "Isometric view, 1:2" })).toBeTruthy();
  });

  it("waits for the engine, and says when there is nothing to draw", async () => {
    const { unmount } = render(<Harness tool="base" />);
    expect(screen.getByRole("status").textContent).toBe("The geometry engine is starting.");
    await userEvent.click(screen.getByRole("button", { name: "Place" }));
    expect(sheetNow().views).toHaveLength(0);
    unmount();
    render(<Harness call={kernel({ ...plate, edges: [] })} tool="base" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/nothing to draw yet/));
  });

  it("Esc puts the tool away without placing anything", async () => {
    render(<Harness call={kernel()} tool="base" />);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Base view" })).toBeNull();
    expect(sheetNow().views).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Base view" }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("a placed view", () => {
  it("drags to move, by the pointer's travel in paper millimetres", async () => {
    render(<Harness call={kernel()} start={{ views: [placed] }} />);
    const view = await screen.findByRole("button", { name: "Front view, 1:1" });
    const region = screen.getByRole("region", { name: "Drawing: Drawing 1" });
    // The sheet fits a 1024 × 768 window here: 976 px across 420 mm.
    const k = (1024 - 48) / 420;
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(region, { pointerId: 1, clientX: 400 + 10 * k, clientY: 300 + 20 * k });
    fireEvent.pointerUp(region, { pointerId: 1, clientX: 400 + 10 * k, clientY: 300 + 20 * k });
    const at = sheetNow().views[0]!.at;
    expect(at[0]).toBeCloseTo(110);
    expect(at[1]).toBeCloseTo(130);
  });

  it("moves with the arrow keys, and Delete takes it off the sheet", async () => {
    render(<Harness call={kernel()} start={{ views: [placed] }} />);
    const view = await screen.findByRole("button", { name: "Front view, 1:1" });
    act(() => view.focus());
    await userEvent.keyboard("{ArrowRight}{ArrowUp}{Shift>}{ArrowLeft}{/Shift}");
    expect(sheetNow().views[0]!.at).toEqual([91, 151]);
    await userEvent.keyboard("{Delete}");
    expect(sheetNow().views).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Front view/ })).toBeNull();
  });

  it("double-click opens its card to change it; Done keeps the changes", async () => {
    render(<Harness call={kernel()} start={{ views: [placed, { ...placed, id: "v2", at: [250, 150] }] }} />);
    const views = await screen.findAllByRole("button", { name: "Front view, 1:1" });
    await userEvent.dblClick(views[1]!);
    const card = within(screen.getByRole("dialog", { name: "Base view" }));
    expect((card.getByRole("combobox", { name: "Scale" }) as HTMLSelectElement).value).toBe("1");
    await userEvent.selectOptions(card.getByRole("combobox", { name: "Direction" }), "Top");
    await userEvent.selectOptions(card.getByRole("combobox", { name: "Scale" }), "5:1");
    await userEvent.click(card.getByRole("button", { name: "Done" }));
    expect(sheetNow().views[1]).toMatchObject({ direction: "top", scale: 5, at: [250, 150] });
    expect(sheetNow().scale).toBe(1);
    expect(await screen.findByRole("button", { name: "Top view, 5:1" })).toBeTruthy();
  });

  it("says when a view is still being worked out or could not be drawn", async () => {
    const call = vi.fn<ViewCall>(() => Promise.reject(new Error("No such body")));
    render(<Harness call={call} start={{ views: [placed] }} />);
    expect(await screen.findByRole("button", { name: "Front view, 1:1, could not be drawn" })).toBeTruthy();
  });

  it("is only drawn in a view-only model", async () => {
    render(<Harness call={kernel()} start={{ views: [placed] }} readOnly />);
    const view = await screen.findByRole("button", { name: "Front view, 1:1" });
    await userEvent.dblClick(view);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => view.focus());
    await userEvent.keyboard("{Delete}");
    expect(sheetNow().views).toHaveLength(1);
  });

  it("does not ask the kernel again when only the title block or a view's place changes", async () => {
    const call = kernel();
    render(<Harness call={call} start={{ views: [placed] }} />);
    const view = await screen.findByRole("button", { name: "Front view, 1:1" });
    expect(call).toHaveBeenCalledTimes(1);
    act(() => view.focus());
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("the Drawing tab", () => {
  it("has Base view and the sheet's tools, and no Finish drawing", async () => {
    const p = { onBaseView: vi.fn(), onSettings: vi.fn(), onFit: vi.fn() };
    const { rerender } = render(<DrawingRibbon {...p} />);
    await userEvent.click(within(screen.getByRole("group", { name: "Create" })).getByRole("button", { name: "Base view" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Sheet" })).getByRole("button", { name: "Sheet settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Fit sheet" }));
    expect(screen.queryByRole("button", { name: "Finish drawing" })).toBeNull();
    expect([p.onBaseView, p.onSettings, p.onFit].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    rerender(<DrawingRibbon {...p} readOnly />);
    expect(screen.queryByRole("button", { name: "Base view" })).toBeNull();
    expect(screen.getByRole("button", { name: "Fit sheet" })).toBeTruthy();
  });
});
