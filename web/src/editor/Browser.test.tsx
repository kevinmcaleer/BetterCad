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
    expect(items.filter((i) => i.parentId === ROW.origin).map((i) => i.name)).toEqual(["Origin point", "XY plane", "XZ plane", "YZ plane"]);
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

  it("doesn't rename or drag the folders", () => {
    render(<Harness />);
    fireEvent.doubleClick(screen.getByText("Bodies"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(row(/^Bodies/)).toHaveAttribute("draggable", "false");
    expect(row(/^Box 1/)).toHaveAttribute("draggable", "true");
  });
});

describe("robot tree (#171)", () => {
  const linked = () => {
    const d = addLink(addPart(addPart(addPart(newDoc("Rover"), "box", "a"), "cylinder", "b"), "box", "c"), ["a", "b"], "L1");
    const b = build(d);
    return { ...model(), parts: b.parts, links: b.links };
  };

  it("hides the Robot folder until there is a link", () => {
    expect(browserItems(model()).some((i) => i.id === ROW.robot)).toBe(false);
  });

  it("lists Base, then each link with its body count", () => {
    const items = browserItems(linked());
    expect(items.find((i) => i.id === ROW.robot)).toMatchObject({ name: "Robot", note: "1" });
    expect(items.filter((i) => i.parentId === ROW.robot).map((i) => [i.name, i.note])).toEqual([
      ["Base", "1 body"],
      ["Link 1", "2 bodies"],
    ]);
  });

  it("selects a link's bodies from its row, and Base's from Base", () => {
    expect(browserPick(["L1"], linked()).parts).toEqual(["a", "b"]);
    expect(browserPick([ROW.base], linked()).parts).toEqual(["c"]);
  });

  it("shows the tree by role and selects a link's bodies on click", async () => {
    const onSelect = vi.fn();
    const m = linked();
    render(
      <BrowserPanel
        model={m}
        selection={[]}
        onSelect={onSelect}
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
      />,
    );
    expect(row(/^Robot/)).toBeInTheDocument();
    expect(row(/^Base/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Link 1"));
    expect(onSelect).toHaveBeenLastCalledWith(["a", "b"]);
  });
});

describe("joints in the browser (#172)", () => {
  it("lists joints, and hangs each link under the link its joint hangs from", () => {
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
    expect(items.find((i) => i.id === "L1")).toMatchObject({ parentId: ROW.base, note: "1 body, hinge on Joint 1" });
    expect(items.find((i) => i.id === "L2")).toMatchObject({ parentId: "L1", note: "1 body, wheel on Joint 2" });
    // Children come after their parent.
    const order = items.map((i) => i.id);
    expect(order.indexOf("L2")).toBeGreaterThan(order.indexOf("L1"));
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
