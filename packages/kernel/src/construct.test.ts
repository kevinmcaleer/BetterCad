import { describe, expect, it } from "vitest";
import {
  addConstruct,
  addPart,
  addSketch,
  build,
  changeParts,
  dependsOn,
  featureSummary,
  newDoc,
  updateConstruct,
  removeParts,
  type ConstructParams,
  type ModelDoc,
} from "./document";
import { bodyGeo, bodyRef, construct, type ConstructGeo, type Geo } from "./construct";
import { loadBcad, saveBcad } from "./bcad";

type V3 = [number, number, number];
const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));
const planeOf = (g: ConstructGeo | string) => {
  if (typeof g === "string" || g.what !== "plane") throw new Error(`Not a plane: ${JSON.stringify(g)}`);
  return g.frame;
};
const axisOf = (g: ConstructGeo | string) => {
  if (typeof g === "string" || g.what !== "axis") throw new Error(`Not an axis: ${JSON.stringify(g)}`);
  return g;
};
const pointOf = (g: ConstructGeo | string) => {
  if (typeof g === "string" || g.what !== "point") throw new Error(`Not a point: ${JSON.stringify(g)}`);
  return g.at;
};

// A 20 mm box at the origin: x and y from −10 to 10, z from 0 to 20.
const top: Geo = { t: "plane", origin: [0, 0, 20], normal: [0, 0, 1], x: [1, 0, 0] };
const bottom: Geo = { t: "plane", origin: [0, 0, 0], normal: [0, 0, -1], x: [1, 0, 0] };
const right: Geo = { t: "plane", origin: [10, 0, 10], normal: [1, 0, 0], x: [0, 1, 0] };
const front: Geo = { t: "plane", origin: [0, -10, 10], normal: [0, -1, 0], x: [1, 0, 0] };
/** The top front edge, along X. */
const topFront: Geo = { t: "line", origin: [-10, -10, 20], dir: [1, 0, 0], length: 20 };
const pt = (at: V3): Geo => ({ t: "point", at });

describe("construction geometry maths (#265)", () => {
  it("offsets a plane along its normal", () => {
    const f = planeOf(construct("offset", [top], 10));
    close(f.origin, [0, 0, 30]);
    close(f.normal, [0, 0, 1]);
    close(f.x, [1, 0, 0]);
  });

  it("turns a plane 30° about a box edge, starting level", () => {
    const flat = planeOf(construct("angle", [topFront], 0));
    close(flat.normal, [0, 0, 1]);
    close(flat.origin, [0, -10, 20]);
    const f = planeOf(construct("angle", [topFront], 30));
    close(f.normal, [0, -0.5, Math.sqrt(3) / 2]);
    close(f.x, [1, 0, 0]);
    // The edge lies in the plane.
    const d: V3 = [10 - f.origin[0], -10 - f.origin[1], 20 - f.origin[2]];
    expect(d[0] * f.normal[0] + d[1] * f.normal[1] + d[2] * f.normal[2]).toBeCloseTo(0, 6);
    // An upright edge starts from the front plane.
    close(planeOf(construct("angle", [{ t: "line", origin: [10, -10, 0], dir: [0, 0, 1], length: 20 }], 0)).normal, [0, -1, 0]);
  });

  it("puts a midplane halfway between two faces, or between two that meet", () => {
    const mid = planeOf(construct("midplane", [top, bottom]));
    close(mid.origin, [0, 0, 10]);
    expect(Math.abs(mid.normal[2])).toBeCloseTo(1, 6);
    const corner = planeOf(construct("midplane", [top, right]));
    // Through the top right edge and the box's middle, at 45°.
    close(corner.normal.map(Math.abs), [Math.SQRT1_2, 0, Math.SQRT1_2]);
    const d: V3 = [10 - corner.origin[0], 0 - corner.origin[1], 20 - corner.origin[2]];
    expect(d[0] * corner.normal[0] + d[1] * corner.normal[1] + d[2] * corner.normal[2]).toBeCloseTo(0, 6);
    const c: V3 = [0 - corner.origin[0], 0 - corner.origin[1], 10 - corner.origin[2]];
    expect(c[0] * corner.normal[0] + c[1] * corner.normal[1] + c[2] * corner.normal[2]).toBeCloseTo(0, 6);
  });

  it("makes tangent, perpendicular and along-path planes", () => {
    // A cylinder of radius 5 standing on the origin, clicked on its +X side.
    const cyl: Geo = { t: "circle", centre: [0, 0, 0], axis: [0, 0, 1], radius: 5, round: true, start: [5, 0, 8] };
    const t0 = planeOf(construct("tangent", [cyl], 0));
    close(t0.origin, [5, 0, 8]);
    close(t0.normal, [1, 0, 0]);
    close(planeOf(construct("tangent", [cyl], 90)).origin, [0, 5, 8]);
    const p = planeOf(construct("perpendicular", [topFront], 5));
    close(p.origin, [-5, -10, 20]);
    close(p.normal, [1, 0, 0]);
    close(planeOf(construct("planeAlong", [topFront], 50)).origin, [0, -10, 20]);
    // A quarter arc from +X to +Y about Z: halfway is at 45°, the plane square to the arc there.
    const arc: Geo = { t: "circle", centre: [0, 0, 0], axis: [0, 0, 1], radius: 10, start: [10, 0, 0], sweep: 90 };
    const half = planeOf(construct("planeAlong", [arc], 50));
    close(half.origin, [10 * Math.SQRT1_2, 10 * Math.SQRT1_2, 0]);
    close(half.normal, [-Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  it("makes a plane through two edges or three points, and says when it can't", () => {
    const back: Geo = { t: "line", origin: [-10, 10, 20], dir: [1, 0, 0], length: 20 };
    close(planeOf(construct("twoEdges", [topFront, back])).normal.map(Math.abs), [0, 0, 1]);
    const skew: Geo = { t: "line", origin: [-10, 10, 0], dir: [0, 0, 1], length: 20 };
    expect(construct("twoEdges", [topFront, skew])).toBe("The two edges don't lie in one plane");
    const tri = planeOf(construct("threePoints", [pt([0, 0, 0]), pt([10, 0, 0]), pt([0, 10, 0])]));
    close(tri.normal, [0, 0, 1]);
    close(tri.x, [1, 0, 0]);
    expect(construct("threePoints", [pt([0, 0, 0]), pt([1, 1, 1]), pt([2, 2, 2])])).toBe("The three points are on one line, so they don't make a plane");
    expect(construct("threePoints", [pt([0, 0, 0]), pt([1, 0, 0])])).toBe("Pick a vertex, a point or a round edge's centre");
    expect(construct("offset", [topFront])).toBe("That isn't a flat face or a plane");
  });

  it("makes axes", () => {
    const cyl: Geo = { t: "circle", centre: [3, 4, 0], axis: [0, 0, 1], radius: 5, round: true };
    expect(axisOf(construct("cylinder", [cyl]))).toEqual({ what: "axis", origin: [3, 4, 0], dir: [0, 0, 1] });
    const n = axisOf(construct("normal", [{ ...right, origin: [10, 2, 3] } as Geo]));
    close(n.origin, [10, 2, 3]);
    close(n.dir, [1, 0, 0]);
    const meet = axisOf(construct("twoPlanes", [top, right]));
    close(meet.dir.map(Math.abs), [0, 1, 0]);
    close([meet.origin[0], meet.origin[2]], [10, 20]);
    expect(construct("twoPlanes", [top, bottom])).toBe("The planes are parallel, so they don't meet");
    const two = axisOf(construct("twoPoints", [pt([0, 0, 0]), pt([0, 0, 5])]));
    close(two.dir, [0, 0, 1]);
    expect(construct("twoPoints", [pt([1, 1, 1]), pt([1, 1, 1])])).toBe("Pick two different points");
    close(axisOf(construct("edge", [topFront])).dir, [1, 0, 0]);
  });

  it("makes points", () => {
    close(pointOf(construct("vertex", [pt([1, 2, 3])])), [1, 2, 3]);
    const upright: Geo = { t: "line", origin: [-10, -10, 0], dir: [0, 0, 1], length: 20 };
    close(pointOf(construct("edgesPoint", [topFront, upright])), [-10, -10, 20]);
    expect(construct("edgesPoint", [topFront, { t: "line", origin: [0, 0, 0], dir: [0, 1, 0] }])).toBe("The edges don't meet");
    close(pointOf(construct("threePlanes", [top, right, front])), [10, -10, 20]);
    expect(construct("threePlanes", [top, bottom, right])).toBe("Two of the planes are parallel, so they don't meet at a point");
    close(pointOf(construct("centre", [{ t: "circle", centre: [1, 1, 1], axis: [0, 0, 1], radius: 2 }])), [1, 1, 1]);
    close(pointOf(construct("edgePlane", [{ t: "line", origin: [0, 0, 0], dir: [0, 0, 1] }, top])), [0, 0, 20]);
    expect(construct("edgePlane", [topFront, top])).toBe("The edge runs along the plane, so it doesn't cross it");
    close(pointOf(construct("pointAlong", [topFront], 25)), [-5, -10, 20]);
  });
});

/** A 20 mm box at the origin, as the timeline makes it. */
const boxDoc = () => addPart(newDoc(), "box", "b");
const boxPart = (doc: ModelDoc) => build(doc).parts.find((p) => p.id === "b")!;

describe("construction steps on the timeline (#265)", () => {
  it("a plane 10 mm above the top of a box, and a sketch on it, follow the box's height", () => {
    let doc = boxDoc();
    const ref = bodyRef(boxPart(doc), "face", 1, top);
    doc = addConstruct(doc, { kind: "offset", refs: [ref], value: 10 }, "pl");
    expect(doc.features.at(-1)!.name).toBe("Plane 1");
    doc = addSketch(doc, { kind: "construct", step: "pl", offset: 0, frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] } }, "sk");
    let b = build(doc);
    expect(b.failed.size).toBe(0);
    close(planeOf(b.construct[0]!.geo).origin, [0, 0, 30]);
    close((b.sketches[0]!.sketch.plane as { frame: { origin: V3 } }).frame.origin, [0, 0, 30]);
    // 20 mm taller: the plane and the sketch go up with the top.
    doc = changeParts(doc, ["b"], "size", { z: 40 }, 1);
    b = build(doc);
    close(planeOf(b.construct[0]!.geo).origin, [0, 0, 50]);
    close((b.sketches[0]!.sketch.plane as { frame: { origin: V3 } }).frame.origin, [0, 0, 50]);
    // And it follows a move.
    doc = changeParts(doc, ["b"], "position", { x: 5 }, 1);
    close(planeOf(build(doc).construct[0]!.geo).origin, [5, 0, 50]);
    expect(dependsOn(doc, "sk")).toContain("pl");
    expect(
      featureSummary(
        doc,
        doc.features.find((f) => f.id === "pl")!,
      ),
    ).toBe("Offset plane, 10 mm from a face of Box 1");
  });

  it("follows a turned body", () => {
    let doc = boxDoc();
    const ref = bodyRef(boxPart(doc), "face", 1, top);
    doc = addConstruct(doc, { kind: "offset", refs: [ref], value: 0 }, "pl");
    doc = changeParts(doc, ["b"], "rotation", { x: 90 }, 1);
    const f = planeOf(build(doc).construct[0]!.geo);
    close(f.normal, [0, -1, 0]);
    close(f.origin, [0, -20, 0]);
  });

  it("chains steps and the origin: a plane from a plane, an axis where it meets an origin plane", () => {
    let doc = addConstruct(newDoc(), { kind: "offset", refs: [{ origin: "XY" }], value: 5 }, "p1");
    doc = addConstruct(doc, { kind: "offset", refs: [{ step: "p1" }], value: 5 }, "p2");
    doc = addConstruct(doc, { kind: "twoPlanes", refs: [{ step: "p2" }, { origin: "YZ" }], value: 0 }, "ax");
    doc = addConstruct(doc, { kind: "edgePlane", refs: [{ origin: "Z" }, { step: "p2" }], value: 0 }, "pt");
    let b = build(doc);
    expect(b.construct.map((c) => c.geo.what)).toEqual(["plane", "plane", "axis", "point"]);
    expect(doc.features.map((f) => f.name)).toEqual(["Plane 1", "Plane 2", "Axis 1", "Point 1"]);
    close(pointOf(b.construct[3]!.geo), [0, 0, 10]);
    doc = updateConstruct(doc, "p1", { value: 20 });
    b = build(doc);
    close(pointOf(b.construct[3]!.geo), [0, 0, 25]);
    close([axisOf(b.construct[2]!.geo).origin[2]], [25]);
    expect(dependsOn(doc, "pt")).toEqual(["p2"]);
    expect(
      featureSummary(
        doc,
        doc.features.find((f) => f.id === "ax")!,
      ),
    ).toBe("Axis through two planes: Plane 2 and the YZ plane");
  });

  it("fails, with a reason, when what it was made from is gone", () => {
    let doc = boxDoc();
    doc = addConstruct(doc, { kind: "offset", refs: [bodyRef(boxPart(doc), "face", 1, top)], value: 1 }, "pl");
    doc = addConstruct(doc, { kind: "offset", refs: [{ step: "pl" }], value: 1 }, "p2");
    doc = addSketch(doc, { kind: "construct", step: "p2", offset: 0, frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] } }, "sk");
    doc = removeParts(doc, ["b"], 1);
    const b = build(doc);
    expect(b.failed.get("pl")).toBe("The body it was made from is gone");
    expect(b.failed.get("p2")).toBe("A step it was made from is gone");
    expect(b.failed.get("sk")).toBe("The plane it sits on is gone. Redefine its plane from the timeline menu.");
    expect(b.construct).toEqual([]);
  });

  it("scales a primitive's picks with it but not a body's made from a sketch", () => {
    const part = { id: "s", kind: "solid", position: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 10, z: 10 } };
    const ref = bodyRef(part, "face", 0, top);
    expect("size" in ref).toBe(false);
    expect(bodyGeo(ref as Extract<typeof ref, { body: string }>, { ...part, size: { x: 10, y: 10, z: 99 } })).toEqual(top);
  });

  it("survives a .bcad round trip", () => {
    const params: ConstructParams = { kind: "threePoints", refs: [{ origin: "O" }, { origin: "O" }, { origin: "O" }], value: 0 };
    const doc = addConstruct(newDoc(), params, "c");
    const file = loadBcad(saveBcad(doc));
    if (file instanceof Error) throw file;
    const back = file.doc;
    expect(back.features).toEqual(doc.features);
    expect(back.features[0]).toMatchObject({ type: "construct", kind: "threePoints" });
  });
});
