import { beforeAll, describe, expect, it } from "vitest";
import { SketchIndex, ellipseGeo, newSketch, removeEntities, type Ellipse, type Sketch } from "./model";
import { Draft, drawEllipse } from "./draw";
import { Solver } from "./solver";
import { profiles, regions } from "./profiles";
import { allCrossings, trimAt } from "./edit";
import { lineEllipse } from "./ellipse";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});

const ellipseOf = (s: Sketch) => s.entities.find((e): e is Ellipse => e.kind === "ellipse")!;
const geo = (s: Sketch) => ellipseGeo(new SketchIndex(s), ellipseOf(s));

describe("ellipse (#401)", () => {
  it("draws from a centre, an axis end and the other axis's reach, with typed widths as dimensions", () => {
    const r = drawEllipse(newSketch(), [0, 0], [12, 0.4], [0, 3], { first: 20, second: 8 })!;
    const e = ellipseOf(r.sketch);
    expect(r.ids).toEqual([e.id, e.ax1, e.ax2]);
    expect(r.sketch.entities.filter((x) => x.kind === "line").every((l) => l.construction)).toBe(true);
    // Drawn nearly level, the first axis is made level.
    expect(r.sketch.constraints.map((c) => c.type)).toEqual(["horizontal"]);
    expect(r.sketch.dimensions.map((d) => `${d.kind} ${d.value}`)).toEqual(["length 20", "length 8"]);
    const g = geo(r.sketch);
    expect(g.r1).toBeCloseTo(10, 9);
    expect(g.r2).toBeCloseTo(4, 9);
    expect(drawEllipse(newSketch(), [0, 0], [0, 0], [0, 3])).toBeNull();
    expect(drawEllipse(newSketch(), [0, 0], [5, 0], [9, 0])).toBeNull();
  });

  it("is one closed profile with an ellipse's area", () => {
    const r = drawEllipse(newSketch(), [0, 0], [10, 0], [0, 4])!;
    const p = profiles(r.sketch).profiles;
    expect(p).toHaveLength(1);
    expect(p[0]!.area).toBeCloseTo(Math.PI * 40, 6);
    expect(p[0]!.edges).toEqual([{ id: ellipseOf(r.sketch).id, reversed: false }]);
  });

  it("solves fully placed once its centre is fixed and both axes sized", () => {
    const r = drawEllipse(newSketch(), [0, 0], [12, 0.4], [0, 3], { first: 20, second: 8 })!;
    let res = solver.solve(r.sketch);
    expect(res.status).toBe("ok");
    expect(res.dof).toBe(2);
    const d = new Draft(r.sketch);
    d.constrain({ type: "fix", p: ellipseOf(r.sketch).c });
    res = solver.solve(d.done().sketch);
    expect(res.status).toBe("ok");
    expect(res.dof).toBe(0);
    expect(res.fixed.has(ellipseOf(r.sketch).id)).toBe(true);
    const g = geo(res.sketch);
    expect(g.r1).toBeCloseTo(10, 6);
    expect(g.r2).toBeCloseTo(4, 6);
  });

  it("stays an ellipse when an axis end is dragged: the axes still cross square at the centre", () => {
    const r = drawEllipse(newSketch(), [0, 0], [10, 3], [0, 4])!;
    const e = ellipseOf(r.sketch);
    const ax2 = r.sketch.entities.find((x) => x.id === e.ax2) as { b: string };
    const res = solver.drag(r.sketch, ax2.b, [-1, 7]);
    expect(res.status).toBe("ok");
    const idx = new SketchIndex(res.sketch);
    const line = (id: string) => {
      const l = idx.get(id) as { a: string; b: string };
      return [idx.xy(l.a), idx.xy(l.b)] as const;
    };
    const [a, b] = line(e.ax1);
    const [p, q] = line(e.ax2);
    const c = idx.xy(e.c);
    expect((a[0] + b[0]) / 2).toBeCloseTo(c[0], 6);
    expect((p[1] + q[1]) / 2).toBeCloseTo(c[1], 6);
    expect((b[0] - a[0]) * (q[0] - p[0]) + (b[1] - a[1]) * (q[1] - p[1])).toBeCloseTo(0, 6);
  });

  it("is cut by a line across it into two regions, and meets lines exactly", () => {
    const r = drawEllipse(newSketch(), [0, 0], [10, 0], [0, 4])!;
    const d = new Draft(r.sketch);
    const cutter = d.line([0, -6], [0, 6]);
    const s = d.done().sketch;
    const halves = regions(s, { split: true });
    expect(halves).toHaveLength(2);
    for (const h of halves) expect(h.area).toBeCloseTo(Math.PI * 20, 0);
    const across = allCrossings(s).filter((x) => [x.a, x.b].includes(ellipseOf(s).id) && [x.a, x.b].includes(cutter));
    expect(across.map((x) => x.xy.map((v) => Math.round(v * 1e6) / 1e6 + 0))).toEqual([
      [0, -4],
      [0, 4],
    ]);
    const g = geo(s);
    for (const p of lineEllipse([-20, 2], [20, 2], g)) expect((p[0] / 10) ** 2 + (p[1] / 4) ** 2).toBeCloseTo(1, 9);
  });

  it("goes whole with its axes when trimmed or deleted, and goes with an axis", () => {
    const r = drawEllipse(newSketch(), [0, 0], [10, 0], [0, 4])!;
    const e = ellipseOf(r.sketch);
    const trimmed = trimAt(r.sketch, e.id, [10, 0]);
    expect(typeof trimmed).toBe("object");
    expect((trimmed as Sketch).entities).toHaveLength(0);
    expect(removeEntities(r.sketch, [e.id]).entities).toHaveLength(0);
    const noAxis = removeEntities(r.sketch, [e.ax2]);
    expect(noAxis.entities.some((x) => x.kind === "ellipse")).toBe(false);
  });
});
