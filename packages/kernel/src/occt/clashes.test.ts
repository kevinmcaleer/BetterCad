import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { ModelBuilder } from "./model";
import { box, boolean, cylinder, place } from "./shapes";
import { findClashes } from "./clashes";
import { addJoint, addLink, addPart, changeParts, newDoc, setLook, type ModelDoc } from "../document";

let oc: OC;
let m: ModelBuilder;
beforeAll(async () => {
  oc = await loadOCCT();
  m = new ModelBuilder(oc);
}, 60_000);

const cube = (x: number, y = 0, z = 0, s = 10) => place(oc, box(oc, { x: s, y: s, z: s }), { position: { x, y, z } });

describe("clash check (#178)", () => {
  it("finds two overlapping boxes and their common volume", () => {
    // 10 mm cubes 6 mm apart overlap by 4 × 10 × 10.
    const r = findClashes(oc, [
      { id: "a", shape: cube(0) },
      { id: "b", shape: cube(6) },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ a: "a", b: "b", kind: "overlap" });
    expect(r[0]!.volume).toBeCloseTo(400, 6);
    expect(r[0]!.centre[0]).toBeCloseTo(3, 6);
    expect(r[0]!.box.min[0]).toBeCloseTo(1, 6);
    expect(r[0]!.box.max[0]).toBeCloseTo(5, 6);
  });

  it("meshes each overlap for the view to draw in red, inside its box", () => {
    const [c] = findClashes(oc, [
      { id: "a", shape: cube(0) },
      { id: "b", shape: cube(6) },
    ]);
    const mesh = c!.mesh!;
    // A 4 × 10 × 10 block: 6 faces, 2 triangles each at least.
    expect(mesh.length).toBeGreaterThanOrEqual(12 * 9);
    expect(mesh.length % 9).toBe(0);
    for (let i = 0; i < mesh.length; i += 3) {
      expect(mesh[i]!).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(mesh[i]!).toBeLessThanOrEqual(5 + 1e-6);
    }
  });

  it("calls boxes that share a face Touching, and leaves apart ones out", () => {
    const r = findClashes(oc, [
      { id: "a", shape: cube(0) },
      { id: "b", shape: cube(10) },
      { id: "c", shape: cube(40) },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ a: "a", b: "b", kind: "touch", volume: 0 });
  });

  it("finds no clash for a hinge pin in its hole with a sliding fit gap", () => {
    // A 5 mm pin in a 5.3 mm hole through a block: 0.15 mm all round.
    const block = boolean(oc, "cut", cube(0, 0, 0, 20), [cylinder(oc, { x: 5.3, y: 5.3, z: 20 })]);
    const pin = place(oc, cylinder(oc, { x: 5, y: 5, z: 30 }), { position: { x: 0, y: 0, z: -5 } });
    expect(
      findClashes(oc, [
        { id: "block", shape: block },
        { id: "pin", shape: pin },
      ]),
    ).toEqual([]);
  });

  it("skips bodies in the same link unless asked", () => {
    const bodies = [
      { id: "a", shape: cube(0), link: "l" },
      { id: "b", shape: cube(6), link: "l" },
    ];
    expect(findClashes(oc, bodies)).toEqual([]);
    expect(findClashes(oc, bodies, { sameLink: true })).toHaveLength(1);
  });

  it("checks the model as posed, and leaves holes and (unless asked) reference bodies out", () => {
    // Base is a box at the origin; an arm box 30 mm out on a hinge about Z at the origin. Turned 180°, it lands on a
    // reference box at -30.
    let d: ModelDoc = newDoc("Arm");
    d = addPart(d, "box", "base");
    d = addPart(d, "box", "arm");
    d = changeParts(d, ["arm"], "position", { x: 30 });
    d = addPart(d, "box", "ref");
    d = changeParts(d, ["ref"], "position", { x: -30 });
    d = setLook(d, ["ref"], () => ({ reference: true }));
    d = addLink(d, ["arm"], "la");
    d = addJoint(d, { kind: "revolute", child: "la", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: -180, upper: 180 }, "j");
    expect(m.clashes(d)).toEqual([]);
    const turned = { ...d, pose: { j: 180 } };
    expect(m.clashes(turned)).toEqual([]);
    const hit = m.clashes(turned, undefined, { references: true });
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ a: "arm", b: "ref", kind: "overlap" });
    expect(hit[0]!.volume).toBeCloseTo(20 * 20 * 20, 3);
  });
});
