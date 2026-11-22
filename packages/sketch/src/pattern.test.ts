import { beforeAll, describe, expect, it } from "vitest";
import { Draft, drawPolyline } from "./draw";
import { newSketch, removeEntities, type Sketch } from "./model";
import { profiles } from "./profiles";
import { Solver } from "./solver";
import { addSketchPattern, applyPatterns, patternValues, removeSketchPattern, setPatternKind, setPatternValue, skipDeleted } from "./pattern";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});

/** A 4 mm square with its corner held at the origin and a 4 mm width, so it is fully set. */
function square(): { s: Sketch; lines: string[] } {
  const { sketch, ids } = drawPolyline(
    newSketch(),
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    true,
  );
  return { s: sketch, lines: ids };
}

const solve = (s: Sketch) => {
  const r = solver.solve(s);
  expect(["ok", "redundant"]).toContain(r.status);
  return r.sketch;
};

describe("rectangular sketch pattern", () => {
  it("copies a closed square into a row, each copy its own profile", () => {
    const { s, lines } = square();
    const r = addSketchPattern(s, "rect", lines);
    if (typeof r === "string") throw new Error(r);
    const out = solve(setPatternValue(r.sketch, r.id, "spacing1", 10));
    expect(patternValues(out, out.patterns![0]!).count1).toBe(3);
    const found = profiles(out).profiles;
    expect(found).toHaveLength(3);
    for (const p of found) expect(p.area).toBeCloseTo(16);
    const xs = out.entities.filter((e) => e.kind === "point").map((e) => (e as { x: number }).x);
    expect(Math.max(...xs)).toBeCloseTo(24);
  });

  it("lays out rows and columns, and follows a changed count and spacing", () => {
    const { s, lines } = square();
    const r = addSketchPattern(s, "rect", lines);
    if (typeof r === "string") throw new Error(r);
    let out = setPatternValue(r.sketch, r.id, "count2", 2);
    out = solve(setPatternValue(out, r.id, "spacing2", 6));
    expect(profiles(out).profiles).toHaveLength(6);
    out = solve(setPatternValue(out, r.id, "count1", 2));
    expect(profiles(out).profiles).toHaveLength(4);
    const ys = out.entities.filter((e) => e.kind === "point").map((e) => (e as { y: number }).y);
    expect(Math.max(...ys)).toBeCloseTo(10);
  });

  it("copies follow the original when it moves", () => {
    const { s, lines } = square();
    const r = addSketchPattern(s, "rect", lines);
    if (typeof r === "string") throw new Error(r);
    const before = solve(r.sketch);
    const corner = before.entities.find((e) => e.kind === "point" && !e.copy)!;
    const dragged = solver.dragPoints(before, [[corner.id, [-3, -3]]]).sketch;
    const copy = dragged.entities.find((e) => e.id === `${r.id}:1:${corner.id}`) as { x: number; y: number };
    const moved = dragged.entities.find((e) => e.id === corner.id) as { x: number; y: number };
    expect(copy.x - moved.x).toBeCloseTo(patternValues(dragged, dragged.patterns![0]!).spacing1);
    expect(copy.y).toBeCloseTo(moved.y);
  });

  it("runs along a picked line and the other way with flip", () => {
    const d = new Draft(newSketch());
    const axis = d.line([0, 0], [0, 10], { construction: true });
    const dot = d.point([1, 1]);
    const s = d.done().sketch;
    const r = addSketchPattern(s, "rect", [dot], { dir: axis, flip1: true });
    if (typeof r === "string") throw new Error(r);
    const out = applyPatterns(setPatternValue(r.sketch, r.id, "spacing1", 5));
    const c = out.entities.find((e) => e.id === `${r.id}:2:${dot}`) as { x: number; y: number };
    expect(c.x).toBeCloseTo(1);
    expect(c.y).toBeCloseTo(-9);
  });

  it("leaves a deleted copy's place empty, and goes when its originals do", () => {
    const { s, lines } = square();
    const r = addSketchPattern(s, "rect", lines);
    if (typeof r === "string") throw new Error(r);
    let out = solve(r.sketch);
    const copyLine = out.entities.find((e) => e.copy?.n === 1 && e.kind === "line")!;
    out = solve(skipDeleted(out, removeEntities(out, [copyLine.id])));
    expect(out.patterns![0]!.skip).toEqual([1]);
    expect(profiles(out).profiles).toHaveLength(2);
    out = solve(removeEntities(out, lines));
    expect(out.patterns).toBeUndefined();
    expect(out.entities).toHaveLength(0);
    expect(out.dimensions).toHaveLength(0);
  });
});

describe("circular sketch pattern", () => {
  it("turns copies round a centre point, evenly over 360°", () => {
    const d = new Draft(newSketch());
    const centre = d.point([0, 0]);
    const hole = d.circle([10, 0], 1);
    const s = d.done().sketch;
    const r = addSketchPattern(s, "circle", [hole], { centre });
    if (typeof r === "string") throw new Error(r);
    const out = solve(setPatternValue(r.sketch, r.id, "count", 4));
    const centres = out.entities
      .filter((e) => e.kind === "circle")
      .map((c) => out.entities.find((p) => p.id === (c as { c: string }).c) as { x: number; y: number });
    expect(centres).toHaveLength(4);
    const at90 = centres.find((p) => Math.abs(p.y - 10) < 1e-6);
    expect(at90?.x).toBeCloseTo(0);
    expect(profiles(out).profiles).toHaveLength(4);
  });

  it("puts the last copy on the end of a part angle", () => {
    const d = new Draft(newSketch());
    const centre = d.point([0, 0]);
    const dot = d.point([10, 0]);
    const s = d.done().sketch;
    const r = addSketchPattern(s, "circle", [dot], { centre });
    if (typeof r === "string") throw new Error(r);
    let out = setPatternValue(r.sketch, r.id, "count", 3);
    out = applyPatterns(setPatternValue(out, r.id, "angle", 90));
    const last = out.entities.find((e) => e.id === `${r.id}:2:${dot}`) as { x: number; y: number };
    expect(last.x).toBeCloseTo(0);
    expect(last.y).toBeCloseTo(10);
  });

  it("turns copied text with the pattern", () => {
    const d = new Draft(newSketch());
    const centre = d.point([0, 0]);
    const anchor = d.point([10, 0]);
    const s0 = d.done().sketch;
    const s: Sketch = {
      ...s0,
      texts: [{ id: "t1", p: anchor, text: "A", font: "inter", height: 5, angle: 0, letterSpacing: 0, lineSpacing: 1, loops: [] }],
    };
    const r = addSketchPattern(s, "circle", ["t1"], { centre });
    if (typeof r === "string") throw new Error(r);
    const out = applyPatterns(setPatternValue(r.sketch, r.id, "count", 4));
    expect(out.texts!.map((t) => Math.round(t.angle))).toEqual([0, 90, 180, 270]);
  });

  it("goes back to a plain sketch when removed, and switching kind swaps its sizes", () => {
    const d = new Draft(newSketch());
    const centre = d.point([0, 0]);
    const dot = d.point([10, 0]);
    const s = d.done().sketch;
    const r = addSketchPattern(s, "circle", [dot], { centre });
    if (typeof r === "string") throw new Error(r);
    expect(r.sketch.dimensions.map((x) => x.role)).toEqual(["count", "angle"]);
    const rect = applyPatterns(setPatternKind(r.sketch, r.id, "rect"));
    expect(rect.dimensions.map((x) => x.role)).toEqual(["count1", "spacing1", "count2", "spacing2"]);
    expect(rect.entities.filter((e) => e.copy)).toHaveLength(2);
    const gone = removeSketchPattern(rect, r.id);
    expect(gone.entities).toEqual(s.entities);
    expect(gone.dimensions).toEqual([]);
  });

  it("leaves the degrees of freedom of the originals alone", () => {
    const d = new Draft(newSketch());
    const centre = d.point([0, 0]);
    d.constrain({ type: "fix", p: centre });
    const hole = d.circle([10, 0], 1);
    const s = d.done().sketch;
    const plain = solver.solve(s).dof;
    const r = addSketchPattern(s, "circle", [hole], { centre });
    if (typeof r === "string") throw new Error(r);
    expect(solver.solve(r.sketch).dof).toBe(plain);
  });
});
