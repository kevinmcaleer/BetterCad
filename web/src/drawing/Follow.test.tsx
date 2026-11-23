import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  newSheet,
  type Drawing,
  type DrawingDimension,
  type DrawingMark,
  type DrawingRef,
  type DrawingSheet,
  type DrawingView,
} from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingPaper, type DrawingTool, type ViewCall } from "./DrawingView";
import { stamp } from "./follow";

const TAU = Math.PI * 2;
const edge = (index: number, name: string) => ({ body: "b1", kind: "edge" as const, index, name });
const face = (index: number, name: string) => ({ body: "b1", kind: "face" as const, index, name });
const line = (index: number, a: V2, b: V2, name: string) => ({ curve: { kind: "line", a, b }, visible: true, type: "sharp", source: edge(index, name) });
/** A plate `w` mm wide and 40 mm tall with a 5 mm hole, and a 3 mm fillet unless it has been deleted. */
const plate = ({ w = 60, fillet = true, bored = true } = {}) =>
  ({
    edges: [line(0, [0, 0], [w, 0], "bottom"), line(1, [w, 0], [w, 40], "right"), line(2, [w, 40], [0, 40], "top"), line(3, [0, 40], [0, 0], "left")],
    box: { min: [0, 0], max: [w, 40] },
    rounds: [
      ...(bored ? [{ seen: "end", c: [20, 20], r: 2.5, hole: true, sweep: TAU, source: face(20, "bore") }] : []),
      ...(fillet ? [{ seen: "end", c: [w - 3, 37], r: 3, hole: false, sweep: TAU / 4, source: edge(21, "fillet") }] : []),
    ],
    bodies: ["b1"],
    ms: 1,
  }) as unknown as ModelView;
const empty = { edges: [], box: { min: [0, 0], max: [0, 0] }, rounds: [], bodies: [], ms: 1 } as unknown as ModelView;

const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const e = (index: number, name: string): DrawingRef => ({ view: "v1", ...edge(index, name) });
const width: DrawingDimension = { id: "width", view: "v1", kind: "linear", refs: [e(0, "bottom")], across: "aligned", at: [0, -30] };
const height: DrawingDimension = { id: "height", view: "v1", kind: "linear", refs: [e(3, "left")], across: "aligned", at: [-40, 0] };
const radius: DrawingDimension = { id: "radius", view: "v1", kind: "radius", refs: [e(21, "fillet")], at: [45, 30] };
const mark: DrawingMark = { id: "m1", kind: "centre-mark", on: { view: "v1", ...face(20, "bore") } };
/** The sheet as it was saved when the plate was 60 mm wide. */
const saved = (dimensions: DrawingDimension[], marks: DrawingMark[] = [], more: Partial<DrawingSheet> = {}) =>
  stamp({ ...newSheet("Sheet 1", { size: "A3" }), views: [front], dimensions, marks, ...more }, () => plate(), 2);
const say = vi.fn();
const onProblems = vi.fn();
beforeEach(() => {
  say.mockClear();
  onProblems.mockClear();
});

function Harness({ sheet, then, readOnly }: { sheet: DrawingSheet; then: ModelView; readOnly?: boolean }) {
  const [drawing, setDrawing] = useState<Drawing>({ id: "dr1", name: "Drawing 1", decimals: 2, sheets: [sheet] });
  const [doc, setDoc] = useState(() => ({ ...newDoc(), name: "Plate" }));
  const [tool, setTool] = useState<DrawingTool | null>(null);
  const model = useRef(plate());
  const [call] = useState(() => vi.fn<ViewCall>(() => Promise.resolve(model.current)));
  return (
    <>
      <button
        onClick={() => {
          model.current = then;
          setDoc((d) => ({ ...d, features: [...d.features] }));
        }}
      >
        Change the model
      </button>
      <div data-testid="sheet">{JSON.stringify(drawing.sheets[0])}</div>
      <div data-testid="tool">{tool ?? "none"}</div>
      <DrawingPaper
        drawing={drawing}
        readOnly={readOnly}
        onTitle={vi.fn()}
        doc={doc}
        call={call}
        tool={tool}
        onTool={setTool}
        say={say}
        onProblems={onProblems}
        onSheet={(change) => setDrawing((d) => ({ ...d, sheets: [change(d.sheets[0]!)] }))}
      />
    </>
  );
}
const sheetNow = () => JSON.parse(screen.getByTestId("sheet").textContent!) as DrawingSheet;
const changeModel = () => userEvent.click(screen.getByRole("button", { name: "Change the model" }));
const lost = (name: string) => screen.findByRole("button", { name: `${name}. What it was fixed to is no longer in the model.` });

describe("a drawing follows its model", () => {
  it("widen the plate: the width reads 80 mm in its row and the height moves out with the outline", async () => {
    render(<Harness sheet={saved([width, height])} then={plate({ w: 80 })} />);
    await screen.findByRole("button", { name: "Dimension, 60 mm" });
    await changeModel();
    await screen.findByRole("button", { name: "Dimension, 80 mm" });
    expect(screen.queryByRole("button", { name: "Dimension, 60 mm" })).toBeNull();
    expect(onProblems).toHaveBeenLastCalledWith(0);
    // Nothing is written down until you change something; then the new places go in with it, as one step.
    expect(sheetNow().dimensions.map((d) => d.at)).toEqual([
      [0, -30],
      [-40, 0],
    ]);
    const size = screen.getByRole("button", { name: "Dimension, 80 mm" });
    size.focus();
    fireEvent.keyDown(size, { key: "ArrowDown" });
    await waitFor(() => expect(sheetNow().dimensions[1]!.at).toEqual([-50, 0]));
    expect(sheetNow().views[0]!.laid).toMatchObject({ w: 80, h: 40 });
  });

  it("delete the fillet: its radius becomes a warning where it was, the browser is told, and Delete takes it off", async () => {
    render(<Harness sheet={saved([width, radius])} then={plate({ fillet: false })} />);
    await screen.findByRole("button", { name: "Dimension, R3 mm" });
    expect(onProblems).toHaveBeenLastCalledWith(0);
    await changeModel();
    const warning = await lost("Lost dimension");
    expect(screen.queryByRole("button", { name: "Dimension, R3 mm" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dimension, 60 mm" })).toBeTruthy();
    expect(onProblems).toHaveBeenLastCalledWith(1);
    expect(say).toHaveBeenLastCalledWith("1 problem on this sheet. Right-click a warning to pick again or delete it.");
    fireEvent.keyDown(warning, { key: "Delete" });
    await waitFor(() => expect(sheetNow().dimensions.map((d) => d.id)).toEqual(["width"]));
    expect(onProblems).toHaveBeenLastCalledWith(0);
  });

  it("Pick again arms the tool, and the lost one goes when its replacement is placed", async () => {
    render(<Harness sheet={saved([radius], [mark])} then={plate({ fillet: false, bored: false })} />);
    await screen.findByRole("button", { name: "Centre mark" });
    await changeModel();
    await lost("Lost centre mark");
    fireEvent.contextMenu(await lost("Lost dimension"), { clientX: 300, clientY: 200 });
    const menu = within(screen.getByRole("menu", { name: "Warning actions" }));
    expect(menu.getByRole("menuitem", { name: /^Delete/ })).toBeTruthy();
    await userEvent.click(menu.getByRole("menuitem", { name: "Pick again" }));
    expect(screen.getByTestId("tool").textContent).toBe("dimension");
    await userEvent.click(screen.getAllByRole("button", { name: "Edge, 40 mm long" })[0]!);
    await userEvent.click(within(screen.getByRole("dialog", { name: "Dimension" })).getByRole("button", { name: "Place" }));
    await waitFor(() => expect(sheetNow().dimensions).toHaveLength(1));
    expect(sheetNow().dimensions[0]!.id).not.toBe("radius");
    expect(sheetNow().dimensions[0]!.kind).toBe("linear");
    // The lost mark is still there to deal with.
    expect(sheetNow().marks).toHaveLength(1);
    expect(onProblems).toHaveBeenLastCalledWith(1);
  });

  it("delete the body: the view is an empty frame that says so, never a silent blank", async () => {
    render(<Harness sheet={saved([width], [mark])} then={empty} />);
    await screen.findByRole("button", { name: "Front view, 1:1" });
    await changeModel();
    await screen.findByRole("button", { name: "Front view, 1:1, nothing to show" });
    expect(screen.getByText("Nothing to show")).toBeTruthy();
    expect(onProblems).toHaveBeenLastCalledWith(1);
    // What was on it is not counted again, and comes back with the body.
    expect(sheetNow().dimensions).toHaveLength(1);
  });

  it("only shows the warnings on a drawing you can only read", async () => {
    render(<Harness sheet={saved([radius])} then={plate({ fillet: false })} readOnly />);
    await screen.findByRole("button", { name: "Dimension, R3 mm" });
    await changeModel();
    const warning = await lost("Lost dimension");
    fireEvent.keyDown(warning, { key: "Delete" });
    fireEvent.contextMenu(warning, { clientX: 300, clientY: 200 });
    expect(screen.queryByRole("menu", { name: "Warning actions" })).toBeNull();
    expect(sheetNow().dimensions).toHaveLength(1);
  });

  it("Run Auto dimension again is on a view's menu once it has been run, and refreshes its sizes", async () => {
    const auto = { recipe: "baseline" as const, datum: "bottom-left" as const, density: 0 };
    render(<Harness sheet={saved([{ ...width, auto: true }], [], { auto })} then={plate({ w: 80 })} />);
    await screen.findByRole("button", { name: "Dimension, 60 mm" });
    await changeModel();
    await screen.findByRole("button", { name: "Dimension, 80 mm" });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Front view, 1:1" }), { clientX: 300, clientY: 200 });
    await userEvent.click(within(screen.getByRole("menu", { name: "View actions" })).getByRole("menuitem", { name: "Run Auto dimension again" }));
    // The two overall sizes, in place of the one it added before.
    await waitFor(() => expect(sheetNow().dimensions).toHaveLength(2));
    expect(sheetNow().dimensions.every((d) => d.auto)).toBe(true);
    expect(say).toHaveBeenLastCalledWith("Auto dimension ran again: 2 sizes.");
  });

  it("has no Run again before Auto dimension has been run", async () => {
    render(<Harness sheet={saved([width])} then={plate()} />);
    await screen.findByRole("button", { name: "Dimension, 60 mm" });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Front view, 1:1" }), { clientX: 300, clientY: 200 });
    expect(within(screen.getByRole("menu", { name: "View actions" })).queryByRole("menuitem", { name: "Run Auto dimension again" })).toBeNull();
  });
});
