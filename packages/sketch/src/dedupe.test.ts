import { describe, expect, it } from "vitest";
import { removeDuplicates } from "./dedupe";
import { Draft } from "./draw";
import { newSketch, type Sketch } from "./model";
import { profiles } from "./profiles";
import { Solver } from "./solver";

const kinds = (s: Sketch) => s.entities.map((e) => e.kind).sort();

describe("removeDuplicates", () => {
  it("takes a line drawn twice down to one, keeping the one with a size and moving its constraints over", () => {
    const d = new Draft(newSketch());
    const first = d.line([0, 0], [10, 0]);
    const second = d.line([0, 0.0004], [10, 0]);
    const size = d.dimension("length", [second], 10);
    const { sketch, removed, joined } = removeDuplicates(d.done().sketch);
    expect(removed).toBe(1);
    expect(joined).toBe(2);
    expect(kinds(sketch)).toEqual(["line", "point", "point"]);
    expect(sketch.entities.find((e) => e.kind === "line")!.id).toBe(second);
    expect(sketch.dimensions.map((x) => x.id)).toEqual([size]);
    // Both had Horizontal: one is left.
    expect(sketch.constraints.filter((c) => c.type === "horizontal")).toHaveLength(1);
    expect(sketch.entities.some((e) => e.id === first)).toBe(false);
  });

  it("sees a line drawn the other way as the same line", () => {
    const d = new Draft(newSketch());
    d.line([0, 0], [10, 5]);
    d.line([10, 5], [0, 0]);
    const { sketch, removed } = removeDuplicates(d.done().sketch);
    expect(removed).toBe(1);
    expect(kinds(sketch)).toEqual(["line", "point", "point"]);
  });

  it("leaves lines further apart than the tolerance", () => {
    const d = new Draft(newSketch());
    d.line([0, 0], [10, 0]);
    d.line([0, 0.01], [10, 0.01]);
    const r = removeDuplicates(d.done().sketch);
    expect(r.removed).toBe(0);
    expect(r.joined).toBe(0);
  });

  it("removes a short line lying along a longer one, and keeps its end on the long line if a curve uses it", () => {
    const d = new Draft(newSketch());
    const long = d.line([0, 0], [20, 0]);
    const mid = d.point([5, 0]);
    d.line(mid, [12, 0]);
    d.line(mid, [5, 8]);
    const { sketch, removed } = removeDuplicates(d.done().sketch);
    expect(removed).toBe(1);
    expect(sketch.entities.filter((e) => e.kind === "line")).toHaveLength(2);
    expect(sketch.constraints).toContainEqual(expect.objectContaining({ type: "pointOn", p: mid, e: long }));
    // The short line's other end had nothing else on it and went with it.
    expect(sketch.entities.filter((e) => e.kind === "point")).toHaveLength(4);
  });

  it("keeps a short line along a longer one when it carries its own size", () => {
    const d = new Draft(newSketch());
    d.line([0, 0], [20, 0]);
    const short = d.line([5, 0], [12, 0]);
    d.dimension("length", [short], 7);
    expect(removeDuplicates(d.done().sketch).removed).toBe(0);
  });

  it("takes stacked circles and arcs down to one each, and a lone point on a corner into the corner", () => {
    const d = new Draft(newSketch());
    d.circle([0, 0], 5);
    d.circle([0, 0], 5.0005);
    d.circle([0, 0], 6);
    d.arc([20, 0], [25, 0], [20, 5]);
    d.arc([20, 0], [25, 0], [20, 5]);
    // The other way round is the rest of the circle, not the same arc.
    d.arc([20, 0], [20, 5], [25, 0]);
    d.point([25, 0]);
    const { sketch, removed } = removeDuplicates(d.done().sketch);
    expect(removed).toBe(3);
    expect(sketch.entities.filter((e) => e.kind === "circle")).toHaveLength(2);
    expect(sketch.entities.filter((e) => e.kind === "arc")).toHaveLength(2);
  });

  it("never takes construction for a duplicate of normal geometry, nor removes projected geometry", () => {
    const d = new Draft(newSketch());
    d.line([0, 0], [10, 0], { construction: true });
    d.line([0, 0], [10, 0]);
    const s = d.done().sketch;
    expect(removeDuplicates(s).removed).toBe(0);
    const proj: Sketch = { ...s, entities: s.entities.map((e) => (e.kind === "line" ? { ...e, construction: false, projectedFrom: { body: "b1", face: 0 } } : e)) };
    expect(removeDuplicates(proj).removed).toBe(0);
  });

  it("only takes duplicates of the picked geometry when given some, picked or not", () => {
    const d = new Draft(newSketch());
    const a = d.line([0, 0], [10, 0]);
    d.line([0, 0], [10, 0]);
    d.line([0, 5], [10, 5]);
    d.line([0, 5], [10, 5]);
    const r = removeDuplicates(d.done().sketch, [a]);
    expect(r.removed).toBe(1);
    expect(r.sketch.entities.filter((e) => e.kind === "line")).toHaveLength(3);
  });

  it("drops constraints that would name one thing twice once points merge", () => {
    const d = new Draft(newSketch());
    const l1 = d.line([0, 0], [10, 0]);
    const l2 = d.line([10, 0.0002], [10, 10]);
    const s0 = d.done().sketch;
    const end = (id: string, k: "a" | "b") => (s0.entities.find((e) => e.id === id) as { a: string; b: string })[k];
    d.constrain({ type: "coincident", a: end(l1, "b"), b: end(l2, "a") });
    const { sketch, removed, joined } = removeDuplicates(d.done().sketch);
    expect(removed).toBe(0);
    expect(joined).toBe(1);
    expect(sketch.constraints.some((c) => c.type === "coincident")).toBe(false);
  });

  it("leaves a square drawn twice as one closed profile the solver accepts", async () => {
    const d = new Draft(newSketch());
    const square = (o: number) => {
      const c = [d.point([o, 0]), d.point([10, o]), d.point([10, 10]), d.point([0, 10])];
      for (let i = 0; i < 4; i++) d.line(c[i]!, c[(i + 1) % 4]!);
    };
    square(0);
    square(0.0003);
    const { sketch, removed } = removeDuplicates(d.done().sketch);
    expect(removed).toBe(4);
    expect(sketch.entities.filter((e) => e.kind === "line")).toHaveLength(4);
    expect(profiles(sketch).profiles).toHaveLength(1);
    const solver = await Solver.load();
    expect(solver.solve(sketch).status).not.toBe("conflicting");
  });
});
