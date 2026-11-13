import { describe, expect, it } from "vitest";
import { Draft, drawPolyline } from "./draw";
import { mirrorShapes, reflect } from "./edits";
import { SketchIndex, newSketch, type Sketch } from "./model";
import { profiles } from "./profiles";
import { Solver } from "./solver";

/** Half a bracket against a fixed upright axis at x = 0: its two ends sit on the axis. */
function halfBracket(): { s: Sketch; axis: string; lines: string[] } {
  const d = new Draft(newSketch());
  const top = d.point([0, 20], true);
  const bottom = d.point([0, -5], true);
  const axis = d.line(bottom, top, { construction: true });
  d.constrain({ type: "fix", p: top });
  d.constrain({ type: "fix", p: bottom });
  const s0 = d.done().sketch;
  const { sketch: s, ids } = drawPolyline(s0, [
    [0, 0],
    [15, 0],
    [15, 10],
    [5, 10],
    [5, 15],
    [0, 15],
  ]);
  return { s, axis, lines: ids };
}

describe("reflect", () => {
  it("mirrors a point across a slanted line", () => {
    const [x, y] = reflect([1, 0], [0, 0], [1, 1]);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
  });
  it("leaves a point on the line where it is", () => {
    const [x, y] = reflect([3, 3], [0, 0], [1, 1]);
    expect(x).toBeCloseTo(3);
    expect(y).toBeCloseTo(3);
  });
});

describe("mirrorShapes", () => {
  it("closes a half profile into one shape, sharing the points on the line", () => {
    const { s, axis, lines } = halfBracket();
    const out = mirrorShapes(s, lines, axis) as Sketch;
    expect(typeof out).toBe("object");
    const newLines = out.entities.filter((e) => e.kind === "line" && !s.entities.some((x) => x.id === e.id));
    expect(newLines).toHaveLength(5);
    // Only the four points off the line are copied; the two on it are shared and held on it.
    expect(out.entities.filter((e) => e.kind === "point").length - s.entities.filter((e) => e.kind === "point").length).toBe(4);
    expect(out.constraints.filter((c) => c.type === "symmetric")).toHaveLength(4);
    expect(out.constraints.filter((c) => c.type === "pointOn" && c.e === axis)).toHaveLength(2);
    const { profiles: found, openEnds } = profiles(out);
    expect(openEnds).toEqual([]);
    expect(found).toHaveLength(1);
    expect(found[0]!.area).toBeCloseTo(2 * (15 * 10 + 5 * 5));
  });

  it("puts the copy where the mirror lands", () => {
    const { s, axis, lines } = halfBracket();
    const out = mirrorShapes(s, lines, axis) as Sketch;
    const idx = new SketchIndex(out);
    const xs = out.entities.flatMap((e) => (e.kind === "point" ? [Math.round(idx.xy(e.id)[0])] : []));
    expect(xs).toContain(-15);
    expect(xs).toContain(-5);
  });

  it("moves the partner when a mirrored point is dragged", async () => {
    const { s, axis, lines } = halfBracket();
    const out = mirrorShapes(s, lines, axis) as Sketch;
    const solver = await Solver.load();
    const sym = out.constraints.find((c) => c.type === "symmetric")!;
    if (sym.type !== "symmetric") throw new Error();
    const r = solver.drag(out, sym.a, [18, 2]);
    expect(r.status === "ok" || r.status === "redundant").toBe(true);
    const idx = new SketchIndex(r.sketch);
    const [ax, ay] = idx.xy(sym.a);
    const [bx, by] = idx.xy(sym.b);
    expect(bx).toBeCloseTo(-ax, 4);
    expect(by).toBeCloseTo(ay, 4);
  });

  it("mirrors a circle with an equal radius, and an arc the other way round", () => {
    const d = new Draft(newSketch());
    const axis = d.line([0, -10], [0, 10], { construction: true });
    const c = d.circle([5, 0], 2);
    const arc = d.arc([5, 5], [7, 5], [5, 7]);
    const s = d.done().sketch;
    const out = mirrorShapes(s, [c, arc], axis) as Sketch;
    expect(out.constraints.some((k) => k.type === "equal" && k.a === c)).toBe(true);
    const idx = new SketchIndex(out);
    const copy = out.entities.find((e) => e.kind === "arc" && e.id !== arc)!;
    if (copy.kind !== "arc") throw new Error();
    expect(idx.xy(copy.c)[0]).toBeCloseTo(-5);
    // The original ran anticlockwise from (7,5) to (5,7); the copy runs from (-5,7) to (-7,5).
    expect(idx.xy(copy.a)[0]).toBeCloseTo(-5);
    expect(idx.xy(copy.b)[0]).toBeCloseTo(-7);
  });

  it("brings an ellipse's axes with it", () => {
    const d = new Draft(newSketch());
    const axis = d.line([0, -10], [0, 10], { construction: true });
    const e = d.ellipse([10, 0], 4, 2, 0);
    const s = d.done().sketch;
    const out = mirrorShapes(s, [e], axis) as Sketch;
    expect(out.entities.filter((x) => x.kind === "ellipse")).toHaveLength(2);
    const copy = out.entities.find((x) => x.kind === "ellipse" && x.id !== e)!;
    expect(new SketchIndex(out).xy((copy as { c: string }).c)[0]).toBeCloseTo(-10);
  });

  it("says what is missing", () => {
    const { s, axis, lines } = halfBracket();
    expect(mirrorShapes(s, [], axis)).toMatch(/Pick the shapes/);
    expect(mirrorShapes(s, [axis], axis)).toMatch(/Pick the shapes/);
    expect(mirrorShapes(s, lines, "nope")).toMatch(/Pick a line/);
  });
});
