import { describe, expect, it } from "vitest";
import { facetsOf, weld } from "./mesh";
import { recognise } from "./index";

/** A prism 5 mm thick with an n-sided hole through it, as triangles. Its outside has n corners on a 20 mm square. */
function holed(n: number, r = 3): Float32Array {
  const out: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  const edge = (t: number) => {
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const m = Math.max(Math.abs(c), Math.abs(s));
    return [(c / m) * 10, (s / m) * 10];
  };
  for (let i = 0; i < n; i++) {
    const [t0, t1] = [(i / n) * 2 * Math.PI, ((i + 1) / n) * 2 * Math.PI];
    const [p0, p1, q0, q1] = [[r * Math.cos(t0), r * Math.sin(t0)], [r * Math.cos(t1), r * Math.sin(t1)], edge(t0), edge(t1)];
    quad([...p0, 5], [...q0, 5], [...q1, 5], [...p1, 5]);
    quad([...p0, 0], [...p1, 0], [...q1, 0], [...q0, 0]);
    quad([...p0, 0], [...p0, 5], [...p1, 5], [...p1, 0]);
    quad([...q0, 0], [...q1, 0], [...q1, 5], [...q0, 5]);
  }
  return Float32Array.from(out);
}

describe("mesh regions (#440)", () => {
  it("welds a closed mesh and gathers its flat faces", () => {
    const m = weld(holed(16));
    expect(m.openEdges).toBe(0);
    expect(m.manyEdges).toBe(0);
    expect(m.flipped).toBe(false);
    const f = facetsOf(m, (0.5 * Math.PI) / 180, 0.005);
    // Top, bottom, four sides and sixteen strips of wall.
    expect(f.facets).toHaveLength(6 + 16);
    expect(f.facets.filter((x) => x.tris.length > 2)).toHaveLength(6);
  });

  it("gives the same answer every time", () => {
    expect(JSON.stringify(recognise(holed(24)))).toBe(JSON.stringify(recognise(holed(24))));
  });

  it("reads an inside-out mesh the right way round", () => {
    const t = holed(16);
    const flipped = new Float32Array(t.length);
    for (let i = 0; i < t.length; i += 9) {
      flipped.set(t.subarray(i, i + 3), i);
      flipped.set(t.subarray(i + 6, i + 9), i + 3);
      flipped.set(t.subarray(i + 3, i + 6), i + 6);
    }
    expect(weld(flipped).flipped).toBe(true);
    expect(recognise(flipped).holes).toHaveLength(1);
  });

  it("calls eight sides a hole, and six a pocket", () => {
    const eight = recognise(holed(8));
    expect(eight.holes).toHaveLength(1);
    expect(eight.holes[0]!.diameter).toBeCloseTo(6, 6);
    expect(eight.holes[0]).toMatchObject({ step: true, depth: null, normal: [0, 0, 1] });
    expect(Math.hypot(...eight.holes[0]!.origin.map((v, i) => v - [0, 0, 5][i]!))).toBeLessThan(1e-9);
    const six = recognise(holed(6));
    expect(six.holes).toEqual([]);
    expect(six.faces).toEqual([]);
    expect(six.coverage).toBeCloseTo(1, 6);
  });

  it("reports gaps", () => {
    const t = holed(16);
    expect(weld(t.subarray(0, t.length - 18)).openEdges).toBeGreaterThan(0);
  });
});
