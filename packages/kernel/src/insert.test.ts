import { beforeAll, describe, expect, it } from "vitest";
import { cataloguePart, partBounds, placeOnFace, type CataloguePart } from "./catalogue";
import { addPart, build, changeParts, insertCatalogue, newDoc, printed } from "./document";
import { loadBcad, saveBcad } from "./bcad";
import { loadOCCT, type OC } from "./occt/oc";
import { ModelBuilder } from "./occt/model";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

type V3 = [number, number, number];
const DEG = Math.PI / 180;
/** Turns a vector X first, then Y, then Z, as parts are placed. */
function turn(v: V3, r: { x: number; y: number; z: number }): V3 {
  let [x, y, z] = v;
  const [cx, sx] = [Math.cos(r.x * DEG), Math.sin(r.x * DEG)];
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const [cy, sy] = [Math.cos(r.y * DEG), Math.sin(r.y * DEG)];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const [cz, sz] = [Math.cos(r.z * DEG), Math.sin(r.z * DEG)];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return [x, y, z];
}
const close = (a: V3, b: V3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

describe("placing a part on a face (#187)", () => {
  const faces: [string, V3, V3][] = [
    ["top", [0, 0, 1], [1, 0, 0]],
    ["bottom", [0, 0, -1], [1, 0, 0]],
    ["front", [0, -1, 0], [1, 0, 0]],
    ["side", [1, 0, 0], [0, 1, 0]],
    ["side, x along z", [1, 0, 0], [0, 0, 1]],
    ["slope", [0, 1, 1], [1, 0, 0]],
    ["no x given", [1, 0, 0], [1, 0, 0]],
  ];
  it.each(faces)("stands the part's z on the normal of a %s face, in every quarter turn", (_, n, x) => {
    const len = Math.hypot(...n);
    const unit = n.map((v) => v / len) as V3;
    let prev: V3 | null = null;
    for (let q = 0; q < 4; q++) {
      const { position, rotation } = placeOnFace([1, 2, 3], n, x, q);
      expect(position).toEqual({ x: 1, y: 2, z: 3 });
      close(turn([0, 0, 1], rotation), unit);
      const ex = turn([1, 0, 0], rotation);
      expect(Math.abs(ex[0] * unit[0] + ex[1] * unit[1] + ex[2] * unit[2])).toBeLessThan(1e-9);
      // Each quarter turns the part's x a further 90° about the normal.
      if (prev) expect(prev[0] * ex[0] + prev[1] * ex[1] + prev[2] * ex[2]).toBeCloseTo(0, 6);
      prev = ex;
    }
  });
});

describe("Insert part step (#187)", () => {
  const sg90 = cataloguePart("sg90")!;

  it("adds a reference body named after the part, keeping the record it used", () => {
    let d = insertCatalogue(newDoc(), sg90, { position: { x: 0, y: 0, z: 10 } }, "s1", "f1");
    d = insertCatalogue(d, sg90, { position: { x: 40, y: 0, z: 10 } }, "s2", "f2");
    const parts = build(d).parts;
    expect(parts.map((p) => p.name)).toEqual(["SG90 micro servo", "SG90 micro servo 2"]);
    expect(parts[0]).toMatchObject({ kind: "solid", reference: true, position: { x: 0, y: 0, z: 10 }, catalogue: { id: "sg90", version: 1, mass: 9 } });
    expect(printed(parts[0]!)).toBe(false);
    // The step keeps its own copy: changing the catalogue's record later doesn't move it.
    const step = d.features[0] as { record: CataloguePart };
    expect(step.record).toEqual(sg90);
    expect(step.record).not.toBe(sg90);
  });

  it("can be made printable from its look", () => {
    const d = insertCatalogue(newDoc(), sg90, { position: { x: 0, y: 0, z: 0 } }, "s1");
    const p = build({ ...d, looks: { s1: { reference: false } } }).parts[0]!;
    expect(printed(p)).toBe(true);
  });

  it("builds where it was placed, and survives saving", () => {
    let d = addPart(newDoc(), "box", "plate");
    d = changeParts(d, ["plate"], "size", { x: 60, y: 40, z: 5 });
    d = insertCatalogue(d, sg90, placeOnFace([0, 0, 5], [0, 0, 1], [1, 0, 0], 1), "servo");
    const loaded = loadBcad(saveBcad(d));
    if (loaded instanceof Error) throw loaded;
    const r = new ModelBuilder(oc).build(loaded.doc);
    expect(r.failed).toEqual([]);
    const body = r.bodies.find((b) => b.id === "servo")!;
    const [min, max] = partBounds(sg90);
    // A quarter turn swaps x and y; z = 0 of the part is on the plate's top.
    expect(body.measure.bbox.min[0]).toBeCloseTo(-max[1], 3);
    expect(body.measure.bbox.max[1]).toBeCloseTo(max[0], 3);
    expect(body.measure.bbox.min[2]).toBeCloseTo(5 + min[2], 3);
  });
});
