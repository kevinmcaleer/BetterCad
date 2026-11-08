import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { ModelBuilder } from "./model";
import { box, boolean, cylinder, measure, place } from "./shapes";
import { addPart, changeParts, newDoc, setLook, type ModelDoc } from "../document";
import { SHELL_MM } from "../print/materials";
import { combine, uniform, type MassProps } from "../mass";

let oc: OC;
let m: ModelBuilder;
beforeAll(async () => {
  oc = await loadOCCT();
  m = new ModelBuilder(oc);
}, 60_000);

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const props = (shape: Parameters<typeof measure>[1], density: number): MassProps => {
  const v = measure(oc, shape);
  return uniform({ volume: v.volume, centroid: v.centroid, inertia: v.inertia }, density);
};

describe("mass properties from the B-rep (#174)", () => {
  it("matches a 10 mm cube's analytic mass and inertia, wherever it sits", () => {
    const p = props(place(oc, box(oc, { x: 10, y: 10, z: 10 }), { position: { x: 40, y: -7, z: 3 } }), 1.24);
    expect(p.mass).toBeCloseTo(1.24, 6);
    // m(a² + a²)/12 about each axis through the centre; no products for a cube.
    const i = (1.24 * 200) / 12;
    for (const k of [0, 1, 2]) expect(p.inertia[k]).toBeCloseTo(i, 4);
    for (const k of [3, 4, 5]) expect(Math.abs(p.inertia[k]!)).toBeLessThan(1e-6);
  });

  it("matches a cylinder's analytic inertia", () => {
    const r = 10;
    const h = 30;
    const p = props(cylinder(oc, { x: 2 * r, y: 2 * r, z: h }), 1);
    const mass = (Math.PI * r * r * h) / 1000;
    expect(rel(p.mass, mass)).toBeLessThan(1e-6);
    // About its own axis m r²/2; across it m(3r² + h²)/12.
    expect(rel(p.inertia[2], (mass * r * r) / 2)).toBeLessThan(1e-4);
    expect(rel(p.inertia[0], (mass * (3 * r * r + h * h)) / 12)).toBeLessThan(1e-4);
  });

  it("combines bodies with the parallel axis theorem, matching OCCT's own L shape, products and all", () => {
    const a = box(oc, { x: 30, y: 10, z: 10 });
    const b = place(oc, box(oc, { x: 10, y: 20, z: 10 }), { position: { x: 10, y: 15, z: 0 } });
    const whole = props(boolean(oc, "join", a, [b]), 1);
    const sum = combine([props(a, 1), props(b, 1)]);
    expect(rel(sum.mass, whole.mass)).toBeLessThan(1e-6);
    sum.com.forEach((c, k) => expect(c).toBeCloseTo(whole.com[k]!, 4));
    sum.inertia.forEach((v, k) => expect(v).toBeCloseTo(whole.inertia[k]!, 2));
    // An L has a product of inertia in its plane, and OCCT's sign agrees with ours.
    expect(Math.abs(whole.inertia[3])).toBeGreaterThan(1);
  });
});

describe("a body's mass as printed (#174)", () => {
  function cube(size: number): ModelDoc {
    const d = addPart({ ...newDoc("Cube"), print: { material: "pla", infill: 20 } }, "box", "c");
    return changeParts(d, ["c"], "size", { x: size, y: size, z: size });
  }

  it("weighs a 40 mm cube as a solid shell and a 20% core, within 1% of the formula", () => {
    const [b] = m.mass(cube(40));
    expect(b!.method).toBe("shell");
    const rho = 1.24 / 1000;
    const a = 40;
    const c = a - 2 * SHELL_MM;
    const mass = rho * (a ** 3 - c ** 3 * 0.8);
    const ixx = (rho * (a ** 5 - c ** 5 * 0.8)) / 6;
    expect(rel(b!.mass, mass)).toBeLessThan(0.01);
    expect(rel(b!.inertia[0], ixx)).toBeLessThan(0.01);
  });

  it("weighs a body thinner than the shell as solid all through", () => {
    let d = cube(40);
    d = changeParts(d, ["c"], "size", { z: 3 });
    const [b] = m.mass(d);
    expect(b!.method).toBe("shell");
    expect(rel(b!.mass, (1.24 / 1000) * 40 * 40 * 3)).toBeLessThan(1e-6);
  });

  it("takes a datasheet mass as uniform, and leaves out holes and reference bodies without one", () => {
    let d = setLook(cube(40), ["c"], () => ({ mass: 55 }));
    d = addPart(d, "box", "h");
    d = setLook(d, ["h"], () => ({ hole: true }));
    d = addPart(d, "box", "r");
    d = setLook(d, ["r"], () => ({ reference: true }));
    const out = m.mass(d);
    expect(out.map((x) => x.id)).toEqual(["c"]);
    expect(out[0]!.method).toBe("datasheet");
    expect(out[0]!.mass).toBeCloseTo(55, 6);
    expect(out[0]!.inertia[0]).toBeCloseTo((55 * 2 * 40 * 40) / 12, 2);
  });
});
