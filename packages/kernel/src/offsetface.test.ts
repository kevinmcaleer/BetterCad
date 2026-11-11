import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import { boolean, box, cylinder, elements, measure, offsetFaces, place, wedge } from "./occt/shapes";
import type { TopoDS_Shape } from "replicad-opencascadejs";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** The face whose outward normal is nearest `dir` (a slanted face: the one that leans most that way). */
function faceToward(shape: TopoDS_Shape, dir: [number, number, number], round = false): number {
  let best = -1;
  let score = -Infinity;
  elements(oc, shape, "face").forEach((f, i) => {
    const face = oc.TopoDS.Face(f);
    const s = new oc.BRepAdaptor_Surface(face, true);
    const isPlane = s.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane;
    if (round ? isPlane : !isPlane) return s.delete();
    if (round) {
      score = 0;
      best = i;
      return s.delete();
    }
    const d = s.Plane().Axis().Direction();
    const k = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
    const v = k * (d.X() * dir[0] + d.Y() * dir[1] + d.Z() * dir[2]);
    if (v > score) [score, best] = [v, i];
    s.delete();
  });
  return best;
}

describe("offset face (#264)", () => {
  it("moves a box's top out and in", () => {
    const b = box(oc, { x: 20, y: 20, z: 20 });
    const top = faceToward(b, [0, 0, 1]);
    expect(measure(oc, offsetFaces(oc, b, [top], 3)).volume).toBeCloseTo(20 * 20 * 23, 3);
    expect(measure(oc, offsetFaces(oc, b, [top], -3)).volume).toBeCloseTo(20 * 20 * 17, 3);
  });

  it("moves a wedge's slope out, and its neighbours stretch to meet it", () => {
    // A right triangle 20 wide and 10 tall, 10 deep: the slope is 10 × 20 / √500 from the right angle.
    const w = wedge(oc, { x: 20, y: 10, z: 10 });
    const slope = faceToward(w, [1, 0, 2]);
    const h = 200 / Math.sqrt(500);
    const k = (h + 2) / h;
    const out = offsetFaces(oc, w, [slope], 2);
    expect(measure(oc, out).volume).toBeCloseTo(10 * 100 * k * k, 3);
    // Still five faces: the slope, the bottom, the back and the two ends, grown.
    expect(elements(oc, out, "face")).toHaveLength(5);
  });

  it("loosens and tightens a hole's wall", () => {
    const plate = boolean(oc, "cut", box(oc, { x: 20, y: 20, z: 5 }), [place(oc, cylinder(oc, { x: 5, y: 5, z: 5 }), { position: { x: 0, y: 0, z: 0 } })]);
    const wall = faceToward(plate, [0, 0, 0], true);
    const base = measure(oc, plate).volume;
    const ring = (r0: number, r1: number) => Math.PI * (r1 * r1 - r0 * r0) * 5;
    // In by 0.2 mm (the body shrinks): a 5.4 mm hole.
    expect(base - measure(oc, offsetFaces(oc, plate, [wall], -0.2)).volume).toBeCloseTo(ring(2.5, 2.7), 3);
    expect(measure(oc, offsetFaces(oc, plate, [wall], 0.5)).volume - base).toBeCloseTo(ring(2, 2.5), 3);
    expect(() => offsetFaces(oc, plate, [wall], 3)).toThrow("That closes the hole up.");
  });

  it("refuses a distance that would take the whole body away", () => {
    const b = box(oc, { x: 20, y: 20, z: 20 });
    expect(() => offsetFaces(oc, b, [faceToward(b, [0, 0, 1])], -25)).toThrow();
  });
});
