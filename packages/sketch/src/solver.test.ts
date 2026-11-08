import { beforeAll, describe, expect, it } from "vitest";
import { Solver } from "./solver";
import { newSketch, SketchIndex, type Sketch } from "./model";
import { Draft, drawCircle, drawPolygon, drawRectangle } from "./draw";
import { measureDimension } from "./measure";
import { slideAcross } from "./geom2d";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});

/** A rectangle fixed at one corner, 40 × 20. */
function rect(): { sketch: Sketch; lines: string[]; corner: string } {
  const r = drawRectangle(newSketch(), [0, 0], [38, 21], { width: 40, height: 20 });
  const corner = (r.sketch.entities.find((e) => e.id === r.ids[0]) as { a: string }).a;
  const d = new Draft(r.sketch);
  d.constrain({ type: "fix", p: corner });
  return { sketch: d.done().sketch, lines: r.ids, corner };
}

const corners = (s: Sketch) =>
  s.entities.filter((e) => e.kind === "point").map((p) => [Math.round((p as { x: number }).x * 1e6) / 1e6, Math.round((p as { y: number }).y * 1e6) / 1e6]);

describe("planegcs solver", () => {
  it("a fully constrained rectangle solves to its dimensions with 0 degrees of freedom", () => {
    const r = solver.solve(rect().sketch);
    expect(r.status).toBe("ok");
    expect(r.dof).toBe(0);
    expect(corners(r.sketch)).toEqual([
      [0, 0],
      [40, 0],
      [40, 20],
      [0, 20],
    ]);
    expect(r.fixed.size).toBe(r.sketch.entities.length);
    expect(r.ms).toBeLessThan(100);
  });

  it("removing one dimension leaves 1 degree of freedom, and only the free side is not fixed", () => {
    const { sketch, lines } = rect();
    const r = solver.solve({ ...sketch, dimensions: sketch.dimensions.slice(0, 1) });
    expect(r.status).toBe("ok");
    expect(r.dof).toBe(1);
    // The bottom is fixed (corner + width + horizontal); the top and sides can slide up and down.
    expect(r.fixed.has(lines[0]!)).toBe(true);
    expect(r.fixed.has(lines[2]!)).toBe(false);
  });

  it("a conflicting dimension is reported with the constraints it fights, and the sketch is left as it was", () => {
    const { sketch, lines } = rect();
    const d = new Draft(sketch);
    // The top must equal the bottom (40 mm), so 30 mm on it conflicts.
    const extra = d.dimension("length", [lines[2]!], 30);
    const r = solver.solve(d.done().sketch);
    expect(r.status).toBe("conflicting");
    expect(r.conflicting).toContain(extra);
    expect(corners(r.sketch)).toEqual(corners(d.done().sketch));
  });

  it("driven dimensions report what they measure", () => {
    const { sketch } = rect();
    const d = new Draft(sketch);
    const lines = sketch.entities.filter((e) => e.kind === "line");
    d.dimension("length", [lines[2]!.id], 999, { driving: false });
    const r = solver.solve(d.done().sketch);
    expect(r.status).toBe("ok");
    expect(r.sketch.dimensions.at(-1)!.value).toBeCloseTo(40, 6);
  });

  it("each constraint solves to the geometry it names", () => {
    const d = new Draft(newSketch());
    const l1 = d.line([0, 0], [10, 1], { auto: false });
    const l2 = d.line([0, 5], [9, 9], { auto: false });
    const c1 = d.circle([30, 0], 4);
    const c2 = d.circle([31, 1], 6);
    d.constrain({ type: "parallel", a: l1, b: l2 });
    d.constrain({ type: "equal", a: c1, b: c2 });
    d.constrain({ type: "concentric", a: c1, b: c2 });
    d.constrain({ type: "tangent", a: l1, b: c1 });
    const r = solver.solve(d.done().sketch);
    expect(r.status).toBe("ok");
    const idx = new SketchIndex(r.sketch);
    const L = (id: string) => {
      const l = idx.get(id) as { a: string; b: string };
      const a = idx.xy(l.a);
      const b = idx.xy(l.b);
      return [b[0] - a[0], b[1] - a[1]] as const;
    };
    const [u, v] = [L(l1), L(l2)];
    expect(u[0] * v[1] - u[1] * v[0]).toBeCloseTo(0, 6);
    const C = (id: string) => idx.get(id) as { c: string; r: number };
    expect(C(c1).r).toBeCloseTo(C(c2).r, 6);
    expect(idx.xy(C(c1).c)).toEqual(idx.xy(C(c2).c).map((x) => expect.closeTo(x, 6)));
    // Tangent: the circle's centre is one radius from the line.
    const l = idx.get(l1) as { a: string; b: string };
    const a = idx.xy(l.a);
    const cc = idx.xy(C(c1).c);
    const dist = Math.abs(u[0] * (cc[1] - a[1]) - u[1] * (cc[0] - a[0])) / Math.hypot(...u);
    expect(dist).toBeCloseTo(C(c1).r, 6);
  });

  it("symmetric points about a construction line, and a midpoint", () => {
    const d = new Draft(newSketch());
    const axis = d.line([0, -10], [0, 10], { construction: true, auto: false });
    for (const e of d.entities) if (e.kind === "point") d.constrain({ type: "fix", p: e.id });
    const p = d.point([-3, 1]);
    const q = d.point([5, 2]);
    d.constrain({ type: "symmetric", a: p, b: q, line: axis });
    const base = d.line([0, 0], [10, 0], { auto: false });
    const m = d.point([3, 3]);
    d.constrain({ type: "midpoint", p: m, line: base });
    const r = solver.solve(d.done().sketch);
    const idx = new SketchIndex(r.sketch);
    const [P, Q] = [idx.xy(p), idx.xy(q)];
    expect(P[0] + Q[0]).toBeCloseTo(0, 6);
    expect(P[1]).toBeCloseTo(Q[1], 6);
    const bl = idx.get(base) as { a: string; b: string };
    const M = idx.xy(m);
    expect(M[0]).toBeCloseTo((idx.xy(bl.a)[0] + idx.xy(bl.b)[0]) / 2, 6);
    expect(M[1]).toBeCloseTo((idx.xy(bl.a)[1] + idx.xy(bl.b)[1]) / 2, 6);
  });

  it("an angle dimension turns a line, and a polygon keeps equal sides", () => {
    const d = new Draft(newSketch());
    const h = d.line([0, 0], [10, 0]);
    const l = d.line([0, 0], [10, 4], { auto: false });
    d.dimension("angle", [h, l], 30);
    const r = solver.solve(d.done().sketch);
    expect(measureDimension(r.sketch, { kind: "angle", refs: [h, l] })).toBeCloseTo(30, 6);

    const poly = drawPolygon(newSketch(), [0, 0], 10, 6);
    const pr = solver.solve(poly.sketch);
    expect(pr.status).toBe("ok");
    // Centre, size and turn are free.
    expect(pr.dof).toBe(4);
  });

  it("dragging a point moves what the constraints allow", () => {
    const { sketch, corner } = rect();
    const free = { ...sketch, constraints: sketch.constraints.filter((c) => c.type !== "fix") };
    const pt = free.entities.find((e) => e.kind === "point" && e.id !== corner)!.id;
    const r = solver.drag(free, pt, [100, 50]);
    expect(r.status).toBe("ok");
    // The rectangle keeps its size and moves with the dragged corner.
    const xs = r.sketch.entities.filter((e) => e.kind === "point").map((p) => (p as { x: number }).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 6);
    expect(new SketchIndex(r.sketch).xy(pt)).toEqual([expect.closeTo(100, 6), expect.closeTo(50, 6)]);
  });

  it("dragging a line slides it square across, and the lines joined to it follow", () => {
    // A 40 × 20 rectangle, no sizes, bottom-left corner fixed: dragging the top line up makes it taller.
    const r = drawRectangle(newSketch(), [0, 0], [40, 20]);
    const lines = r.ids.map((id) => r.sketch.entities.find((e) => e.id === id) as { a: string; b: string });
    const d = new Draft(r.sketch);
    d.constrain({ type: "fix", p: lines[0]!.a });
    const sketch = d.done().sketch;
    const top = lines[2]!;
    const idx = new SketchIndex(sketch);
    // Grabbed at x 20, pulled up 10 and sideways 7: the sideways part does nothing.
    const [a, b] = slideAcross(idx.xy(top.a), idx.xy(top.b), [20, 20], [27, 30]);
    const moved = solver.dragPoints(sketch, [
      [top.a, a],
      [top.b, b],
    ]);
    expect(moved.status).toBe("ok");
    const after = new SketchIndex(moved.sketch);
    expect(after.xy(top.a)).toEqual([expect.closeTo(40, 6), expect.closeTo(30, 6)]);
    expect(after.xy(top.b)).toEqual([expect.closeTo(0, 6), expect.closeTo(30, 6)]);
    expect(after.xy(lines[0]!.a)).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6)]);

    // With its height sized the line can't move up, and the drag leaves it where it was.
    const { sketch: sized, lines: sizedLines } = rect();
    const topS = sized.entities.find((e) => e.id === sizedLines[2]) as { a: string; b: string };
    const si = new SketchIndex(sized);
    const [sa, sb] = slideAcross(si.xy(topS.a), si.xy(topS.b), [20, 20], [20, 30]);
    const held = solver.dragPoints(sized, [
      [topS.a, sa],
      [topS.b, sb],
    ]);
    expect(new SketchIndex(held.sketch).xy(topS.a)[1]).toBeCloseTo(20, 6);
  });

  it("solves a 200-circle sketch quickly", () => {
    let s = newSketch();
    for (let i = 0; i < 200; i++) s = drawCircle(s, [(i % 20) * 10, Math.floor(i / 20) * 10], 3, 4).sketch;
    const r = solver.solve(s);
    expect(r.status).toBe("ok");
    expect(r.dof).toBe(400);
  });
});
