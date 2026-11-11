import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HoleFeature } from "../state/document";
import { HoleBar } from "./HoleBar";
import type { HoleSession } from "./useHole";

const feature = (c: Partial<HoleFeature> = {}): HoleFeature => ({
  id: "h",
  type: "hole",
  name: "Hole 1",
  part: "b",
  frame: { origin: [0, 0, 13], x: [1, 0, 0], normal: [0, 0, 1] },
  points: [[0, 0]],
  size: "custom",
  fit: "normal",
  diameter: 8,
  head: "none",
  depth: null,
  ...c,
});

const session = (f: HoleFeature) => ({ feature: f, help: "", change: vi.fn(), done: vi.fn(), cancel: vi.fn() }) as unknown as HoleSession;

describe("Hole panel, custom heads (#404)", () => {
  it("starts a custom counterbore in proportion to the hole", () => {
    const x = session(feature());
    render(<HoleBar x={x} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Counterbore" }));
    expect(x.change).toHaveBeenCalledWith({ head: "counterbore", headSize: { diameter: 14.4, depth: 4.8 } });
  });

  it("shows a counterbore's diameter and depth, and a countersink's angle", () => {
    const { rerender } = render(<HoleBar x={session(feature({ head: "counterbore", headSize: { diameter: 15, depth: 4 } }))} onCancel={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /Head diameter/ })).toHaveValue("15");
    expect(screen.getByRole("textbox", { name: /Head depth/ })).toHaveValue("4");
    expect(screen.queryByRole("textbox", { name: /Head angle/ })).toBeNull();
    rerender(<HoleBar x={session(feature({ head: "countersink", headSize: { diameter: 16, depth: 0, angle: 82 } }))} onCancel={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /Head angle/ })).toHaveValue("82");
    expect(screen.queryByRole("textbox", { name: /Head depth/ })).toBeNull();
  });

  it("lists M8 to M12 among the sizes", () => {
    render(<HoleBar x={session(feature({ size: "M3", fit: "printed" }))} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^M3/ }));
    for (const m of ["M8", "M10", "M12"]) expect(screen.getByRole("menuitemradio", { name: m })).toBeInTheDocument();
  });
});
