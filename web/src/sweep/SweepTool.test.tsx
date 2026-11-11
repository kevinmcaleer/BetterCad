import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Part, SweepFeature } from "../state/document";
import { SweepPanel } from "./SweepTool";
import { pathInto, type SweepSession } from "./useSweep";

const feature = (c: Partial<SweepFeature> = {}): SweepFeature => ({
  id: "w",
  type: "sweep",
  name: "Sweep 1",
  body: { id: "b", name: "Body 1" },
  sketch: "s2",
  seeds: [[0, 0]],
  split: true,
  path: { sketch: "s1", curves: ["l1", "a1"] },
  operation: "new",
  ...c,
});

const session = (f: SweepFeature | null) =>
  ({
    feature: f,
    help: "Click a closed sketch shape to sweep. Draw it where the path starts.",
    targets: f?.target ? [f.target] : [],
    setTargets: vi.fn(),
    toggleTarget: vi.fn(),
    setOperation: vi.fn(),
    clearShapes: vi.fn(),
    clearPath: vi.fn(),
    done: vi.fn(),
    cancel: vi.fn(),
  }) as unknown as SweepSession;

const names = new Map([
  ["s1", "Sketch 1"],
  ["s2", "Sketch 2"],
]);
const box = { id: "box", name: "Box 1" } as Part;

describe("Sweep panel (#400)", () => {
  it("asks for a shape before there's a sweep", () => {
    render(<SweepPanel x={session(null)} names={names} parts={[]} />);
    expect(screen.getByText("Click a closed sketch shape to sweep. Draw it where the path starts.")).toBeInTheDocument();
  });

  it("keeps the sweep only once it has a shape and a path", () => {
    const x = session(feature({ path: undefined }));
    const { rerender } = render(<SweepPanel x={x} names={names} parts={[]} />);
    expect(screen.getByText("1 shape in Sketch 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toHaveAttribute("aria-disabled", "true");
    const y = session(feature());
    rerender(<SweepPanel x={y} names={names} parts={[]} />);
    expect(screen.getByText("1 shape in Sketch 2, along 2 curves in Sketch 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(y.done).toHaveBeenCalled();
  });

  it("clears the path, and switches to a cut", () => {
    const x = session(feature());
    render(<SweepPanel x={x} names={names} parts={[box]} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear the path and pick again" }));
    expect(x.clearPath).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    expect(x.setOperation).toHaveBeenCalledWith("cut");
  });

  it("names the body a cut changes, and shows why it can't be made", () => {
    render(
      <SweepPanel
        x={session(feature({ operation: "cut", target: "box" }))}
        names={names}
        parts={[box]}
        error="That shape could not be swept along the path."
      />,
    );
    expect(screen.getByRole("button", { name: /Box 1/ })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("That shape could not be swept along the path.");
  });
});

describe("picking a sweep's path", () => {
  const line = (curve: string, sketch = "s1") => ({ sketch, curve, circle: false });
  it("adds curves of one sketch and takes a picked one out", () => {
    const p = pathInto(pathInto(undefined, line("l1")), line("a1"));
    expect(p).toEqual({ sketch: "s1", curves: ["l1", "a1"] });
    expect(pathInto(p, line("l1"))).toEqual({ sketch: "s1", curves: ["a1"] });
    expect(pathInto({ sketch: "s1", curves: ["l1"] }, line("l1"))).toBeUndefined();
  });
  it("starts again in another sketch, and a circle stands alone", () => {
    expect(pathInto({ sketch: "s1", curves: ["l1"] }, line("l9", "s3"))).toEqual({ sketch: "s3", curves: ["l9"] });
    expect(pathInto({ sketch: "s1", curves: ["l1"] }, { sketch: "s1", curve: "c1", circle: true })).toEqual({ sketch: "s1", curves: ["c1"] });
  });
});
