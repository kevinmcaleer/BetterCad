import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SplitFeature } from "../state/document";
import { SplitPanel } from "./SplitTool";
import type { SplitSession } from "./useSplit";

const feature = (c: Partial<SplitFeature> = {}): SplitFeature => ({
  id: "s",
  type: "split",
  name: "Split 1",
  part: "box",
  plane: "YZ",
  offset: 0,
  keep: "both",
  body: { id: "b", name: "Box 1 (2)" },
  ...c,
});

const session = (f: SplitFeature | null, pickingPlane = false) =>
  ({
    feature: f,
    help: f ? "Pick which halves to keep. Enter keeps the split, Esc cancels it." : "Click the body to split.",
    pickingPlane,
    setPickingPlane: vi.fn(),
    setPlane: vi.fn(),
    setOffset: vi.fn(),
    setKeep: vi.fn(),
    done: vi.fn(),
    cancel: vi.fn(),
  }) as unknown as SplitSession;

const names = new Map([["box", "Box 1"]]);

describe("Split body panel (#406)", () => {
  it("asks for a body before there's a split", () => {
    render(<SplitPanel x={session(null)} names={names} />);
    expect(screen.getByText("Click the body to split.")).toBeInTheDocument();
  });

  it("names the body, and picks the plane and the halves to keep", () => {
    const x = session(feature());
    render(<SplitPanel x={x} names={names} />);
    expect(screen.getByText("Box 1")).toBeInTheDocument();
    const planes = screen.getByRole("group", { name: "Split plane" });
    expect(planes.querySelector("[aria-pressed=true]")).toHaveTextContent("YZ");
    fireEvent.click(screen.getByRole("button", { name: "XY" }));
    expect(x.setPlane).toHaveBeenCalledWith("XY");
    fireEvent.click(screen.getByRole("button", { name: "Face" }));
    expect(x.setPickingPlane).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Front" }));
    expect(x.setKeep).toHaveBeenCalledWith("front");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(x.done).toHaveBeenCalled();
  });

  it("shows a picked face as Face, and why the split can't be made", () => {
    const x = session(feature({ face: { body: "box", face: 2, origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } } }));
    render(<SplitPanel x={x} names={names} error="The plane misses the body, so there is nothing on one side of it" />);
    expect(screen.getByRole("button", { name: "Face" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("The plane misses the body");
  });
});
