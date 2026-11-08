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
import { THROUGH_ALL, extent, frameToLocal, fromPartLocal, pickProfiles, profilesMiddle, targetsOf, toPartLocal, upToDistance } from "./extrude";
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
  it("works out how far To object goes, to a plane or a point", () => {
    const f = { origin: [0, 0, 10] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    expect(upToDistance(f, [0, 0], { point: [50, 50, 2], normal: [0, 0, -1] })).toBe(-8);
    expect(upToDistance(f, [0, 0], { point: [3, 3, 25] })).toBe(15);
    // A tilted plane: it ends where the plane crosses the line up from the shapes' middle.
    expect(upToDistance(f, [10, 0], { point: [0, 0, 20], normal: [-Math.SQRT1_2, 0, Math.SQRT1_2] })).toBeCloseTo(20, 6);
    expect(upToDistance(f, [0, 0], { point: [0, 0, 20], normal: [1, 0, 0] })).toMatch(/alongside/);
    expect(upToDistance(f, [0, 0], { point: [5, 5, 10] })).toMatch(/own plane/);
    expect(
      profilesMiddle([
        {
          points: [
            [0, 0],
            [10, 4],
          ],
        },
      ]),
    ).toEqual([5, 2]);
  });

  it("takes points into a part's own coordinates and back", () => {
    const place = { position: { x: 5, y: -2, z: 3 }, rotation: { x: 30, y: 0, z: 90 } };
    const w: [number, number, number] = [1, 2, 3];
    fromPartLocal(toPartLocal(w, place), place).forEach((v, i) => expect(v).toBeCloseTo(w[i]!, 9));
    fromPartLocal(toPartLocal(w, place, true), place, true).forEach((v, i) => expect(v).toBeCloseTo(w[i]!, 9));
  });

  it("works out the extent for each direction", () => {
    expect(extent("one", 10)).toEqual({ from: 0, to: 10 });
    expect(extent("one", -4)).toEqual({ from: -4, to: 0 });
    expect(extent("symmetric", 10)).toEqual({ from: -5, to: 5 });
    expect(extent("two", 10, 3)).toEqual({ from: -3, to: 10 });
  });

  it("goes through all on the distance's side, or both ways", () => {
    expect(extent("one", 10, 0, true)).toEqual({ from: 0, to: THROUGH_ALL });
    expect(extent("one", -4, 0, true)).toEqual({ from: -THROUGH_ALL, to: 0 });
    expect(extent("symmetric", 10, 0, true)).toEqual({ from: -THROUGH_ALL, to: THROUGH_ALL });
    expect(extent("two", 10, 3, true)).toEqual({ from: -THROUGH_ALL, to: THROUGH_ALL });
  });

  it("reads its bodies from targets, or the single target in older files", () => {
    expect(targetsOf({ operation: "cut", target: "a" })).toEqual(["a"]);
    expect(targetsOf({ operation: "cut", target: "a", targets: ["a", "b", "a"] })).toEqual(["a", "b"]);
    expect(targetsOf({ operation: "join", target: "a", targets: ["a", "b"] })).toEqual(["a"]);
    expect(targetsOf({ operation: "new", target: "a", targets: ["a"] })).toEqual([]);
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
    expect(build(addExtrude(sketched(), params({ operation: "cut" }), "e1")).failed.get("e1")).toMatch(/Pick the bodies/);
    expect(build(addExtrude(sketched(), params({ extent: "all" }), "e1")).failed.get("e1")).toMatch(/Through all works with Cut and Intersect/);
    expect(build(addExtrude(sketched(), params({ operation: "cut", targets: ["gone", "also"] }), "e1")).failed.get("e1")).toBe("2 bodies it changes are gone");
  });

  it("cuts into a body in its own coordinates, so the cut moves with it", () => {
    let d = addPart(sketched(), "box", "box");
    d = changeParts(d, ["box"], "size", { x: 30, y: 20, z: 20 });
    d = changeParts(d, ["box"], "position", { x: 15, y: 10, z: -10 });
    d = addExtrude(d, params({ seeds: [[15, 10]], distance: -5, operation: "cut", target: "box" }), "e1");
    const box = build(d).parts.find((p) => p.id === "box")!;
    expect(box.ops).toHaveLength(1);
    expect(box.ops![0]!.tool!.frame.origin).toEqual([-15, -10, 10]);
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

  /** Two 20 mm cubes side by side under the sketch, the circle over the gap between them, cut 5 mm or through all. */
  function twoBoxes(p: Partial<ExtrudeParams>): ModelDoc {
    let d = addPart(sketched(), "box", "a");
    d = changeParts(d, ["a"], "size", { x: 20, y: 20, z: 20 });
    d = changeParts(d, ["a"], "position", { x: 5, y: 10, z: -20 });
    d = addPart(d, "box", "b");
    d = changeParts(d, ["b"], "size", { x: 20, y: 20, z: 20 });
    d = changeParts(d, ["b"], "position", { x: 25, y: 10, z: -20 });
    return addExtrude(d, params({ seeds: [[15, 10]], operation: "cut", ...p }), "e1");
  }
  const volumes = (d: ModelDoc) => {
    const r = new ModelBuilder(oc).build(d);
    expect(r.failed).toEqual([]);
    return Object.fromEntries(r.bodies.map((b) => [b.id, b.measure.volume]));
  };

  it("cuts right through a body with through all, whichever side the sketch is on", () => {
    // The sketch is on the boxes' top face, so the cut goes down: a negative distance picks that side.
    const down = volumes(twoBoxes({ distance: -1, extent: "all", target: "a" }));
    expect(down.a).toBeCloseTo(8000 - (Math.PI * 25 * 20) / 2, 1);
    expect(down.b).toBeCloseTo(8000, 1);
    // Flipped, it goes up, away from the box, and leaves it whole.
    expect(volumes(twoBoxes({ distance: 1, extent: "all", target: "a" })).a).toBeCloseTo(8000, 1);
    // Symmetric reaches both ways.
    expect(volumes(twoBoxes({ distance: 1, direction: "symmetric", extent: "all", target: "a" })).a).toBeCloseTo(8000 - (Math.PI * 25 * 20) / 2, 1);
  });

  it("cuts up to a face, an edge or a point (To object)", () => {
    const placeA = { position: { x: 5, y: 10, z: -20 } };
    // A flat face 12 mm down: the cut stops there, whichever way the distance pointed before.
    const face = { body: "a", kind: "face" as const, point: toPartLocal([0, 0, -12], placeA), normal: toPartLocal([0, 0, 1], placeA, true) };
    const toFace = volumes(twoBoxes({ distance: 5, extent: "to", to: face, targets: ["a"], target: "a" }));
    expect(toFace.a).toBeCloseTo(8000 - (Math.PI * 25 * 12) / 2, 1);
    // A point 7 mm down.
    const point = { body: "a", kind: "vertex" as const, point: toPartLocal([3, 4, -7], placeA) };
    expect(volumes(twoBoxes({ distance: -1, extent: "to", to: point, targets: ["a"], target: "a" })).a).toBeCloseTo(8000 - (Math.PI * 25 * 7) / 2, 1);
  });

  it("says why it cannot go up to an object", () => {
    const along = { body: "a", kind: "face" as const, point: [0, 0, 0] as [number, number, number], normal: [1, 0, 0] as [number, number, number] };
    expect(build(twoBoxes({ distance: -1, extent: "to", to: along, target: "a" })).failed.get("e1")).toMatch(/runs alongside/);
    expect(build(twoBoxes({ distance: -1, extent: "to", target: "a" })).failed.get("e1")).toMatch(/Click a face, edge or point/);
    expect(build(twoBoxes({ distance: -1, extent: "to", to: { ...along, body: "gone" }, target: "a" })).failed.get("e1")).toMatch(/body it goes up to is gone/);
  });

  it("cuts every body it is given, and only those", () => {
    const both = volumes(twoBoxes({ distance: -5, targets: ["a", "b"], target: "a" }));
    expect(both.a).toBeCloseTo(8000 - (Math.PI * 25 * 5) / 2, 1);
    expect(both.b).toBeCloseTo(8000 - (Math.PI * 25 * 5) / 2, 1);
    const one = volumes(twoBoxes({ distance: -5, extent: "all", targets: ["b"], target: "b" }));
    expect(one.a).toBeCloseTo(8000, 1);
    expect(one.b).toBeCloseTo(8000 - (Math.PI * 25 * 20) / 2, 1);
  });

  it("joins two profiles into one body", () => {
    let d = addExtrude(sketched(), params(), "e1", "b1");
    d = addExtrude(d, params({ seeds: [[15, 10]], distance: 20, operation: "join", target: "b1" }), "e2");
    const r = new ModelBuilder(oc).build(d);
    expect(r.failed).toEqual([]);
    expect(r.bodies[0]!.measure.volume).toBeCloseTo((600 - Math.PI * 25) * 10 + Math.PI * 25 * 20, 1);
  });
});
