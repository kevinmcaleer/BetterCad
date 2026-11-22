import { beforeAll, describe, expect, it } from "vitest";
import { autoCandidates, describeAdded, keepUseful, polygonCandidates } from "./auto";
import { Draft, drawPolyline, drawRectangle } from "./draw";
import { SketchIndex, newSketch, type Line, type Sketch, type Vec2 } from "./model";
import { Solver } from "./solver";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});
const solve = (s: Sketch) => solver.solve(s);

const sides = (s: Sketch) => {
  const idx = new SketchIndex(s);
  return s.entities
    .filter((e): e is Line => e.kind === "line" && !e.construction)
    .map((l) => {
      const [a, b] = [idx.xy(l.a), idx.xy(l.b)];
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    });
};

describe("Polygon", () => {
  it("makes an uneven closed outline of lines a regular polygon", () => {
    const pts: Vec2[] = [
      [0, 0],
      [12, 1],
      [17, 9],
      [9, 16],
      [-2, 11],
    ];
    const s = drawPolyline(newSketch(), pts, true).sketch;
    const line = s.entities.find((e) => e.kind === "line")!.id;
    const p = polygonCandidates(s, line);
    if (typeof p === "string") throw new Error(p);
    const { sketch, added } = keepUseful(solve, p.sketch, p.candidates);
    expect(added).toHaveLength(9);
    const r = solver.solve(sketch);
    expect(r.status).toBe("ok");
    const l = sides(r.sketch);
    for (const x of l) expect(x).toBeCloseTo(l[0]!, 6);
  });

  it("turns a rectangle into a square, leaving out what it already holds", () => {
    const s = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const p = polygonCandidates(s, s.entities.find((e) => e.kind === "line")!.id);
    if (typeof p === "string") throw new Error(p);
    const { sketch, added } = keepUseful(solve, p.sketch, p.candidates);
    // Three corners pin the circle (the fourth is on it already), and one pair of sides makes it square.
    expect(added.map((c) => c.type).sort()).toEqual(["equal", "pointOn", "pointOn", "pointOn"]);
    const r = solver.solve(sketch);
    expect(r.status).toBe("ok");
    const l = sides(r.sketch);
    for (const x of l) expect(x).toBeCloseTo(l[0]!, 6);
  });

  it("says what it needs for an open outline", () => {
    const s = drawPolyline(newSketch(), [
      [0, 0],
      [10, 0],
      [10, 10],
    ]).sketch;
    expect(polygonCandidates(s, s.entities.find((e) => e.kind === "line")!.id)).toBe("Pick a side of a closed outline of three or more lines");
  });
});

describe("AutoConstrain", () => {
  /** A hand-drawn rectangle: separate lines whose ends meet, a hair off level and upright, and a hole in the middle. */
  function rough(): Sketch {
    const d = new Draft(newSketch());
    d.line([0, 0], [40, 0.0005], { auto: false });
    d.line([40, 0], [40.0004, 20], { auto: false });
    d.line([40, 20], [0, 20], { auto: false });
    d.line([0, 20], [0, 0], { auto: false });
    d.circle([20, 10], 4);
    d.circle([20, 10], 6);
    return d.done().sketch;
  }

  it("adds what already lines up and takes away the freedom it held", () => {
    const s = rough();
    const before = solver.solve(s).dof;
    const { sketch, added } = keepUseful(solve, s, autoCandidates(s));
    const types = added.map((c) => c.type);
    expect(types.filter((t) => t === "coincident")).toHaveLength(4);
    expect(types.filter((t) => t === "horizontal" || t === "vertical")).toHaveLength(4);
    expect(types).toContain("concentric");
    const r = solver.solve(sketch);
    expect(r.status).toBe("ok");
    // Four free lines (16) and two circles (6) go down to a rectangle (4) and two rings on one centre (4).
    expect(before).toBe(22);
    expect(r.dof).toBe(8);
    expect(describeAdded(added)).toMatch(/^Added 9 constraints: 4 coincident, 2 horizontal, 2 vertical, 1 concentric$/);
  });

  it("adds nothing twice", () => {
    const s = rough();
    const once = keepUseful(solve, s, autoCandidates(s)).sketch;
    const twice = keepUseful(solve, once, autoCandidates(once));
    expect(twice.added).toEqual([]);
    expect(describeAdded(twice.added)).toBe("Nothing to add: what lines up is already held");
  });

  it("only looks at the picked geometry when there is a pick", () => {
    const s = rough();
    const first = s.entities.find((e) => e.kind === "line")!.id;
    const out = autoCandidates(s, [first]);
    expect(out).toEqual([{ type: "horizontal", e: first }]);
  });
});
