import { describe, expect, it } from "vitest";
import { drawRectangle, newSketch, profiles } from "@bettercad/sketch";
import { commit, constraintsFor, preview } from "./tools";
import type { Snap } from "./snap";

const free = (x: number, y: number): Snap => ({ xy: [x, y], kind: "free", label: "" });

describe("sketch tools", () => {
  it("previews a rectangle with its width and height", () => {
    const p = preview("rectangle", [[0, 0]], [30, -10]);
    expect(p.values).toEqual([30, 10]);
    expect(p.lines[0]).toHaveLength(5);
  });

  it("draws a closed, level rectangle", () => {
    const c = commit("rectangle", newSketch(), [free(0, 0), free(40, 20)])!;
    expect(c.label).toBe("Draw a rectangle");
    expect(c.sketch.entities.filter((e) => e.kind === "line")).toHaveLength(4);
    expect(c.sketch.constraints.map((x) => x.type).sort()).toEqual(["horizontal", "horizontal", "vertical", "vertical"]);
    expect(profiles(c.sketch).profiles[0]!.area).toBeCloseTo(800);
  });

  it("uses typed sizes and adds them as dimensions", () => {
    const c = commit("rectangle", newSketch(), [free(0, 0), free(-3, 7)], [25, 15])!;
    expect(c.sketch.dimensions.map((d) => d.value)).toEqual([25, 15]);
    expect(profiles(c.sketch).profiles[0]!.area).toBeCloseTo(375);
    const circle = commit("circle", newSketch(), [free(0, 0), free(1, 0)], [12])!;
    expect(circle.sketch.entities.find((e) => e.kind === "circle")).toMatchObject({ r: 6 });
  });

  it("chains lines from the last point and joins a corner snapped to", () => {
    const first = commit("line", newSketch(), [free(0, 0), free(10, 0)])!;
    const end = first.end!;
    const second = commit("line", first.sketch, [{ xy: [10, 0], kind: "end", ref: end, label: "End" }, free(10, 10)])!;
    const lines = second.sketch.entities.filter((e) => e.kind === "line");
    expect(lines).toHaveLength(2);
    expect(second.sketch.entities.filter((e) => e.kind === "point")).toHaveLength(3);
  });

  it("makes an equal-sided polygon on a construction circle", () => {
    const c = commit("polygon", newSketch(), [free(0, 0), free(10, 0)], [], 5)!;
    expect(c.label).toBe("Draw a 5-sided polygon");
    expect(c.sketch.entities.filter((e) => e.kind === "line")).toHaveLength(5);
    expect(c.sketch.entities.find((e) => e.kind === "circle")?.construction).toBe(true);
  });

  it("says what a constraint needs until the selection fits", () => {
    const s = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const lines = s.entities.filter((e) => e.kind === "line").map((e) => e.id);
    const pts = s.entities.filter((e) => e.kind === "point").map((e) => e.id);
    expect(constraintsFor("parallel", s, [lines[0]!])).toBe("Pick two lines");
    expect(constraintsFor("perpendicular", s, [lines[0]!, lines[1]!])).toEqual([{ type: "perpendicular", a: lines[0], b: lines[1] }]);
    expect(constraintsFor("coincident", s, [pts[0]!, lines[1]!])).toEqual([{ type: "pointOn", p: pts[0], e: lines[1] }]);
    expect(constraintsFor("fix", s, [lines[0]!])).toHaveLength(2);
  });

  it("fixes a point drawn on the origin, once, and shares it", () => {
    const origin: Snap = { xy: [0, 0], kind: "origin", label: "Origin" };
    const line = commit("line", newSketch(), [origin, free(30, 0)])!;
    const fixes = line.sketch.constraints.filter((c) => c.type === "fix");
    expect(fixes).toHaveLength(1);
    const p = (fixes[0] as { p: string }).p;
    expect(line.sketch.entities.find((e) => e.id === p)).toMatchObject({ x: 0, y: 0 });
    // A circle centred on the same point reuses it and adds no second fix.
    const circle = commit("circle", line.sketch, [{ ...origin, ref: p }, free(5, 0)])!;
    expect(circle.sketch.constraints.filter((c) => c.type === "fix")).toHaveLength(1);
    expect(circle.sketch.entities.find((e) => e.kind === "circle")).toMatchObject({ c: p, r: 5 });
  });
});
