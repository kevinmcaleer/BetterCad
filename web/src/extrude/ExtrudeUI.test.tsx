import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { planeFrame } from "@bettercad/sketch";
import { addPart, newDoc, build, type ExtrudeFeature, type Part } from "../state/document";
import { ExtrudeBar } from "./ExtrudeUI";
import { touchedBodies, type Box, type ExtrudeSession } from "./useExtrude";

const parts: Part[] = build(addPart(addPart(newDoc(), "box", "a"), "box", "b")).parts;

function session(f: Partial<ExtrudeFeature>, targets: string[] = []) {
  const feature: ExtrudeFeature = {
    id: "e1",
    type: "extrude",
    name: "Extrude 1",
    sketch: "s1",
    seeds: [[0, 0]],
    distance: -10,
    direction: "one",
    operation: "cut",
    target: targets[0],
    targets,
    body: { id: "new", name: "Body 3" },
    ...f,
  };
  const x = {
    kind: "extrude",
    feature,
    picked: 1,
    targets,
    targeting: feature.operation !== "new",
    help: "",
    change: vi.fn(),
    setTargets: vi.fn(),
    toggleTarget: vi.fn(),
    setOperation: vi.fn(),
    setFieldExpr: vi.fn(),
    done: vi.fn(),
    cancel: vi.fn(),
  };
  return x as typeof x & ExtrudeSession;
}

describe("ExtrudeBar", () => {
  it("offers through all for a cut, and a flip in place of the distance", async () => {
    const x = session({ extent: "all" }, ["a"]);
    render(<ExtrudeBar x={x} parts={parts} />);
    expect(screen.queryByLabelText("Distance")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Flip/ }));
    expect(x.change).toHaveBeenCalledWith({ distance: 10 });
    await userEvent.click(screen.getByRole("button", { name: /Through all/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Distance" }));
    expect(x.change).toHaveBeenCalledWith({ extent: "distance" });
  });

  it("keeps through all off for a join", async () => {
    const x = session({ operation: "join" }, ["a"]);
    render(<ExtrudeBar x={x} parts={parts} />);
    await userEvent.click(screen.getByRole("button", { name: /^Distance/ }));
    expect(screen.getByRole("menuitemradio", { name: "Through all" })).toBeDisabled();
  });

  it("ticks the bodies a cut goes through", async () => {
    const x = session({}, ["a", "b"]);
    render(<ExtrudeBar x={x} parts={parts} />);
    await userEvent.click(screen.getByRole("button", { name: /2 bodies/ }));
    const boxes = screen.getAllByRole("menuitemcheckbox");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "true"]);
    await userEvent.click(boxes[1]!);
    expect(x.toggleTarget).toHaveBeenCalledWith("b");
  });
});

describe("touchedBodies", () => {
  const frame = planeFrame({ kind: "world", plane: "XY", offset: 0 });
  const square = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as [number, number][],
  ];
  const bounds = new Map<string, Box>([
    ["under", { min: [-5, -5, -20], max: [5, 5, 0] }],
    ["deep", { min: [-5, -5, -60], max: [5, 5, -30] }],
    ["beside", { min: [20, 20, -20], max: [30, 30, 0] }],
  ]);

  it("names the bodies the pushed shape reaches", () => {
    expect(touchedBodies(frame, square, -10, 0, bounds)).toEqual(["under"]);
    expect(touchedBodies(frame, square, -10_000, 0, bounds)).toEqual(["under", "deep"]);
    expect(touchedBodies(frame, square, 0, 10, bounds, "under")).toEqual([]);
  });
});
