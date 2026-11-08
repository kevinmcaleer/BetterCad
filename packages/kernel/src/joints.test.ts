import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import { box, cylinder, elements } from "./occt/shapes";
import { describe as describeRef, type Single } from "./occt/measure";
import {
  LOOP_MESSAGE,
  addJoint,
  addLink,
  addParam,
  addPart,
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
    ).toBe("Hinge (revolute): Link 1 on Base, -90° to 90°");
    expect(
      featureSummary(
        d,
        d.features.find((f) => f.id === "J2")!,
      ),
    ).toBe("Slider (prismatic): Link 2 on Link 1, 0 mm to 40 mm");
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
});
