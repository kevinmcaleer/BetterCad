import { describe, expect, it } from "vitest";
import { newSketch } from "./model";
import { Draft, drawPolyline, drawRectangle } from "./draw";
import { profiles } from "./profiles";
import { bridgeGap, findGaps, gapSummary, joinAll } from "./gaps";

describe("findGaps", () => {
  it("a closed rectangle has no open ends", () => {
    const r = findGaps(drawRectangle(newSketch(), [0, 0], [20, 10]).sketch);
    expect(r.gaps).toEqual([]);
    expect(gapSummary(r)).toBe("No open ends");
  });

  it("a rectangle with one corner not quite joined: one gap between ends, with its size", () => {
    const s = drawPolyline(newSketch(), [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
      [0, 0.3],
    ]).sketch;
    const r = findGaps(s);
    expect(r.openEnds).toBe(2);
    expect(r.gaps).toHaveLength(1);
    const g = r.gaps[0]!;
    expect(g.kind).toBe("ends");
    if (g.kind !== "ends") return;
    expect(g.size).toBeCloseTo(0.3, 6);
    expect(g.join).toBe(true);
    expect(gapSummary(r)).toBe("2 open ends");
    // Joining them gives a coincident tie, which closes the shape.
    const joined = joinAll(s, r.gaps);
    expect(joined.constraints.at(-1)).toMatchObject({ type: "coincident" });
    expect(profiles(joined).profiles).toHaveLength(1);
    // A bridge closes it too, without moving anything.
    expect(profiles(bridgeGap(s, g)).profiles).toHaveLength(1);
  });

  it("an end stopping short of a line is paired with that line", () => {
    const d = new Draft(newSketch());
    const a = d.point([0, 0]);
    const b = d.point([20, 0]);
    d.line(a, b);
    d.line([10, 10], [10, 0.5]);
    const r = findGaps(d.done().sketch);
    const short = r.gaps.find((g) => g.kind === "curve");
    expect(short).toBeDefined();
    if (short?.kind !== "curve") return;
    expect(short.size).toBeCloseTo(0.5, 6);
    expect(short.to[0]).toBeCloseTo(10, 6);
  });

  it("an end touching a line is not open", () => {
    const d = new Draft(newSketch());
    d.line([0, 0], [20, 0]);
    d.line([10, 10], [10, 0]);
    const r = findGaps(d.done().sketch);
    // The T's top end and the long line's two ends are open, but not the end on the line.
    expect(r.openEnds).toBe(3);
  });

  it("far-apart ends are just open, and big gaps are not offered a join", () => {
    const s = drawPolyline(newSketch(), [
      [0, 0],
      [100, 0],
      [100, 100],
    ]).sketch;
    const r = findGaps(s);
    expect(r.gaps.every((g) => g.kind !== "ends" || !g.join)).toBe(true);
  });

  it("finds lines lying partly along each other", () => {
    const d = new Draft(newSketch());
    d.line([0, 0], [10, 0]);
    d.line([5, 0], [15, 0]);
    const r = findGaps(d.done().sketch);
    const o = r.gaps.find((g) => g.kind === "overlap");
    expect(o).toBeDefined();
    if (o?.kind !== "overlap") return;
    expect([o.from[0], o.to[0]].sort((x, y) => x - y)).toEqual([5, 10]);
  });

  it("construction lines are ignored", () => {
    const d = new Draft(newSketch());
    d.line([0, 0], [10, 0], { construction: true });
    expect(findGaps(d.done().sketch).gaps).toEqual([]);
  });

  it("ends that touch without being joined still close a shape, and are listed as loose joins", () => {
    // A 110 mm circle with a notch cut in its side: an arc and three lines, each with its own end points.
    const d = new Draft(newSketch());
    const [y, x] = [28, Math.sqrt(55 ** 2 - 28 ** 2)];
    d.arc([0, 0], [x, y], [x, -y]);
    d.line([x, -y], [x - 8, -y], { auto: false });
    d.line([x - 8, -y], [x - 8, y], { auto: false });
    d.line([x - 8, y], [x, y], { auto: false });
    const s = d.done().sketch;
    const r = findGaps(s);
    expect(r.openEnds).toBe(0);
    expect(r.shapes).toBe(1);
    expect(r.gaps.map((g) => g.kind)).toEqual(["touch", "touch", "touch", "touch"]);
    expect(gapSummary(r)).toBe("4 loose joins");
    const joined = joinAll(s, r.gaps);
    expect(profiles(joined).profiles).toHaveLength(1);
    expect(findGaps(joined).gaps).toEqual([]);
  });
});
