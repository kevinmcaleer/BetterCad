import { beforeAll, describe, expect, it } from "vitest";
import type { TopoDS_Shape } from "replicad-opencascadejs";
import { loadOCCT, type OC } from "../occt/oc";
import { boolean, box, count, cylinder, holes, measure, place, valid } from "../occt/shapes";
import { triangles } from "../occt/export";
import { meshSolid } from "../occt/imports";
import { plug } from "../occt/plug";
import { readStl, writeStl } from "../export/mesh";
import type { HoleSpec } from "../holes";
import { recognise, type FoundHole, type Recognition } from "./index";

/**
 * The scoring harness (#439): parts built in the kernel, where every hole is known, exported as triangles at three
 * qualities and in harder variants, recognised, and scored against the truth.
 */
let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

interface Truth {
  at: [number, number, number];
  diameter: number;
  depth: number | null;
  head?: "counterbore" | "countersink";
}

const frame = (origin: number[], x: number[], normal: number[]) => ({ origin, x, normal }) as unknown as HoleSpec["frame"];
const TOP = (z: number) => frame([0, 0, z], [1, 0, 0], [0, 0, 1]);

/** A 40 × 30 × 6 plate with every kind of hole the Hole step makes. */
function plate(): { shape: TopoDS_Shape; truth: Truth[] } {
  let s = box(oc, { x: 40, y: 30, z: 6 });
  const z = measure(oc, s).bbox.max[2];
  const corners: [number, number][] = [
    [-12, -8],
    [12, -8],
    [12, 8],
    [-12, 8],
  ];
  s = holes(oc, s, { frame: TOP(z), points: corners, diameter: 3.4, depth: null });
  s = holes(oc, s, { frame: TOP(z), points: [[0, 0]], diameter: 5, depth: 3 });
  s = holes(oc, s, { frame: TOP(z), points: [[0, 9]], diameter: 3.4, depth: null, head: { kind: "counterbore", diameter: 6, depth: 2 } });
  s = holes(oc, s, { frame: TOP(z), points: [[0, -9]], diameter: 3.4, depth: null, head: { kind: "countersink", diameter: 6.4, depth: 1.5, angle: 90 } });
  // One from the side, blind.
  s = holes(oc, s, { frame: frame([20, 0, 3], [0, 1, 0], [1, 0, 0]), points: [[0, 0]], diameter: 2, depth: 4 });
  return {
    shape: s,
    truth: [
      ...corners.map(([x, y]): Truth => ({ at: [x, y, z], diameter: 3.4, depth: null })),
      { at: [0, 0, z], diameter: 5, depth: 3 },
      { at: [0, 9, z], diameter: 3.4, depth: null, head: "counterbore" },
      { at: [0, -9, z], diameter: 3.4, depth: null, head: "countersink" },
      { at: [20, 0, 3], diameter: 2, depth: 4 },
    ],
  };
}

interface Score {
  found: number;
  missed: number;
  wrong: number;
  /** The worst diameter and depth errors, mm. */
  size: number;
  depth: number;
}

function score(r: Recognition, truth: Truth[], move: (p: [number, number, number]) => [number, number, number] = (p) => p): Score {
  const left = [...r.holes];
  const out: Score = { found: 0, missed: 0, wrong: 0, size: 0, depth: 0 };
  for (const t of truth) {
    const at = move(t.at);
    const i = left.findIndex((h) => Math.hypot(h.origin[0] - at[0], h.origin[1] - at[1], h.origin[2] - at[2]) < 0.05);
    const h: FoundHole | undefined = left[i];
    if (!h || !h.step || h.head?.kind !== t.head || (h.depth === null) !== (t.depth === null)) {
      out.missed++;
      continue;
    }
    left.splice(i, 1);
    out.found++;
    out.size = Math.max(out.size, Math.abs(h.diameter - t.diameter));
    if (t.depth !== null) out.depth = Math.max(out.depth, Math.abs(h.depth! - t.depth));
  }
  out.wrong = left.length;
  return out;
}

const QUALITY: [string, number][] = [
  ["coarse", 0.3],
  ["normal", 0.05],
  ["fine", 0.005],
];

/** Turns triangles about X then Z, so nothing lines up with the axes. */
function turned(t: Float32Array): { t: Float32Array; move: (p: [number, number, number]) => [number, number, number] } {
  const a = 0.37;
  const b = 1.13;
  const move = ([x, y, z]: [number, number, number]): [number, number, number] => {
    const y1 = y * Math.cos(a) - z * Math.sin(a);
    const z1 = y * Math.sin(a) + z * Math.cos(a);
    return [x * Math.cos(b) - y1 * Math.sin(b) + 7, x * Math.sin(b) + y1 * Math.cos(b) - 3, z1 + 11];
  };
  const out = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3) out.set(move([t[i]!, t[i + 1]!, t[i + 2]!]), i);
  return { t: out, move };
}

/** Shakes every corner by up to `by` mm, the same for a corner wherever it is used. */
function shaken(t: Float32Array, by: number): Float32Array {
  const out = new Float32Array(t.length);
  const moved = new Map<string, [number, number, number]>();
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2 * by;
  for (let i = 0; i < t.length; i += 3) {
    const k = `${t[i]},${t[i + 1]},${t[i + 2]}`;
    if (!moved.has(k)) moved.set(k, [t[i]! + rnd(), t[i + 1]! + rnd(), t[i + 2]! + rnd()]);
    out.set(moved.get(k)!, i);
  }
  return out;
}

describe("mesh recognition scores (#439)", () => {
  it("finds every hole on the plate, at each quality and when turned, with none false", () => {
    const { shape, truth } = plate();
    const rows: string[] = [];
    for (const [name, d] of QUALITY) {
      const t = triangles(oc, shape, d);
      for (const [variant, tris, move] of [
        ["as made", t, undefined],
        ["turned", turned(t).t, turned(t).move],
        ["through an STL file", readStl(writeStl("plate", [{ name: "plate", triangles: t }])), undefined],
      ] as const) {
        const r = recognise(tris);
        const s = score(r, truth, move);
        rows.push(
          `${name.padEnd(7)} ${variant.padEnd(20)} ${String(tris.length / 9).padStart(6)} tris  found ${s.found}/${truth.length}  wrong ${s.wrong}  size ±${s.size.toFixed(4)}  depth ±${s.depth.toFixed(4)}  surface ${(r.coverage * 100).toFixed(0)}%`,
        );
        expect(s, `${name}, ${variant}`).toMatchObject({ found: truth.length, missed: 0, wrong: 0 });
        expect(s.size).toBeLessThan(0.05);
        expect(s.depth).toBeLessThan(0.1);
        expect(r.coverage).toBeGreaterThan(0.99);
      }
    }
    console.log(rows.join("\n"));
  }, 30_000);

  it("still finds them on a shaken mesh, once the tolerance is loosened", () => {
    const { shape, truth } = plate();
    const t = shaken(triangles(oc, shape, 0.05), 0.01);
    expect(score(recognise(t), truth).found).toBeLessThan(truth.length);
    const s = score(recognise(t, { tol: 0.05, flat: 6 }), truth);
    console.log("shaken 0.01 mm:", JSON.stringify(s));
    // The plain holes are found and sized. Counterbores and countersinks need a cleaner mesh: they are listed, but
    // not as holes a step can make.
    expect(s.found).toBeGreaterThanOrEqual(5);
    expect(s.size).toBeLessThan(0.05);
    expect(s.depth).toBeLessThan(0.1);
  }, 30_000);

  it("does not call these holes: a boss, a square hole", () => {
    let s = box(oc, { x: 40, y: 30, z: 6 });
    const boss = place(oc, cylinder(oc, { x: 8, y: 8, z: 5 }), { position: { x: 10, y: 0, z: 6 } });
    s = boolean(oc, "join", s, [boss]);
    s = boolean(oc, "cut", s, [place(oc, box(oc, { x: 5, y: 5, z: 20 }), { position: { x: -10, y: 0, z: -5 } })]);
    const r = recognise(triangles(oc, s, 0.05));
    expect(r.holes).toEqual([]);
    // The boss is a round face, and its rims are round edges.
    expect(r.faces.filter((f) => f.full && !f.concave)).toHaveLength(1);
    expect(r.faces[0]!.radius[0]).toBeCloseTo(4, 3);
    expect(r.edges.some((e) => Math.abs(e.radius - 4) < 1e-3 && e.full)).toBe(true);
  }, 30_000);

  it("reads the bore of a tube as a hole right through, and leaves a pin in a pocket alone", () => {
    let tube = cylinder(oc, { x: 20, y: 20, z: 12 });
    tube = holes(oc, tube, { frame: TOP(12), points: [[0, 0]], diameter: 6, depth: null });
    const r = recognise(triangles(oc, tube, 0.05));
    expect(r.holes).toHaveLength(1);
    expect(r.holes[0]).toMatchObject({ step: true, depth: null, normal: [0, 0, 1] });
    expect(r.holes[0]!.diameter).toBeCloseTo(6, 3);
    let pocket = box(oc, { x: 30, y: 30, z: 10 });
    pocket = holes(oc, pocket, { frame: TOP(10), points: [[0, 0]], diameter: 16, depth: 6 });
    pocket = boolean(oc, "join", pocket, [place(oc, cylinder(oc, { x: 5, y: 5, z: 6 }), { position: { x: 0, y: 0, z: 4 } })]);
    const p = recognise(triangles(oc, pocket, 0.05));
    expect(p.holes).toHaveLength(1);
    expect(p.holes[0]).toMatchObject({ step: false });
  }, 30_000);

  it("a recognised hole plugs and re-cuts to a true cylinder", () => {
    const { shape, truth } = plate();
    const exact = measure(oc, shape).volume;
    const t = triangles(oc, shape, 0.05);
    const mesh = meshSolid(oc, t);
    const r = recognise(t);
    const before = count(oc, mesh.shape, "face");
    let s = plug(
      oc,
      mesh.shape,
      r.holes.flatMap((h) => h.plugs),
    );
    // A plain block again: six flat faces.
    expect(count(oc, s, "face")).toBe(6);
    expect(before).toBeGreaterThan(100);
    expect(measure(oc, s).volume).toBeCloseTo(40 * 30 * 6, 6);
    for (const g of r.groups)
      s = holes(oc, s, { frame: g.frame as unknown as HoleSpec["frame"], points: g.points, diameter: g.diameter, depth: g.depth, head: g.head });
    expect(valid(oc, s)).toBe(true);
    // The same part as the one the mesh was made from, to a thousandth of its volume (hole sizes are read to a
    // millionth of a mm, not exactly).
    expect(Math.abs(measure(oc, s).volume - exact) / exact).toBeLessThan(1e-5);
    expect(r.groups.reduce((n, g) => n + g.points.length, 0)).toBe(truth.length);
    // Four corner holes share one step.
    expect(r.groups.some((g) => g.points.length === 4)).toBe(true);
  }, 30_000);

  it("reads half a million triangles in a few seconds", () => {
    // A slab with a grid of 48-sided holes, written straight out as triangles (meshing it would take a minute).
    const out: number[] = [];
    const [N, G, R, P, H] = [48, 42, 2, 10, 6];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let gx = 0; gx < G; gx++)
      for (let gy = 0; gy < G; gy++) {
        const [cx, cy] = [gx * P, gy * P];
        const edge = (t: number) => {
          const [c, s] = [Math.cos(t), Math.sin(t)];
          const m = Math.max(Math.abs(c), Math.abs(s));
          return [cx + ((c / m) * P) / 2, cy + ((s / m) * P) / 2];
        };
        for (let i = 0; i < N; i++) {
          const [t0, t1] = [(i / N) * 2 * Math.PI, ((i + 1) / N) * 2 * Math.PI];
          const [p0, p1] = [
            [cx + R * Math.cos(t0), cy + R * Math.sin(t0)],
            [cx + R * Math.cos(t1), cy + R * Math.sin(t1)],
          ];
          const [q0, q1] = [edge(t0), edge(t1)];
          quad([...p0, H], [...q0, H], [...q1, H], [...p1, H]);
          quad([...p0, 0], [...p1, 0], [...q1, 0], [...q0, 0]);
          quad([...p0, 0], [...p0, H], [...p1, H], [...p1, 0]);
        }
      }
    const t = Float32Array.from(out);
    const t0 = performance.now();
    const r = recognise(t);
    const ms = performance.now() - t0;
    console.log(`big mesh: ${t.length / 9} triangles, ${r.holes.length} holes, ${ms.toFixed(0)} ms`);
    expect(t.length / 9).toBeGreaterThan(500_000);
    expect(r.holes).toHaveLength(G * G);
    expect(r.holes.every((h) => h.step && h.depth === null && Math.abs(h.diameter - 4) < 1e-4)).toBe(true);
    // The slab's sides are left open here, and that is reported.
    expect(r.openEdges).toBeGreaterThan(0);
    expect(ms).toBeLessThan(15_000);
  }, 60_000);
});
