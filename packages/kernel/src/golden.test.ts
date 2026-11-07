import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./occt/oc";
import {
  boolean,
  box,
  chamfer,
  cone,
  cylinder,
  fillet,
  holes,
  measure,
  place,
  prismOf,
  pushPull,
  revolveOf,
  shell,
  sphere,
  torus,
  valid,
  wedge,
  type TopoDS_Shape,
} from "./occt/shapes";
import type { PrismSpec, ProfileSeg } from "./extrude";
import { resolveHole, type HoleParams, type HoleSpec } from "./holes";
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

const XY = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] } as PrismSpec["frame"];
const rect = (w: number, h: number): ProfileSeg[] => [
  { kind: "line", a: [0, 0], b: [w, 0] },
  { kind: "line", a: [w, 0], b: [w, h] },
  { kind: "line", a: [w, h], b: [0, h] },
  { kind: "line", a: [0, h], b: [0, 0] },
];

const XZ = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] } as PrismSpec["frame"];
const Z_AXIS = { origin: [0, 0] as [number, number], dir: [0, 1] as [number, number] };
const rectAt = (x: number, y: number, w: number, h: number): ProfileSeg[] =>
  rect(w, h).map((g) => (g.kind === "line" ? { kind: "line", a: [g.a[0] + x, g.a[1] + y], b: [g.b[0] + x, g.b[1] + y] } : g));

const holeOn = (top: number, p: HoleParams): HoleSpec => {
  const r = resolveHole(p) as { diameter: number; head?: HoleSpec["head"] };
  return { frame: { origin: [0, 0, top], x: [1, 0, 0], normal: [0, 0, 1] }, points: [[0, 0]], depth: p.depth, ...r };
};

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
  // Extrude (#61): a sketch's closed shapes pushed along its normal.
  "extrude-rect": (oc) => prismOf(oc, { frame: XY, profiles: [{ outer: rect(30, 20), holes: [], area: 600 }], from: 0, to: 10 }),
  "extrude-ring": (oc) =>
    prismOf(oc, {
      frame: XY,
      profiles: [{ outer: [{ kind: "circle", c: [0, 0], r: 10 }], holes: [[{ kind: "circle", c: [0, 0], r: 4 }]], area: 0 }],
      from: 0,
      to: 5,
    }),
  "extrude-arc": (oc) =>
    prismOf(oc, {
      frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] },
      profiles: [
        {
          outer: [
            { kind: "line", a: [-10, 0], b: [10, 0] },
            { kind: "arc", a: [10, 0], m: [0, 10], b: [-10, 0] },
          ],
          holes: [],
          area: 0,
        },
      ],
      from: -4,
      to: 4,
    }),
  // Finishes (#67, #68): every edge of a cube rounded; a tray with a 1.2 mm wall; a shell grown outward.
  "fillet-all": (oc) => fillet(oc, box(oc, { x: 20, y: 20, z: 20 }), [...Array(12).keys()], 2),
  "chamfer-all": (oc) => chamfer(oc, box(oc, { x: 20, y: 20, z: 20 }), [...Array(12).keys()], 1),
  tray: (oc) => shell(oc, fillet(oc, box(oc, { x: 40, y: 30, z: 15 }), [...Array(12).keys()], 3), [], 1.2),
  "hollow-sphere": (oc) => shell(oc, sphere(oc, { x: 20, y: 20, z: 20 }), [], 1),
  "shell-outside": (oc) => shell(oc, box(oc, { x: 20, y: 20, z: 20 }), [5], 2, true),
  // Revolve (#62): a 10 × 30 mm rectangle beside the Z axis, a full turn and a quarter; a groove cut into a cylinder.
  "revolve-full": (oc) => revolveOf(oc, { frame: XZ, profiles: [{ outer: rectAt(5, 0, 10, 30), holes: [], area: 300 }], axis: Z_AXIS, angle: 360 }),
  "revolve-quarter": (oc) => revolveOf(oc, { frame: XZ, profiles: [{ outer: rectAt(5, 0, 10, 30), holes: [], area: 300 }], axis: Z_AXIS, angle: 90 }),
  "revolve-groove": (oc) =>
    boolean(oc, "cut", cylinder(oc, { x: 20, y: 20, z: 30 }), [
      revolveOf(oc, { frame: XZ, profiles: [{ outer: rectAt(8, 10, 4, 4), holes: [], area: 16 }], axis: Z_AXIS, angle: 360 }),
    ]),
  // Push/pull (#65): the top of a 20 mm box out 5 mm, and in 5 mm.
  "pushpull-out": (oc) => pushPull(oc, box(oc, { x: 20, y: 20, z: 20 }), 5, 5),
  "pushpull-in": (oc) => pushPull(oc, box(oc, { x: 20, y: 20, z: 20 }), 5, -5),
  // Holes (#70), into the top of a plate.
  "hole-m3-plate": (oc) => holes(oc, box(oc, { x: 20, y: 20, z: 5 }), holeOn(5, { size: "M3", fit: "printed", head: "none", depth: null })),
  "hole-m3-countersunk": (oc) => holes(oc, box(oc, { x: 20, y: 20, z: 5 }), holeOn(5, { size: "M3", fit: "printed", head: "countersink", depth: null })),
  "hole-m4-counterbore": (oc) => holes(oc, box(oc, { x: 20, y: 20, z: 10 }), holeOn(10, { size: "M4", fit: "printed", head: "counterbore", depth: 6 })),
  // Group (#66): a box with two hole cylinders is the box less both.
  group: (oc) =>
    boolean(oc, "cut", box(oc, { x: 40, y: 20, z: 10 }), [
      place(oc, cylinder(oc, { x: 6, y: 6, z: 10 }), { position: { x: -10, y: 0, z: 0 } }),
      place(oc, cylinder(oc, { x: 6, y: 6, z: 10 }), { position: { x: 10, y: 0, z: 0 } }),
    ]),
  "extrude-cut": (oc) =>
    boolean(oc, "cut", box(oc, { x: 20, y: 20, z: 20 }), [
      prismOf(oc, {
        frame: { origin: [0, 0, 20], x: [1, 0, 0], normal: [0, 0, 1] },
        profiles: [{ outer: [{ kind: "circle", c: [0, 0], r: 3 }], holes: [], area: 0 }],
        from: -8,
        to: 0,
      }),
    ]),
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
      // Every number that moved, before and after, for the CI job summary (GOLDEN_SUMMARY names the file).
      const moved: [string, unknown, unknown][] = [];
      const diff = (a: unknown, b: unknown, path: string): void => {
        if (typeof b === "number") {
          if (typeof a !== "number" || Math.abs(a - b) >= 5e-4) moved.push([path, b, a]);
        } else if (b && typeof b === "object") for (const [k, x] of Object.entries(b)) diff((a as Record<string, unknown>)?.[k], x, `${path}.${k}`);
        else if (JSON.stringify(a) !== JSON.stringify(b)) moved.push([path, b, a]);
      };
      diff(got, want, name);
      if (moved.length && process.env.GOLDEN_SUMMARY) {
        const rows = moved.map(([p, b, a]) => `| \`${p}\` | ${JSON.stringify(b)} | ${JSON.stringify(a)} |`).join("\n");
        appendFileSync(process.env.GOLDEN_SUMMARY, `\n#### ${name}\n\n| Measure | Golden | Now |\n| --- | --- | --- |\n${rows}\n`);
      }
      expect(moved.map(([p, b, a]) => `${p}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`)).toEqual([]);
    });
  }
});
