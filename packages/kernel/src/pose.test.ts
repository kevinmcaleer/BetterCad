import { describe, expect, it } from "vitest";
import { atHome, clampJoint, formatJointValue, jointMotion, linkTransforms, mat4Apply, posedFrames, type PoseJoint } from "./pose";
import { addJoint, addLink, homePose, newDoc, setPose } from "./document";
import { loadBcad, saveBcad } from "./bcad";

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

// A two-link arm in the XZ plane: the shoulder turns about Y at the origin, the elbow about Y 100 mm up the arm, and
// the hand is 80 mm past the elbow.
const shoulder: PoseJoint = { id: "s", kind: "revolute", child: "upper", parent: null, origin: [0, 0, 0], axis: [0, 1, 0], lower: -180, upper: 180 };
const elbow: PoseJoint = { id: "e", kind: "revolute", child: "fore", parent: "upper", origin: [0, 0, 100], axis: [0, 1, 0], lower: -180, upper: 180 };
const hand: [number, number, number] = [0, 0, 180];

describe("forward kinematics", () => {
  it("leaves everything at home with no pose", () => {
    const m = linkTransforms([shoulder, elbow], undefined);
    close(mat4Apply(m.get("fore")!, hand), hand);
    expect(atHome([shoulder, elbow], undefined)).toBe(true);
  });

  it("puts a two-link arm's hand where trigonometry says", () => {
    // Turning +90° about Y takes +Z to +X.
    const m = linkTransforms([shoulder, elbow], { s: 90, e: 0 });
    close(mat4Apply(m.get("fore")!, hand), [180, 0, 0]);
    const bent = linkTransforms([shoulder, elbow], { s: 90, e: 90 });
    // The elbow sits at (100, 0, 0); the forearm turns a further 90°, pointing down -Z.
    close(mat4Apply(bent.get("fore")!, hand), [100, 0, -80]);
    close(mat4Apply(bent.get("upper")!, [0, 0, 100]), [100, 0, 0]);
    const thirty = linkTransforms([shoulder, elbow], { s: 30, e: 45 });
    const a = (30 * Math.PI) / 180;
    const b = (75 * Math.PI) / 180;
    close(mat4Apply(thirty.get("fore")!, hand), [100 * Math.sin(a) + 80 * Math.sin(b), 0, 100 * Math.cos(a) + 80 * Math.cos(b)]);
  });

  it("carries a child's joint with its parent", () => {
    const m = linkTransforms([shoulder, elbow], { s: 90 });
    const f = posedFrames([shoulder, elbow], m).get("e")!;
    close(f.origin, [100, 0, 0]);
    close(f.axis, [0, 1, 0]);
  });

  it("slides a slider along its axis and holds a fixed joint", () => {
    const slide: PoseJoint = { id: "p", kind: "prismatic", child: "carriage", parent: null, origin: [5, 5, 5], axis: [0, 0, 2], lower: 0, upper: 50 };
    const bolt: PoseJoint = { id: "f", kind: "fixed", child: "tool", parent: "carriage", origin: [0, 0, 0], axis: [1, 0, 0], lower: 0, upper: 0 };
    const m = linkTransforms([slide, bolt], { p: 20, f: 33 });
    close(mat4Apply(m.get("carriage")!, [1, 2, 3]), [1, 2, 23]);
    close(mat4Apply(m.get("tool")!, [1, 2, 3]), [1, 2, 23]);
  });

  it("turns about an axis that doesn't pass through the origin", () => {
    const m = jointMotion({ kind: "continuous", origin: [10, 0, 0], axis: [0, 0, 1] }, 180);
    close(mat4Apply(m, [20, 0, 5]), [0, 0, 5]);
  });
});

describe("joint values", () => {
  it("keeps a hinge and a slider between their limits", () => {
    expect(clampJoint({ kind: "revolute", lower: -90, upper: 45 }, 60)).toBe(45);
    expect(clampJoint({ kind: "revolute", lower: -90, upper: 45 }, -100)).toBe(-90);
    expect(clampJoint({ kind: "prismatic", lower: 0, upper: 50 }, -3)).toBe(0);
    expect(clampJoint({ kind: "fixed", lower: 0, upper: 0 }, 12)).toBe(0);
  });

  it("wraps a wheel", () => {
    expect(clampJoint({ kind: "continuous", lower: 0, upper: 0 }, 270)).toBe(-90);
    expect(clampJoint({ kind: "continuous", lower: 0, upper: 0 }, -190)).toBe(170);
    expect(clampJoint({ kind: "continuous", lower: 0, upper: 0 }, 180)).toBe(180);
  });

  it("shows units", () => {
    expect(formatJointValue("revolute", 35)).toBe("35°");
    expect(formatJointValue("prismatic", 12.04)).toBe("12 mm");
  });
});

describe("the pose in the document", () => {
  it("sets, clamps and clears joint values, and goes home", () => {
    let doc = addLink(newDoc(), ["a"], "l1");
    doc = addJoint(doc, { kind: "revolute", child: "l1", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: -90, upper: 90 }, "j1");
    doc = setPose(doc, "j1", 120);
    expect(doc.pose).toEqual({ j1: 90 });
    expect(setPose(doc, "j1", 0).pose).toBeUndefined();
    expect(setPose(doc, "nope", 5)).toBe(doc);
    expect(homePose(doc).pose).toBeUndefined();
    expect(doc.features).toHaveLength(2);
  });

  it("saves with the file, so a shared model opens as it was left", () => {
    let doc = addLink(newDoc(), ["a"], "l1");
    doc = addJoint(doc, { kind: "prismatic", child: "l1", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: 0, upper: 50 }, "j1");
    const back = loadBcad(saveBcad(setPose(doc, "j1", 12)));
    expect("doc" in back && back.doc.pose).toEqual({ j1: 12 });
  });
});
