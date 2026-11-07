import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import { boolean, box, chamfer, cone, cylinder, fillet, measure, place, shell, sphere, torus, valid, wedge, type TopoDS_Shape } from "./occt/shapes";
import { tessellate } from "./occt/tessellate";
import { meshVolume, triangleCount } from "./mesh";

/**
 * Golden tests (#49): every kernel operation, measured from the exact B-rep and checked against a stored answer in
 * golden/. A change to OCCT, the build or an operation that moves a number shows up here. To accept a deliberate
 * change, run `UPDATE_GOLDEN=1 npm run test:golden` and commit the new files.
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "golden");
const UPDATE = !!process.env.UPDATE_GOLDEN;

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const cases: Record<string, (oc: OC) => TopoDS_Shape> = {
  box: (oc) => box(oc, { x: 20, y: 10, z: 5 }),
  cylinder: (oc) => cylinder(oc, { x: 20, y: 20, z: 30 }),
  "cylinder-elliptical": (oc) => cylinder(oc, { x: 20, y: 10, z: 30 }),
  sphere: (oc) => sphere(oc, { x: 20, y: 20, z: 20 }),
  spheroid: (oc) => sphere(oc, { x: 20, y: 20, z: 40 }),
  cone: (oc) => cone(oc, 20, 10, 15),
  torus: (oc) => torus(oc, 40, 10),
  wedge: (oc) => wedge(oc, { x: 20, y: 10, z: 10 }),
  placed: (oc) => place(oc, box(oc, { x: 20, y: 10, z: 5 }), { position: { x: 5, y: -3, z: 2 }, rotation: { x: 30, y: 0, z: 45 } }),
  join: (oc) => boolean(oc, "join", box(oc, { x: 20, y: 20, z: 20 }), [place(oc, cylinder(oc, { x: 10, y: 10, z: 30 }), { position: { x: 10, y: 0, z: 0 } })]),
  cut: (oc) => boolean(oc, "cut", box(oc, { x: 20, y: 20, z: 20 }), [cylinder(oc, { x: 10, y: 10, z: 30 })]),
  intersect: (oc) => boolean(oc, "intersect", box(oc, { x: 20, y: 20, z: 20 }), [sphere(oc, { x: 24, y: 24, z: 24 })]),
  fillet: (oc) => fillet(oc, box(oc, { x: 20, y: 20, z: 20 }), [0, 1, 2, 3], 3),
  chamfer: (oc) => chamfer(oc, box(oc, { x: 20, y: 20, z: 20 }), [0, 1, 2, 3], 2),
  shell: (oc) => shell(oc, box(oc, { x: 20, y: 20, z: 20 }), [0], 2),
};

const round = (v: unknown): unknown =>
  typeof v === "number"
    ? Math.round(v * 1e4) / 1e4
    : Array.isArray(v)
      ? v.map(round)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
        : v;

describe("golden geometry", () => {
  for (const [name, make] of Object.entries(cases)) {
    it(name, () => {
      const shape = make(oc);
      expect(valid(oc, shape)).toBe(true);
      const m = measure(oc, shape);
      const mesh = tessellate(oc, shape, "fine");
      // The fine mesh is what export writes: it must hold the solid's volume to within 0.5 %.
      expect(Math.abs(meshVolume(mesh) - m.volume) / m.volume).toBeLessThan(0.005);
      const got = round({ ...m, triangles: triangleCount(mesh) > 0 }) as Record<string, unknown>;
      const file = join(DIR, `${name}.json`);
      if (UPDATE || !existsSync(file)) {
        if (!UPDATE && process.env.CI) throw new Error(`No golden file for ${name}. Run UPDATE_GOLDEN=1 npm run test:golden and commit it.`);
        mkdirSync(DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(got, null, 2) + "\n");
        return;
      }
      const want = JSON.parse(readFileSync(file, "utf8")) as typeof got;
      const near = (a: unknown, b: unknown, path: string): void => {
        if (typeof b === "number") expect(a as number, path).toBeCloseTo(b, 3);
        else if (b && typeof b === "object") for (const [k, x] of Object.entries(b)) near((a as Record<string, unknown>)[k], x, `${path}.${k}`);
        else expect(a, path).toEqual(b);
      };
      near(got, want, name);
    });
  }
});
