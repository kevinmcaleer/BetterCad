import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingSheet } from "@bettercad/kernel/drawing";
import { DrawingBar, DrawingPaper, type DrawingApi } from "./DrawingView";
import SheetCard from "./SheetCard";

const drawing = (o: Partial<DrawingSheet> = {}): Drawing => ({
  id: "dr1",
  name: "Drawing 1",
  decimals: 2,
  sheets: [{ ...newSheet("Sheet 1", { size: "A3", title: "Bracket", date: "2026-11-22" }), ...o }],
});

beforeEach(() => localStorage.clear());

describe("the drawing's sheet", () => {
  it("draws the sheet with its title block filled in", () => {
    render(<DrawingPaper drawing={drawing()} onTitle={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Drawing: Drawing 1" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Sheet 1: A3, landscape" })).toBeTruthy();
    const block = within(screen.getByRole("group", { name: "Title block" }));
    expect(block.getByRole("button", { name: "Title: Bracket" })).toBeTruthy();
    expect(block.getByRole("button", { name: "Date of issue: 2026-11-22" })).toBeTruthy();
    expect(block.getByRole("button", { name: "Drawing number: blank" })).toBeTruthy();
    expect(block.getByRole("img", { name: "Size: A3" })).toBeTruthy();
    expect(block.getByRole("img", { name: "Scale: 1:1" })).toBeTruthy();
    expect(block.getByRole("img", { name: "Projection: first angle" })).toBeTruthy();
  });

  it("an ASME sheet says third angle and uses its own names", () => {
    render(<DrawingPaper drawing={drawing({ size: "letter", standard: "asme" })} onTitle={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Projection: third angle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Drawn: blank" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Size: Letter" })).toBeTruthy();
  });

  it("double-click a field to type in it; Enter keeps it", async () => {
    const onTitle = vi.fn();
    render(<DrawingPaper drawing={drawing()} onTitle={onTitle} />);
    await userEvent.dblClick(screen.getByRole("button", { name: "Drawing number: blank" }));
    const box = screen.getByRole("textbox", { name: "Drawing number" });
    expect(document.activeElement).toBe(box);
    await userEvent.type(box, "BC-001{Enter}");
    expect(onTitle).toHaveBeenCalledWith("number", "BC-001");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Enter on a focused field opens it, Tab moves to the next, and nothing is saved when nothing changed", async () => {
    const onTitle = vi.fn();
    render(<DrawingPaper drawing={drawing()} onTitle={onTitle} />);
    screen.getByRole("button", { name: "Title: Bracket" }).focus();
    await userEvent.keyboard("{Enter}");
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Bracket");
    await userEvent.keyboard("{Tab}");
    expect(onTitle).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole("textbox", { name: "Drawing number" }), "7{Tab}");
    expect(onTitle).toHaveBeenLastCalledWith("number", "7");
    expect(screen.getByRole("textbox", { name: "Rev" })).toBeTruthy();
  });

  it("Esc drops what you typed", async () => {
    const onTitle = vi.fn();
    render(<DrawingPaper drawing={drawing()} onTitle={onTitle} />);
    await userEvent.dblClick(screen.getByRole("button", { name: "Title: Bracket" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Title" }), " arm{Escape}");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onTitle).not.toHaveBeenCalled();
  });

  it("a view-only model's title block is only drawn", () => {
    render(<DrawingPaper drawing={drawing()} readOnly onTitle={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("img", { name: "Title: Bracket" })).toBeTruthy();
  });

  it("the wheel zooms about the pointer and a drag moves the sheet; Fit puts it back", () => {
    const api = { current: null as DrawingApi | null };
    render(<DrawingPaper drawing={drawing()} onTitle={vi.fn()} api={api} />);
    const region = screen.getByRole("region", { name: "Drawing: Drawing 1" });
    const placed = () => region.querySelector("svg > g")!.getAttribute("transform");
    const fitted = placed();
    fireEvent.wheel(region, { deltaY: -200, clientX: 100, clientY: 100 });
    expect(placed()).not.toBe(fitted);
    act(() => api.current!.fit());
    fireEvent.pointerDown(region, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(region, { pointerId: 1, clientX: 102, clientY: 100 });
    fireEvent.pointerUp(region, { pointerId: 1 });
    fireEvent.pointerDown(region, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(region, { pointerId: 1, clientX: 160, clientY: 130 });
    fireEvent.pointerUp(region, { pointerId: 1 });
    expect(placed()).not.toBe(fitted);
  });

  it("the bar finishes the drawing, fits the sheet and opens its settings", async () => {
    const p = { onSettings: vi.fn(), onFit: vi.fn(), onFinish: vi.fn() };
    const { rerender } = render(<DrawingBar name="Drawing 1" {...p} />);
    const bar = within(screen.getByRole("group", { name: "Drawing 1 options" }));
    await userEvent.click(bar.getByRole("button", { name: "Sheet settings" }));
    await userEvent.click(bar.getByRole("button", { name: "Fit sheet" }));
    await userEvent.click(bar.getByRole("button", { name: "Finish drawing" }));
    expect([p.onSettings.mock.calls.length, p.onFit.mock.calls.length, p.onFinish.mock.calls.length]).toEqual([1, 1, 1]);
    rerender(<DrawingBar name="Drawing 1" readOnly {...p} />);
    expect(screen.queryByRole("button", { name: "Sheet settings" })).toBeNull();
  });
});

describe("sheet set-up", () => {
  it("offers A sizes and US sizes, landscape first, and the standard follows the page until you pick one", async () => {
    const onDone = vi.fn();
    render(<SheetCard onCancel={vi.fn()} onDone={onDone} />);
    const dialog = within(screen.getByRole("dialog", { name: "New drawing" }));
    const size = dialog.getByRole("combobox", { name: "Page size" }) as HTMLSelectElement;
    expect([...size.options].map((o) => o.textContent)).toEqual([
      "A4, 210 × 297 mm",
      "A3, 297 × 420 mm",
      "A2, 420 × 594 mm",
      "A1, 594 × 841 mm",
      "A0, 841 × 1189 mm",
      "Letter (ANSI A), 215.9 × 279.4 mm",
      "Legal, 215.9 × 355.6 mm",
      "Tabloid (ANSI B), 279.4 × 431.8 mm",
      "ANSI C, 431.8 × 558.8 mm",
      "ANSI D, 558.8 × 863.6 mm",
      "ANSI E, 863.6 × 1117.6 mm",
    ]);
    expect(size.value).toBe("A4");
    expect(dialog.getByRole("button", { name: "Landscape" }).getAttribute("aria-pressed")).toBe("true");
    const standard = dialog.getByRole("combobox", { name: "Standard" }) as HTMLSelectElement;
    expect(standard.value).toBe("iso");
    await userEvent.selectOptions(size, "tabloid");
    expect(standard.value).toBe("asme");
    await userEvent.click(dialog.getByRole("button", { name: "Portrait" }));
    await userEvent.click(dialog.getByRole("button", { name: "Create" }));
    expect(onDone).toHaveBeenLastCalledWith({ size: "tabloid", landscape: false, border: true, standard: "asme" });
  });

  it("keeps a standard you picked when the page changes, and starts from the page you used last", async () => {
    localStorage.setItem("bettercad.sheet", JSON.stringify({ size: "A2", landscape: false, border: false }));
    const onDone = vi.fn();
    render(<SheetCard onCancel={vi.fn()} onDone={onDone} />);
    expect((screen.getByRole("combobox", { name: "Page size" }) as HTMLSelectElement).value).toBe("A2");
    expect((screen.getByRole("checkbox", { name: "Border and zones" }) as HTMLInputElement).checked).toBe(false);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Standard" }), "asme");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Page size" }), "A3");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onDone).toHaveBeenLastCalledWith({ size: "A3", landscape: false, border: false, standard: "asme" });
  });

  it("Sheet settings lists the title block's fields too, with Set to today", async () => {
    const onDone = vi.fn();
    render(<SheetCard sheet={drawing({ scale: 0.5 }).sheets[0]} onCancel={vi.fn()} onDone={onDone} />);
    const dialog = within(screen.getByRole("dialog", { name: "Sheet settings" }));
    expect((dialog.getByRole("combobox", { name: "Scale" }) as HTMLSelectElement).value).toBe("0.5");
    expect((dialog.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Bracket");
    await userEvent.type(dialog.getByRole("textbox", { name: "Drawing number" }), "BC-001");
    await userEvent.clear(dialog.getByRole("textbox", { name: "Revision" }));
    await userEvent.click(dialog.getByRole("button", { name: "Set to today" }));
    expect((dialog.getByLabelText("Date of issue") as HTMLInputElement).value).toMatch(/^\d{4}-\d\d-\d\d$/);
    await userEvent.selectOptions(dialog.getByRole("combobox", { name: "Scale" }), "2");
    await userEvent.click(dialog.getByRole("button", { name: "Done" }));
    const choice = onDone.mock.calls[0]![0];
    expect(choice).toMatchObject({ size: "A3", landscape: true, border: true, standard: "iso", scale: 2 });
    expect(choice.title).toMatchObject({ title: "Bracket", number: "BC-001", type: "Part drawing" });
    expect("revision" in choice.title).toBe(false);
  });
});
