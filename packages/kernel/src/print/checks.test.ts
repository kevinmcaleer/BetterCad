import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "../occt/oc";
import { boolean, box, place, polygonFace, prism, shell, sphere, type TopoDS_Shape } from "../occt/shapes";
import { tessellate } from "../occt/tessellate";
import { overhangs, thickness } from "./checks";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

/** A profile in XZ, 20 mm deep along Y. */
const profile = (pts: [number, number][]): TopoDS_Shape =>
  prism(
    oc,
    polygonFace(
      oc,
      pts.map(([x, z]) => [x, 0, z]),
    ),
    [0, 20, 0],
  );
const mesh = (s: TopoDS_Shape, q: "fast" | "fine" = "fast") => tessellate(oc, s, q);

describe("overhangs", () => {
  // A step whose underside is a 45° chamfer, 10 mm above the bed.
  const chamfered = () =>
    profile([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 20],
      [20, 30],
      [0, 30],
    ]);

  it("a 45° chamfer passes at 45° and needs support at 44°", () => {
    const m = mesh(chamfered());
    expect(overhangs(m, 45).areas).toHaveLength(0);
    const at44 = overhangs(m, 44);
    expect(at44.areas).toHaveLength(1);
    expect(at44.area).toBeCloseTo(Math.SQRT2 * 10 * 20, 0);
  });

  it("finds the underside of a T's top bar, both sides as one area each", () => {
    const t = profile([
      [-5, 0],
      [5, 0],
      [5, 20],
      [15, 20],
      [15, 25],
      [-15, 25],
      [-15, 20],
      [-5, 20],
    ]);
    const r = overhangs(mesh(t));
    expect(r.areas).toHaveLength(2);
    expect(r.area).toBeCloseTo(2 * 10 * 20, 0);
    // The bottom sits on the bed, so it isn't an overhang.
    expect(r.areas.every((a) => a.box.min[2] > 19)).toBe(true);
  });
});

describe("thickness", () => {
  const cube = () => box(oc, { x: 20, y: 20, z: 20 });

  it("a box shelled to 0.6 mm is thin everywhere, at 0.6 mm", () => {
    const r = thickness(mesh(shell(oc, cube(), [5], 0.6)), 0.8);
    expect(r.min).toBeCloseTo(0.6, 2);
    expect(r.area).toBeGreaterThan(4 * 20 * 19);
  });

  it("a 1.2 mm wall passes at 0.8 mm", () => {
    const r = thickness(mesh(shell(oc, cube(), [5], 1.2)), 0.8);
    expect(r.areas).toHaveLength(0);
    expect(r.min).toBeNull();
  });

  it("a plate with a 0.5 mm fin has one thin area", () => {
    const plate = box(oc, { x: 40, y: 40, z: 5 });
    const fin = place(oc, box(oc, { x: 0.5, y: 20, z: 10 }), { position: { x: 0, y: 0, z: 5 } });
    const r = thickness(mesh(boolean(oc, "join", plate, [fin])), 0.8);
    expect(r.areas).toHaveLength(1);
    expect(r.areas[0]!.min).toBeCloseTo(0.5, 2);
    expect(r.areas[0]!.box.min[2]).toBeGreaterThanOrEqual(4.99);
  });

  it("checks a curved body of many triangles quickly", () => {
    const many = mesh(shell(oc, sphere(oc, { x: 60, y: 60, z: 60 }), [], 1), "fine");
    const tris = many.indices.length / 3;
    const t = performance.now();
    const r = thickness(many, 0.8);
    const ms = performance.now() - t;
    expect(tris).toBeGreaterThan(10_000);
    expect(r.areas).toHaveLength(0);
    // About 10 µs a triangle locally keeps 200k under 2 s; shared CI runners are slower, so the guard is loose and
    // only catches a step change (an allocation per ray, a lost BVH).
    expect(ms / tris).toBeLessThan(0.04);
  });
});
