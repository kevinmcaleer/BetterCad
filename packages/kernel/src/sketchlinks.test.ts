import { describe, expect, it } from "vitest";
import { drawRectangle, planeFrame, projectSegments, type Sketch, type Vec3 } from "@bettercad/sketch";
import {
  addPart,
  addSketch,
  build,
  fixSketchLinks,
  newDoc,
  redefineSketchPlane,
  removeFeature,
  sketchBrokenLinks,
  updateSketch,
  type ModelDoc,
} from "./document";

/** A box, then a sketch on XY with the box's top edges projected onto it and a rectangle of its own. */
function linked(): { d: ModelDoc; box: string } {
  let d = addPart(newDoc(), "box", "b1");
  d = addSketch(d, { kind: "world", plane: "XY", offset: 0 }, "s1");
  const top: Vec3[] = [
    [0, 0, 20],
    [20, 0, 20],
    [20, 20, 20],
    [0, 20, 20],
  ];
  const segs = top.map((p, i) => [p, top[(i + 1) % 4]!] as [Vec3, Vec3]);
  d = updateSketch(d, "s1", (s: Sketch) => {
    const r = projectSegments(s, planeFrame(s.plane), segs, { body: "b1", face: 5 });
    if (typeof r === "string") throw new Error(r);
    return drawRectangle(r, [30, 0], [40, 10]).sketch;
  });
  return { d, box: d.features[0]!.id };
}

const sketchOf = (d: ModelDoc) => (d.features.find((f) => f.id === "s1") as { sketch: Sketch }).sketch;

describe("sketch links", () => {
  it("are fine while the body is there", () => {
    const { d } = linked();
    expect(sketchBrokenLinks(d, "s1")).toEqual([]);
    expect(build(d).failed.has("s1")).toBe(false);
  });

  it("break when the projected body goes, and say how to fix them", () => {
    const { d, box } = linked();
    const gone = removeFeature(d, box);
    expect(sketchBrokenLinks(gone, "s1")).toHaveLength(8);
    expect(build(gone).failed.get("s1")).toBe("4 projected edges have lost the body they came from. Fix the links from the timeline menu.");
  });

  it("keep the geometry as plain fixed lines", () => {
    const { d, box } = linked();
    const fixed = fixSketchLinks(removeFeature(d, box), "s1", "keep");
    expect(sketchBrokenLinks(fixed, "s1")).toEqual([]);
    expect(build(fixed).failed.has("s1")).toBe(false);
    expect(sketchOf(fixed).entities).toHaveLength(sketchOf(d).entities.length);
    expect(sketchOf(fixed).entities.some((e) => e.projectedFrom)).toBe(false);
  });

  it("delete the projected geometry and leave the rest", () => {
    const { d, box } = linked();
    const fixed = fixSketchLinks(removeFeature(d, box), "s1", "delete");
    expect(build(fixed).failed.has("s1")).toBe(false);
    // The rectangle's four lines and four corners stay.
    expect(sketchOf(fixed).entities).toHaveLength(8);
    expect(sketchOf(fixed).constraints.every((c) => c.type !== "fix")).toBe(true);
  });

  it("say when the face a sketch sits on is gone, and a new plane fixes it", () => {
    let d = addPart(newDoc(), "box", "b1");
    const frame = { origin: [10, 10, 20] as Vec3, x: [1, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    d = addSketch(d, { kind: "face", face: { body: "b1", face: 5 }, offset: 0, frame }, "s1");
    const gone = removeFeature(d, d.features[0]!.id);
    expect(build(gone).failed.get("s1")).toBe("The face it sits on is gone. Redefine its plane from the timeline menu.");
    const moved = redefineSketchPlane(gone, "s1", { kind: "world", plane: "XZ", offset: 0 });
    expect(build(moved).failed.has("s1")).toBe(false);
    expect(sketchOf(moved).plane).toEqual({ kind: "world", plane: "XZ", offset: 0 });
  });
});
