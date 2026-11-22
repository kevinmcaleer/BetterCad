import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingBar, DrawingPaper, DrawingRibbon, type DrawingTool, type ViewCall } from "./DrawingView";

/** Every view of this model is a 40 × 20 mm outline. */
const plate: ModelView = {
  edges: [{ curve: { kind: "line", a: [0, 0], b: [40, 20] }, visible: true, type: "sharp" }],
  box: { min: [0, 0], max: [40, 20] },
  rounds: [],
  bodies: ["b1"],
  ms: 1,
};
const doc = { ...newDoc(), name: "Plate" };
const front: DrawingView = { id: "f", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const top: DrawingView = { ...front, id: "t", kind: "projected", parent: "f", direction: "top", at: [150, 220] };

function Harness({
  start,
  tool: first = "projected",
  standard = "asme",
}: {
  start?: Partial<DrawingSheet>;
  tool?: DrawingTool | null;
  standard?: "iso" | "asme";
}) {
  const [drawing, setDrawing] = useState<Drawing>({
    id: "dr1",
    name: "Drawing 1",
    decimals: 2,
    sheets: [{ ...newSheet("Sheet 1", { size: "A3", standard }), views: [front], ...start }],
  });
  const [tool, setTool] = useState<DrawingTool | null>(first);
  const [call] = useState(() => vi.fn<ViewCall>(() => Promise.resolve(plate)));
  return (
    <>
      <DrawingBar
        name="Drawing 1"
        projectedView={tool === "projected"}
        onProjectedView={() => setTool("projected")}
        onSettings={vi.fn()}
        onFit={vi.fn()}
        onFinish={vi.fn()}
      />
      <div data-testid="sheet">{JSON.stringify(drawing.sheets[0])}</div>
      <DrawingPaper
        drawing={drawing}
        onTitle={vi.fn()}
        doc={doc}
        call={call}
        tool={tool}
        onTool={setTool}
        onSheet={(change) => setDrawing((d) => ({ ...d, sheets: [change(d.sheets[0]!)] }))}
      />
    </>
  );
}
const sheetNow = () => JSON.parse(screen.getByTestId("sheet").textContent!) as DrawingSheet;
/** The sheet fits a 1024 × 768 window here; a sheet position (mm from the bottom left) as a point of the window. */
const k = (1024 - 48) / 420;
const px = (x: number, y: number) => ({ clientX: 24 + x * k, clientY: (768 - 297 * k) / 2 + (297 - y) * k });
const region = () => screen.getByRole("region", { name: "Drawing: Drawing 1" });
const clickAt = (x: number, y: number) => {
  fireEvent.pointerMove(region(), { pointerId: 1, ...px(x, y) });
  fireEvent.pointerDown(region(), { pointerId: 1, ...px(x, y) });
  fireEvent.pointerUp(region(), { pointerId: 1, ...px(x, y) });
};
const ready = () => waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Move the pointer away/));

describe("Projected view", () => {
  it("starts from the only view, and each click puts a view down in line with it until you finish", async () => {
    render(<Harness />);
    const card = within(screen.getByRole("dialog", { name: "Projected view" }));
    expect((card.getByRole("combobox", { name: "From" }) as HTMLSelectElement).value).toBe("f");
    await ready();
    clickAt(152, 230);
    clickAt(260, 158);
    clickAt(250, 240);
    const views = sheetNow().views;
    expect(views.map((v) => [v.kind, v.parent, v.direction, v.at.map(Math.round)])).toEqual([
      ["base", undefined, "front", [150, 150]],
      ["projected", "f", "top", [150, 230]],
      ["projected", "f", "right", [260, 150]],
      ["projected", "f", "iso", [250, 240]],
    ]);
    expect(await screen.findByRole("button", { name: "Top view, 1:1" })).toBeTruthy();
    // Still armed. Enter finishes.
    expect(screen.getByRole("dialog", { name: "Projected view" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: "Projected view" })).toBeNull();
  });

  it("first angle puts the top view below and the right view on the left", async () => {
    render(<Harness standard="iso" />);
    await ready();
    clickAt(150, 60);
    clickAt(40, 150);
    expect(
      sheetNow()
        .views.slice(1)
        .map((v) => v.direction),
    ).toEqual(["top", "right"]);
    expect(await screen.findByRole("button", { name: "Right view, 1:1" })).toBeTruthy();
  });

  it("a click on the parent itself places nothing", async () => {
    render(<Harness />);
    await ready();
    clickAt(155, 152);
    expect(sheetNow().views).toHaveLength(1);
  });

  it("works from the card: pick the view and the side, then Place; Esc finishes", async () => {
    render(<Harness start={{ views: [front, { ...front, id: "g", direction: "top", at: [300, 150] }] }} />);
    const card = within(screen.getByRole("dialog", { name: "Projected view" }));
    expect(card.getByRole("status").textContent).toBe("Click the view to project from.");
    await userEvent.selectOptions(card.getByRole("combobox", { name: "From" }), "Top view, 1:1");
    await userEvent.selectOptions(card.getByRole("combobox", { name: "Side" }), "Below");
    await waitFor(() => expect(card.getByRole("status").textContent).toMatch(/Move the pointer away/));
    await userEvent.click(card.getByRole("button", { name: "Place" }));
    // Below a top view in third angle is the front; 15 mm clear of its 20 mm tall parent.
    expect(sheetNow().views[2]).toMatchObject({ kind: "projected", parent: "g", direction: "front", at: [300, 115] });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Projected view" })).toBeNull();
  });

  it("with several views and none selected, the first click picks the one to project from", async () => {
    render(<Harness start={{ views: [front, { ...front, id: "g", at: [300, 150] }] }} />);
    const views = await screen.findAllByRole("button", { name: "Front view, 1:1" });
    fireEvent.pointerDown(views[1]!, { pointerId: 1, ...px(300, 150) });
    fireEvent.pointerUp(region(), { pointerId: 1, ...px(300, 150) });
    expect((screen.getByRole("combobox", { name: "From" }) as HTMLSelectElement).value).toBe("g");
    expect(sheetNow().views).toHaveLength(2);
    await ready();
  });

  it("says to put a base view down first on an empty sheet", () => {
    render(<Harness start={{ views: [] }} />);
    expect(screen.getByRole("status").textContent).toBe("Put a base view on the sheet first.");
    expect(screen.getByRole("button", { name: "Place" }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("a projected view on the sheet", () => {
  it("drags along its line only, and its parent carries it", async () => {
    render(<Harness tool={null} start={{ views: [front, top] }} />);
    const child = await screen.findByRole("button", { name: "Top view, 1:1" });
    fireEvent.pointerDown(child, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(region(), { pointerId: 1, clientX: 400 + 30 * k, clientY: 300 - 10 * k });
    fireEvent.pointerUp(region(), { pointerId: 1, clientX: 400 + 30 * k, clientY: 300 - 10 * k });
    expect(sheetNow().views[1]!.at.map(Math.round)).toEqual([150, 230]);
    const parent = screen.getByRole("button", { name: "Front view, 1:1" });
    act(() => parent.focus());
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}{ArrowDown}");
    expect(sheetNow().views.map((v) => v.at.map(Math.round))).toEqual([
      [160, 149],
      [160, 229],
    ]);
  });

  it("opens a card with only its scale and lines; its own scale is written under it", async () => {
    render(<Harness tool={null} start={{ views: [front, top] }} />);
    await userEvent.dblClick(await screen.findByRole("button", { name: "Top view, 1:1" }));
    const card = within(screen.getByRole("dialog", { name: "Projected view" }));
    expect(card.queryByRole("combobox", { name: "Direction" })).toBeNull();
    expect(card.queryByRole("combobox", { name: "Show" })).toBeNull();
    expect(card.getByRole("option", { name: "As its parent, 1:1" })).toBeTruthy();
    await userEvent.selectOptions(card.getByRole("combobox", { name: "Scale" }), "2:1");
    await userEvent.click(card.getByRole("button", { name: "Done" }));
    expect(sheetNow().views[1]).toMatchObject({ scale: 2, direction: "top", parent: "f" });
    const view = await screen.findByRole("button", { name: "Top view, 2:1" });
    expect(within(view).getByText("Scale 2:1")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Front view, 1:1" })).queryByText(/Scale/)).toBeNull();
  });

  it("deleting a parent asks first, then keeps its views as base views", async () => {
    render(<Harness tool={null} start={{ views: [front, top] }} />);
    const parent = await screen.findByRole("button", { name: "Front view, 1:1" });
    act(() => parent.focus());
    await userEvent.keyboard("{Delete}");
    const ask = within(screen.getByRole("dialog", { name: "Delete this view?" }));
    expect(ask.getByText("The view projected from it stays on the sheet as a base view.")).toBeTruthy();
    expect(sheetNow().views).toHaveLength(2);
    await userEvent.click(ask.getByRole("button", { name: "Delete" }));
    expect(sheetNow().views).toEqual([{ ...top, kind: "base", parent: undefined, scale: 1 }].map((v) => JSON.parse(JSON.stringify(v))));
  });
});

describe("the Drawing tab and bar", () => {
  it("have Projected view beside Base view", async () => {
    const p = { onBaseView: vi.fn(), onProjectedView: vi.fn(), onSettings: vi.fn(), onFit: vi.fn(), onFinish: vi.fn() };
    render(<DrawingRibbon {...p} />);
    await userEvent.click(within(screen.getByRole("group", { name: "Create" })).getByRole("button", { name: "Projected view" }));
    expect(p.onProjectedView).toHaveBeenCalledTimes(1);
  });
});
