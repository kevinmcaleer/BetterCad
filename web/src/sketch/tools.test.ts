import { describe, expect, it } from "vitest";
import { Draft, drawRectangle, newSketch, profiles } from "@bettercad/sketch";
import { commit, constraintsFor, levelOrUpright, preview } from "./tools";
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

  it("makes a line horizontal up to 45° from the horizon and vertical past it", () => {
    const d = new Draft(newSketch());
    const line = (x: number, y: number) => d.line(d.point([0, 0]), d.point([x, y]), { auto: false });
    const flat = line(10, 4);
    const steep = line(-3, 10);
    const diagonal = line(10, -10);
    const s = d.done().sketch;
    expect(levelOrUpright(s, flat)).toBe("horizontal");
    expect(levelOrUpright(s, steep)).toBe("vertical");
    expect(levelOrUpright(s, diagonal)).toBe("horizontal");
    expect(constraintsFor("horizontalVertical", s, [flat, steep])).toEqual([
      { type: "horizontal", e: flat },
      { type: "vertical", e: steep },
    ]);
  });

  it("skips lines that are already horizontal or vertical", () => {
    const s = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const lines = s.entities.filter((e) => e.kind === "line").map((e) => e.id);
    expect(constraintsFor("horizontalVertical", s, [lines[0]!])).toBe("That line is already horizontal or vertical");
    const pts = s.entities.filter((e) => e.kind === "point").map((e) => e.id);
    expect(constraintsFor("horizontalVertical", s, [pts[0]!])).toBe("Pick lines");
  });
});
