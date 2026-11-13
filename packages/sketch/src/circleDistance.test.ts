import { beforeAll, describe, expect, it } from "vitest";
import { Solver } from "./solver";
import { newSketch, SketchIndex, type Circle, type Sketch } from "./model";
import { Draft } from "./draw";
import { edgeGap, measureDimension } from "./measure";
import { freedom } from "./dof";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});

/** Two circles, R 5 fixed at the origin and R 3 free at (20, 4), both radii set. */
function twoCircles(): { d: Draft; a: string; b: string } {
  const d = new Draft(newSketch());
  const a = d.circle([0, 0], 5);
  const b = d.circle([20, 4], 3);
  const s = d.done().sketch;
  const ca = (s.entities.find((e) => e.id === a) as Circle).c;
  d.constrain({ type: "fix", p: ca });
  d.dimension("radius", [a], 5);
  d.dimension("radius", [b], 3);
  return { d, a, b };
}

const centreOf = (s: Sketch, id: string) => new SketchIndex(s).xy((s.entities.find((e) => e.id === id) as Circle).c);
const gapOf = (c: [number, number]) => Math.hypot(c[0], c[1]);

describe("distances to circles", () => {
  it("between two circles' centres", () => {
    const { d, a, b } = twoCircles();
    d.dimension("distance", [a, b], 30);
    const r = solver.solve(d.done().sketch);
    expect(r.status).toBe("ok");
    expect(gapOf(centreOf(r.sketch, b))).toBeCloseTo(30, 6);
    expect(measureDimension(r.sketch, r.sketch.dimensions.at(-1)!)).toBeCloseTo(30, 6);
  });

  it("across and up between centres", () => {
    const { d, a, b } = twoCircles();
    d.dimension("distanceX", [a, b], 25);
    d.dimension("distanceY", [a, b], 7);
    const r = solver.solve(d.done().sketch);
    expect(r.status).toBe("ok");
    expect(r.dof).toBe(0);
    const c = centreOf(r.sketch, b);
    expect(c[0]).toBeCloseTo(25, 6);
    expect(c[1]).toBeCloseTo(7, 6);
  });

  it("the gap between two circles' edges", () => {
    const { d, a, b } = twoCircles();
    d.dimension("distance", [a, b], 4, { edges: true });
    const r = solver.solve(d.done().sketch);
    expect(r.status).toBe("ok");
    // 5 + 4 + 3 between the centres.
    expect(gapOf(centreOf(r.sketch, b))).toBeCloseTo(12, 6);
    const dm = r.sketch.dimensions.at(-1)!;
    expect(measureDimension(r.sketch, dm)).toBeCloseTo(4, 6);
    const g = edgeGap(r.sketch, dm)!;
    expect(Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1])).toBeCloseTo(4, 6);
    // Only the turn round the fixed circle is left free.
    expect(freedom(r.sketch).dof).toBe(1);
    expect(r.dof).toBe(1);
  });

  it("the gap inside a bigger circle, to a smaller one in it", () => {
    const d = new Draft(newSketch());
    const a = d.circle([0, 0], 20);
    const b = d.circle([6, 0], 3);
    const ca = (d.done().sketch.entities.find((e) => e.id === a) as Circle).c;
    d.constrain({ type: "fix", p: ca });
    d.dimension("radius", [a], 20);
    d.dimension("radius", [b], 3);
    d.dimension("distance", [a, b], 2, { edges: true });
    const r = solver.solve(d.done().sketch);
    expect(r.status).toBe("ok");
    expect(gapOf(centreOf(r.sketch, b))).toBeCloseTo(15, 6);
    expect(measureDimension(r.sketch, r.sketch.dimensions.at(-1)!)).toBeCloseTo(2, 6);
  });

  it("the gap from a circle's edge to a line, and from a point to a circle's edge", () => {
    const d = new Draft(newSketch());
    const c = d.circle([0, 10], 4);
    const l = d.line([-20, 0], [20, 0], { auto: false });
    const p = d.point([12, 10]);
    const s0 = d.done().sketch;
    const idx = new SketchIndex(s0);
    const line = idx.get(l) as { a: string; b: string };
    d.constrain({ type: "fix", p: line.a });
    d.constrain({ type: "fix", p: line.b });
    d.dimension("radius", [c], 4);
    d.dimension("distance", [c, l], 3, { edges: true });
    d.dimension("distance", [p, c], 6, { edges: true });
    const r = solver.solve(d.done().sketch);
    expect(r.status).toBe("ok");
    expect(centreOf(r.sketch, c)[1]).toBeCloseTo(7, 6);
    const [dl, dp] = r.sketch.dimensions.slice(-2);
    expect(measureDimension(r.sketch, dl!)).toBeCloseTo(3, 6);
    expect(measureDimension(r.sketch, dp!)).toBeCloseTo(6, 6);
  });

  it("a point to a circle's centre, and a circle's centre to a line", () => {
    const d = new Draft(newSketch());
    const c = d.circle([3, 9], 2);
    const l = d.line([-20, 0], [20, 0], { auto: false });
    const p = d.point([0, 0]);
    const s0 = d.done().sketch;
    const line = new SketchIndex(s0).get(l) as { a: string; b: string };
    d.constrain({ type: "fix", p: line.a });
    d.constrain({ type: "fix", p: line.b });
    d.dimension("distance", [c, l], 12);
    const r = solver.solve(d.done().sketch);
    expect(r.status).toBe("ok");
    expect(centreOf(r.sketch, c)[1]).toBeCloseTo(12, 6);
    expect(measureDimension(r.sketch, { kind: "distance", refs: [p, c] })).toBeCloseTo(Math.hypot(...centreOf(r.sketch, c)), 6);
  });
});
