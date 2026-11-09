import { describe, expect, it } from "vitest";
import { addFinish, addPart, newDoc, updateFinish } from "../state/document";
import { recoveredText } from "../editor/DeleteStepDialog";
import { pickNames } from "./names";

const names = { faces: ["cap.start", "cap.end", "side(l1)"], edges: ["cap.end|side(l1)", "cap.start|side(l1)"] };

describe("picks by name (#47)", () => {
  it("stores the names of the picked edges or faces", () => {
    expect(pickNames(names, "edges", [1, 0])).toEqual(["cap.start|side(l1)", "cap.end|side(l1)"]);
    expect(pickNames(names, "faces", [2])).toEqual(["side(l1)"]);
  });

  it("stores none when the body has no names or a pick isn't named", () => {
    expect(pickNames(undefined, "edges", [0])).toBeUndefined();
    expect(pickNames(names, "edges", [5])).toBeUndefined();
    expect(pickNames(names, "faces", [])).toBeUndefined();
  });

  it("warns on the timeline about steps found again only by place", () => {
    let d = addPart(newDoc(), "box", "b");
    d = addFinish(d, { type: "fillet", part: "b", refs: [0], size: 1 }, "f1");
    d = addFinish(d, { type: "chamfer", part: "b", refs: [1], size: 1 }, "f2");
    expect(recoveredText(d, new Map())).toBeNull();
    expect(recoveredText(d, new Map([["f1", "x"]]))).toBe(
      "Fillet 1 picks edges or faces that an earlier step changed. Double-click it to check it's on the right ones.",
    );
    expect(
      recoveredText(
        d,
        new Map([
          ["f1", "x"],
          ["f2", "x"],
        ]),
      ),
    ).toMatch(/^Fillet 1 and Chamfer 1 pick .* Double-click each to check they're/);
    // Steps past the marker aren't built, so they aren't mentioned.
    expect(recoveredText(d, new Map([["f2", "x"]]), 2)).toBeNull();
  });

  it("drops stored names when the picks change without them", () => {
    let d = addPart(newDoc(), "box", "b");
    d = addFinish(d, { type: "fillet", part: "b", refs: [0], names: ["a|b"], size: 1 }, "f1");
    expect(d.features.at(-1)).toMatchObject({ names: ["a|b"] });
    expect(updateFinish(d, "f1", { size: 2 }).features.at(-1)).toMatchObject({ names: ["a|b"] });
    expect(updateFinish(d, "f1", { refs: [3] }).features.at(-1)).not.toHaveProperty("names");
    expect(updateFinish(d, "f1", { refs: [3], names: ["c|d"] }).features.at(-1)).toMatchObject({ refs: [3], names: ["c|d"] });
  });
});
