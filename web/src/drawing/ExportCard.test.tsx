import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingSheet } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingBar, DrawingPaper, DrawingRibbon, type DrawingFile, type ViewCall } from "./DrawingView";
import { ExportCard, exportName } from "./ExportCard";
import { sheetLayout } from "./layout";

const plate: ModelView = {
  edges: [
    { curve: { kind: "line", a: [0, 0], b: [40, 0] }, visible: true, type: "sharp" },
    { curve: { kind: "circle", c: [20, 10], r: 4 }, visible: false, type: "sharp" },
  ],
  box: { min: [0, 0], max: [40, 20] },
  rounds: [],
  bodies: ["b1"],
  ms: 1,
};
const sheet: DrawingSheet = {
  ...newSheet("Sheet 1", { size: "A3", title: "Bracket" }),
  views: [{ id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] }],
};
const drawing: Drawing = { id: "dr1", name: "Drawing 1", decimals: 2, sheets: [sheet] };
const text = async (f: DrawingFile) => new TextDecoder().decode(await f.data);

function card(over: { viewOf?: (id: string) => ModelView | undefined; saved?: string | undefined } = {}) {
  const onSave = vi.fn<(f: DrawingFile) => Promise<string | undefined>>((f) => Promise.resolve("saved" in over ? over.saved : f.name));
  const say = vi.fn();
  const onClose = vi.fn();
  render(
    <ExportCard
      drawing={drawing}
      sheet={sheet}
      layout={sheetLayout(sheet)}
      viewOf={over.viewOf ?? (() => plate)}
      onSave={onSave}
      say={say}
      onClose={onClose}
    />,
  );
  return { onSave, say, onClose, dialog: within(screen.getByRole("dialog", { name: "Export drawing" })) };
}

beforeEach(() => localStorage.clear());

describe("Export drawing", () => {
  it("names the file from the title and revision", () => {
    expect(exportName(drawing, sheet)).toBe("Bracket rev A");
    expect(exportName(drawing, { ...sheet, title: {} })).toBe("Drawing 1");
    expect(exportName(drawing, { ...sheet, title: { title: "Arm: left/right", revision: "2" } })).toBe("Arm  left right rev 2");
  });

  it("starts on PDF and says what page it will be", () => {
    const { dialog } = card();
    expect(dialog.getByRole("button", { name: "PDF" }).getAttribute("aria-pressed")).toBe("true");
    expect(dialog.getByRole("status").textContent).toBe("A3 landscape, 420 × 297 mm. Black on white, whatever the theme.");
  });

  it("saves the sheet as an SVG, says so and closes", async () => {
    const { dialog, onSave, say, onClose } = card();
    await userEvent.click(dialog.getByRole("button", { name: "SVG" }));
    await userEvent.click(dialog.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const file = onSave.mock.calls[0]![0];
    expect(file).toMatchObject({ name: "Bracket rev A.svg", mime: "image/svg+xml" });
    const svg = await text(file);
    expect(svg).toContain('width="420mm" height="297mm"');
    expect(svg).toContain(">Bracket</text>");
    expect(say).toHaveBeenCalledWith("Exported Bracket rev A.svg");
  });

  it("a DXF can be the whole sheet or one view at full size", async () => {
    const { dialog, onSave } = card();
    await userEvent.click(dialog.getByRole("button", { name: "DXF" }));
    await userEvent.click(dialog.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].name).toBe("Bracket rev A.dxf");
    expect(await text(onSave.mock.calls[0]![0])).toContain("TITLE");
  });

  it("one view at full size has just the edges you see", async () => {
    const { dialog, onSave } = card();
    await userEvent.click(dialog.getByRole("button", { name: "DXF" }));
    await userEvent.selectOptions(dialog.getByRole("combobox", { name: "What" }), "Front view only, at full size");
    expect(dialog.getByRole("status").textContent).toMatch(/Just the edges you see, in the model's own millimetres \(the sheet shows it at 1:1\)/);
    await userEvent.click(dialog.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const file = onSave.mock.calls[0]![0];
    expect(file.name).toBe("Bracket rev A front view.dxf");
    const dxf = await text(file);
    expect(dxf).toContain("$EXTMAX\r\n 10\r\n40\r\n 20\r\n20\r\n");
    expect(dxf).not.toContain("CIRCLE");
    expect(dxf).not.toContain("TEXT");
  });

  it("a PNG says its size in pixels at the resolution picked, and remembers the choice", async () => {
    const first = card();
    await userEvent.click(first.dialog.getByRole("button", { name: "PNG" }));
    expect(first.dialog.getByRole("status").textContent).toBe("A3 landscape, 420 × 297 mm: 2480 × 1754 pixels.");
    await userEvent.click(first.dialog.getByRole("button", { name: "300 dpi" }));
    expect(first.dialog.getByRole("status").textContent).toMatch(/4961 × 3508 pixels/);
    expect(JSON.parse(localStorage.getItem("bettercad.drawingExport")!)).toEqual({ format: "png", dpi: 300 });
  });

  it("waits for views that are still being worked out", () => {
    const { dialog } = card({ viewOf: () => undefined });
    expect(dialog.getByRole("status").textContent).toBe("Working out the views.");
    expect(dialog.getByRole("button", { name: "Export" }).getAttribute("aria-disabled")).toBe("true");
    expect(dialog.getByRole("button", { name: "Print" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("stays open when you back out of the save", async () => {
    const { dialog, onClose, say, onSave } = card({ saved: undefined });
    await userEvent.click(dialog.getByRole("button", { name: "SVG" }));
    await userEvent.click(dialog.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });
});

describe("Export on the sheet", () => {
  it("opens from the bar and the tab, also in a view-only model, and closes on Cancel", async () => {
    const onExport = vi.fn();
    const p = { onSettings: vi.fn(), onFit: vi.fn(), onExport };
    render(
      <>
        <DrawingBar name="Drawing 1" readOnly {...p} />
        <DrawingRibbon readOnly {...p} />
      </>,
    );
    for (const b of screen.getAllByRole("button", { name: "Export" })) await userEvent.click(b);
    expect(onExport).toHaveBeenCalledTimes(2);
  });

  it("the sheet shows the card while Export is the tool, with the views it has drawn", async () => {
    const onTool = vi.fn();
    const call = vi.fn<ViewCall>(() => Promise.resolve(plate));
    render(
      <DrawingPaper drawing={drawing} onTitle={vi.fn()} doc={{ ...newDoc(), name: "Bracket" }} call={call} tool="export" onTool={onTool} onSave={vi.fn()} />,
    );
    const dialog = within(await screen.findByRole("dialog", { name: "Export drawing" }));
    await waitFor(() => expect(dialog.getByRole("status").textContent).toMatch(/A3 landscape/));
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(onTool).toHaveBeenCalledWith(null);
  });
});
