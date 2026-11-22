import { beforeAll, describe, expect, it } from "vitest";
import { Draft, drawLine, drawSpline } from "./draw";
import { trimAt } from "./cut";
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

  /** Signed curvature of a piece at its start, or at its end walked backwards (so the sign flips there). */
  const bendAt = ([p0, p1, p2, p3]: [Vec2, Vec2, Vec2, Vec2], end: boolean): number => {
    const [a, b, c] = end ? [p3, p2, p1] : [p0, p1, p2];
    const d1: Vec2 = [3 * (b[0] - a[0]), 3 * (b[1] - a[1])];
    const d2: Vec2 = [6 * (a[0] - 2 * b[0] + c[0]), 6 * (a[1] - 2 * b[1] + c[1])];
    return (d1[0] * d2[1] - d1[1] * d2[0]) / Math.hypot(...d1) ** 3;
  };

  it("curvature on a line: tangent and straight where it leaves (G2)", () => {
    const { s, spline, line } = lineThenSpline();
    const tangent = splineGeo(new SketchIndex(s), s.entities.find((e) => e.id === spline) as Spline);
    expect(Math.abs(bendAt(tangent.bez[0]!, false))).toBeGreaterThan(0.01);
    const g2 = { ...s, constraints: s.constraints.map((c) => (c.type === "tangent" ? { ...c, type: "curvature" as const } : c)) };
    const g = splineGeo(new SketchIndex(g2), s.entities.find((e) => e.id === spline) as Spline);
    const d = unit(splineDeriv(g, 0));
    expect(d[0]).toBeCloseTo(1, 9);
    expect(d[1]).toBeCloseTo(0, 9);
    expect(bendAt(g.bez[0]!, false)).toBeCloseTo(0, 9);
    // Still through every fit point, and smooth where the pieces meet.
    expect(splinePoint(g, 2)).toEqual([20, 2].map((x) => expect.closeTo(x, 9)));
    const [a, b] = [unit(splineDeriv(g, 1 - 1e-9)), unit(splineDeriv(g, 1 + 1e-9))];
    expect(a[0]).toBeCloseTo(b[0], 6);
    expect(a[1]).toBeCloseTo(b[1], 6);
    expect(line).toBeTruthy();
  });

  it("curvature on an arc: bends as the arc does where they meet", () => {
    const d = new Draft(newSketch());
    // A quarter arc of radius 10 round the origin, from (10, 0) up to (0, 10); the spline carries on from its end.
    const arc = d.arc([0, 0], [10, 0], [0, 10]);
    const end = (d.entities.find((e) => e.id === arc) as { b: string }).b;
    const spline = d.spline([end, [-8, 14], [-15, 10], [-20, 4]]);
    d.constrain({ type: "curvature", a: spline, b: arc });
    const s = d.done().sketch;
    const g = splineGeo(new SketchIndex(s), s.entities.find((e) => e.id === spline) as Spline);
    // Leaving (0, 10) heading on anticlockwise: along -x, turning left at 1/10.
    const dir = unit(splineDeriv(g, 0));
    expect(dir[0]).toBeCloseTo(-1, 9);
    expect(dir[1]).toBeCloseTo(0, 9);
    expect(bendAt(g.bez[0]!, false)).toBeCloseTo(0.1, 6);
    // Arriving at the arc's start instead: the arc bends the same way.
    const d2 = new Draft(newSketch());
    const arc2 = d2.arc([0, 0], [10, 0], [0, 10]);
    const start = (d2.entities.find((e) => e.id === arc2) as { a: string }).a;
    const sp2 = d2.spline([[0, -20], [6, -12], start]);
    d2.constrain({ type: "curvature", a: sp2, b: arc2 });
    const s2 = d2.done().sketch;
    const g2 = splineGeo(new SketchIndex(s2), s2.entities.find((e) => e.id === sp2) as Spline);
    const last = g2.bez[g2.bez.length - 1]!;
    const into = unit(splineDeriv(g2, g2.bez.length));
    expect(into[0]).toBeCloseTo(0, 9);
    expect(into[1]).toBeCloseTo(1, 9);
    expect(-bendAt(last, true)).toBeCloseTo(0.1, 6);
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
