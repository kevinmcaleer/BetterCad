import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingDimension, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import { newDoc, type Feature, type ModelDoc } from "../state/document";
import { DrawingPaper, type SelectedSize, type ViewCall } from "./DrawingView";
import SizeProps from "./SizeProps";

const edge = (index: number, name: string) => ({ body: "b1", kind: "edge" as const, index, name });
/** A 60 by 40 plate seen from above: its long edge is sketch line l1, its short one l2. */
const plate = {
  edges: [
    { curve: { kind: "line", a: [0, 0], b: [60, 0] }, visible: true, type: "sharp", source: edge(0, "cap.end|side(l1)") },
    { curve: { kind: "line", a: [60, 0], b: [60, 40] }, visible: true, type: "sharp", source: edge(1, "cap.end|side(l2)") },
  ],
  box: { min: [0, 0], max: [60, 40] },
  rounds: [],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
const features = [
  {
    id: "s1",
    type: "sketch",
    name: "Sketch 1",
    sketch: {
      entities: [
        { id: "l1", kind: "line", a: "p1", b: "p2" },
        { id: "l2", kind: "line", a: "p2", b: "p3" },
      ],
      dimensions: [{ id: "k1", name: "d1", kind: "length", refs: ["l1"], value: 60, expression: "60", driving: true, labelOffset: [0, 0] }],
    },
  },
  { id: "e1", type: "extrude", name: "Extrude 1", sketch: "s1", distance: 5, body: { id: "b1", name: "Plate" } },
] as unknown as Feature[];
const doc: ModelDoc = { ...newDoc(), name: "Plate", features };
const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "top", hidden: true, tangent: false, at: [150, 150] };
const ref = (index: number, name: string) => ({ view: "v1", ...edge(index, name) });
const long: DrawingDimension = { id: "d1", view: "v1", kind: "linear", refs: [ref(0, "cap.end|side(l1)")], across: "aligned", at: [0, -40], auto: true };
const short: DrawingDimension = { id: "d2", view: "v1", kind: "linear", refs: [ref(1, "cap.end|side(l2)")], across: "aligned", at: [50, 0] };

const onEditModel = vi.fn();
const say = vi.fn();

function Harness({ readOnly }: { readOnly?: boolean }) {
  const [drawing, setDrawing] = useState<Drawing>({
    id: "dr1",
    name: "Drawing 1",
    decimals: 2,
    sheets: [{ ...newSheet("Sheet 1", { size: "A3" }), views: [front], dimensions: [long, short] }],
  });
  const [size, setSize] = useState<SelectedSize | null>(null);
  const [call] = useState(() => vi.fn<ViewCall>(() => Promise.resolve(plate)));
  const onSheet = (change: (s: Drawing["sheets"][number]) => Drawing["sheets"][number]) => setDrawing((d) => ({ ...d, sheets: d.sheets.map(change) }));
  return (
    <>
      <div data-testid="sizes">{JSON.stringify(drawing.sheets[0]!.dimensions.map((d) => [d.id, d.decimals ?? null, !!d.auto]))}</div>
      <DrawingPaper
        drawing={drawing}
        readOnly={readOnly}
        onTitle={vi.fn()}
        doc={doc}
        call={call}
        say={say}
        onSheet={onSheet}
        onSelectSize={setSize}
        onEditModel={onEditModel}
      />
      {size && <SizeProps drawing={drawing} sheet={drawing.sheets[0]!} size={size} doc={doc} onSheet={onSheet} onEditModel={onEditModel} />}
    </>
  );
}

describe("Edit in model from a drawing's size", () => {
  it("a double-click or Enter opens the sketch dimension that sets it", async () => {
    onEditModel.mockClear();
    render(<Harness />);
    const size = await screen.findByRole("button", { name: "Dimension, 60 mm" });
    fireEvent.doubleClick(size);
    await waitFor(() => expect(onEditModel).toHaveBeenLastCalledWith("s1", "k1"));
    size.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(onEditModel).toHaveBeenCalledTimes(2));
  });

  it("says so when no one thing sets the size, and the menu offers it too", async () => {
    onEditModel.mockClear();
    say.mockClear();
    render(<Harness />);
    const size = await screen.findByRole("button", { name: "Dimension, 40 mm" });
    fireEvent.contextMenu(size);
    await userEvent.click(screen.getByRole("menuitem", { name: /^Edit in model/ }));
    await waitFor(() => expect(say).toHaveBeenLastCalledWith("No one sketch dimension or step sets this size. Change the model to change it."));
    expect(onEditModel).not.toHaveBeenCalled();
  });

  it("does nothing in a view-only model", async () => {
    onEditModel.mockClear();
    render(<Harness readOnly />);
    fireEvent.doubleClick(await screen.findByRole("button", { name: "Dimension, 60 mm" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(onEditModel).not.toHaveBeenCalled();
  });
});

describe("a size in the properties panel", () => {
  it("shows what it measures and where the model sets it, with Edit in model", async () => {
    onEditModel.mockClear();
    render(<Harness />);
    (await screen.findByRole("button", { name: "Dimension, 60 mm" })).focus();
    const panel = await screen.findByRole("complementary", { name: "Properties" });
    expect(panel).toHaveTextContent("Length60 mm");
    expect(panel).toHaveTextContent("Set by d1 in Sketch 1. A drawing's sizes follow the model, so change it there.");
    await userEvent.click(screen.getByRole("button", { name: "Edit in model" }));
    expect(onEditModel).toHaveBeenLastCalledWith("s1", "k1");
  });

  it("gives the size decimal places of its own, which makes it yours and not Auto dimension's", async () => {
    render(<Harness />);
    (await screen.findByRole("button", { name: "Dimension, 60 mm" })).focus();
    const places = await screen.findByRole("combobox", { name: "Decimal places" });
    expect(places).toHaveValue("");
    expect(screen.getByRole("option", { name: "As the drawing (2)" })).toBeInTheDocument();
    await userEvent.selectOptions(places, "0");
    expect(screen.getByTestId("sizes")).toHaveTextContent('[["d1",0,false],["d2",null,false]]');
    await userEvent.selectOptions(places, "");
    expect(screen.getByTestId("sizes")).toHaveTextContent('[["d1",null,false],["d2",null,false]]');
  });

  it("says when nothing sets the size, and goes when the sheet is pressed", async () => {
    render(<Harness />);
    (await screen.findByRole("button", { name: "Dimension, 40 mm" })).focus();
    const panel = await screen.findByRole("complementary", { name: "Properties" });
    expect(panel).toHaveTextContent("No one sketch dimension or step sets this size. It follows the model as it is.");
    expect(screen.queryByRole("button", { name: "Edit in model" })).toBeNull();
    fireEvent.pointerDown(document.querySelector(".bc-sheet-paper")!, { button: 0, pointerId: 1 });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Properties" })).toBeNull());
  });
});
