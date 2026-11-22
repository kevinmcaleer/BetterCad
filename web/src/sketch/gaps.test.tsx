// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { drawPolyline, newSketch, type Sketch } from "@bettercad/sketch";
import { DEFAULT_OPTIONS } from "./options";
import { SketchPanel } from "./SketchPanel";
import type { SketchSession } from "./useSketch";

const almostClosed = (): Sketch =>
  drawPolyline(newSketch(), [
    [0, 0],
    [20, 0],
    [20, 10],
    [0, 10],
    [0, 0.3],
  ]).sketch;

function session(over: Partial<SketchSession>): SketchSession {
  return {
    sketch: almostClosed(),
    feature: { id: "f", name: "Sketch 1" },
    textEdit: null,
    sel: [],
    result: null,
    drawConstruction: false,
    status: "Free",
    finishWarn: false,
    options: DEFAULT_OPTIONS,
    gapsOn: false,
    setGapsOn: vi.fn(),
    setSel: vi.fn(),
    apply: vi.fn(() => true),
    ...over,
  } as unknown as SketchSession;
}

describe("Find open ends in the sketch palette", () => {
  it("offers Find open ends, which turns the markers on", () => {
    const s = session({});
    render(<SketchPanel s={s} />);
    fireEvent.click(screen.getByRole("button", { name: "Find open ends" }));
    expect(s.setGapsOn).toHaveBeenCalledWith(true);
  });

  it("lists the gap with its size, and Join ties the two ends", () => {
    const s = session({ gapsOn: true });
    render(<SketchPanel s={s} />);
    expect(screen.getByText("2 open ends")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Open ends" });
    expect(list.textContent).toContain("0.3 mm gap between ends");
    fireEvent.click(screen.getByRole("button", { name: "Join the two ends" }));
    const [next, label] = (s.apply as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(label).toBe("Join ends");
    expect((next as Sketch).constraints.at(-1)).toMatchObject({ type: "coincident" });
  });
});
