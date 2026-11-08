import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "../occt/oc";
import { boolean, box, place, sphere, wedge, type TopoDS_Shape } from "../occt/shapes";
import { tessellate } from "../occt/tessellate";
import { apply, convexHull, eulerMatrix, matrixEuler, mul, orientationFacts, suggestOrientations, turnDown, turnPlacement } from "./orient";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const mesh = (s: TopoDS_Shape, q: "fast" | "fine" = "fast") => tessellate(oc, s, q);
const near = (a: number[], b: number[], d = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, -Math.log10(d)));

describe("turns", () => {
  it("takes any direction to straight down", () => {
    for (const n of [
      [0, 0, -1],
      [0, 0, 1],
      [1, 0, 0],
      [0, -1, 0],
      [0.6, 0, 0.8],
      [-0.48, 0.6, -0.64],
    ] as [number, number, number][]) {
      near(apply(turnDown(n), n), [0, 0, -1]);
    }
  });

  it("reads a part's angles back from its matrix", () => {
    for (const r of [
      { x: 0, y: 0, z: 0 },
      { x: 30, y: -20, z: 75 },
      { x: 90, y: 0, z: 0 },
      { x: -120, y: 45, z: 170 },
    ]) {
      const back = matrixEuler(eulerMatrix(r));
      near(eulerMatrix(back).flat(), eulerMatrix(r).flat());
    }
    // At the lock (y = ±90°) the matrix still comes back the same.
    const lock = { x: 20, y: 90, z: 10 };
    near(eulerMatrix(matrixEuler(eulerMatrix(lock))).flat(), eulerMatrix(lock).flat());
  });

  it("turns a placement about the origin", () => {
    const turn = turnDown([1, 0, 0]);
    const out = turnPlacement({ position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }, turn);
    near([out.position.x, out.position.y, out.position.z], [0, 0, -10]);
    near(eulerMatrix(out.rotation).flat(), mul(turn, eulerMatrix({ x: 0, y: 0, z: 0 })).flat());
  });
});

describe("convex hull", () => {
  it("wraps a cube and ignores the points inside", () => {
    const pts: [number, number, number][] = [];
    for (const x of [0, 10]) for (const y of [0, 10]) for (const z of [0, 10]) pts.push([x, y, z]);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 9.8 + 0.1;
    for (let i = 0; i < 500; i++) pts.push([rnd(), rnd(), rnd()]);
    const hull = convexHull(pts);
    expect(hull.reduce((s, f) => s + f.area, 0)).toBeCloseTo(600, 6);
    // Every face's normal points out: the centre is behind it.
    for (const f of hull) expect(f.n[0] * (5 - f.a[0]) + f.n[1] * (5 - f.a[1]) + f.n[2] * (5 - f.a[2])).toBeLessThan(0);
  });

  it("wraps a sphere's points", () => {
    const m = mesh(sphere(oc, { x: 20, y: 20, z: 20 }));
    const pts: [number, number, number][] = [];
    for (let i = 0; i < m.positions.length; i += 3) pts.push([m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!]);
    const area = convexHull(pts).reduce((s, f) => s + f.area, 0);
    // Just under the true sphere's 4πr².
    expect(area).toBeLessThan(4 * Math.PI * 100);
    expect(area).toBeGreaterThan(4 * Math.PI * 100 * 0.95);
  });
});

describe("orientation suggestions", () => {
  it("puts a wedge's largest flat face down", () => {
    // 40 × 20 × 10: the slope (about 825 mm²) is a little larger than the bottom (800 mm²).
    const m = mesh(wedge(oc, { x: 40, y: 20, z: 10 }));
    const [best, ...rest] = suggestOrientations([m]);
    expect(best!.contact).toBeCloseTo(Math.hypot(40, 10) * 20, 0);
    expect(best!.current).toBe(false);
    expect(best!.overhang).toBeLessThan(1);
    expect(rest.length).toBe(2);
    // As modelled it sits on its bottom: that is a suggestion too, marked as how it is now.
    const now = suggestOrientations([m], { count: 10 }).find((o) => o.current);
    expect(now!.contact).toBeCloseTo(800, 0);
  });

  it("prefers an L bracket's long flat side to its thin edge", () => {
    // Base 40 × 30 × 4 on the bed, an upright 4 × 30 × 40 at its −X end.
    const base = box(oc, { x: 40, y: 30, z: 4 });
    const upright = place(oc, box(oc, { x: 4, y: 30, z: 40 }), { position: { x: -18, y: 0, z: 0 } });
    const m = mesh(boolean(oc, "join", base, [upright]));
    const all = suggestOrientations([m], { count: 20 });
    const best = all[0]!;
    expect(best.contact).toBeGreaterThan(1000);
    expect(Math.abs(best.down[1])).toBeLessThan(0.01);
    const edge = all.find((o) => Math.abs(o.down[1]) > 0.99)!;
    expect(edge.score).toBeLessThan(best.score);
    expect(orientationFacts(best)).toMatch(/^Contact 1,200 mm², overhang \d+ mm², height \d+(\.\d)? mm$/);
  });

  it("scores a curved body of many triangles quickly", () => {
    const m = mesh(sphere(oc, { x: 80, y: 80, z: 80 }), "fine");
    const tris = m.indices.length / 3;
    // Warm up once, then take the faster of two timed runs, so a busy moment on a shared runner doesn't count.
    expect(suggestOrientations([m]).length).toBeGreaterThan(0);
    let ms = Infinity;
    for (let i = 0; i < 2; i++) {
      const t = performance.now();
      suggestOrientations([m]);
      ms = Math.min(ms, performance.now() - t);
    }
    // The budget is 1 s for 100k triangles; shared CI runners are slower, so this only catches a step change.
    expect(ms / tris).toBeLessThan(0.03);
    // Meshing the sphere and three runs can pass 5 s on a busy runner; the speed check is the line above.
  }, 30_000);
});
