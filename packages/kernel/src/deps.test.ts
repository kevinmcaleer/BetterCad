import { describe, expect, it } from "vitest";
import { drawRectangle } from "@bettercad/sketch";
import {
  addCombine,
  addExtrude,
  addFinish,
  addHole,
  addPart,
  addSketch,
  build,
  changeParts,
  dependents,
  dependsOn,
  moveProblem,
  newDoc,
  removeWithDependents,
  updateFeature,
  updateSketch,
  usedByText,
  type ModelDoc,
} from "./document";

/**
 * Ten steps: Box 1 (a), Box 2 (b), Sketch 1 on XY, Extrude 1 (new body e), Move Box 2, Fillet Box 1, Extrude 2 cutting
 * Box 1, Hole in Box 1, Combine e into Box 2, Sketch 2 (unused).
 */
function model(): ModelDoc {
  let d = addPart(newDoc(), "box", "a");
  d = addPart(d, "box", "b");
  d = addSketch(d, { kind: "world", plane: "XY", offset: 0 }, "s1");
  d = updateSketch(d, "s1", (s) => drawRectangle(s, [-50, -5], [-40, 5]).sketch);
  d = addExtrude(d, { sketch: "s1", seeds: [[-45, 0]], distance: 5, direction: "one", operation: "new" }, "x1", "e");
  d = changeParts(d, ["b"], "position", { y: 5 });
  d = addFinish(d, { type: "fillet", part: "a", refs: [0], size: 1 }, "f1");
  d = addExtrude(d, { sketch: "s1", seeds: [[-45, 0]], distance: 5, direction: "one", operation: "cut", target: "a" }, "x2");
  d = addHole(
    d,
    { part: "a", frame: { origin: [0, 0, 20], x: [1, 0, 0], normal: [0, 0, 1] }, points: [[0, 0]], size: "M3", fit: "printed", head: "none", depth: null },
    "h1",
  );
  d = addCombine(d, { mode: "combine", target: "b", tools: [{ id: "e", op: "join" }] }, "c1");
  d = addSketch(d, { kind: "world", plane: "XZ", offset: 0 }, "s2");
  return d;
}
const ids = (d: ModelDoc) => d.features.map((f) => f.id);

describe("dependencies", () => {
  it("knows what each step needs", () => {
    const d = model();
    const [a, b, , , mv] = ids(d);
    expect(dependsOn(d, "x1")).toEqual(["s1"]);
    expect(dependsOn(d, mv!)).toEqual([b]);
    expect(dependsOn(d, "f1")).toEqual([a]);
    // The cut changes Box 1, and picks by number come after it.
    expect(dependsOn(d, "x2").sort()).toEqual([a, "s1"].sort());
    expect(dependsOn(d, "h1").sort()).toEqual([a, "f1", "x2"].sort());
    expect(dependsOn(d, "c1").sort()).toEqual([b, "x1"].sort());
    expect(dependsOn(d, "s2")).toEqual([]);
  });

  it("finds every dependent, through others", () => {
    const d = model();
    expect(dependents(d, "s1").map((f) => f.id)).toEqual(["x1", "x2", "h1", "c1"]);
    expect(usedByText(d, "s1")).toBe("Sketch 1 is used by Extrude 1, Extrude 2, Hole 1 and Combine 1");
    expect(usedByText(d, "s2")).toBeNull();
  });

  it("allows a move only where everything still comes after what it needs", () => {
    const d = model();
    expect(moveProblem(d, "x1", "s1")).toBe("Extrude 1 needs Sketch 1 before it");
    expect(moveProblem(d, "s1", null)).toBe("Extrude 1 needs Sketch 1 before it");
    expect(moveProblem(d, "s2", ids(d)[0]!)).toBeNull();
    expect(moveProblem(d, "f1", "x2")).toBeNull();
    expect(moveProblem(d, "h1", "x2")).toBe("Hole 1 needs Extrude 2 before it");
  });

  it("deletes a step with its dependents, or says the suppressed step a failure needs", () => {
    const d = model();
    expect(ids(removeWithDependents(d, "x1"))).not.toContain("c1");
    const s = updateFeature(d, "x1", { suppressed: true });
    expect(build(s).failed.get("c1")).toBe("Needs Extrude 1, which is suppressed");
  });
});
