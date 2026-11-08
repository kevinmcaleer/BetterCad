import { describe, expect, it } from "vitest";
import { addJoint, addLink, addPart, namedPoseValues, newDoc, nextPoseName, removeFeature, removePose, savePose, type ModelDoc } from "./document";
import { loadBcad, saveBcad } from "./bcad";

/** Base and two links on hinges: a shoulder (±90°) and an elbow. */
function arm(): ModelDoc {
  let d = newDoc("Arm");
  for (const id of ["b", "u", "f"]) d = addPart(d, "box", id);
  d = addLink(d, ["u"], "lu");
  d = addLink(d, ["f"], "lf");
  const hinge = (child: string, parent: string | null) => ({
    kind: "revolute" as const,
    child,
    parent,
    origin: [0, 0, 0] as [number, number, number],
    axis: [0, 0, 1] as [number, number, number],
    lower: -90,
    upper: 90,
  });
  d = addJoint(d, hinge("lu", null), "shoulder");
  return addJoint(d, hinge("lf", "lu"), "elbow");
}

describe("named poses (#177)", () => {
  it("saves, renames, updates and deletes, naming each Pose N", () => {
    let d = arm();
    expect(nextPoseName(d)).toBe("Pose 1");
    d = savePose(d, { id: "p1", name: nextPoseName(d), values: { shoulder: 30 } });
    expect(nextPoseName(d)).toBe("Pose 2");
    d = savePose(d, { id: "p1", name: "Reach", values: { shoulder: 45, elbow: -20 } });
    expect(d.poses).toEqual([{ id: "p1", name: "Reach", values: { shoulder: 45, elbow: -20 } }]);
    d = removePose(d, "p1");
    expect(d.poses).toBeUndefined();
  });

  it("survive saving and loading the file", () => {
    const d = savePose(savePose(arm(), { id: "p1", name: "Reach", values: { shoulder: 45 } }), { id: "p2", name: "Folded", values: { elbow: -80 } });
    const back = loadBcad(saveBcad(d));
    if ("message" in back) throw new Error(back.message);
    expect(back.doc.poses).toEqual(d.poses);
  });

  it("goes to a pose within today's limits, dropping joints that have gone", () => {
    let d = savePose(arm(), { id: "p1", name: "Reach", values: { shoulder: 120, elbow: -20 } });
    expect(namedPoseValues(d, "p1")).toEqual({ values: { shoulder: 90, elbow: -20 }, dropped: [] });
    d = removeFeature(d, "elbow");
    expect(namedPoseValues(d, "p1")).toEqual({ values: { shoulder: 90 }, dropped: ["elbow"] });
    expect(namedPoseValues(d, "nope")).toBeNull();
  });
});
