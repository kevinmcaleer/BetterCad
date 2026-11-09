import { vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addJoint, addLink, addPart, build, newDoc, type Part } from "../state/document";
import type { WorldPlaneName } from "../viewport/engine";
import { BrowserPanel, ROW, browserItems, browserPick, type BrowserModel, type BrowserSketch, type OriginItem } from "./Browser";

function model(over: Partial<BrowserModel> = {}): BrowserModel {
  const d = addPart(addPart(newDoc("Rover"), "box", "a"), "cylinder", "b");
  return { name: d.name, parts: build(d).parts, sketches: [{ id: "s1", name: "Sketch 1", hidden: false }], origin: [], ...over };
}

function Harness(spy: {
  onSelectSketch?: (id: string) => void;
  onSketchOn?: (p: WorldPlaneName) => void;
  onPicked?: (id: string | null) => void;
  readOnly?: boolean;
}) {
  const [name, setName] = useState("Rover");
  const [parts, setParts] = useState<Part[]>(model().parts);
  const [sketches, setSketches] = useState<BrowserSketch[]>(model().sketches);
  const [origin, setOrigin] = useState<OriginItem[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [renameId, setRenameId] = useState<string | null>(null);
  const hide = (ids: string[], hidden: boolean) => setParts((ps) => ps.map((p) => (ids.includes(p.id) ? { ...p, hidden } : p)));
  return (
    <BrowserPanel
      model={{ name, parts, sketches, origin, readOnly: spy.readOnly }}
      selection={selection}
      onSelect={setSelection}
      onAdd={() => {}}
      onToggle={(id) => hide([id], !parts.find((p) => p.id === id)!.hidden)}
      onBodiesHidden={hide}
      onSketchesHidden={(ids, hidden) => setSketches((ss) => ss.map((s) => (ids.includes(s.id) ? { ...s, hidden } : s)))}
      onOrigin={setOrigin}
      onPicked={spy.onPicked ?? (() => {})}
      onSelectSketch={spy.onSelectSketch ?? (() => {})}
      onRename={() => {}}
      onRenameModel={setName}
      onRenameSketch={() => {}}
      onReorder={() => {}}
      onSketchOn={spy.onSketchOn ?? (() => {})}
      partMenu={() => []}
      sketchMenu={() => [{ id: "edit", label: "Edit sketch", onSelect: () => {} }]}
      renameId={renameId}
      onRenameIdChange={setRenameId}
    />
  );
}

const row = (name: RegExp) => screen.getByRole("treeitem", { name });

describe("browserItems", () => {
  it("puts the model at the top with origin, bodies, sketches and joints under it", () => {
    const items = browserItems(model());
    expect(items[0]).toMatchObject({ id: ROW.root, name: "Rover", kind: "component" });
    const folders = items.filter((i) => i.kind === "folder").map((i) => i.name);
    expect(folders).toEqual(["Origin", "Bodies", "Sketches", "Joints"]);
    expect(items.filter((i) => i.parentId === ROW.bodies).map((i) => i.name)).toEqual(["Box 1", "Cylinder 1"]);
    expect(items.filter((i) => i.parentId === ROW.origin).map((i) => i.name)).toEqual([
      "Origin point",
      "X axis",
      "Y axis",
      "Z axis",
      "XY plane",
      "XZ plane",
      "YZ plane",
    ]);
    expect(items.find((i) => i.id === ROW.joints)).toMatchObject({ note: "None yet", toggles: [] });
  });

  it("shows a folder as hidden only when everything in it is", () => {
    const m = model();
    const one = { ...m, parts: m.parts.map((p, i) => ({ ...p, hidden: i === 0 })) };
    expect(browserItems(one).find((i) => i.id === ROW.bodies)!.hidden).toBe(false);
    const all = { ...m, parts: m.parts.map((p) => ({ ...p, hidden: true })) };
    expect(browserItems(all).find((i) => i.id === ROW.bodies)!.hidden).toBe(true);
    expect(browserItems({ ...m, origin: ["XY"] }).find((i) => i.id === ROW.origin)!.hidden).toBe(false);
  });
});

describe("browserPick", () => {
  it("selects every body from the Bodies folder or the model", () => {
    expect(browserPick([ROW.bodies], model()).parts).toEqual(["a", "b"]);
    expect(browserPick([ROW.root], model()).parts).toEqual(["a", "b"]);
  });
  it("keeps the last sketch or plane as the browser's own pick", () => {
    expect(browserPick(["a", ROW.plane("XZ"), "s1"], model())).toEqual({ parts: ["a"], other: "s1" });
  });
});

describe("BrowserPanel", () => {
  it("is a tree labelled Browser, with the origin folded", () => {
    render(<Harness />);
    expect(screen.getByRole("tree", { name: "Browser" })).toBeInTheDocument();
    expect(row(/^Origin/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: /^XY plane/ })).not.toBeInTheDocument();
    expect(row(/^Box 1/)).toHaveAttribute("aria-level", "3");
    expect(row(/^Joints/)).toHaveTextContent("None yet");
  });

  it("heads the tree with the model's name, renamed with a double-click", async () => {
    render(<Harness />);
    await userEvent.dblClick(screen.getByText("Rover"));
    const box = screen.getByRole("textbox", { name: "Rename Rover" });
    await userEvent.clear(box);
    await userEvent.type(box, "Rover arm{Enter}");
    expect(row(/^Rover arm/)).toHaveAttribute("aria-level", "1");
  });

  it("keeps a shared model's name as it is", async () => {
    render(<Harness readOnly />);
    await userEvent.dblClick(screen.getByText("Rover"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("selects a body, and every body from the folder", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Box 1"));
    expect(row(/^Box 1/)).toHaveAttribute("aria-selected", "true");
    expect(row(/^Cylinder 1/)).toHaveAttribute("aria-selected", "false");
    await userEvent.click(screen.getByText("Bodies"));
    expect(row(/^Box 1/)).toHaveAttribute("aria-selected", "true");
    expect(row(/^Cylinder 1/)).toHaveAttribute("aria-selected", "true");
  });

  it("hides every body from the folder's eye, and shows them again", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Hide Bodies" }));
    expect(row(/^Box 1/)).toHaveClass("bc-off");
    expect(row(/^Cylinder 1/)).toHaveClass("bc-off");
    await userEvent.click(screen.getByRole("button", { name: "Show Bodies" }));
    expect(row(/^Box 1/)).not.toHaveClass("bc-off");
  });

  it("selects and hides a sketch", async () => {
    const onSelectSketch = vi.fn();
    render(<Harness onSelectSketch={onSelectSketch} />);
    await userEvent.click(screen.getByText("Sketch 1"));
    expect(onSelectSketch).toHaveBeenCalledWith("s1");
    expect(row(/^Sketch 1/)).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "Hide Sketch 1" }));
    expect(row(/^Sketch 1/)).toHaveClass("bc-off");
    expect(row(/^Sketches/)).toHaveClass("bc-off");
  });

  it("shows origin planes, picks one for the view, and sketches on it from the menu", async () => {
    const onSketchOn = vi.fn();
    const onPicked = vi.fn();
    render(<Harness onSketchOn={onSketchOn} onPicked={onPicked} />);
    await userEvent.click(screen.getByRole("button", { name: "Show what is in Origin" }));
    expect(row(/^XY plane/)).toHaveClass("bc-off");
    await userEvent.click(screen.getByRole("button", { name: "Show XZ plane" }));
    expect(row(/^XZ plane/)).not.toHaveClass("bc-off");
    expect(row(/^Origin(?! point)/)).not.toHaveClass("bc-off");
    await userEvent.click(screen.getByText("YZ plane"));
    expect(onPicked).toHaveBeenLastCalledWith(ROW.plane("YZ"));
    fireEvent.contextMenu(screen.getByText("XY plane"));
    await userEvent.click(screen.getByRole("menuitem", { name: /Sketch on the XY plane/ }));
    expect(onSketchOn).toHaveBeenCalledWith("XY");
  });

  it("shows and picks the origin point, which the folder's eye includes", async () => {
    const onPicked = vi.fn();
    render(<Harness onPicked={onPicked} />);
    const folderRow = () => row(/^Origin(?! point)/);
    await userEvent.click(screen.getByRole("button", { name: "Show what is in Origin" }));
    expect(row(/^Origin point/)).toHaveClass("bc-off");
    await userEvent.click(screen.getByRole("button", { name: "Show Origin point" }));
    expect(row(/^Origin point/)).not.toHaveClass("bc-off");
    expect(folderRow()).not.toHaveClass("bc-off");
    await userEvent.click(screen.getByRole("button", { name: "Hide Origin" }));
    expect(row(/^Origin point/)).toHaveClass("bc-off");
    await userEvent.click(screen.getByRole("button", { name: "Show Origin" }));
    expect(row(/^Origin point/)).not.toHaveClass("bc-off");
    expect(row(/^XY plane/)).not.toHaveClass("bc-off");
    await userEvent.click(screen.getByText("Origin point"));
    expect(onPicked).toHaveBeenLastCalledWith(ROW.point);
  });

  it("shows, hides and picks the X, Y and Z axes", async () => {
    const onPicked = vi.fn();
    render(<Harness onPicked={onPicked} />);
    await userEvent.click(screen.getByRole("button", { name: "Show what is in Origin" }));
    expect(row(/^Z axis/)).toHaveClass("bc-off");
    await userEvent.click(screen.getByRole("button", { name: "Show Z axis" }));
    expect(row(/^Z axis/)).not.toHaveClass("bc-off");
    expect(row(/^X axis/)).toHaveClass("bc-off");
    expect(row(/^Origin(?! point)/)).not.toHaveClass("bc-off");
    await userEvent.click(screen.getByText("X axis"));
    expect(onPicked).toHaveBeenLastCalledWith(ROW.axis("X"));
    fireEvent.contextMenu(screen.getByText("Z axis"));
    await userEvent.click(screen.getByRole("menuitem", { name: /Hide/ }));
    expect(row(/^Z axis/)).toHaveClass("bc-off");
  });

  it("doesn't rename or drag the folders", () => {
    render(<Harness />);
    fireEvent.doubleClick(screen.getByText("Bodies"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(row(/^Bodies/)).toHaveAttribute("draggable", "false");
    expect(row(/^Box 1/)).toHaveAttribute("draggable", "true");
  });
});

describe("components (#171)", () => {
  // Bodies a and b in Component 1, c in the model; Component 2 inside Component 1 holds d, with a sketch.
  const nested = (over: Partial<BrowserModel> = {}): BrowserModel => {
    let d = addPart(addPart(addPart(addPart(newDoc("Rover"), "box", "a"), "cylinder", "b"), "box", "c"), "box", "d");
    d = addLink(d, ["a", "b"], "L1");
    d = addLink(d, ["d"], "L2", undefined, "L1");
    const b = build(d);
    return { ...model(), parts: b.parts, links: b.components, sketches: [{ id: "s1", name: "Sketch 1", hidden: false, component: "L2" }], ...over };
  };
  const tree = (m: BrowserModel) => browserItems(m).map((i) => `${i.parentId ?? "-"} > ${i.name}${i.note ? ` (${i.note})` : ""}`);

  it("lists each component's bodies and sketches inside it, nested, after the model's own", () => {
    expect(tree(nested())).toEqual([
      "- > Rover",
      `${ROW.root} > Origin`,
      `${ROW.origin} > Origin point`,
      `${ROW.origin} > X axis`,
      `${ROW.origin} > Y axis`,
      `${ROW.origin} > Z axis`,
      `${ROW.origin} > XY plane`,
      `${ROW.origin} > XZ plane`,
      `${ROW.origin} > YZ plane`,
      `${ROW.root} > Bodies (1)`,
      `${ROW.bodies} > Box 2`,
      `${ROW.root} > Component 1`,
      `L1 > Bodies (2)`,
      `${ROW.bodies}:L1 > Box 1`,
      `${ROW.bodies}:L1 > Cylinder 1`,
      `L1 > Component 2`,
      `L2 > Bodies (1)`,
      `${ROW.bodies}:L2 > Box 3`,
      `L2 > Sketches (1)`,
      `${ROW.sketches}:L2 > Sketch 1`,
      `${ROW.root} > Joints (None yet)`,
    ]);
  });

  it("shows an empty component, and the active one's radio on", () => {
    const m = nested({ links: [...nested().links!, { id: "L3", name: "Component 3", parts: [] }], active: "L3" });
    const items = browserItems(m);
    expect(items.find((i) => i.id === "L3")).toMatchObject({ active: true, toggles: ["hidden", "active"], hidden: false });
    expect(items.find((i) => i.id === "L1")).toMatchObject({ active: false });
    expect(items[0]).toMatchObject({ toggles: ["active"], active: false });
    expect(browserItems(nested({ readOnly: true })).find((i) => i.id === "L1")).toMatchObject({ toggles: ["hidden"] });
  });

  it("shuts a component's eye once everything in it, and in the components inside it, is hidden", () => {
    const hide = (m: BrowserModel, ids: string[]) => ({
      ...m,
      parts: m.parts.map((p) => (ids.includes(p.id) ? { ...p, hidden: true } : p)),
      sketches: m.sketches.map((s) => (ids.includes(s.id) ? { ...s, hidden: true } : s)),
    });
    const eye = (m: BrowserModel, id: string) => browserItems(m).find((i) => i.id === id)!.hidden;
    expect(eye(hide(nested(), ["a", "b"]), "L1")).toBe(false);
    expect(eye(hide(nested(), ["a", "b", "d"]), "L1")).toBe(false);
    expect(eye(hide(nested(), ["d"]), "L2")).toBe(false);
    expect(eye(hide(nested(), ["d", "s1"]), "L2")).toBe(true);
    expect(eye(hide(nested(), ["a", "b", "d", "s1"]), "L1")).toBe(true);
  });

  it("hides everything in a component from its eye, as one step, and shows it again", async () => {
    const onBodiesHidden = vi.fn();
    const props = {
      selection: [],
      onSelect: () => {},
      onAdd: () => {},
      onToggle: () => {},
      onActivate: () => {},
      onBodiesHidden,
      onSketchesHidden: () => {},
      onOrigin: () => {},
      onPicked: () => {},
      onSelectSketch: () => {},
      onRename: () => {},
      onRenameModel: () => {},
      onRenameSketch: () => {},
      onReorder: () => {},
      onSketchOn: () => {},
      partMenu: () => [],
      sketchMenu: () => [],
      renameId: null,
      onRenameIdChange: () => {},
    };
    const { rerender } = render(<BrowserPanel model={nested()} {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Hide Component 1" }));
    expect(onBodiesHidden).toHaveBeenLastCalledWith(["a", "b", "d", "s1"], true, "Component 1");
    // The radio stays beside the eye.
    expect(screen.getByRole("button", { name: "Activate Component 1" })).toBeInTheDocument();
    const all = nested();
    const hidden = { ...all, parts: all.parts.map((p) => ({ ...p, hidden: p.id !== "c" })), sketches: all.sketches.map((s) => ({ ...s, hidden: true })) };
    rerender(<BrowserPanel model={hidden} {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Show Component 2" }));
    expect(onBodiesHidden).toHaveBeenLastCalledWith(["d", "s1"], false, "Component 2");
  });

  it("selects a component's bodies with those inside it, and a Bodies folder's own", () => {
    expect(browserPick(["L1"], nested()).parts).toEqual(["a", "b", "d"]);
    expect(browserPick(["L2"], nested()).parts).toEqual(["d"]);
    expect(browserPick([ROW.bodies], nested()).parts).toEqual(["c"]);
    expect(browserPick([`${ROW.bodies}:L1`], nested()).parts).toEqual(["a", "b"]);
  });

  it("activates a component from its radio, and the model from its own", async () => {
    const onActivate = vi.fn();
    const onSelect = vi.fn();
    render(
      <BrowserPanel
        model={nested({ active: "L1" })}
        selection={[]}
        onSelect={onSelect}
        onAdd={() => {}}
        onToggle={() => {}}
        onActivate={onActivate}
        onBodiesHidden={() => {}}
        onSketchesHidden={() => {}}
        onOrigin={() => {}}
        onPicked={() => {}}
        onSelectSketch={() => {}}
        onRename={() => {}}
        onRenameModel={() => {}}
        onRenameSketch={() => {}}
        onReorder={() => {}}
        onSketchOn={() => {}}
        partMenu={() => []}
        sketchMenu={() => []}
        renameId={null}
        onRenameIdChange={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Activate Component 2" }));
    expect(onActivate).toHaveBeenLastCalledWith("L2");
    await userEvent.click(screen.getByRole("button", { name: "Activate Rover" }));
    expect(onActivate).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: "Working in Component 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByText("Component 2"));
    expect(onSelect).toHaveBeenLastCalledWith(["d"]);
  });

  it("makes a component active when you pick its row, and keeps it while you pick bodies", async () => {
    const onActivate = vi.fn();
    const onSelect = vi.fn();
    const props = {
      selection: [],
      onSelect,
      onAdd: () => {},
      onToggle: () => {},
      onActivate,
      onBodiesHidden: () => {},
      onSketchesHidden: () => {},
      onOrigin: () => {},
      onPicked: () => {},
      onSelectSketch: () => {},
      onRename: () => {},
      onRenameModel: () => {},
      onRenameSketch: () => {},
      onReorder: () => {},
      onSketchOn: () => {},
      partMenu: () => [],
      sketchMenu: () => [],
      renameId: null,
      onRenameIdChange: () => {},
    };
    const { rerender } = render(<BrowserPanel model={nested()} {...props} />);
    await userEvent.click(screen.getByText("Component 2"));
    expect(onActivate).toHaveBeenLastCalledWith("L2");
    expect(onSelect).toHaveBeenLastCalledWith(["d"]);

    rerender(<BrowserPanel model={nested({ active: "L2" })} {...props} />);
    expect(screen.getByRole("treeitem", { name: /^Component 2/ })).toHaveClass("bc-row-active");
    onActivate.mockClear();
    // A body, or the active component again, leaves it be; the model's row makes the model active.
    await userEvent.click(screen.getByText("Component 2"));
    await userEvent.click(screen.getByText("Box 2"));
    expect(onActivate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Rover"));
    expect(onActivate).toHaveBeenLastCalledWith(null);
  });
});

describe("moving into components (#334)", () => {
  const m = (): BrowserModel => {
    let d = addPart(addPart(newDoc("Rover"), "box", "a"), "box", "b");
    d = addLink(d, [], "L1");
    d = addLink(d, ["b"], "L2");
    const b = build(d);
    return { ...model(), parts: b.parts, links: b.components, sketches: [{ id: "s1", name: "Sketch 1", hidden: false }] };
  };
  const panel = (onMoveInto: (ids: string[], to: string | null) => void, selection: string[] = []) => (
    <BrowserPanel
      model={m()}
      selection={selection}
      onSelect={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      onMoveInto={onMoveInto}
      onBodiesHidden={() => {}}
      onSketchesHidden={() => {}}
      onOrigin={() => {}}
      onPicked={() => {}}
      onSelectSketch={() => {}}
      onRename={() => {}}
      onRenameModel={() => {}}
      onRenameSketch={() => {}}
      onReorder={() => {}}
      onSketchOn={() => {}}
      partMenu={() => []}
      sketchMenu={() => []}
      renameId={null}
      onRenameIdChange={() => {}}
    />
  );
  const drag = (from: HTMLElement, to: HTMLElement) => {
    fireEvent.dragStart(from, { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    fireEvent.dragOver(to);
    fireEvent.drop(to);
  };

  it("marks what can move and what takes it", () => {
    const items = browserItems(m());
    expect(items.find((i) => i.id === "a")).toMatchObject({ move: true });
    expect(items.find((i) => i.id === "s1")).toMatchObject({ move: true });
    expect(items.find((i) => i.id === "L1")).toMatchObject({ move: true, into: true });
    expect(items[0]).toMatchObject({ into: true });
    expect(browserItems({ ...m(), readOnly: true }).some((i) => i.move || i.into)).toBe(false);
  });

  it("drops a sketch onto a component, a body back onto the model, and a component into another", () => {
    const onMoveInto = vi.fn();
    render(panel(onMoveInto));
    drag(row(/^Sketch 1/), row(/Component 1$/));
    expect(onMoveInto).toHaveBeenLastCalledWith(["s1"], "L1");
    drag(row(/^Box 2/), row(/Rover/));
    expect(onMoveInto).toHaveBeenLastCalledWith(["b"], null);
    drag(row(/Component 2$/), row(/Component 1$/));
    expect(onMoveInto).toHaveBeenLastCalledWith(["L2"], "L1");
  });

  it("drags the selected bodies together", () => {
    const onMoveInto = vi.fn();
    render(panel(onMoveInto, ["a", "b"]));
    drag(row(/^Box 1/), row(/Component 1$/));
    expect(onMoveInto).toHaveBeenLastCalledWith(["a", "b"], "L1");
  });

  it("offers Move into from the menu, but not into where it is or into itself", async () => {
    const onMoveInto = vi.fn();
    render(panel(onMoveInto));
    fireEvent.contextMenu(row(/Component 2$/));
    expect(screen.queryByRole("menuitem", { name: "Move into Component 2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to Rover" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Move into Component 1" }));
    expect(onMoveInto).toHaveBeenLastCalledWith(["L2"], "L1");
  });
});

describe("joints in the browser (#172)", () => {
  it("lists joints, and shows only the name on each component's row", () => {
    let d = addPart(addPart(addPart(newDoc("Arm"), "box", "a"), "box", "b"), "box", "c");
    d = addLink(addLink(d, ["b"], "L1"), ["c"], "L2");
    const axis = { origin: [0, 0, 0] as [number, number, number], axis: [0, 0, 1] as [number, number, number] };
    d = addJoint(d, { kind: "revolute", child: "L1", parent: null, ...axis, lower: -90, upper: 90 }, "J1");
    d = addJoint(d, { kind: "continuous", child: "L2", parent: "L1", ...axis, lower: 0, upper: 0 }, "J2");
    const b = build(d);
    const items = browserItems({ ...model(), parts: b.parts, links: b.links, joints: b.joints });
    expect(items.find((i) => i.id === ROW.joints)).toMatchObject({ note: "2" });
    expect(items.filter((i) => i.parentId === ROW.joints).map((i) => [i.name, i.note])).toEqual([
      ["Joint 1", "Hinge"],
      ["Joint 2", "Wheel"],
    ]);
    // Joints don't nest components: where each sits is up to you, as in Fusion.
    expect(items.find((i) => i.id === "L1")).toMatchObject({ parentId: ROW.root });
    expect(items.find((i) => i.id === "L1")?.note).toBeUndefined();
    expect(items.find((i) => i.id === "L2")).toMatchObject({ parentId: ROW.root });
    expect(items.find((i) => i.id === "L2")?.note).toBeUndefined();
  });
});

describe("named poses in the browser (#177)", () => {
  function robot(over: Partial<BrowserModel> = {}): BrowserModel {
    let d = addPart(addPart(newDoc("Arm"), "box", "a"), "box", "b");
    d = addLink(d, ["b"], "L1");
    d = addJoint(d, { kind: "revolute", child: "L1", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: -90, upper: 90 }, "J1");
    const b = build(d);
    return { ...model(), parts: b.parts, links: b.links, joints: b.joints, poses: [{ id: "p1", name: "Reach" }], ...over };
  }
  const panel = (m: BrowserModel, spy: { onPose?: (id: string | null) => void; onSavePose?: () => void; onDeletePose?: (id: string) => void } = {}) => (
    <BrowserPanel
      model={m}
      selection={[]}
      onSelect={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      onBodiesHidden={() => {}}
      onSketchesHidden={() => {}}
      onOrigin={() => {}}
      onPicked={() => {}}
      onSelectSketch={() => {}}
      onRename={() => {}}
      onRenameModel={() => {}}
      onRenameSketch={() => {}}
      onReorder={() => {}}
      onSketchOn={() => {}}
      partMenu={() => []}
      sketchMenu={() => []}
      renameId={null}
      onRenameIdChange={() => {}}
      {...spy}
    />
  );

  it("lists Home and each pose under Poses once there are joints, marking the one the joints are in", () => {
    expect(browserItems(model()).some((i) => i.id === ROW.poses)).toBe(false);
    const items = browserItems(robot({ atPose: "p1" }));
    expect(items.filter((i) => i.parentId === ROW.poses).map((i) => [i.name, i.note])).toEqual([
      ["Home", undefined],
      ["Reach", "Now"],
    ]);
  });

  it("goes to a pose on click, and saves and deletes from the menu", async () => {
    const onPose = vi.fn();
    const onSavePose = vi.fn();
    const onDeletePose = vi.fn();
    render(panel(robot(), { onPose, onSavePose, onDeletePose }));
    await userEvent.click(screen.getByText("Reach"));
    expect(onPose).toHaveBeenCalledWith("p1");
    await userEvent.click(screen.getByText("Home"));
    expect(onPose).toHaveBeenLastCalledWith(null);
    fireEvent.contextMenu(row(/^Poses/));
    await userEvent.click(screen.getByRole("menuitem", { name: /Save pose/ }));
    expect(onSavePose).toHaveBeenCalled();
    fireEvent.contextMenu(row(/^Reach/));
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(onDeletePose).toHaveBeenCalledWith("p1");
  });

  it("offers only Go to in a shared model", () => {
    render(panel(robot({ readOnly: true })));
    fireEvent.contextMenu(row(/^Reach/));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Go to Reach"]);
  });
});
