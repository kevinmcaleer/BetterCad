import { fireEvent, render, screen, within } from "@testing-library/react";
import { addPart, changeParts, featureSummary, newDoc, updateFeature } from "../state/document";
import { Timeline } from "./Timeline";
import { Editor } from "./Editor";

function setup(at: number, failed = new Map<string, string>()) {
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
});
