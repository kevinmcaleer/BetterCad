// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SketchRibbon } from "./SketchUI";
import type { SketchSession } from "./useSketch";

function setup() {
  localStorage.clear();
  const s = {
    stool: "line",
    ctool: null,
    pickTool: vi.fn(),
    constrain: vi.fn(),
    autoConstrain: vi.fn(),
    finish: vi.fn(),
  } as unknown as SketchSession;
  const view = render(<SketchRibbon s={s} />);
  return { s, view };
}

describe("SketchRibbon", () => {
  it("shows the usual constraints big to start with", () => {
    setup();
    const group = screen.getByRole("group", { name: "Constrain" });
    expect(within(group).getByRole("button", { name: "Coincident" })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "Collinear" })).toBeNull();
  });

  it("pins a constraint to the ribbon from the drop-down, in the drop-down's order, and keeps it", () => {
    const { s, view } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Constrain" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Show Collinear on the ribbon" }));
    const group = screen.getByRole("group", { name: "Constrain" });
    fireEvent.click(within(group).getByRole("button", { name: "Collinear" }));
    expect(s.constrain).toHaveBeenCalledWith("collinear");
    expect(JSON.parse(localStorage.getItem("bettercad.ribbonPins")!)["sketch.constrain"]).toContain("collinear");
    // Still there when the sketch opens again.
    view.unmount();
    render(<SketchRibbon s={s} />);
    expect(within(screen.getByRole("group", { name: "Constrain" })).getByRole("button", { name: "Collinear" })).toBeInTheDocument();
  });

  it("unpins a constraint, and pins AutoConstrain and draw tools too", () => {
    const { s } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Constrain" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Show Tangent on the ribbon" }));
    // The drop-down stays open while you pin and unpin.
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Show AutoConstrain on the ribbon" }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const group = screen.getByRole("group", { name: "Constrain" });
    expect(within(group).queryByRole("button", { name: "Tangent" })).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "AutoConstrain" }));
    expect(s.autoConstrain).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Draw" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Show Point on the ribbon" }));
    expect(within(screen.getByRole("group", { name: "Draw" })).getByRole("button", { name: "Point" })).toBeInTheDocument();
  });
});
