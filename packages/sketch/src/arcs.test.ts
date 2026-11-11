import { beforeAll, describe, expect, it } from "vitest";
import { SketchIndex, newSketch, type Arc, type Sketch } from "./model";
import { Draft, directionAt, drawArcTangent, drawLine } from "./draw";
import { Solver } from "./solver";
import { profiles } from "./profiles";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});

const lastArc = (s: Sketch) => [...s.entities].reverse().find((e): e is Arc => e.kind === "arc")!;
const endOf = (s: Sketch, id: string) => (s.entities.find((e) => e.id === id) as { b: string }).b;

describe("tangent arcs (#405)", () => {
  it("knows which way a line or arc leaves its end", () => {
    const l = drawLine(newSketch(), [0, 0], [20, 0]);
    const line = l.sketch.entities.find((e) => e.kind === "line")!;
    expect(directionAt(l.sketch, endOf(l.sketch, line.id))).toEqual([1, 0]);
    const a = drawArcTangent(l.sketch, endOf(l.sketch, line.id), [30, 10])!;
    const arc = lastArc(a.sketch);
    // Turning left, it runs anticlockwise from the line's end and leaves its far end heading up.
    expect(arc.r).toBeCloseTo(10, 9);
    expect(new SketchIndex(a.sketch).xy(arc.c)).toEqual([20, 10]);
    expect(directionAt(a.sketch, arc.b)!.map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, 1]);
  });

  it("turns right as well, and keeps tangent when the line is dragged", () => {
    const l = drawLine(newSketch(), [0, 0], [20, 0]);
    const line = l.sketch.entities.find((e) => e.kind === "line")!;
    const a = drawArcTangent(l.sketch, endOf(l.sketch, line.id), [30, -10])!;
    const arc = lastArc(a.sketch);
    expect(new SketchIndex(a.sketch).xy(arc.c)).toEqual([20, -10]);
    expect(a.sketch.constraints.map((c) => c.type)).toEqual(["horizontal", "tangent"]);
    const r = solver.drag(a.sketch, (line as { a: string }).a, [0, 5]);
    expect(r.status).toBe("ok");
    const idx = new SketchIndex(r.sketch);
    const sol = lastArc(r.sketch);
    // The line stays level, so the centre stays straight below the joint.
    expect(idx.xy(sol.c)[0]).toBeCloseTo(idx.xy(endOf(r.sketch, line.id))[0], 6);
  });

  it("is refused from a point nothing ends at, or straight ahead", () => {
    const d = new Draft(newSketch());
    const p = d.point([0, 0]);
    expect(drawArcTangent(d.done().sketch, p, [5, 5])).toBeNull();
    const l = drawLine(newSketch(), [0, 0], [20, 0]);
    const line = l.sketch.entities.find((e) => e.kind === "line")!;
    expect(drawArcTangent(l.sketch, endOf(l.sketch, line.id), [40, 0])).toBeNull();
  });

  it("draws the Bearing Jig's end: a line, an R10 half round tangent to it, a line back, closed", () => {
    let s = drawLine(newSketch(), [0, 0], [40, 0]).sketch;
    const bottom = s.entities.find((e) => e.kind === "line")!;
    s = drawArcTangent(s, endOf(s, bottom.id), [40, 20], 10)!.sketch;
    const arc = lastArc(s);
    const d = new Draft(s);
    const top = d.line(arc.a === endOf(s, bottom.id) ? arc.b : arc.a, [0, 20]);
    d.line((d.entities.find((e) => e.id === top) as { b: string }).b, (bottom as { a: string }).a);
    const res = solver.solve(d.done().sketch);
    expect(res.status).toBe("ok");
    expect(profiles(res.sketch).profiles).toHaveLength(1);
    expect(profiles(res.sketch).profiles[0]!.area).toBeCloseTo(40 * 20 + (Math.PI * 100) / 2, 0);
  });
});
