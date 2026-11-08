import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { addPart, changeParts, featureSummary, newDoc, updateFeature, type Feature } from "../state/document";
import { Timeline } from "./Timeline";
import { Editor } from "./Editor";

function setup(at: number, failed = new Map<string, string>(), onEdit?: (f: Feature) => void) {
  let d = changeParts(addPart(addPart(newDoc(), "box", "a"), "sphere", "b"), ["a"], "position", { x: 9 });
  d = updateFeature(d, d.features[1]!.id, { suppressed: true });
  const onMarker = vi.fn();
  const onSelect = vi.fn();
  const onMenu = vi.fn();
  render(
    <Timeline
      features={d.features}
      at={at}
      onMarker={onMarker}
      failed={failed}
      activeId={d.features[0]!.id}
      summary={(f) => featureSummary(d, f)}
      onSelect={onSelect}
      onMenu={onMenu}
      onEdit={onEdit}
    />,
  );
  return { d, onMarker, onSelect, onMenu };
}

describe("Timeline", () => {
  it("shows a tile per step with its state", () => {
    const { d } = setup(2, new Map([["x", "gone"]]));
    const bar = screen.getByRole("region", { name: "Timeline" });
    const box = within(bar).getByRole("button", { name: /^Box 1/ });
    expect(box).toHaveClass("bc-on");
    expect(box).toHaveAttribute("aria-pressed", "true");
    expect(box).not.toHaveClass("bc-after");
    expect(within(bar).getByRole("button", { name: /^Sphere 1.*suppressed/ })).toHaveClass("bc-suppressed");
    const move = within(bar).getByRole("button", { name: /^Move 1, Box 1, X 9 mm, not built/ });
    expect(move).toHaveClass("bc-after");
    expect(move).toHaveAttribute("data-tip", "Move 1 · Box 1, X 9 mm");
    expect(d.features).toHaveLength(3);
  });
  it("marks a failed step", () => {
    const d = changeParts(addPart(newDoc(), "box", "a"), ["a"], "size", { z: 3 });
    render(
      <Timeline
        features={d.features}
        at={2}
        onMarker={() => {}}
        failed={new Map([[d.features[1]!.id, "The parts it changes are gone"]])}
        activeId={null}
        summary={() => "x"}
        onSelect={() => {}}
        onMenu={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /^Resize 1.*problem/ })).toHaveClass("bc-failed");
  });
  it("moves the marker with the keyboard and the play controls", () => {
    const { onMarker } = setup(2);
    const marker = screen.getByRole("slider", { name: "Timeline marker" });
    expect(marker).toHaveAttribute("aria-valuenow", "2");
    expect(marker).toHaveAttribute("aria-valuetext", "Rolled back to after Sphere 1");
    fireEvent.keyDown(marker, { key: "ArrowLeft" });
    expect(onMarker).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(marker, { key: "End" });
    expect(onMarker).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Roll back to the start" }));
    expect(onMarker).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Go to the end" }));
    expect(onMarker).toHaveBeenLastCalledWith(3);
  });
  it("selects a step on click and opens its menu on right-click", () => {
    const { d, onSelect, onMenu } = setup(3);
    fireEvent.click(screen.getByRole("button", { name: /^Move 1/ }));
    expect(onSelect).toHaveBeenCalledWith(d.features[2]);
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Box 1/ }));
    expect(onMenu).toHaveBeenCalledWith(d.features[0], expect.objectContaining({ x: expect.any(Number) }));
  });
});

/** Adds a box from the Library on the top bar. */
function addBox() {
  fireEvent.click(screen.getByRole("button", { name: "Library" }));
  fireEvent.click(screen.getByRole("button", { name: "Box" }));
}

describe("Timeline marker drag", () => {
  /** Lays the tiles out 30 px apart, as jsdom has no layout. */
  function layOut() {
    screen
      .getByRole("region", { name: "Timeline" })
      .querySelectorAll<HTMLElement>(".bc-tl-tile")
      .forEach((t) => {
        const i = (Number(t.style.order) - 1) / 2;
        t.getBoundingClientRect = () => ({ left: i * 30, width: 24, top: 0, height: 24, right: i * 30 + 24, bottom: 24, x: i * 30, y: 0, toJSON: () => ({}) });
      });
  }
  it("scrubs across several steps in one drag", () => {
    // jsdom has no PointerEvent; a MouseEvent carries the button and position the drag reads.
    if (!("PointerEvent" in window)) vi.stubGlobal("PointerEvent", class extends MouseEvent {});
    let d = addPart(newDoc(), "box", "a");
    for (const k of ["b", "c", "d", "e"]) d = addPart(d, "box", k);
    const seen: number[] = [];
    function Host() {
      const [at, setAt] = useState(5);
      return (
        <Timeline
          features={d.features}
          at={at}
          onMarker={(to) => {
            seen.push(to);
            setAt(to);
          }}
          failed={new Map()}
          activeId={null}
          summary={() => "x"}
          onSelect={() => {}}
          onMenu={() => {}}
        />
      );
    }
    render(<Host />);
    layOut();
    const marker = screen.getByRole("slider", { name: "Timeline marker" });
    fireEvent.pointerDown(marker, { button: 0, pointerId: 1, clientX: 150 });
    for (const x of [120, 90, 60, 30, 0]) {
      fireEvent.pointerMove(screen.getByRole("slider", { name: "Timeline marker" }), { pointerId: 1, clientX: x });
      layOut();
    }
    // The same element all the way, so the drag carries on past the first step.
    expect(screen.getByRole("slider", { name: "Timeline marker" })).toBe(marker);
    expect(marker).toHaveAttribute("aria-valuenow", "0");
    expect(seen).toEqual([4, 3, 2, 1, 0]);
    fireEvent.pointerUp(marker, { pointerId: 1 });
    fireEvent.pointerMove(marker, { pointerId: 1, clientX: 150 });
    expect(seen).toHaveLength(5);
    vi.unstubAllGlobals();
  });
});

describe("Timeline edit", () => {
  it("opens a step on a double-click", () => {
    const onEdit = vi.fn();
    const { d, onSelect } = setup(3, undefined, onEdit);
    fireEvent.click(screen.getByRole("button", { name: /^Move 1/ }), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Move 1/ }), { detail: 2 });
    expect(onSelect).toHaveBeenCalledWith(d.features[2]);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(d.features[2]);
  });
  it("opens a step on a double-tap, where the second tap has no click count", () => {
    const onEdit = vi.fn();
    const { d } = setup(3, undefined, onEdit);
    const box = screen.getByRole("button", { name: /^Box 1/ });
    fireEvent.click(box, { detail: 1 });
    fireEvent.click(box, { detail: 1 });
    expect(onEdit).toHaveBeenCalledWith(d.features[0]);
  });
  it("does not open a step from a single click, two different tiles or the keyboard", () => {
    const onEdit = vi.fn();
    setup(3, undefined, onEdit);
    fireEvent.click(screen.getByRole("button", { name: /^Box 1/ }), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Move 1/ }), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Sphere 1/ }), { detail: 0 });
    fireEvent.click(screen.getByRole("button", { name: /^Sphere 1/ }), { detail: 0 });
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("Editor timeline", () => {
  it("rolls the model back and inserts new steps at the marker", () => {
    render(<Editor />);
    addBox();
    addBox();
    expect(screen.getAllByRole("treeitem", { name: /^Box/ })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /^Step back/ }));
    expect(screen.getAllByRole("treeitem", { name: /^Box/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Box 2.*not built/ })).toHaveClass("bc-after");

    addBox();
    const tiles = within(screen.getByRole("region", { name: "Timeline" }))
      .getAllByRole("button", { name: /^Box/ })
      .map((b) => b.getAttribute("aria-label")!.split(",")[0]);
    expect(tiles).toEqual(["Box 1", "Box 3", "Box 2"]);
    expect(screen.getByRole("slider", { name: "Timeline marker" })).toHaveAttribute("aria-valuenow", "2");

    fireEvent.keyDown(window, { key: "End", altKey: true });
    expect(screen.getAllByRole("treeitem", { name: /^Box/ })).toHaveLength(3);
  });
  it("opens a step past the marker on a double-click, rolling forward to it", () => {
    render(<Editor />);
    addBox();
    addBox();
    fireEvent.click(screen.getByRole("button", { name: /^Step back/ }));
    const tile = screen.getByRole("button", { name: /^Box 2.*not built/ });
    fireEvent.click(tile, { detail: 1 });
    fireEvent.click(tile, { detail: 2 });
    expect(screen.getByRole("slider", { name: "Timeline marker" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getAllByText("Change Box 2 in Properties.").length).toBeGreaterThan(0);
  });
  const tile = (name: RegExp) => within(screen.getByRole("region", { name: "Timeline" })).getByRole("button", { name });
  const tiles = () =>
    within(screen.getByRole("region", { name: "Timeline" }))
      .queryAllByRole("button")
      .filter((b) => b.classList.contains("bc-tl-tile"))
      .map((b) => b.getAttribute("aria-label")!.split(",")[0]);

  it("deletes the last step picked on the timeline with Delete, without adding a step", () => {
    render(<Editor />);
    addBox();
    addBox();
    fireEvent.click(tile(/^Box 2/), { detail: 1 });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.queryByRole("dialog", { name: /^Delete/ })).toBeNull();
    expect(tiles()).toEqual(["Box 1"]);
    // Undo brings the step back; the timeline never gained a delete step.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(tiles()).toEqual(["Box 1", "Box 2"]);
  });

  it("warns before deleting an earlier step, then just removes it", () => {
    render(<Editor />);
    addBox();
    addBox();
    fireEvent.click(tile(/^Box 1/), { detail: 1 });
    fireEvent.keyDown(window, { key: "Delete" });
    const dialog = screen.getByRole("dialog", { name: "Delete Box 1" });
    expect(within(dialog).getByText(/1 later step comes after Box 1\. It rebuilds without it/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(tiles()).toEqual(["Box 2"]);
  });

  it("still records a delete step for parts picked in the model", () => {
    render(<Editor />);
    addBox();
    fireEvent.click(screen.getByRole("treeitem", { name: /^Box 1/ }));
    fireEvent.keyDown(window, { key: "Delete" });
    expect(tiles()).toEqual(["Box 1", "Delete 1"]);
  });

  it("warns on the timeline while rolled back", () => {
    render(<Editor />);
    addBox();
    addBox();
    const bar = screen.getByRole("region", { name: "Timeline" });
    expect(within(bar).queryByText(/Rolled back/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Step back/ }));
    expect(within(bar).getByText("Rolled back. What you add goes before 1 later step, which may break.")).toBeInTheDocument();
  });
});
