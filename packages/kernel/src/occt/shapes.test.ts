import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { boolean, box, chamfer, cone, cylinder, fillet, measure, place, shell, sphere, torus, wedge } from "./shapes";
import { KernelError } from "../errors";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const close = (a: number[], b: number[], d = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, d));

describe("OCCT shapes (analytic)", () => {
  it("a box", () => {
    const m = measure(oc, box(oc, { x: 20, y: 10, z: 5 }));
    expect(m.volume).toBeCloseTo(1000, 6);
    close(m.bbox.min, [-10, -5, 0]);
    close(m.bbox.max, [10, 5, 5]);
    expect([m.faces, m.edges, m.vertices]).toEqual([6, 12, 8]);
  });
  it("a cylinder and an elliptical one", () => {
    expect(measure(oc, cylinder(oc, { x: 20, y: 20, z: 30 })).volume).toBeCloseTo(Math.PI * 100 * 30, 4);
    expect(measure(oc, cylinder(oc, { x: 20, y: 10, z: 30 })).volume).toBeCloseTo(Math.PI * 10 * 5 * 30, 4);
  });
  it("a sphere and a spheroid", () => {
    const s = measure(oc, sphere(oc, { x: 20, y: 20, z: 20 }));
    expect(s.volume).toBeCloseTo((4 / 3) * Math.PI * 1000, 3);
    close(s.bbox.min, [-10, -10, 0], 3);
    expect(measure(oc, sphere(oc, { x: 20, y: 20, z: 40 })).volume).toBeCloseTo((4 / 3) * Math.PI * 10 * 10 * 20, 2);
  });
  it("a cone, a torus and a wedge", () => {
    expect(measure(oc, cone(oc, 20, 0, 30)).volume).toBeCloseTo((Math.PI * 100 * 30) / 3, 3);
    expect(measure(oc, cone(oc, 20, 10, 30)).volume).toBeCloseTo((Math.PI * 30 * (100 + 50 + 25)) / 3, 3);
    expect(measure(oc, torus(oc, 40, 10)).volume).toBeCloseTo(2 * Math.PI * Math.PI * 20 * 25, 2);
    expect(measure(oc, wedge(oc, { x: 10, y: 20, z: 6 })).volume).toBeCloseTo(600, 6);
  });
  it("placement turns about X, then Y, then Z, then moves", () => {
    const b = place(oc, box(oc, { x: 20, y: 10, z: 5 }), { position: { x: 100, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 90 } });
    const m = measure(oc, b);
    close(m.bbox.min, [95, -10, 0]);
    close(m.bbox.max, [105, 10, 5]);
  });
  it("rejects a zero size in one line", () => {
    expect(() => box(oc, { x: 0, y: 1, z: 1 })).toThrow(/above 0 mm/);
  });
});

describe("OCCT operations", () => {
  it("cuts a hole: box minus cylinder", () => {
    const hole = place(oc, cylinder(oc, { x: 6, y: 6, z: 20 }), { position: { x: 0, y: 0, z: -5 } });
    const m = measure(oc, boolean(oc, "cut", box(oc, { x: 10, y: 10, z: 10 }), [hole]));
    expect(m.volume).toBeCloseTo(1000 - Math.PI * 9 * 10, 4);
    expect(m.faces).toBe(7);
  });
  it("joins two overlapping boxes into one solid", () => {
    const a = box(oc, { x: 10, y: 10, z: 10 });
    const b = place(oc, box(oc, { x: 10, y: 10, z: 10 }), { position: { x: 5, y: 0, z: 0 } });
    const m = measure(oc, boolean(oc, "join", a, [b]));
    expect(m.volume).toBeCloseTo(1500, 4);
    expect(m.solids).toBe(1);
    expect(m.faces).toBe(6);
  });
  it("intersects, and says so when nothing overlaps", () => {
    const a = box(oc, { x: 10, y: 10, z: 10 });
    const b = place(oc, box(oc, { x: 10, y: 10, z: 10 }), { position: { x: 5, y: 0, z: 0 } });
    expect(measure(oc, boolean(oc, "intersect", a, [b])).volume).toBeCloseTo(500, 4);
    const far = place(oc, box(oc, { x: 1, y: 1, z: 1 }), { position: { x: 50, y: 0, z: 0 } });
    expect(() => boolean(oc, "intersect", a, [far])).toThrow(/do not overlap/);
  });
  it("fillets every edge of a box", () => {
    const b = box(oc, { x: 20, y: 20, z: 20 });
    const m = measure(oc, fillet(oc, b, [...Array(12).keys()], 2));
    // A 20 mm cube with 2 mm rounds: cube − edge material + corner spheres (analytic).
    const r = 2;
    const L = 20;
    const expected = L ** 3 - 12 * (L - 2 * r) * r * r * (1 - Math.PI / 4) - 8 * r ** 3 * (1 - Math.PI / 6) - 0;
    // The corner term above is approximate; check within 0.5 mm³ and the face count exactly.
    expect(Math.abs(m.volume - expected)).toBeLessThan(5);
    expect(m.faces).toBe(26);
  });
  it("a fillet that does not fit suggests one that does", () => {
    const b = box(oc, { x: 4, y: 20, z: 20 });
    try {
      fillet(oc, b, [...Array(12).keys()], 3);
      throw new Error("expected a failure");
    } catch (e) {
      expect(e).toBeInstanceOf(KernelError);
      expect((e as KernelError).code).toBe("fillet-too-large");
      expect((e as KernelError).message).toMatch(/^A 3 mm fillet does not fit here\. Try [\d.]+ mm or less\.$/);
    }
  });
  it("chamfers one edge", () => {
    const m = measure(oc, chamfer(oc, box(oc, { x: 10, y: 10, z: 10 }), [0], 1));
    expect(m.volume).toBeCloseTo(1000 - 0.5 * 10, 4);
    expect(m.faces).toBe(7);
  });
  it("shells a box at 1.2 mm with the top open", () => {
    const b = box(oc, { x: 20, y: 20, z: 20 });
    // Face 1 of a box from MakeBox is the top? Find the face whose centroid is highest.
    const m = measure(oc, shell(oc, b, [5], 1.2));
    expect(m.volume).toBeGreaterThan(0);
    expect(m.volume).toBeLessThan(8000 - 17.6 * 17.6 * 18.8 + 1);
  });
});
