import { describe, expect, it } from "vitest";
import { chainTo, homeOf, solveIk, toolPoint, type IkProblem } from "./ik";
import { addJoint, addLink, addPart, clearToolPoint, linkTransforms, lockJoint, mat4Apply, newDoc, setToolPoint, type PoseJoint, type V3 } from "./document";

// A two-link arm flat on XY: a shoulder at the origin and an elbow 100 mm out, both about Z, and the tool 80 mm past it.
const shoulder: PoseJoint = { id: "s", kind: "revolute", child: "upper", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: -180, upper: 180 };
const elbow: PoseJoint = { id: "e", kind: "revolute", child: "fore", parent: "upper", origin: [100, 0, 0], axis: [0, 0, 1], lower: -170, upper: 170 };
const arm = (change: Partial<IkProblem> = {}): IkProblem => ({ joints: [elbow, shoulder], link: "fore", point: [180, 0, 0], ...change });
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("inverse kinematics (#176)", () => {
  it("walks the chain from Base to the tool's link", () => {
    expect(chainTo([elbow, shoulder], "fore").map((j) => j.id)).toEqual(["s", "e"]);
  });

  it("matches the two-link arm's analytic solution", () => {
    const target: V3 = [100, 100, 0];
    const r = solveIk(arm(), {}, target);
    expect(r.miss).toBeLessThan(0.01);
    // Law of cosines: the elbow's bend is fixed by the distance; the shoulder follows from it.
    const [a, b] = [100, 80];
    const d2 = 100 * 100 + 100 * 100;
    const bend = (Math.acos((d2 - a * a - b * b) / (2 * a * b)) * 180) / Math.PI;
    expect(Math.abs(r.pose.e!)).toBeCloseTo(bend, 2);
    const sign = Math.sign(r.pose.e!);
    const sh = Math.atan2(100, 100) - sign * Math.atan2(b * Math.sin((bend * Math.PI) / 180), a + b * Math.cos((bend * Math.PI) / 180));
    expect(r.pose.s!).toBeCloseTo((sh * 180) / Math.PI, 2);
    expect(dist(toolPoint(arm(), r.pose), target)).toBeLessThan(0.01);
  });

  it("keeps to the limits", () => {
    const tight = arm({ joints: [{ ...elbow, lower: -20, upper: 20 }, shoulder] });
    const r = solveIk(tight, {}, [0, 120, 0]);
    expect(Math.abs(r.pose.e ?? 0)).toBeLessThanOrEqual(20);
    expect(r.miss).toBeGreaterThan(1);
  });

  it("stretches toward a target out of reach and says by how much", () => {
    const r = solveIk(arm(), { e: 30 }, [0, 300, 0]);
    expect(r.miss).toBeCloseTo(120, 1);
    expect(r.at[1]).toBeCloseTo(180, 1);
  });

  it("leaves a locked joint where it is", () => {
    const r = solveIk(arm({ locked: ["e"] }), { e: 45 }, [100, 100, 0]);
    expect(r.pose.e).toBe(45);
    // The shoulder alone gets as near as the circle the tool can sweep allows.
    const reach = Math.hypot(100 + 80 * Math.cos(Math.PI / 4), 80 * Math.sin(Math.PI / 4));
    expect(r.miss).toBeCloseTo(Math.abs(reach - Math.hypot(100, 100)), 1);
  });

  it("slides a slider in the chain", () => {
    const slide: PoseJoint = { id: "z", kind: "prismatic", child: "upper", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: 0, upper: 50 };
    const r = solveIk(arm({ joints: [{ ...elbow }, slide] }), {}, [180, 0, 30]);
    expect(r.pose.z).toBeCloseTo(30, 2);
    expect(r.miss).toBeLessThan(0.01);
  });

  it("solves a 6-joint chain fast enough to drag at 60 fps", () => {
    const joints: PoseJoint[] = [0, 1, 2, 3, 4, 5].map((k) => ({
      id: `j${k}`,
      kind: "revolute",
      child: `l${k}`,
      parent: k ? `l${k - 1}` : null,
      origin: [k * 40, 0, 0],
      axis: k % 2 ? [0, 1, 0] : [0, 0, 1],
      lower: -150,
      upper: 150,
    }));
    const p: IkProblem = { joints, link: "l5", point: [240, 0, 0] };
    let pose = {};
    const t = performance.now();
    for (let f = 0; f < 60; f++) pose = solveIk(p, pose, [150 + f, 60, 40], 20).pose;
    expect((performance.now() - t) / 60).toBeLessThan(16);
    expect(solveIk(p, pose, [209, 60, 40]).miss).toBeLessThan(0.5);
  });

  it("finds a point seen in a pose back at home", () => {
    const m = linkTransforms([elbow, shoulder], { s: 90, e: -30 }).get("fore")!;
    const home: V3 = [150, 10, 5];
    const back = homeOf(m, mat4Apply(m, home));
    back.forEach((v, k) => expect(v).toBeCloseTo(home[k]!, 9));
  });
});

describe("tool points (#176)", () => {
  // Base, an upper arm on a hinge, and a forearm on a hinge from it; and a second arm on Base.
  function arms() {
    let d = newDoc("Arms");
    for (const id of ["u", "f", "o"]) d = addPart(d, "box", id);
    d = addLink(d, ["u"], "lu");
    d = addLink(d, ["f"], "lf");
    d = addLink(d, ["o"], "lo");
    const j = (child: string, parent: string | null) => ({
      kind: "revolute" as const,
      child,
      parent,
      origin: [0, 0, 0] as V3,
      axis: [0, 0, 1] as V3,
      lower: -90,
      upper: 90,
    });
    d = addJoint(d, j("lu", null), "ju");
    d = addJoint(d, j("lf", "lu"), "jf");
    return addJoint(d, j("lo", null), "jo");
  }

  it("keeps one per chain, and is saved with the model", () => {
    let d = setToolPoint(arms(), "lu", [1, 2, 3]);
    d = setToolPoint(d, "lo", [4, 5, 6]);
    // The forearm's replaces the upper arm's, on the same chain; the other arm's stays.
    d = setToolPoint(d, "lf", [7, 8, 9]);
    expect(d.tools).toEqual([
      { link: "lo", point: [4, 5, 6] },
      { link: "lf", point: [7, 8, 9] },
    ]);
    expect(clearToolPoint(clearToolPoint(d, "lo"), "lf").tools).toBeUndefined();
  });

  it("locks and unlocks a joint", () => {
    let d = setToolPoint(arms(), "lf", [0, 0, 0]);
    d = lockJoint(d, "ju", true);
    expect(d.tools![0]!.locked).toEqual(["ju"]);
    expect(lockJoint(d, "ju", false).tools![0]!.locked).toBeUndefined();
  });
});
