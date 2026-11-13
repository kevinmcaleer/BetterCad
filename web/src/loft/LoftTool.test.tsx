import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LoftFeature, LoftPick, Part } from "../state/document";
import { LoftPanel } from "./LoftTool";
import { pickInto, type LoftSession } from "./useLoft";

const feature = (c: Partial<LoftFeature> = {}): LoftFeature => ({
  id: "l",
  type: "loft",
  name: "Loft 1",
  body: { id: "b", name: "Body 1" },
  sections: [
    { sketch: "s1", seed: [0, 0] },
    { sketch: "s2", seed: [0, 0] },
  ],
  operation: "new",
  ...c,
});

const session = (f: LoftFeature | null) =>
  ({
    feature: f,
    help: "Click a closed sketch shape to start the loft.",
    targets: f?.target ? [f.target] : [],
    setTargets: vi.fn(),
    toggleTarget: vi.fn(),
    setOperation: vi.fn(),
    setRuled: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    done: vi.fn(),
    cancel: vi.fn(),
  }) as unknown as LoftSession;

const names = new Map([
  ["s1", "Sketch 1"],
  ["s2", "Sketch 2"],
]);
const box = { id: "box", name: "Box 1" } as Part;

describe("Loft panel (#399)", () => {
  it("asks for a shape before there's a loft", () => {
    render(<LoftPanel x={session(null)} names={names} parts={[]} />);
    expect(screen.getByText("Click a closed sketch shape to start the loft.")).toBeInTheDocument();
  });

  it("lists the shapes in order and keeps the loft only with two or more", () => {
    const x = session(feature({ sections: [{ sketch: "s1", seed: [0, 0] }] }));
    const { rerender } = render(<LoftPanel x={x} names={names} parts={[]} />);
    expect(screen.getByText("From Sketch 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toHaveAttribute("aria-disabled", "true");
    const y = session(feature());
    rerender(<LoftPanel x={y} names={names} parts={[]} />);
    expect(screen.getByText("Through Sketch 1, then Sketch 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(y.done).toHaveBeenCalled();
  });

  it("switches to straight sides and to a cut", () => {
    const x = session(feature());
    render(<LoftPanel x={x} names={names} parts={[box]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Straight sides/ }));
    expect(x.setRuled).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    expect(x.setOperation).toHaveBeenCalledWith("cut");
  });

  it("names the body a cut changes, and shows why it can't be made", () => {
    render(<LoftPanel x={session(feature({ operation: "cut", target: "box" }))} names={names} parts={[box]} error="Those shapes could not be lofted." />);
    expect(screen.getByRole("button", { name: /Box 1/ })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Those shapes could not be lofted.");
  });
});

describe("picking loft shapes", () => {
  const a: LoftPick = { sketch: "s1", seed: [0, 0] };
  const b: LoftPick = { sketch: "s2", seed: [0, 0] };
  it("adds a shape on a new plane at the end", () => {
    expect(pickInto([a], b, () => false)).toEqual([a, b]);
  });
  it("takes a picked shape out", () => {
    expect(pickInto([a, b], { ...a }, (s) => s === a)).toEqual([b]);
  });
  it("swaps another shape in the same sketch into its place", () => {
    const c: LoftPick = { sketch: "s1", seed: [30, 0] };
    expect(pickInto([a, b], c, () => false)).toEqual([c, b]);
  });
});
