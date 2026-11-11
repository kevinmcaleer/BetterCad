import { beforeAll, describe, expect, it } from "vitest";
import { Draft, drawLine, drawSpline } from "./draw";
import { trimAt } from "./edit";
import { SketchIndex, newSketch, removeEntities, type Sketch, type Spline, type Vec2 } from "./model";
import { profiles, regions } from "./profiles";
import { Solver } from "./solver";
import { fitSpline, sampleSpline, splineDeriv, splineGeo, splineParam, splinePieces, splinePoint } from "./spline";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});

const PTS: Vec2[] = [
  [0, 0],
  [10, 5],
  [20, 0],
  [30, 8],
];
const unit = (v: Vec2): Vec2 => {
  const n = Math.hypot(v[0], v[1]);
  return [v[0] / n, v[1] / n];
};

describe("fitSpline", () => {
  it("passes through every fit point, smoothly", () => {
    const g = fitSpline(PTS);
    expect(g.bez).toHaveLength(3);
    PTS.forEach((p, i) => {
      const q = splinePoint(g, i);
      expect(q[0]).toBeCloseTo(p[0], 9);
      expect(q[1]).toBeCloseTo(p[1], 9);
    });
    // The same way either side of each inner point.
    for (const i of [1, 2]) {
      const a = unit(splineDeriv(g, i - 1e-9));
      const b = unit(splineDeriv(g, i + 1e-9));
      expect(a[0]).toBeCloseTo(b[0], 6);
      expect(a[1]).toBeCloseTo(b[1], 6);
    }
  });

  it("leaves along a given direction", () => {
    const g = fitSpline(PTS, false, [0, 1], [1, 0]);
    const [s, e] = [unit(splineDeriv(g, 0)), unit(splineDeriv(g, 3))];
    expect(s[0]).toBeCloseTo(0, 6);
    expect(s[1]).toBeCloseTo(1, 6);
    expect(e[0]).toBeCloseTo(1, 6);
    expect(e[1]).toBeCloseTo(0, 6);
  });

  it("closes smoothly", () => {
    const g = fitSpline(PTS, true);
    expect(g.bez).toHaveLength(4);
    const a = unit(splineDeriv(g, 0));
    const b = unit(splineDeriv(g, 4 - 1e-9));
    expect(a[0]).toBeCloseTo(b[0], 5);
    expect(a[1]).toBeCloseTo(b[1], 5);
  });

  it("finds the nearest point's parameter", () => {
    const g = fitSpline(PTS);
    const p = splinePoint(g, 1.37);
    const r = splineParam(g, p);
    expect(r.t).toBeCloseTo(1.37, 6);
    expect(r.d).toBeLessThan(1e-9);
  });
});

/** A closed 5-point spline round the origin, like a pebble. */
function pebble(): { s: Sketch; id: string } {
  const r = drawSpline(
    newSketch(),
    [
      [10, 0],
      [3, 9],
      [-8, 6],
      [-8, -6],
      [3, -9],
    ],
    true,
  )!;
  return { s: r.sketch, id: r.ids[0]! };
}

describe("splines in profiles", () => {
  it("a closed spline is one profile", () => {
    const { s } = pebble();
    const p = profiles(s);
    expect(p.profiles).toHaveLength(1);
    expect(p.profiles[0]!.area).toBeGreaterThan(200);
    expect(p.profiles[0]!.area).toBeLessThan(400);
  });

  it("an open spline closed by a line is one profile", () => {
    const r = drawSpline(newSketch(), PTS)!;
    const sp = r.sketch.entities.find((e) => e.kind === "spline") as Spline;
    const closed = drawLine(r.sketch, sp.pts[3]!, sp.pts[0]!).sketch;
    const p = profiles(closed);
    expect(p.profiles).toHaveLength(1);
    expect(p.openEnds).toEqual([]);
  });

  it("a line across a closed spline splits it into two regions", () => {
    const { s } = pebble();
    const cut = drawLine(s, [0, -20], [0, 20]).sketch;
    const parts = regions(cut, { split: true });
    expect(parts).toHaveLength(2);
    const total = parts.reduce((n, p) => n + p.area, 0);
    expect(total).toBeCloseTo(profiles(s).profiles[0]!.area, 0);
  });
});

describe("splines in edits", () => {
  it("trims the piece a line cuts off an open spline's end", () => {
    const r = drawSpline(newSketch(), PTS)!;
    const s = drawLine(r.sketch, [5, -10], [5, 20]).sketch;
    const out = trimAt(s, r.ids[0]!, [1, 0.5]) as Sketch;
    expect(typeof out).toBe("object");
    const left = out.entities.filter((e): e is Spline => e.kind === "spline");
    expect(left).toHaveLength(1);
    const g = splineGeo(new SketchIndex(out), left[0]!);
    expect(splinePoint(g, 0)[0]).toBeCloseTo(5, 4);
    expect(splinePoint(g, g.bez.length)[0]).toBeCloseTo(30, 6);
  });

  it("a spline goes with its fit points", () => {
    const { s, id } = pebble();
    const out = removeEntities(s, [id]);
    expect(out.entities).toHaveLength(0);
  });
});

describe("tangent ends", () => {
  /** A level line ending at the origin, and a spline carrying on from it. */
  function lineThenSpline(): { s: Sketch; spline: string; line: string } {
    const d = new Draft(newSketch());
    const start = d.point([0, 0]);
    const line = d.line([-10, 0], start, { auto: false });
    d.constrain({ type: "fix", p: (d.entities.find((e) => e.id === line) as { a: string }).a });
    d.constrain({ type: "fix", p: start });
    const spline = d.spline([start, [10, 6], [20, 2]]);
    d.constrain({ type: "tangent", a: spline, b: line });
    return { s: d.done().sketch, spline, line };
  }

  it("leaves along the line it is tangent to", () => {
    const { s, spline } = lineThenSpline();
    const g = splineGeo(new SketchIndex(s), s.entities.find((e) => e.id === spline) as Spline);
    const d = unit(splineDeriv(g, 0));
    expect(d[0]).toBeCloseTo(1, 9);
    expect(d[1]).toBeCloseTo(0, 9);
  });

  it("stays tangent when a fit point is dragged", () => {
    const { s, spline } = lineThenSpline();
    const sp = s.entities.find((e) => e.id === spline) as Spline;
    const r = solver.drag(s, sp.pts[1]!, [12, 15]);
    expect(r.status).toBe("ok");
    const idx = new SketchIndex(r.sketch);
    expect(idx.xy(sp.pts[1]!)).toEqual([12, 15]);
    const d = unit(splineDeriv(splineGeo(idx, sp), 0));
    expect(d[0]).toBeCloseTo(1, 9);
    expect(d[1]).toBeCloseTo(0, 9);
  });

  it("drawing from a line's end nearly straight on makes it tangent", () => {
    const l = drawLine(newSketch(), [-10, 0], [0, 0]);
    const end = (l.sketch.entities.find((e) => e.id === l.ids[0]) as { b: string }).b;
    const r = drawSpline(l.sketch, [end, [10, 1.5], [20, 0]])!;
    expect(r.sketch.constraints.some((c) => c.type === "tangent" && c.a === r.ids[0])).toBe(true);
    const sharp = drawSpline(l.sketch, [end, [3, 10], [20, 0]])!;
    expect(sharp.sketch.constraints.some((c) => c.type === "tangent")).toBe(false);
  });

  it("samples a closed spline round to its start", () => {
    const g = fitSpline(PTS, true);
    const pts = sampleSpline(g);
    expect(pts[pts.length - 1]![0]).toBeCloseTo(pts[0]![0], 9);
  });
});

describe("splinePieces", () => {
  it("cuts out the exact piece between two parameters", () => {
    const g = fitSpline(PTS);
    const { bez: parts, knots } = splinePieces(g, 0.4, 2.25);
    expect(knots).toHaveLength(4);
    expect(parts).toHaveLength(3);
    const a = splinePoint(g, 0.4);
    const b = splinePoint(g, 2.25);
    expect(parts[0]![0][0]).toBeCloseTo(a[0], 12);
    expect(parts[2]![3][1]).toBeCloseTo(b[1], 12);
    // The middle of the first part is on the curve.
    const sub = { bez: parts, closed: false };
    const m = splinePoint(sub, 0.5);
    expect(splineParam(g, m).d).toBeLessThan(1e-9);
  });
  it("runs round the start of a closed spline", () => {
    const g = fitSpline(PTS, true);
    const parts = splinePieces(g, 3.5, 4.5).bez;
    expect(parts).toHaveLength(2);
    expect(parts[1]![3][0]).toBeCloseTo(splinePoint(g, 0.5)[0], 12);
  });
});
