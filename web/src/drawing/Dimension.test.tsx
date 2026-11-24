import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingDimension, type DrawingRef, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingBar, DrawingPaper, DrawingRibbon, type DrawingTool, type ViewCall } from "./DrawingView";
import { sceneDxf } from "./export/dxf";
import { sheetScene } from "./export/scene";
import { sceneSvg } from "./export/svg";
import { sheetLayout } from "./layout";
import { decimalsChange } from "./ops";

const TAU = Math.PI * 2;
const face = (index: number, name: string) => ({ body: "b1", kind: "face" as const, index, name });
const edge = (index: number) => ({ body: "b1", kind: "edge" as const, index });
const bolts: V2[] = [0, 1, 2, 3].map((i) => [Math.round(20 * Math.cos((i * TAU) / 4)), Math.round(20 * Math.sin((i * TAU) / 4))]);
/** A 60 mm plate with a chamfered corner, four 5 mm holes on a bolt circle and a 12 mm bore. */
const plate = {
  edges: [
    { curve: { kind: "line", a: [-30, -30], b: [30, -30] }, visible: true, type: "sharp", source: edge(0) },
    { curve: { kind: "line", a: [30, -30], b: [30, 20] }, visible: true, type: "sharp", source: edge(1) },
    { curve: { kind: "line", a: [30, 20], b: [20, 30] }, visible: true, type: "sharp", source: edge(2) },
    { curve: { kind: "line", a: [20, 30], b: [-30, 30] }, visible: true, type: "sharp", source: edge(3) },
  ],
  box: { min: [-30, -30], max: [30, 30] },
  rounds: [
    ...bolts.map((c, i) => ({ seen: "end", c, r: 2.5, hole: true, sweep: TAU, source: face(10 + i, `hole${i}`) })),
    { seen: "end", c: [0, 0], r: 6, hole: true, sweep: TAU, source: face(20, "bore") },
  ],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const doc = { ...newDoc(), name: "Plate" };
const e = (index: number, at?: DrawingRef["at"]): DrawingRef => ({ view: "v1", ...edge(index), ...(at ? { at } : {}) });
const bore: DrawingRef = { view: "v1", ...face(20, "bore") };
const length: DrawingDimension = { id: "d1", view: "v1", kind: "linear", refs: [e(0)], across: "aligned", at: [0, -40] };

function Harness({
  tool: first = null,
  dimensions = [],
  readOnly,
  view = front,
}: {
  tool?: DrawingTool | null;
  dimensions?: DrawingDimension[];
  readOnly?: boolean;
  view?: DrawingView;
}) {
  const [drawing, setDrawing] = useState<Drawing>({
    id: "dr1",
    name: "Drawing 1",
    decimals: 2,
    sheets: [{ ...newSheet("Sheet 1", { size: "A3" }), views: [view], dimensions }],
  });
  const [tool, setTool] = useState<DrawingTool | null>(first);
  const [call] = useState(() => vi.fn<ViewCall>(() => Promise.resolve(plate)));
  return (
    <>
      <div data-testid="sheet">{JSON.stringify(drawing.sheets[0])}</div>
      <div data-testid="places">{drawing.decimals}</div>
      <DrawingPaper
        drawing={drawing}
        readOnly={readOnly}
        onTitle={vi.fn()}
        doc={doc}
        call={call}
        tool={tool}
        onTool={setTool}
        onDecimals={(decimals) => setDrawing((d) => ({ ...d, decimals }))}
        onSheet={(change) => setDrawing((d) => ({ ...d, sheets: [change(d.sheets[0]!)] }))}
      />
    </>
  );
}
const sheetNow = () => JSON.parse(screen.getByTestId("sheet").textContent!) as DrawingSheet;
const status = () => within(screen.getByRole("dialog", { name: "Dimension" })).getByRole("status").textContent;
const place = () => userEvent.click(within(screen.getByRole("dialog", { name: "Dimension" })).getByRole("button", { name: "Place" }));

describe("the Dimension tool", () => {
  it("offers edges, circles and points; the middles of edges only once something is picked", async () => {
    render(<Harness tool="dimension" />);
    expect(status()).toMatch(/^Click an edge for its length, a circle for its size, or a point to measure from\./);
    expect(await screen.findAllByRole("button", { name: "Edge, 50 mm long" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Hole, 5 mm across" })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Point at 30, -30 mm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Centre at 0, 0 mm" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Midpoint/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Point at 30, -30 mm" }));
    expect(screen.getByRole("button", { name: "Midpoint at 0, -30 mm" })).toBeTruthy();
    expect(status()).toBe("Now click a second point or an edge to measure to.");
    expect(within(screen.getByRole("dialog", { name: "Dimension" })).queryByRole("button", { name: "Place" })).toBeNull();
  });

  it("sizes an edge: one click, then Place puts its length under the view", async () => {
    render(<Harness tool="dimension" />);
    const bottom = await screen.findByRole("button", { name: "Edge, 60 mm long" });
    await userEvent.click(bottom);
    expect(bottom.getAttribute("aria-pressed")).toBe("true");
    expect(status()).toMatch(/^Click the sheet to place the size, or click a second edge or point/);
    await place();
    expect(sheetNow().dimensions).toEqual([{ id: expect.any(String), view: "v1", kind: "linear", refs: [e(0)], across: "aligned", at: [0, -40] }]);
    expect(screen.getByRole("button", { name: "Dimension, 60 mm" })).toBeTruthy();
    // The tool stays armed for the next size, with nothing picked.
    expect(status()).toMatch(/^Click an edge for its length/);
    expect(screen.getByRole("button", { name: "Edge, 60 mm long" }).getAttribute("aria-pressed")).toBeNull();
  });

  it("sizes between two points, from an edge to a point, and a circle, from the keyboard too", async () => {
    render(<Harness tool="dimension" />);
    const holes = await screen.findAllByRole("button", { name: "Hole, 5 mm across" });
    await userEvent.click(screen.getByRole("button", { name: "Centre at 20, 0 mm" }));
    await userEvent.click(screen.getByRole("button", { name: "Centre at 0, 20 mm" }));
    expect(status()).toBe("Click the sheet to place the size.");
    await place();
    await userEvent.click(screen.getAllByRole("button", { name: "Edge, 50 mm long" })[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Centre at 0, 0 mm" }));
    await place();
    act(() => holes[2]!.focus());
    await userEvent.keyboard("{Enter}");
    await place();
    const bore = screen.getByRole("button", { name: "Hole, 12 mm across" });
    act(() => bore.focus());
    await userEvent.keyboard(" ");
    await place();
    expect(sheetNow().dimensions.map((d) => [d.kind, d.across, d.refs.map((r) => `${r.name ?? r.index}${r.at ? ` ${r.at}` : ""}`)])).toEqual([
      ["linear", "x", ["hole0 centre", "hole1 centre"]],
      ["linear", "aligned", ["1", "bore centre"]],
      ["diameter", undefined, ["hole2"]],
      ["diameter", undefined, ["bore"]],
    ]);
    for (const name of ["Dimension, 20 mm", "Dimension, 30 mm", "Dimension, 4× Ø5 mm", "Dimension, Ø12 mm"])
      expect(screen.getByRole("button", { name })).toBeTruthy();
  });

  it("sizes the angle between two edges", async () => {
    render(<Harness tool="dimension" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Edge, 50 mm long" }))[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Edge, 14.14 mm long" }));
    await place();
    expect(sheetNow().dimensions[0]).toMatchObject({ kind: "angle", refs: [e(1), e(2)] });
    expect(screen.getByRole("button", { name: "Dimension, 135°" })).toBeTruthy();
  });

  it("lets go of a pick clicked again, and Esc lets go before it finishes", async () => {
    render(<Harness tool="dimension" />);
    const bottom = await screen.findByRole("button", { name: "Edge, 60 mm long" });
    await userEvent.click(bottom);
    await userEvent.click(bottom);
    expect(status()).toMatch(/^Click an edge for its length/);
    await userEvent.click(bottom);
    await userEvent.keyboard("{Escape}");
    expect(status()).toMatch(/^Click an edge for its length/);
    expect(sheetNow().dimensions).toEqual([]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Dimension" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edge, 60 mm long" })).toBeNull();
  });

  it("keeps to aligned in an isometric view", async () => {
    render(<Harness tool="dimension" view={{ ...front, direction: { toEye: [1, -1, 1], up: [0, 0, 1] } }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Centre at 20, 0 mm" }));
    await userEvent.click(screen.getByRole("button", { name: "Centre at 0, 20 mm" }));
    await place();
    expect(sheetNow().dimensions[0]).toMatchObject({ across: "aligned" });
    expect(screen.getByRole("button", { name: "Dimension, 28.28 mm" })).toBeTruthy();
  });

  it("sets how many decimal places the drawing's sizes show", async () => {
    const pair: DrawingDimension = {
      id: "d2",
      view: "v1",
      kind: "linear",
      refs: [
        { view: "v1", ...face(10, "hole0"), at: "centre" },
        { view: "v1", ...face(11, "hole1"), at: "centre" },
      ],
      across: "aligned",
      at: [20, 20],
    };
    render(<Harness tool="dimension" dimensions={[pair]} />);
    expect(await screen.findByRole("button", { name: "Dimension, 28.28 mm" })).toBeTruthy();
    const places = within(screen.getByRole("dialog", { name: "Dimension" })).getByRole("combobox", { name: "Sizes show" }) as HTMLSelectElement;
    expect(places.value).toBe("2");
    await userEvent.selectOptions(places, "No decimal places");
    expect(screen.getByTestId("places").textContent).toBe("0");
    expect(screen.getByRole("button", { name: "Dimension, 28 mm" })).toBeTruthy();
  });
});

describe("a dimension on the sheet", () => {
  it("is moved by the arrow keys, further with Shift, and deleted with Delete; its view stays put", async () => {
    render(<Harness dimensions={[length]} />);
    const dim = await screen.findByRole("button", { name: "Dimension, 60 mm" });
    act(() => dim.focus());
    expect(dim.getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    expect(sheetNow().dimensions[0]!.at).toEqual([1, -41]);
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(sheetNow().dimensions[0]!.at).toEqual([1, -51]);
    expect(sheetNow().views[0]!.at).toEqual([150, 150]);
    await userEvent.keyboard("{Delete}");
    expect(sheetNow().dimensions).toEqual([]);
    expect(sheetNow().views).toHaveLength(1);
  });

  it("is dragged by its text, and is no longer Auto dimension's once moved", async () => {
    render(<Harness dimensions={[{ ...length, auto: true }]} />);
    const dim = await screen.findByRole("button", { name: "Dimension, 60 mm" });
    fireEvent.pointerDown(dim, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(dim, { pointerId: 1, clientX: 100, clientY: 130 });
    fireEvent.pointerUp(dim, { pointerId: 1, clientX: 100, clientY: 130 });
    const moved = sheetNow().dimensions[0]!;
    // Down the screen is down the sheet, by the pointer's pixels at the sheet's zoom.
    expect(moved.at[0]).toBe(0);
    expect(moved.at[1]).toBeLessThan(-40);
    expect(moved.auto).toBeUndefined();
    expect(sheetNow().views[0]!.at).toEqual([150, 150]);
  });

  it("takes its own decimal places from its right-click menu, or goes back to the drawing's", async () => {
    const pair: DrawingDimension = { id: "d2", view: "v1", kind: "linear", refs: [e(1, "start"), e(2, "end")], across: "aligned", at: [35, 5] };
    render(<Harness dimensions={[pair]} />);
    const dim = await screen.findByRole("button", { name: "Dimension, 60.83 mm" });
    fireEvent.contextMenu(dim, { clientX: 300, clientY: 200 });
    const menu = within(screen.getByRole("menu", { name: "Dimension actions" }));
    expect(menu.getByRole("menuitemradio", { name: "Decimal places as the drawing" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(menu.getByRole("menuitemradio", { name: "1 decimal place" }));
    expect(sheetNow().dimensions[0]!.decimals).toBe(1);
    expect(screen.getByRole("button", { name: "Dimension, 60.8 mm" })).toBeTruthy();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Dimension, 60.8 mm" }), { clientX: 300, clientY: 200 });
    await userEvent.click(
      within(screen.getByRole("menu", { name: "Dimension actions" })).getByRole("menuitemradio", { name: "Decimal places as the drawing" }),
    );
    expect("decimals" in sheetNow().dimensions[0]!).toBe(false);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Dimension, 60.83 mm" }), { clientX: 300, clientY: 200 });
    await userEvent.click(within(screen.getByRole("menu", { name: "Dimension actions" })).getByRole("menuitem", { name: /^Delete/ }));
    expect(sheetNow().dimensions).toEqual([]);
  });

  it("is kept but not drawn when the model lost its edge, and is only drawn in a view-only model", async () => {
    render(<Harness dimensions={[length, { ...length, id: "d9", refs: [e(99)] }]} readOnly tool="dimension" />);
    const drawn = await screen.findAllByRole("button", { name: /^Dimension, / });
    expect(drawn).toHaveLength(1);
    act(() => drawn[0]!.focus());
    await userEvent.keyboard("{ArrowDown}{Delete}");
    fireEvent.contextMenu(drawn[0]!, { clientX: 300, clientY: 200 });
    expect(sheetNow().dimensions).toHaveLength(2);
    expect(sheetNow().dimensions[0]!.at).toEqual([0, -40]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edge/ })).toBeNull();
  });
});

describe("Dimension on the bar and the Drawing tab", () => {
  it("is a button on both, lit while the tool is armed", async () => {
    const p = { onSettings: vi.fn(), onFit: vi.fn(), onFinish: vi.fn(), onDimension: vi.fn() };
    const { unmount } = render(<DrawingRibbon {...p} dimension />);
    const button = within(screen.getByRole("group", { name: "Dimensions" })).getByRole("button", { name: /^Dimension/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(button);
    unmount();
    render(<DrawingBar name="Drawing 1" {...p} />);
    await userEvent.click(screen.getByRole("button", { name: /^Dimension/ }));
    expect(p.onDimension).toHaveBeenCalledTimes(2);
  });

  it("the decimal places change is one step of Undo, kept between 0 and 3", () => {
    const drawing: Drawing = { id: "dr1", name: "Drawing 1", decimals: 2, sheets: [newSheet("Sheet 1", { size: "A3" })] };
    const model = { ...doc, drawings: [drawing] };
    const [change, label] = decimalsChange(drawing, 7);
    expect(label).toBe("Decimal places");
    expect(change(model).drawings![0]!.decimals).toBe(3);
    expect(decimalsChange(drawing, 2)[0](model)).toBe(model);
  });
});

describe("dimensions in an export", () => {
  const sheet: DrawingSheet = {
    ...newSheet("Sheet 1", { size: "A3" }),
    views: [front],
    dimensions: [
      length,
      { id: "d2", view: "v1", kind: "linear", refs: [e(1)], across: "aligned", at: [40, -5] },
      { id: "d3", view: "v1", kind: "diameter", refs: [bore], at: [20, 20] },
    ],
  };
  const scene = sheetScene(sheet, sheetLayout(sheet), () => plate, 2);

  it("go on their own layer as thin lines, filled arrowheads and text, turned where the size is upright", () => {
    const lines = scene.strokes.filter((s) => s.layer === "dimension");
    expect(lines).toHaveLength(3 + 3 + 2);
    expect(lines[0]).toEqual({ layer: "dimension", width: 0.25, curve: { kind: "line", a: [120, 119], b: [120, 108] } });
    expect(scene.fills).toHaveLength(5);
    expect(scene.fills![0]!.pts[0]).toEqual([120, 110]);
    const labels = scene.labels.filter((l) => l.layer === "dimension");
    expect(labels.map((l) => [l.text, l.turn])).toEqual([
      ["60", undefined],
      ["50", Math.PI / 2],
      ["Ø12", undefined],
    ]);
    expect(labels[0]).toMatchObject({ size: 3.5, anchor: "middle", baseline: "central" });
  });

  it("are written to SVG and DXF", () => {
    const svg = sceneSvg(scene);
    expect(svg).toContain('<path class="arrows" fill="black" d="M120 187L123 187.5L123 186.5Z');
    expect(svg).toMatch(
      /<text class="dimension" x="[\d.]+" y="[\d.]+" font-size="3.5" text-anchor="middle" dominant-baseline="central" transform="rotate\(-90 [\d.]+ [\d.]+\)">50<\/text>/,
    );
    const dxf = sceneDxf(scene);
    expect(dxf).toContain("LINE\r\n  8\r\nDIMENSIONS\r\n 10\r\n120\r\n 20\r\n119\r\n");
    expect(dxf).toContain("SOLID\r\n  8\r\nDIMENSIONS\r\n 10\r\n120\r\n 20\r\n110\r\n");
    expect(dxf).toMatch(/TEXT\r\n {2}8\r\nDIMENSIONS\r\n[\s\S]*? {2}1\r\n50\r\n 50\r\n90\r\n/);
  });

  it("leave a sheet with none exactly as it was", () => {
    const plain = sheetScene({ ...sheet, dimensions: [] }, sheetLayout(sheet), () => plate);
    expect(plain.fills).toBeUndefined();
    expect(plain.strokes.some((s) => s.layer === "dimension")).toBe(false);
  });
});
