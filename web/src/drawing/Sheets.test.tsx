import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingDimension, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingPaper, type DrawingFile, type DrawingTool, type ViewCall } from "./DrawingView";

// Letters as boxes: the real font is fetched, which a test has no server for.
vi.mock("../sketch/text/glyphs", () => ({
  glyphFont: () => Promise.resolve({ unitsPerEm: 1000, ascender: 800, descender: -200, glyph: () => ({ advance: 500, commands: [] }) }),
}));

const edge = (index: number) => ({ body: "b1", kind: "edge" as const, index });
const line = (index: number, a: V2, b: V2) => ({ curve: { kind: "line", a, b }, visible: true, type: "sharp", source: edge(index) });
const plate = {
  edges: [line(0, [0, 0], [60, 0]), line(1, [60, 0], [60, 40]), line(2, [60, 40], [0, 40]), line(3, [0, 40], [0, 0])],
  box: { min: [0, 0], max: [60, 40] },
  rounds: [],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const width: DrawingDimension = { id: "d1", view: "v1", kind: "linear", refs: [{ view: "v1", ...edge(0) }], across: "aligned", at: [0, -30] };
const one: DrawingSheet = { ...newSheet("Sheet 1", { size: "A3", title: "Plate" }), id: "s1", views: [front], dimensions: [width] };
const two: DrawingSheet = { ...newSheet("Sheet 2", { size: "A4", title: "Plate" }), id: "s2" };
const say = vi.fn();
const onSave = vi.fn<(f: DrawingFile) => Promise<string | undefined>>((f) => Promise.resolve(f.name));
beforeEach(() => {
  say.mockClear();
  onSave.mockClear();
});

function Harness({ sheets = [one], readOnly, tool: first = null }: { sheets?: DrawingSheet[]; readOnly?: boolean; tool?: DrawingTool | null }) {
  const [drawing, setDrawing] = useState<Drawing>({ id: "dr1", name: "Drawing 1", decimals: 2, sheets });
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawingTool | null>(first);
  const [call] = useState(() => vi.fn<ViewCall>(() => Promise.resolve(plate)));
  const open = drawing.sheets.find((s) => s.id === sheetId) ?? drawing.sheets[0]!;
  return (
    <>
      <div data-testid="drawing">{JSON.stringify(drawing)}</div>
      <div data-testid="open">{open.id}</div>
      <DrawingPaper
        drawing={drawing}
        readOnly={readOnly}
        onTitle={vi.fn()}
        doc={{ ...newDoc(), name: "Plate" }}
        call={call}
        tool={tool}
        onTool={setTool}
        say={say}
        onSave={onSave}
        sheetId={sheetId}
        onSheetId={setSheetId}
        onDrawing={(change) => setDrawing(change)}
        onSheet={(change) => setDrawing((d) => ({ ...d, sheets: d.sheets.map((s) => (s.id === open.id ? change(s) : s)) }))}
      />
    </>
  );
}
const now = () => JSON.parse(screen.getByTestId("drawing").textContent!) as Drawing;
const openId = () => screen.getByTestId("open").textContent;
const tabs = () => within(screen.getByRole("tablist", { name: "Sheets" })).getAllByRole("tab");
const names = () => tabs().map((t) => t.getAttribute("aria-label"));

describe("the strip of sheets", () => {
  it("has a tab for each sheet and a plus; a new sheet opens, blank, with the same page, and the title block counts", async () => {
    render(<Harness />);
    expect(names()).toEqual(["Sheet 1, A3, sheet 1 of 1"]);
    expect(tabs()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("img", { name: "Sheet: 1/1" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add sheet" }));
    expect(names()).toEqual(["Sheet 1, A3, sheet 1 of 2", "Sheet 2, A3, sheet 2 of 2"]);
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(now().sheets[1]).toMatchObject({ size: "A3", views: [], title: { title: "Plate" } });
    expect(screen.getByRole("img", { name: "Sheet: 2/2" })).toBeTruthy();
    // The new sheet has none of the first one's views.
    expect(screen.queryByRole("button", { name: "Front view, 1:1" })).toBeNull();
    await userEvent.click(tabs()[0]!);
    expect(await screen.findByRole("button", { name: "Front view, 1:1" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Sheet: 1/2" })).toBeTruthy();
  });

  it("arrow keys go from sheet to sheet, and Alt with an arrow moves a sheet along", async () => {
    render(<Harness sheets={[one, two]} />);
    tabs()[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(openId()).toBe("s2");
    await userEvent.keyboard("{ArrowLeft}");
    expect(openId()).toBe("s1");
    await userEvent.keyboard("{End}");
    expect(openId()).toBe("s2");
    await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(now().sheets.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(openId()).toBe("s2");
  });

  it("F2 renames, and Esc leaves the name as it was", async () => {
    render(<Harness sheets={[one, two]} />);
    tabs()[0]!.focus();
    await userEvent.keyboard("{F2}");
    const name = screen.getByRole("textbox", { name: "Sheet name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Overview{Enter}");
    expect(now().sheets[0]!.name).toBe("Overview");
    expect(names()[0]).toBe("Overview, A3, sheet 1 of 2");
    await userEvent.dblClick(tabs()[1]!);
    await userEvent.type(screen.getByRole("textbox", { name: "Sheet name" }), "x");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Sheet name" })).toBeNull();
    expect(now().sheets[1]!.name).toBe("Sheet 2");
  });

  it("right-click duplicates and deletes; the last sheet stays", async () => {
    render(<Harness />);
    fireEvent.contextMenu(tabs()[0]!, { clientX: 200, clientY: 500 });
    const menu = within(screen.getByRole("menu", { name: "Sheet actions" }));
    expect((menu.getByRole("menuitem", { name: /^Delete/ }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(menu.getByRole("menuitem", { name: "Duplicate" }));
    expect(now().sheets.map((s) => s.name)).toEqual(["Sheet 1", "Sheet 1 copy"]);
    expect(now().sheets[1]!.views).toHaveLength(1);
    expect(now().sheets[1]!.dimensions[0]!.view).toBe(now().sheets[1]!.views[0]!.id);
    expect(openId()).toBe(now().sheets[1]!.id);
    tabs()[1]!.focus();
    await userEvent.keyboard("{Delete}");
    expect(now().sheets.map((s) => s.name)).toEqual(["Sheet 1"]);
    expect(openId()).toBe("s1");
    expect(say).toHaveBeenLastCalledWith("Deleted Sheet 1 copy. Undo brings it back.");
    await userEvent.keyboard("{Delete}");
    expect(now().sheets).toHaveLength(1);
    expect(say).toHaveBeenLastCalledWith("A drawing keeps at least one sheet.");
  });

  it("a view's menu moves it to another sheet with its sizes", async () => {
    render(<Harness sheets={[one, two]} />);
    fireEvent.contextMenu(await screen.findByRole("button", { name: "Front view, 1:1" }), { clientX: 300, clientY: 200 });
    await userEvent.click(within(screen.getByRole("menu", { name: "View actions" })).getByRole("menuitem", { name: "Move to Sheet 2" }));
    expect(now().sheets.map((s) => [s.views.length, s.dimensions.length])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(say).toHaveBeenLastCalledWith("Moved the front view to Sheet 2.");
    expect(screen.queryByRole("button", { name: "Front view, 1:1" })).toBeNull();
    await userEvent.click(tabs()[1]!);
    expect(await screen.findByRole("button", { name: "Dimension, 60 mm" })).toBeTruthy();
  });

  it("only switches sheets on a drawing you can only read, and is not there for a single sheet", async () => {
    const { unmount } = render(<Harness readOnly />);
    expect(screen.queryByRole("tablist", { name: "Sheets" })).toBeNull();
    unmount();
    render(<Harness sheets={[one, two]} readOnly />);
    expect(screen.queryByRole("button", { name: "Add sheet" })).toBeNull();
    fireEvent.contextMenu(tabs()[0]!, { clientX: 200, clientY: 500 });
    expect(screen.queryByRole("menu", { name: "Sheet actions" })).toBeNull();
    tabs()[0]!.focus();
    await userEvent.keyboard("{Delete}{F2}");
    expect(now().sheets).toHaveLength(2);
    await userEvent.click(tabs()[1]!);
    expect(openId()).toBe("s2");
  });

  it("exports every sheet as one PDF, a page each", async () => {
    render(<Harness sheets={[one, two]} tool="export" />);
    await screen.findByRole("button", { name: "Front view, 1:1" });
    const card = within(await screen.findByRole("dialog", { name: "Export drawing" }));
    await userEvent.click(card.getByRole("button", { name: "PDF" }));
    await userEvent.selectOptions(card.getByRole("combobox", { name: "Sheets" }), "All 2 sheets, one page each");
    expect(card.getByRole("status").textContent).toBe("2 pages, each at its sheet's size. Black on white, whatever the theme.");
    await userEvent.click(card.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const pdf = new TextDecoder("latin1").decode(await onSave.mock.calls[0]![0].data);
    expect(pdf).toContain("/Count 2");
    // A3 landscape, then A4 landscape.
    expect(pdf).toMatch(/\/MediaBox \[0 0 1190\.5\d* 841\.8\d*\]/);
    expect(pdf).toMatch(/\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/);
  });
});
