import { describe, expect, it } from "vitest";
import { build, liftParts, type Feature, type ModelDoc } from "./document";

/**
 * Kev's Open Duck Mini (STLs) steps, trimmed to what places the parts: two imported STLs made components, then a hinge
 * that hangs trunk_bottom under trunk_top. Imported meshes sit on the floor, so the joint puts trunk_bottom 68.6 mm
 * under it, hidden below trunk_top. Build places parts from the steps alone, so the meshes aren't needed.
 */
const TOP = "pmwbcjdve1g8";
const BOTTOM = "pmwbck5311k3";
const duck = (): ModelDoc =>
  ({
    version: 2,
    name: "Open Duck Mini (STLs)",
    features: [
      {
        type: "import",
        id: "fImport1",
        name: "Import 1",
        blob: "b1",
        file: "trunk_top.stl",
        format: "stl",
        position: { x: 0, y: 0, z: 0 },
        bodies: [{ id: TOP, name: "trunk_top" }],
      },
      {
        type: "import",
        id: "fImport2",
        name: "Import 2",
        blob: "b2",
        file: "trunk_bottom.stl",
        format: "stl",
        position: { x: 0, y: 0, z: 0 },
        bodies: [{ id: BOTTOM, name: "trunk_bottom" }],
      },
      { type: "move", id: "fMove1", name: "Move 1", parts: [BOTTOM], position: { x: -137.828, y: 0, z: 0 } },
      { type: "link", id: "lBottom", name: "trunk_bottom", parts: [BOTTOM] },
      { type: "link", id: "lTop", name: "trunk_top", parts: [TOP] },
      {
        type: "joint",
        id: "fJoint1",
        name: "Joint 1",
        kind: "revolute",
        child: "lBottom",
        parent: "lTop",
        from: { normal: [0, 0, 1], point: [-158.800888062, -0.013931274, 73.675003052] },
        origin: [14.240681648, 0, 5.099998474],
        axis: [0, 0, -1],
        lower: -90,
        upper: 90,
      },
    ] as Feature[],
    looks: {},
  }) as unknown as ModelDoc;

const at = (doc: ModelDoc, id: string) => build(doc).parts.find((p) => p.id === id)!.position;

describe("moving a component carries what's jointed to it", () => {
  it("hangs trunk_bottom under trunk_top, below the floor, where the joint lines it up", () => {
    const p = at(duck(), BOTTOM);
    expect(p.x).toBeCloseTo(35.214, 2);
    expect(p.z).toBeCloseTo(-68.575, 2);
  });

  it("lifts the whole assembly onto the floor: trunk_bottom and the joint come up with trunk_top", () => {
    const doc = liftParts(duck(), [TOP], 68.575);
    const b = build(doc);
    expect(b.failed.size).toBe(0);
    expect(b.parts.find((p) => p.id === TOP)!.position.z).toBeCloseTo(68.575, 3);
    const p = b.parts.find((x) => x.id === BOTTOM)!.position;
    expect(p.z).toBeCloseTo(0, 3);
    expect(p.x).toBeCloseTo(35.214, 2);
    expect(b.joints[0]!.origin[2]).toBeCloseTo(73.675, 3);
    expect(b.joints[0]!.axis).toEqual([0, 0, -1].map((v) => expect.closeTo(v, 9)));
  });

  it("carries the child when the parent goes to a new place, and turns it with the parent", () => {
    const doc = duck();
    doc.features.push({ type: "move", id: "fMove2", name: "Move 2", parts: [TOP], position: { x: 10, y: 0, z: 68.575 }, rotation: { z: 90 } } as Feature);
    const b = build(doc);
    // trunk_bottom was at (35.214, 0.014, -68.575): turned a quarter about Z, then moved by (10, 0, 68.575).
    const p = b.parts.find((x) => x.id === BOTTOM)!;
    expect(p.position.x).toBeCloseTo(10 - 0.014, 2);
    expect(p.position.y).toBeCloseTo(35.214, 2);
    expect(p.position.z).toBeCloseTo(0, 3);
    expect(p.rotation?.z).toBeCloseTo(90, 6);
  });

  it("leaves a child that the move names itself where the move puts it", () => {
    const doc = liftParts(duck(), [TOP, BOTTOM], 10);
    const b = build(doc);
    expect(b.parts.find((x) => x.id === BOTTOM)!.position.z).toBeCloseTo(-58.575, 3);
  });

  it("leaves the parent where it is when only the child moves", () => {
    const doc = liftParts(duck(), [BOTTOM], 10);
    const b = build(doc);
    expect(b.parts.find((x) => x.id === TOP)!.position.z).toBe(0);
    expect(b.joints[0]!.origin[2]).toBeCloseTo(5.1, 3);
  });
});
