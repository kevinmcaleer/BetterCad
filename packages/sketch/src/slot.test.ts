import { beforeAll, describe, expect, it } from "vitest";
import { SketchIndex, newSketch, type Sketch } from "./model";
import { drawSlot } from "./draw";
import { Solver } from "./solver";
import { profiles } from "./profiles";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});

/** How far `p` is from the line through `a` and `b`. */
const off = (p: number[], a: number[], b: number[]) =>
  Math.abs((b[0]! - a[0]!) * (p[1]! - a[1]!) - (b[1]! - a[1]!) * (p[0]! - a[0]!)) / Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);

/** Is it still a slot: equal ends, sides tangent to both, one closed shape? */
function isSlot(s: Sketch) {
  const idx = new SketchIndex(s);
  const arcs = s.entities.filter((e) => e.kind === "arc");
  const sides = s.entities.filter((e) => e.kind === "line" && !e.construction);
  expect(arcs).toHaveLength(2);
  expect(sides).toHaveLength(2);
  const [r0, r1] = arcs.map((a) => (a.kind === "arc" ? a.r : 0));
  expect(r0).toBeCloseTo(r1!, 6);
  for (const l of sides)
    for (const a of arcs) if (l.kind === "line" && a.kind === "arc") expect(off(idx.xy(a.c), idx.xy(l.a), idx.xy(l.b))).toBeCloseTo(a.r, 6);
  expect(profiles(s).profiles).toHaveLength(1);
}

describe("slot (#403)", () => {
  it("draws two sides, two equal ends tangent to both, and a centre line; typed sizes are dimensions", () => {
    const r = drawSlot(newSketch(), [0, 0], [30, 0], 8, { length: 30, width: 8 })!;
    const s = r.sketch;
    expect(s.constraints.map((c) => c.type).sort()).toEqual(["equal", "horizontal", "tangent", "tangent", "tangent", "tangent"]);
    expect(s.dimensions.map((d) => `${d.kind} ${d.value}`)).toEqual(["length 30", "diameter 8"]);
    const solved = solver.solve(s);
    expect(solved.status).toBe("ok");
    isSlot(solved.sketch);
  });

  it("stays a slot when an end is dragged", () => {
    const s = solver.solve(drawSlot(newSketch(), [0, 0], [20, 10], 6)!.sketch).sketch;
    const far = s.entities.filter((e) => e.kind === "point")[1]!.id;
    const moved = solver.drag(s, far, [40, -5]);
    expect(moved.status).toBe("ok");
    isSlot(moved.sketch);
    const side = s.entities.find((e) => e.kind === "point" && !e.construction)!.id;
    const pulled = solver.drag(moved.sketch, side, [0, 9]);
    expect(pulled.status).toBe("ok");
    isSlot(pulled.sketch);
  });

  it("needs two centres apart and a width", () => {
    expect(drawSlot(newSketch(), [0, 0], [0, 0], 8)).toBeNull();
    expect(drawSlot(newSketch(), [0, 0], [10, 0], 0)).toBeNull();
  });
});
