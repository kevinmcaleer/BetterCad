import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Clash } from "@bettercad/kernel";
import { ClashList, volumeText, type ClashListProps } from "./ClashList";

const box = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
const names: Record<string, string> = { a: "Upper arm", b: "Base", c: "Gripper" };
const props = (change: Partial<ClashListProps> = {}): ClashListProps => ({
  on: true,
  onToggle: vi.fn(),
  sameLink: false,
  references: false,
  onOptions: vi.fn(),
  progress: null,
  clashes: null,
  nameOf: (id) => names[id]!,
  onShow: vi.fn(),
  onStop: vi.fn(),
  ...change,
});

describe("ClashList (#178)", () => {
  it("writes volumes in cm³, or mm³ when small", () => {
    expect(volumeText(800)).toBe("0.8 cm³");
    expect(volumeText(12_340)).toBe("12.3 cm³");
    expect(volumeText(40.04)).toBe("40 mm³");
  });

  it("lists overlaps and touches, and Show frames one", async () => {
    const overlap: Clash = { a: "a", b: "b", kind: "overlap", volume: 800, centre: [0, 0, 0], box };
    const touch: Clash = { a: "c", b: "b", kind: "touch", volume: 0, centre: [0, 0, 0], box };
    const p = props({ clashes: [overlap, touch] });
    render(<ClashList {...p} />);
    const overlaps = screen.getByRole("list", { name: "Overlaps" });
    expect(overlaps).toHaveTextContent("Upper arm and Base overlap by 0.8 cm³");
    expect(screen.getByRole("list", { name: "Touching" })).toHaveTextContent("Gripper and Base touch");
    await userEvent.click(screen.getAllByRole("button", { name: "Show" })[0]!);
    expect(p.onShow).toHaveBeenCalledWith(overlap);
  });

  it("says when nothing clashes, and shows progress with Stop while it checks", async () => {
    const { rerender } = render(<ClashList {...props({ clashes: [] })} />);
    expect(screen.getByRole("status")).toHaveTextContent("No clashes at this pose.");
    const p = props({ progress: 0.4 });
    rerender(<ClashList {...p} />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking, 40%");
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(p.onStop).toHaveBeenCalled();
  });

  it("turns on and off, and sets which bodies count", async () => {
    const p = props({ on: false });
    const { rerender } = render(<ClashList {...p} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Check clashes" }));
    expect(p.onToggle).toHaveBeenCalledWith(true);
    rerender(<ClashList {...props({ onOptions: p.onOptions })} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Reference bodies" }));
    expect(p.onOptions).toHaveBeenCalledWith({ references: true });
  });
});
