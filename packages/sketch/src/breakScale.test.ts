import { beforeAll, describe, expect, it } from "vitest";
import { SketchIndex, newSketch, type Sketch } from "./model";
import { drawCircle, drawLine, drawRectangle, drawSpline } from "./draw";
import { breakAt, breakPreview, scaleShapes } from "./edits";
import { profiles } from "./profiles";
import { Solver } from "./solver";
import { dist } from "./geom2d";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});

const ok = (r: Sketch | string): Sketch => {
  if (typeof r === "string") throw new Error(r);
  return r;
};
const of = (s: Sketch, kind: string) => s.entities.filter((e) => e.kind === kind);

describe("break", () => {
  it("splits a line at the crossings either side of the pointer, into joined pieces that stay in line", () => {
    let s = drawLine(newSketch(), [0, 0], [30, 0]).sketch;
    s = drawLine(s, [10, -5], [10, 5]).sketch;
    s = drawLine(s, [20, -5], [20, 5]).sketch;
    const base = of(s, "line")[0]!;
    const pv = breakPreview(s, base.id, [15, 0])!;
    expect(pv.breaks.map((p) => p[0])).toEqual([10, 20]);
    const out = ok(breakAt(s, base.id, [15, 0]));
    const idx = new SketchIndex(out);
    const parts = of(out, "line").filter((l) => l.kind === "line" && Math.abs(idx.xy(l.a)[1]) + Math.abs(idx.xy(l.b)[1]) < 1e-9);
    expect(parts).toHaveLength(3);
    // Nothing is lost: the pieces run end to end and share their points.
    const lens = parts.map((l) => (l.kind === "line" ? dist(idx.xy(l.a), idx.xy(l.b)) : 0));
    expect(lens.reduce((a, b) => a + b)).toBeCloseTo(30);
    const first = idx.get(base.id)!;
    expect(first.kind === "line" && idx.xy(first.a)).toEqual([0, 0]);
    expect(out.constraints.filter((c) => c.type === "parallel")).toHaveLength(2);
    expect(solver.solve(out).status).toBe("ok");
  });

  it("breaks near an end into two, and refuses a line nothing crosses", () => {
    let s = drawLine(newSketch(), [0, 0], [30, 0]).sketch;
    s = drawLine(s, [10, -5], [10, 5]).sketch;
    const base = of(s, "line")[0]!;
    expect(of(ok(breakAt(s, base.id, [25, 0])), "line")).toHaveLength(3);
    const lone = drawLine(newSketch(), [0, 0], [5, 5]).sketch;
    expect(breakAt(lone, of(lone, "line")[0]!.id, [1, 1])).toBe("Nothing crosses it there to break it at");
    expect(breakPreview(lone, of(lone, "line")[0]!.id, [1, 1])).toBeNull();
  });

  it("breaks a circle crossed by a rectangle into two arcs of one radius, and keeps the profiles", () => {
    let s = drawCircle(newSketch(), [0, 0], 10).sketch;
    s = drawRectangle(s, [0, 0], [20, 20]).sketch;
    const circle = of(s, "circle")[0]!;
    const before = profiles(s).profiles.length;
    const out = ok(breakAt(s, circle.id, [7, 7]));
    const arcs = of(out, "arc");
    expect(arcs).toHaveLength(2);
    expect(out.constraints.some((c) => c.type === "equal")).toBe(true);
    // The two arcs share both ends.
    const [a, b] = arcs as Extract<(typeof arcs)[number], { kind: "arc" }>[];
    expect(a!.a).toBe(b!.b);
    expect(a!.b).toBe(b!.a);
    expect(profiles(out).profiles.length).toBeGreaterThanOrEqual(before);
    expect(solver.solve(out).status).toBe("ok");
    const once = drawCircle(newSketch(), [0, 0], 10).sketch;
    expect(breakAt(once, of(once, "circle")[0]!.id, [10, 0])).toBe("Break needs two shapes crossing a closed curve");
  });

  it("breaks a spline into two curves through the crossing", () => {
    let s = drawSpline(newSketch(), [
      [0, 0],
      [10, 5],
      [20, 0],
      [30, 5],
    ])!.sketch;
    s = drawLine(s, [15, -10], [15, 10]).sketch;
    const sp = of(s, "spline")[0]!;
    const out = ok(breakAt(s, sp.id, [5, 3]));
    const parts = of(out, "spline");
    expect(parts).toHaveLength(2);
    const [p, q] = parts as Extract<(typeof parts)[number], { kind: "spline" }>[];
    expect(p!.pts[p!.pts.length - 1]).toBe(q!.pts[0]);
  });
});

describe("sketch scale", () => {
  it("doubles a sized rectangle about its corner, sizes and all", () => {
    let s = drawRectangle(newSketch(), [0, 0], [20, 10], { width: 20, height: 10 }).sketch;
    const ids = of(s, "line").map((l) => l.id);
    s = ok(scaleShapes(s, ids, [0, 0], 2));
    const xs = of(s, "point").map((p) => (p.kind === "point" ? [p.x, p.y] : [0, 0]));
    expect(Math.max(...xs.map((p) => p[0]!))).toBeCloseTo(40);
    expect(Math.max(...xs.map((p) => p[1]!))).toBeCloseTo(20);
    expect(s.dimensions.map((d) => d.value).sort((a, b) => a - b)).toEqual([20, 40]);
    const solved = solver.solve(s);
    expect(solved.status).toBe("ok");
  });

  it("scales circles' radii, keeps formulas linked, and leaves unpicked shapes alone", () => {
    let s = drawCircle(newSketch(), [10, 0], 5, 10).sketch;
    s = { ...s, dimensions: s.dimensions.map((d) => ({ ...d, expression: "width" })) };
    s = drawLine(s, [50, 50], [60, 50]).sketch;
    const c = of(s, "circle")[0]!;
    const out = ok(scaleShapes(s, [c.id], [0, 0], 0.5));
    const idx = new SketchIndex(out);
    const cc = idx.get(c.id)!;
    expect(cc.kind === "circle" && cc.r).toBeCloseTo(2.5);
    expect(cc.kind === "circle" && idx.xy(cc.c)).toEqual([5, 0]);
    expect(out.dimensions[0]!.expression).toBe("(width) * 0.5");
    const l = of(out, "line")[0]!;
    expect(l.kind === "line" && idx.xy(l.a)).toEqual([50, 50]);
    expect(scaleShapes(s, [c.id], [0, 0], 0)).toBe("Type a scale above 0");
    expect(scaleShapes(s, [], [0, 0], 2)).toBe("Pick the shapes to scale");
  });
});
