import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { planeFrame } from "@bettercad/sketch";
import { addPart, newDoc, build, type ExtrudeFeature, type Part } from "../state/document";
import { ExtrudeBar } from "./ExtrudeUI";
import { touchedBodies, type Box, type ExtrudeSession } from "./useExtrude";
import { Box3, type Mesh } from "three";
import { ExtrudeArrow, arrowOf, dragTo, flipOf, ghostSpan } from "./arrow";
import type { Engine } from "../viewport/engine";

const parts: Part[] = build(addPart(addPart(newDoc(), "box", "a"), "box", "b")).parts;

function session(f: Partial<ExtrudeFeature>, targets: string[] = [], wantTo = false) {
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
    setExtent: vi.fn(),
    pickFrom: vi.fn(),
    wantFrom: false,
    flip: vi.fn(),
    wantTo,
    pickingTo: wantTo || feature.extent === "to",
    setTargets: vi.fn(),
    toggleTarget: vi.fn(),
    setOperation: vi.fn(),
    setFieldExpr: vi.fn(),
    done: vi.fn(),
    cancel: vi.fn(),
    pickingShapes: false,
    repickShapes: vi.fn(),
    stopShapes: vi.fn(),
  };
  return x as typeof x & ExtrudeSession;
}

describe("ExtrudeBar", () => {
  it("picks the shapes again, or clears them first", async () => {
    const x = session({}, ["a"]);
    render(<ExtrudeBar x={x} parts={parts} />);
    const profile = within(screen.getByRole("group", { name: "Profile" }));
    await userEvent.click(profile.getByRole("button", { name: "1 selected" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Clear and pick again" }));
    expect(x.repickShapes).toHaveBeenCalledWith(true);
    await userEvent.click(profile.getByRole("button", { name: "Clear the shapes and pick again" }));
    expect(x.repickShapes).toHaveBeenCalledTimes(2);
  });

  it("is a tall panel: a row per setting, then Cancel and OK", async () => {
    const x = session({}, ["a"]);
    render(<ExtrudeBar x={x} parts={parts} />);
    const panel = screen.getByRole("group", { name: "Extrude options" });
    expect(within(panel).getByText("Operation")).toBeInTheDocument();
    expect(within(panel).getByRole("textbox", { name: "Distance (mm)" })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "OK" }));
    expect(x.done).toHaveBeenCalled();
    // The title folds the rows away, to see more of the model; Cancel and OK stay.
    await userEvent.click(within(panel).getByRole("button", { name: "Fold the settings away" }));
    expect(within(panel).queryByText("Operation")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("picks where it starts: the profile plane, an offset or an object", async () => {
    const x = session({}, ["a"]);
    const { rerender } = render(<ExtrudeBar x={x} parts={parts} />);
    await userEvent.click(screen.getByRole("button", { name: "Profile plane" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Object" }));
    expect(x.pickFrom).toHaveBeenCalledWith(true);
    // An offset is a distance, which can be a parameter.
    const off = session({ start: "offset", startOffset: 4 }, ["a"]);
    rerender(<ExtrudeBar x={off} parts={parts} />);
    expect(screen.getByRole("textbox", { name: "Offset (mm)" })).toHaveValue("4");
    // An object start says what it starts from, and picks again from the panel.
    const obj = session({ start: "object", from: { body: "a", kind: "face", point: [0, 0, 0], normal: [0, 0, 1] } }, ["a"]);
    rerender(<ExtrudeBar x={obj} parts={parts} />);
    await userEvent.click(within(screen.getByRole("group", { name: "Object" })).getByRole("button", { name: "1 face" }));
    expect(obj.pickFrom).toHaveBeenCalledWith(true);
  });

  it("starts the arrow and the drag ghost where the extrude starts", () => {
    const f = session({ distance: 5, direction: "one" }).feature!;
    const frame = { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    const square = {
      points: [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as [number, number][],
      holes: [],
    } as unknown as Parameters<typeof arrowOf>[2][number];
    const a = arrowOf(f, frame, [square], 20, 3);
    expect(a.base[2]).toBeCloseTo(3);
    expect(a.end[2]).toBeCloseTo(8);
    expect(ghostSpan(f, 20, 3)).toEqual({ from: 3, to: 8 });
  });

  it("revolve: picks the axis by name, shows it picked, and clears it with the ×", async () => {
    const x = session({}, ["a"]) as ReturnType<typeof session> & Record<string, unknown>;
    const rev = {
      ...x,
      kind: "revolve",
      feature: { ...x.feature, type: "revolve", angle: 360 },
      construct: [],
      pickAxis: vi.fn(),
      repickAxis: vi.fn(),
      pickingAxis: true,
    };
    const { rerender } = render(<ExtrudeBar x={rev as unknown as ExtrudeSession} parts={parts} />);
    const axis = within(screen.getByRole("group", { name: "Axis" }));
    expect(screen.getByRole("button", { name: "OK" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(axis.getByRole("button", { name: "Pick an axis" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "The Y axis" }));
    expect(rev.pickAxis).toHaveBeenCalledWith({ kind: "ref", ref: { origin: "Y" } });
    const picked = { ...rev, pickingAxis: false, feature: { ...rev.feature, axis: { kind: "ref", ref: { origin: "Y" } } } };
    rerender(<ExtrudeBar x={picked as unknown as ExtrudeSession} parts={parts} />);
    expect(axis.getByRole("button", { name: "1 selected" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Symmetric" })).not.toBeChecked();
    await userEvent.click(axis.getByRole("button", { name: "Clear the axis and pick again" }));
    expect(x.change).toHaveBeenCalledWith({ axis: undefined });
    expect(rev.repickAxis).toHaveBeenCalled();
  });

  it("offers through all for a cut, and a flip in place of the distance", async () => {
    const x = session({ extent: "all" }, ["a"]);
    render(<ExtrudeBar x={x} parts={parts} />);
    expect(screen.queryByLabelText("Distance")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Flip/ }));
    expect(x.flip).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Through all/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Distance" }));
    expect(x.setExtent).toHaveBeenCalledWith("distance");
  });

  it("goes up to an object: asks for a click, then says what it reaches", async () => {
    const x = session({}, ["a"]);
    const { unmount } = render(<ExtrudeBar x={x} parts={parts} />);
    await userEvent.click(screen.getByRole("button", { name: /^Distance/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "To object" }));
    expect(x.setExtent).toHaveBeenCalledWith("to");
    unmount();
    const { unmount: un2 } = render(<ExtrudeBar x={session({}, ["a"], true)} parts={parts} />);
    expect(screen.getByRole("status")).toHaveTextContent("Click a face, edge or point");
    expect(screen.queryByLabelText("Distance")).toBeNull();
    expect(screen.queryByRole("button", { name: /One side/ })).toBeNull();
    un2();
    render(
      <ExtrudeBar x={session({ extent: "to", distance: -12.5, to: { body: "a", kind: "face", point: [0, 0, 0], normal: [0, 0, 1] } }, ["a"])} parts={parts} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Up to a face, 12.5 mm");
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

describe("the extrude arrow", () => {
  const frame = planeFrame({ kind: "world", plane: "XY", offset: 5 });
  const square = {
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as [number, number][],
    holes: [],
  } as unknown as Parameters<typeof arrowOf>[2][number];
  const f = (p: Partial<ExtrudeFeature>): ExtrudeFeature => ({
    id: "e1",
    type: "extrude",
    name: "Extrude 1",
    sketch: "s1",
    seeds: [[5, 5]],
    distance: 10,
    direction: "one",
    operation: "new",
    body: { id: "b", name: "Body 1" },
    ...p,
  });

  it("runs from the middle of the shapes to the end, pointing the way it goes", () => {
    expect(arrowOf(f({}), frame, [square], 30)).toEqual({ base: [5, 5, 5], end: [5, 5, 15], dir: [0, 0, 1], length: 10 });
    expect(arrowOf(f({ distance: -4 }), frame, [square], 30)).toMatchObject({ end: [5, 5, 1], dir: [-0, -0, -1], length: -4 });
    expect(arrowOf(f({ direction: "symmetric" }), frame, [square], 30).length).toBe(5);
    // Through all has no end: the arrow is a fixed length on its side.
    expect(arrowOf(f({ extent: "all", operation: "cut", distance: -1 }), frame, [square], 30).length).toBe(-30);
  });

  it("drags to a distance, and flips to the other side", () => {
    expect(dragTo(f({}), 12.34)).toEqual({ distance: 12.3 });
    expect(dragTo(f({}), -3)).toEqual({ distance: -3 });
    expect(dragTo(f({}), 0.01)).toBeNull();
    expect(dragTo(f({ direction: "symmetric" }), 6)).toEqual({ distance: 12 });
    expect(dragTo(f({ extent: "all", operation: "cut" }), 8)).toEqual({ extent: "distance", distance: 8 });
    expect(dragTo(f({ extent: "to" }), 8)).toEqual({ extent: "distance", direction: "one", distance: 8 });
    expect(flipOf(f({}))).toEqual({ distance: -10 });
    expect(flipOf(f({ direction: "two", distance2: 3 }))).toEqual({ distance: 3, distance2: 10 });
    expect(flipOf(f({ direction: "symmetric" }))).toBeNull();
    expect(flipOf(f({ extent: "to" }))).toBeNull();
  });

  it("sweeps a ghost of the shapes as far as the drag has gone, cut short for through all", () => {
    expect(ghostSpan(f({ distance: -4 }), 30)).toEqual({ from: -4, to: 0 });
    expect(ghostSpan(f({ direction: "symmetric", distance: 6 }), 30)).toEqual({ from: -3, to: 3 });
    expect(ghostSpan(f({ extent: "all", operation: "cut", distance: -1 }), 30)).toEqual({ from: -30, to: 0 });

    const overlays: Mesh[] = [];
    const eng = { addOverlay: (o: Mesh) => overlays.push(o), removeOverlay: vi.fn(), invalidate: vi.fn(), pixelSize: () => 1 } as unknown as Engine;
    const a = new ExtrudeArrow(eng);
    a.setGhost({ frame, shapes: [square], from: -4, to: 0, cut: true });
    const ghost = (overlays[0]!.children as Mesh[]).find((c) => c.isMesh && c.visible && c.geometry.attributes.position);
    const box = new Box3().setFromBufferAttribute(ghost!.geometry.attributes.position as never);
    expect(box.min.toArray()).toEqual([0, 0, 1]);
    expect(box.max.toArray()).toEqual([10, 10, 5]);
    a.setGhost(null);
    expect(ghost!.visible).toBe(false);
    a.dispose();
  });
});
