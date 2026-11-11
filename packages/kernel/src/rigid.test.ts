import { describe, expect, it } from "vitest";
import {
  addJoint,
  addLink,
  addPart,
  build,
  dependsOn,
  featureSummary,
  linkTransforms,
  makeComponent,
  newDoc,
  poseNesting,
  rigidMates,
  type JointParams,
  type ModelDoc,
} from "./document";
import { addRigid, placeRigid } from "./rigid";

/** A base, and an arm (component A), a hand (component B) and a loose pin, spread along X. */
function kit(): ModelDoc {
  let d = addPart(addPart(addPart(addPart(newDoc(), "box", "base"), "box", "arm"), "box", "hand"), "box", "pin");
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
const at = (d: ModelDoc, id: string) => build(d).parts.find((p) => p.id === id)!;

describe("rigid groups", () => {
  it("takes a picked body's component, and loose bodies as they are", () => {
    const d = addRigid(kit(), ["arm", "B", "pin"], "R");
    expect(d.features.at(-1)).toMatchObject({ type: "rigid", name: "Rigid group 1", links: ["A", "B"], parts: ["pin"] });
    expect(build(d).rigid).toEqual([
      { id: "R", name: "Rigid group 1", links: ["A", "B"], parts: ["pin"], bodies: ["arm", "hand", "pin"], root: "A", fixed: ["B"] },
    ]);
    expect(featureSummary(d, d.features.at(-1)!)).toBe("Component 1, Component 2 and Box 4 move as one");
    expect(dependsOn(d, "R")).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("fails with fewer than two parts, or when they have gone", () => {
    expect(build(addRigid(kit(), ["arm"], "R")).failed.get("R")).toBe("Pick two or more parts to lock together");
  });

  it("carries its other parts when a joint lines one of them up", () => {
    const before = { hand: at(kit(), "hand").position, pin: at(kit(), "pin").position };
    let d = addRigid(kit(), ["arm", "hand", "pin"], "R");
    d = addJoint(d, hinge({ angle: 90 }), "J1");
    // About Z through the origin: (x, y) goes to (-y, x), for the hand and the loose pin as for the arm.
    for (const id of ["hand", "pin"] as const) {
      const p = at(d, id);
      expect(p.position.x).toBeCloseTo(-before[id].y, 6);
      expect(p.position.y).toBeCloseTo(before[id].x, 6);
      expect(p.rotation!.z).toBeCloseTo(90, 6);
    }
  });

  it("fixes its components to the one on a joint, so a pose and URDF carry them", () => {
    let d = addRigid(kit(), ["arm", "hand"], "R");
    d = addJoint(d, hinge({ child: "B" }), "J1");
    const b = build(d);
    // B moves on the joint, so A is fixed to it.
    expect(b.rigid![0]).toMatchObject({ root: "B", fixed: ["A"] });
    expect(b.links.find((l) => l.id === "A")!.parent).toBe("B");
    // The browser keeps A where it was.
    expect(b.components.find((c) => c.id === "A")!.parent).toBeUndefined();
    const moves = linkTransforms(b.joints, { J1: 30 }, poseNesting(b));
    expect(moves.get("A")).toEqual(moves.get("B"));
  });

  it("refuses two components that each move on their own joint", () => {
    let d = addJoint(kit(), hinge(), "J1");
    d = addJoint(d, hinge({ child: "B" }), "J2");
    d = addRigid(d, ["A", "B"], "R");
    expect(build(d).failed.get("R")).toBe("Two of its components move on joints of their own");
  });

  it("brings a loose body's component when the Joint tool makes one of it later", () => {
    let d = addRigid(kit(), ["A", "pin"], "R");
    d = makeComponent(d, ["pin"], "P");
    d = addJoint(d, hinge({ child: "P" }), "J1");
    expect(build(d).rigid![0]).toMatchObject({ root: "P", fixed: ["A"], bodies: ["arm", "pin"] });
  });

  it("moves all its bodies as one Move step: the same turn and shift", () => {
    const d = addRigid(kit(), ["arm", "hand", "pin"], "R");
    const mates = rigidMates(build(d).rigid, "hand");
    expect(mates.sort()).toEqual(["arm", "hand", "pin"]);
    expect(rigidMates(build(d).rigid, "base")).toEqual([]);
    const hand = at(d, "hand");
    const arm = at(d, "arm");
    const moved = placeRigid(d, "hand", { x: hand.position.x + 5, y: hand.position.y, z: 7 }, { x: 0, y: 0, z: 90 }, mates);
    const step = moved.features.at(-1)!;
    expect(step).toMatchObject({ type: "move", together: true, rotation: { x: 0, y: 0, z: 90 } });
    expect(featureSummary(moved, step)).toMatch(/^3 parts as one, /);
    // The hand lands where it was dropped; the arm keeps its place relative to the hand.
    const h = at(moved, "hand");
    expect([h.position.x, h.position.y, h.position.z]).toEqual([hand.position.x + 5, hand.position.y, 7].map((v) => expect.closeTo(v, 6)));
    const a = at(moved, "arm");
    const dx = arm.position.x - hand.position.x;
    expect(a.position.x - h.position.x).toBeCloseTo(0, 6);
    expect(a.position.y - h.position.y).toBeCloseTo(dx, 6);
    expect(a.rotation!.z).toBeCloseTo(90, 6);
  });
});
