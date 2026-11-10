import { beforeAll, describe, expect, it } from "vitest";
import { planeFrame } from "@bettercad/sketch";
import { loadOCCT, type OC } from "./occt/oc";
import { boolean, box, cylinder, elements } from "./occt/shapes";
import { describe as describeRef, type Single } from "./occt/measure";
import {
  LOOP_MESSAGE,
  addJoint,
  addLink,
  addConstruct,
  addParam,
  addPart,
  addSketch,
  moveInto,
  build,
  dependsOn,
  featureSummary,
  jointFrame,
  jointLinkProblem,
  newDoc,
  removeParts,
  setExpr,
  updateJoint,
  type JointParams,
  type ModelDoc,
} from "./document";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
});

/** Every element of a kind on a shape, described as Measure describes it. */
const all = (s: ReturnType<typeof box>, kind: "edge" | "face"): Single[] =>
  elements(oc, s, kind).map((_, index) => describeRef(oc, s, { body: "b", kind, index }));

describe("joint frames (#172)", () => {
  it("takes a round edge's axis through its centre", () => {
    const edges = all(cylinder(oc, { x: 16, y: 16, z: 10 }), "edge");
    const top = edges.find((d) => d.kind === "edge" && d.circle && d.circle.centre[2] > 5)!;
    const f = jointFrame(top)!;
    expect(f.origin).toEqual([0, 0, 10]);
    expect(Math.abs(f.axis[2])).toBe(1);
  });

  it("faces a round edge out of the part, the way the flat face beside it faces", () => {
    const edges = all(cylinder(oc, { x: 16, y: 16, z: 10 }), "edge");
    const rim = (up: boolean) => jointFrame(edges.find((d) => d.kind === "edge" && d.circle && d.circle.centre[2] > 5 === up)!)!;
    expect(rim(true).axis).toEqual([0, 0, 1]);
    expect(rim(false).axis).toEqual([0, 0, -1]);
    // A hole's rim faces out of the hole: the top of a box with a hole cut down through it.
    const plate = boolean(oc, "cut", box(oc, { x: 40, y: 40, z: 10 }), [cylinder(oc, { x: 8, y: 8, z: 30 })]);
    const holeRims = all(plate, "edge").filter((d) => d.kind === "edge" && d.circle);
    for (const r of holeRims) {
      const f = jointFrame(r)!;
      expect(f.axis[2]).toBe(f.origin[2] > 5 ? 1 : -1);
    }
  });

  it("takes a cylinder face's axis, level with the middle of the face", () => {
    const faces = all(cylinder(oc, { x: 16, y: 16, z: 10 }), "face");
    const side = faces.find((d) => d.kind === "face" && d.circle)!;
    const f = jointFrame(side)!;
    expect(f.origin[0]).toBeCloseTo(0, 6);
    expect(f.origin[1]).toBeCloseTo(0, 6);
    expect(f.origin[2]).toBeCloseTo(5, 6);
    expect(Math.abs(f.axis[2])).toBe(1);
  });

  it("takes a flat face's normal through its middle, and a straight edge's own line", () => {
    const faces = all(box(oc, { x: 30, y: 20, z: 10 }), "face");
    const top = faces.find((d) => d.kind === "face" && d.normal && d.normal[2] > 0.5)!;
    expect(jointFrame(top)).toEqual({ origin: [0, 0, 10], axis: [0, 0, 1] });
    const edge = all(box(oc, { x: 30, y: 20, z: 10 }), "edge").find((d) => d.kind === "edge" && d.length === 30)!;
    const f = jointFrame(edge)!;
    expect(Math.abs(f.axis[0])).toBe(1);
    expect(f.origin[0]).toBeCloseTo(0, 6);
  });

  it("gives nothing for a point or a body", () => {
    expect(jointFrame({ kind: "vertex", point: [0, 0, 0] })).toBeNull();
  });
});

describe("joint links", () => {
  it("refuses a second joint on a link, a loop, and a link on itself", () => {
    const js = [
      { child: "A", parent: null },
      { child: "B", parent: "A" },
    ];
    expect(jointLinkProblem(js, "C", "B")).toBeNull();
    expect(jointLinkProblem(js, "B", null)).toBe(LOOP_MESSAGE);
    expect(jointLinkProblem([{ child: "B", parent: "A" }], "A", "B")).toBe(LOOP_MESSAGE);
    expect(jointLinkProblem(js, "C", "C")).toBe("A link can't hang from itself");
  });
});

/** Base box, an arm (link A) and a hand (link B). */
function robot(): ModelDoc {
  let d = addPart(addPart(addPart(newDoc(), "box", "base"), "box", "arm"), "box", "hand");
  d = addLink(d, ["arm"], "A");
  d = addLink(d, ["hand"], "B");
  return d;
}
const hinge = (over: Partial<JointParams> = {}): JointParams => ({
  kind: "revolute",
  child: "A",
  parent: null,
  origin: [0, 0, 10],
  axis: [0, 0, 1],
  lower: -90,
  upper: 90,
  ...over,
});

type V3 = [number, number, number];

describe("joint steps", () => {
  it("hangs an arm from Base and a hand from the arm", () => {
    let d = addJoint(robot(), hinge(), "J1");
    d = addJoint(d, hinge({ child: "B", parent: "A", kind: "prismatic", lower: 0, upper: 40 }), "J2");
    const b = build(d);
    expect(b.failed.size).toBe(0);
    expect(b.joints.map((j) => [j.name, j.child, j.parent])).toEqual([
      ["Joint 1", "A", null],
      ["Joint 2", "B", "A"],
    ]);
    expect(
      featureSummary(
        d,
        d.features.find((f) => f.id === "J1")!,
      ),
    ).toBe("Hinge (revolute): Component 1 on Base, -90° to 90°");
    expect(
      featureSummary(
        d,
        d.features.find((f) => f.id === "J2")!,
      ),
    ).toBe("Slider (prismatic): Component 2 on Component 1, 0 mm to 40 mm");
    expect(dependsOn(d, "J2").sort()).toEqual(["A", "B", "J1"].sort());
  });

  it("fails a loop or a second joint on a link with the URDF message", () => {
    let d = addJoint(robot(), hinge({ child: "B", parent: "A" }), "J1");
    d = addJoint(d, hinge({ child: "A", parent: "B" }), "J2");
    expect(build(d).failed.get("J2")).toBe(LOOP_MESSAGE);
    expect(build(d).joints.map((j) => j.id)).toEqual(["J1"]);
  });

  it("fails when its link is gone, or the limits cross", () => {
    let d = addJoint(robot(), hinge(), "J1");
    d = removeParts(d, ["arm"], d.features.length - 1);
    expect(build(d).failed.get("J1")).toBe("The link it moves is gone");
    const crossed = addJoint(robot(), hinge({ lower: 10, upper: -10 }), "J1");
    expect(build(crossed).failed.get("J1")).toBe("The lower limit is above the upper one");
  });

  it("works its limits out from parameters", () => {
    let d = addParam(robot(), { name: "swing", expression: "45", unit: "deg" });
    d = addJoint(d, hinge(), "J1");
    d = setExpr(d, "J1", "upper", "swing * 2");
    expect(build(d).joints[0]!.upper).toBe(90);
  });

  it("brings each kind's starting limits when the kind changes", () => {
    let d = addJoint(robot(), hinge(), "J1");
    d = updateJoint(d, "J1", { kind: "prismatic" });
    expect(build(d).joints[0]).toMatchObject({ kind: "prismatic", lower: 0, upper: 50 });
  });

  it("lines the moving component up on the joint: snap onto snap, face to face, then angle, gap and offset", () => {
    const at = (d: ModelDoc, id: string) => build(d).parts.find((p) => p.id === id)!;
    const before = at(robot(), "arm");
    // The arm's snap: its top face's middle, looking up (a box stands on its position). The parent's: (0, 0, 10) looking
    // up. The arm turns over so its top face sits on the parent's snap, face down, and the rest of it above.
    const top: [number, number, number] = [before.position.x, before.position.y, before.position.z + before.size.z];
    let d = addJoint(robot(), hinge({ from: { point: top, normal: [0, 0, 1] } }), "J1");
    const a = at(d, "arm");
    expect(Math.abs(a.rotation!.x) + Math.abs(a.rotation!.y)).toBeCloseTo(180, 6);
    expect([a.position.x, a.position.y, a.position.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 10 + before.size.z]);
    // A gap stands it off along the axis, and the joint's origin with it; an offset moves both.
    d = updateJoint(d, "J1", { gap: 3, offset: [1, 2, 0] });
    expect(at(d, "arm").position.z).toBeCloseTo(13 + before.size.z, 6);
    expect(build(d).joints[0]!.origin).toEqual([1, 2, 13]);
    // With no snap of its own, it stays where it was modelled.
    d = updateJoint(d, "J1", { from: undefined, gap: undefined, offset: undefined });
    expect(at(d, "arm").position).toEqual(before.position);
    expect(build(d).joints[0]!.origin).toEqual([0, 0, 10]);
  });

  it("turns a component about the axis by the joint's angle, and turns it over when flipped", () => {
    const at = (d: ModelDoc) => build(d).parts.find((p) => p.id === "arm")!;
    const before = at(robot());
    const d = addJoint(robot(), hinge({ angle: 90 }), "J1");
    const a = at(d);
    // About Z through the origin: (x, y) goes to (-y, x).
    expect(a.position.x).toBeCloseTo(-before.position.y, 6);
    expect(a.position.y).toBeCloseTo(before.position.x, 6);
    expect(a.rotation!.z).toBeCloseTo(90, 6);
    const flipped = at(updateJoint(d, "J1", { angle: undefined, flip: true }));
    expect(flipped.position.z).toBeCloseTo(20 - before.position.z, 6);
  });

  it("takes a sketch on a face along with the body it sits on, whichever component it is filed under", () => {
    const face = {
      kind: "face" as const,
      face: { body: "arm", face: 1 },
      offset: 0,
      frame: { origin: [0, 0, 10] as V3, x: [1, 0, 0] as V3, normal: [1, 0, 0] as V3 },
    };
    let d = addSketch(robot(), face, "S1");
    d = moveInto(d, ["S1"], "B");
    d = addJoint(d, hinge({ angle: 90 }), "J1");
    const f = planeFrame(build(d).sketches.find((s) => s.id === "S1")!.sketch.plane);
    // Turned 90° about Z with the arm: +X becomes +Y.
    expect(f.normal.map((x) => Math.round(x * 1e6) / 1e6 + 0)).toEqual([0, 1, 0]);
  });

  it("takes a component's sketches and construction along with it, but not ones made after the joint (#335)", () => {
    // A sketch and a plane in the arm's component, then the joint turns it 90° about Z, then another sketch in it.
    let d = addSketch(robot(), { kind: "world", plane: "XZ", offset: 0 }, "S1");
    d = addConstruct(d, { kind: "offset", refs: [{ origin: "YZ" }], value: 5 }, "P1");
    d = addJoint(d, hinge({ angle: 90 }), "J1");
    d = addSketch(d, { kind: "world", plane: "XZ", offset: 0 }, "S2");
    d = moveInto(d, ["S1", "P1", "S2"], "A");
    const b = build(d);
    const frame = (id: string) => planeFrame(b.sketches.find((s) => s.id === id)!.sketch.plane);
    const round = (v: number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);
    // XZ looks down -Y; turned 90° about Z it looks down +X.
    expect(round(frame("S1").normal)).toEqual([1, 0, 0]);
    expect(round(frame("S2").normal)).toEqual([0, -1, 0]);
    const p = b.construct.find((c) => c.id === "P1")!.geo;
    expect(p.what === "plane" && round(p.frame.origin)).toEqual([0, 5, 0]);
    // The saved sketch keeps its plane as drawn.
    const saved = d.features.find((f) => f.id === "S1");
    expect(saved?.type === "sketch" && "frame" in saved.sketch.plane).toBe(false);
  });
});
