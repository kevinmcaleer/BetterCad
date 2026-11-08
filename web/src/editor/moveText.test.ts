import { addPart, newDoc } from "../state/document";
import { formatCombo } from "../state/commands";
import { moveText } from "./DeleteStepDialog";

describe("moveText", () => {
  const d = addPart(addPart(newDoc(), "box", "a"), "box", "b");
  const [a, b] = d.features;
  const undo = `Double-click a step to check it, or press ${formatCombo("mod+z")} to undo the move.`;

  it("says nothing without a move, after the model changes, or when nothing broke", () => {
    expect(moveText(d, null, new Map())).toBeNull();
    expect(moveText(d, { doc: newDoc(), text: "x", failedBefore: new Set() }, new Map())).toBeNull();
    expect(moveText(d, { doc: d, text: "", failedBefore: new Set() }, new Map())).toBeNull();
  });
  it("names picks that may be wrong and steps that no longer build, but not old failures", () => {
    expect(moveText(d, { doc: d, text: "Box 2 picks edges", failedBefore: new Set() }, new Map())).toBe(`Box 2 picks edges. ${undo}`);
    const failed = new Map([
      [a!.id, "gone"],
      [b!.id, "gone"],
    ]);
    expect(moveText(d, { doc: d, text: "", failedBefore: new Set([a!.id]) }, failed)).toBe(`Box 2 can't build now. ${undo}`);
    expect(moveText(d, { doc: d, text: "", failedBefore: new Set() }, failed)).toBe(`Box 1 and Box 2 can't build now. ${undo}`);
  });
});
