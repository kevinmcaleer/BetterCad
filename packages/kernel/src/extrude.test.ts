import { beforeAll, describe, expect, it } from "vitest";
import { drawCircle, drawRectangle, type Sketch } from "@bettercad/sketch";
import {
  addExtrude,
  addPart,
  addSketch,
  build,
  changeParts,
  featureSummary,
  newDoc,
  updateExtrude,
  updateSketch,
  type ExtrudeParams,
  type ModelDoc,
} from "./document";
import { extent, frameToLocal, pickProfiles } from "./extrude";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A 30 × 20 mm rectangle on the ground with a 5 mm radius circle inside it. */
function sketched(): ModelDoc {
  let d = addSketch(newDoc(), { kind: "world", plane: "XY", offset: 0 }, "s1");
  d = updateSketch(d, "s1", (s: Sketch) => drawCircle(drawRectangle(s, [0, 0], [30, 20]).sketch, [15, 10], 5).sketch);
  return d;
}

const params = (p: Partial<ExtrudeParams> = {}): ExtrudeParams => ({ sketch: "s1", seeds: [[2, 2]], distance: 10, direction: "one", operation: "new", ...p });

describe("extrude geometry", () => {
  it("works out the extent for each direction", () => {
    expect(extent("one", 10)).toEqual({ from: 0, to: 10 });
    expect(extent("one", -4)).toEqual({ from: -4, to: 0 });
    expect(extent("symmetric", 10)).toEqual({ from: -5, to: 5 });
    expect(extent("two", 10, 3)).toEqual({ from: -3, to: 10 });
  });

  it("picks the profile under a point, with its holes", () => {
    const s = sketched().features[0]!;
    if (s.type !== "sketch") throw new Error("no sketch");
    const ring = pickProfiles(s.sketch, [[2, 2]]);
    expect(ring.lost).toBe(0);
    expect(ring.shapes).toHaveLength(1);
    expect(ring.shapes[0]!.holes).toHaveLength(1);
    expect(ring.shapes[0]!.area).toBeCloseTo(600 - Math.PI * 25, 3);
    const disc = pickProfiles(s.sketch, [
      [15, 10],
      [15, 11],
      [99, 99],
    ]);
    expect(disc.shapes).toHaveLength(1);
    expect(disc.shapes[0]!.outer[0]!.kind).toBe("circle");
    expect(disc.lost).toBe(1);
  });

  it("turns a world frame into a moved part's own frame", () => {
    const f = frameToLocal({ origin: [10, 0, 5], x: [1, 0, 0], normal: [0, 0, 1] }, { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 90 } });
    expect(f.origin.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 5]);
    expect(f.x.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, -1, 0]);
    expect(f.normal.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 1]);
  });
});

describe("extrude on the timeline", () => {
  it("makes a new body from a sketch", () => {
    const d = addExtrude(sketched(), params(), "e1", "b1");
    const b = build(d);
    expect(b.failed.size).toBe(0);
    expect(b.parts).toHaveLength(1);
    expect(b.parts[0]).toMatchObject({ id: "b1", name: "Body 1", kind: "solid", size: { x: 30, y: 20, z: 10 } });
    expect(featureSummary(d, d.features[1]!)).toMatch(/10 mm/);
  });

  it("follows the sketch when it changes", () => {
    let d = addExtrude(sketched(), params(), "e1", "b1");
    d = updateSketch(d, "s1", (s) => drawRectangle(s, [40, 0], [60, 10]).sketch);
    d = updateExtrude(d, "e1", {
      seeds: [
        [2, 2],
        [50, 5],
      ],
    });
    const b = build(d);
    expect(b.parts[0]!.prism!.profiles).toHaveLength(2);
    expect(b.parts[0]!.size.x).toBe(60);
  });

  it("says why it cannot apply", () => {
    expect(build(addExtrude(sketched(), params({ distance: 0 }), "e1")).failed.get("e1")).toMatch(/distance/);
    expect(build(addExtrude(sketched(), params({ seeds: [[99, 99]] }), "e1")).failed.get("e1")).toMatch(/closed/);
    expect(build(addExtrude(sketched(), params({ sketch: "nope" }), "e1")).failed.get("e1")).toMatch(/sketch is gone/);
    expect(build(addExtrude(sketched(), params({ operation: "cut" }), "e1")).failed.get("e1")).toMatch(/Pick the body/);
  });

  it("cuts into a body in its own coordinates, so the cut moves with it", () => {
    let d = addPart(sketched(), "box", "box");
    d = changeParts(d, ["box"], "size", { x: 30, y: 20, z: 20 });
    d = changeParts(d, ["box"], "position", { x: 15, y: 10, z: -10 });
    d = addExtrude(d, params({ seeds: [[15, 10]], distance: -5, operation: "cut", target: "box" }), "e1");
    const box = build(d).parts.find((p) => p.id === "box")!;
    expect(box.ops).toHaveLength(1);
    expect(box.ops![0]!.tool.frame.origin).toEqual([-15, -10, 10]);
  });
});

describe("extrude in the kernel", () => {
  it("builds the body and its volume", () => {
    const r = new ModelBuilder(oc).build(addExtrude(sketched(), params(), "e1", "b1"));
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo((600 - Math.PI * 25) * 10, 1);
  });

  it("cuts a hole into a box", () => {
    let d = addPart(sketched(), "box", "box");
    d = changeParts(d, ["box"], "size", { x: 30, y: 20, z: 20 });
    d = changeParts(d, ["box"], "position", { x: 15, y: 10, z: -10 });
    d = addExtrude(d, params({ seeds: [[15, 10]], distance: -5, operation: "cut", target: "box" }), "e1");
    const r = new ModelBuilder(oc).build(d);
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo(30 * 20 * 20 - Math.PI * 25 * 5, 1);
  });

  it("joins two profiles into one body", () => {
    let d = addExtrude(sketched(), params(), "e1", "b1");
    d = addExtrude(d, params({ seeds: [[15, 10]], distance: 20, operation: "join", target: "b1" }), "e2");
    const r = new ModelBuilder(oc).build(d);
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo((600 - Math.PI * 25) * 10 + Math.PI * 25 * 20, 1);
  });
});
