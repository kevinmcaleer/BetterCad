import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "../occt/oc";
import { ModelBuilder } from "../occt/model";
import { box, holes, measure } from "../occt/shapes";
import { triangles } from "../occt/export";
import { addFinish, addImport, build, placePart, newDoc, updateHole, type HoleFeature, type ModelDoc } from "../document";
import { writeStl } from "../export/mesh";
import { blobHash, toBase64 } from "../imports";
import type { HoleSpec } from "../holes";
import { moved, recognise } from "./index";
import { addConverted } from "./steps";

let oc: OC;
let m: ModelBuilder;
let exact = 0;
let stl: ArrayBuffer;
beforeAll(async () => {
  oc = await loadOCCT();
  m = new ModelBuilder(oc);
  // The plate BetterCad would have made: four M3 holes, a counterbore, a countersink and a blind hole.
  let s = box(oc, { x: 40, y: 30, z: 6 });
  const top = { origin: [0, 0, 6], x: [1, 0, 0], normal: [0, 0, 1] } as unknown as HoleSpec["frame"];
  s = holes(oc, s, {
    frame: top,
    points: [
      [-12, -8],
      [12, -8],
      [12, 8],
      [-12, 8],
    ],
    diameter: 3.4,
    depth: null,
  });
  s = holes(oc, s, { frame: top, points: [[0, 9]], diameter: 3.4, depth: null, head: { kind: "counterbore", diameter: 6, depth: 2 } });
  s = holes(oc, s, { frame: top, points: [[0, -9]], diameter: 3.4, depth: null, head: { kind: "countersink", diameter: 6.4, depth: 1.5, angle: 90 } });
  s = holes(oc, s, { frame: top, points: [[0, 0]], diameter: 5, depth: 3 });
  exact = measure(oc, s).volume;
  stl = writeStl("plate", [{ name: "plate", triangles: triangles(oc, s, 0.05) }]);
}, 60_000);

function imported(position = { x: 0, y: 0, z: 0 }): ModelDoc {
  const u = new Uint8Array(stl);
  return addImport(
    newDoc("Plate"),
    { file: "plate.stl", format: "stl", blob: blobHash(u), data: toBase64(u), bodies: [{ id: "mesh", name: "plate" }], position },
    "imp",
  );
}

const find = (d: ModelDoc) => m.recognise(d, undefined, "mesh", {}, recognise, moved);

// Each test builds the model several times in OCCT: a few seconds here, two or three times that on a CI runner.
describe("Convert (#448) and its Hole steps (#449)", () => {
  it("recognises an imported body where it stands", () => {
    const r = find(imported({ x: 50, y: 20, z: 10 }));
    expect(r.open).toBe(false);
    expect(r.holes).toHaveLength(7);
    expect(r.coverage).toBeGreaterThan(0.99);
    // The plate's middle is over the import's position, its top 6 mm up.
    const blind = r.holes.find((h) => h.depth !== null)!;
    expect(blind.origin[0]).toBeCloseTo(50, 4);
    expect(blind.origin[1]).toBeCloseTo(20, 4);
    expect(blind.origin[2]).toBeCloseTo(16, 4);
  }, 30_000);

  it("makes a component with an editable body, a Hole step per kind of hole, and hides the mesh", () => {
    const d0 = imported({ x: 50, y: 20, z: 10 });
    const r = find(d0);
    const made = addConverted(d0, undefined, r, { part: "mesh", name: "plate", holes: r.holes.map(() => true) });
    const types = made.doc.features.map((f) => f.type);
    // Four corner holes share one step; the counterbore, countersink and blind hole have one each.
    expect(types).toEqual(["import", "link", "convert", "hole", "hole", "hole", "hole"]);
    expect(made.steps).toBe(6);
    const b = build(made.doc);
    expect([...b.failed]).toEqual([]);
    const body = b.parts.find((p) => p.id === made.body)!;
    expect(body).toMatchObject({ name: "plate (editable)", link: made.component, hidden: false });
    expect(b.parts.find((p) => p.id === "mesh")).toMatchObject({ hidden: true });
    const res = m.build(made.doc);
    expect(res.failed).toEqual([]);
    const out = res.bodies.find((x) => x.id === made.body)!;
    // The part the mesh was made from, to a hundred-thousandth of its volume, and with true round faces: 6 flat
    // faces, 4 + 1 + 1 bores, a counterbore's wall and shelf, a countersink's cone, and a blind hole's wall and floor.
    expect(Math.abs(out.measure.volume - exact) / exact).toBeLessThan(1e-5);
    expect(out.measure.faces).toBe(6 + 6 + 2 + 1 + 2);
    expect(out.names?.faces.length).toBe(out.measure.faces);
  }, 30_000);

  it("a recognised hole is a Hole step like any other: resize it, or untick it to leave it in the mesh", () => {
    const d0 = imported();
    const r = find(d0);
    const made = addConverted(d0, undefined, r, { part: "mesh", name: "plate", holes: r.holes.map(() => true) });
    const four = made.doc.features.find((f): f is HoleFeature => f.type === "hole" && f.points.length === 4)!;
    expect(four).toMatchObject({ size: "custom", diameter: 3.4, depth: null, head: "none" });
    const bigger = updateHole(made.doc, four.id, { diameter: 4.5 });
    const v = m.build(bigger).bodies.find((x) => x.id === made.body)!.measure.volume;
    expect(v).toBeCloseTo(exact - 4 * Math.PI * (2.25 ** 2 - 1.7 ** 2) * 6, 2);
    // Deleting the Hole step leaves the plate solid there.
    const without = { ...made.doc, features: made.doc.features.filter((f) => f.id !== four.id) };
    expect(m.build(without).bodies.find((x) => x.id === made.body)!.measure.volume).toBeCloseTo(exact + 4 * Math.PI * 1.7 ** 2 * 6, 2);
    // Unticked holes are neither filled nor cut again.
    const some = addConverted(d0, undefined, r, { part: "mesh", name: "plate", holes: r.holes.map((h) => h.depth !== null) });
    expect(some.doc.features.filter((f) => f.type === "hole")).toHaveLength(1);
    const res = m.build(some.doc);
    expect(res.failed).toEqual([]);
    expect(Math.abs(res.bodies.find((x) => x.id === some.body)!.measure.volume - exact) / exact).toBeLessThan(1e-3);
  }, 30_000);

  it("a converted body takes a fillet, which a mesh refuses", () => {
    const d0 = imported();
    const r = find(d0);
    const made = addConverted(d0, undefined, r, { part: "mesh", name: "plate", holes: r.holes.map(() => true) });
    const filleted = addFinish(made.doc, { type: "fillet", part: made.body, refs: [0], size: 1 }, "fil");
    const res = m.build(filleted);
    expect(res.failed).toEqual([]);
    expect(res.bodies.find((x) => x.id === made.body)!.measure.volume).toBeLessThan(exact);
    const onMesh = addFinish(d0, { type: "fillet", part: "mesh", refs: [0], size: 1 }, "fil");
    expect(m.build(onMesh).failed).toContainEqual(["fil", "Imported meshes can't be filleted; use a STEP file for that"]);
  }, 30_000);

  it("moves with the body when a later step moves it, and only reads a body as it was imported", () => {
    const d0 = imported();
    const r = find(d0);
    const made = addConverted(d0, undefined, r, { part: "mesh", name: "plate", holes: r.holes.map(() => true) });
    const shifted = placePart(made.doc, made.body, { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 90 });
    const res = m.build(shifted);
    expect(res.failed).toEqual([]);
    const out = res.bodies.find((x) => x.id === made.body)!;
    expect(Math.abs(out.measure.volume - exact) / exact).toBeLessThan(1e-5);
    expect((out.measure.bbox.min[0] + out.measure.bbox.max[0]) / 2).toBeCloseTo(100, 4);
    expect(() => m.recognise(made.doc, undefined, made.body, {}, recognise, moved)).toThrow("as it was imported");
  }, 30_000);
});
