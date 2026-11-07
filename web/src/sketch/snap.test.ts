import { describe, expect, it } from "vitest";
import { drawRectangle, drawCircle, drawLine, newSketch } from "@bettercad/sketch";
import { entityAt, snap, snapStep } from "./snap";

const rect = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;

describe("snap", () => {
  it("jumps to a corner within 8 px", () => {
    const s = snap([39.5, 20.4], rect, { px: 0.1, grid: 1 });
    expect(s.kind).toBe("end");
    expect(s.xy).toEqual([40, 20]);
    expect(s.label).toBe("End");
  });

  it("prefers a corner over the middle of a line", () => {
    expect(snap([40.3, 0.2], rect, { px: 0.1, grid: null }).kind).toBe("end");
    const m = snap([20.2, 0.3], rect, { px: 0.1, grid: null });
    expect(m.kind).toBe("middle");
    expect(m.xy).toEqual([20, 0]);
  });

  it("lands on a line, then on the grid, then level with the start", () => {
    const on = snap([10, 0.4], rect, { px: 0.1, grid: null });
    expect(on.kind).toBe("on");
    expect(on.xy[1]).toBeCloseTo(0);
    const g = snap([61.2, 33.7], rect, { px: 0.1, grid: 1 });
    expect(g).toMatchObject({ kind: "grid", xy: [61, 34] });
    const level = snap([70, 50.3], rect, { px: 0.1, grid: null, from: [60, 50] });
    expect(level).toMatchObject({ kind: "horizontal", xy: [70, 50] });
  });

  it("finds circle centres and skips what is excluded", () => {
    const c = drawCircle(newSketch(), [100, 100], 10);
    const centre = c.sketch.entities.find((e) => e.kind === "point")!;
    expect(snap([100.3, 99.8], c.sketch, { px: 0.1, grid: null }).kind).toBe("centre");
    expect(snap([100.3, 99.8], c.sketch, { px: 0.1, grid: null, exclude: new Set([centre.id]) }).kind).toBe("free");
  });

  it("snaps to where two lines cross, after corners and midpoints", () => {
    const x = drawLine(drawLine(newSketch(), [-10, 0], [10, 0]).sketch, [3, -10], [3, 20]).sketch;
    const s = snap([3.4, 0.3], x, { px: 0.1, grid: null });
    expect(s).toMatchObject({ kind: "crossing", label: "Crossing" });
    expect(s.xy[0]).toBeCloseTo(3);
    expect(s.ref && s.ref2).toBeTruthy();
  });

  it("snaps to the grid only with Ctrl", () => {
    expect(snap([39.6, 20.4], rect, { px: 0.1, grid: 5, gridOnly: true })).toMatchObject({ kind: "grid", xy: [40, 20] });
    expect(snap([1.2, 0.2], rect, { px: 0.1, grid: 5, gridOnly: true }).xy).toEqual([0, 0]);
  });

  it("turns off with Shift", () => {
    expect(snap([39.5, 20.4], rect, { px: 0.1, grid: 1, off: true })).toMatchObject({ kind: "free", xy: [39.5, 20.4] });
  });

  it("picks a grid step about 10 px wide", () => {
    expect(snapStep(0.1)).toBe(1);
    expect(snapStep(0.3)).toBe(5);
    expect(snapStep(0.004)).toBe(0.05);
  });

  it("finds the entity under a point, points first", () => {
    const corner = entityAt([0.1, 0.1], rect, 1)!;
    expect(rect.entities.find((e) => e.id === corner)?.kind).toBe("point");
    const edge = entityAt([20, 0.2], rect, 1)!;
    expect(rect.entities.find((e) => e.id === edge)?.kind).toBe("line");
    expect(entityAt([20, 10], rect, 1)).toBeNull();
  });

  it("snaps to the origin first, reusing a point already on it", () => {
    const empty = newSketch();
    expect(snap([0.4, -0.3], empty, { px: 0.1, grid: 1 })).toMatchObject({ kind: "origin", xy: [0, 0], label: "Origin" });
    expect(snap([0.4, -0.3], empty, { px: 0.1, grid: 1 }).ref).toBeUndefined();
    const corner = rect.entities.find((e) => e.kind === "point" && e.x === 0 && e.y === 0)!;
    expect(snap([0.4, -0.3], rect, { px: 0.1, grid: 1 })).toMatchObject({ kind: "origin", ref: corner.id });
    // On a face, the origin is wherever the model's origin projects to; null leaves it out.
    expect(snap([5.2, 4.9], empty, { px: 0.1, grid: null, origin: [5, 5] })).toMatchObject({ kind: "origin", xy: [5, 5] });
    expect(snap([0.4, -0.3], empty, { px: 0.1, grid: null, origin: null }).kind).toBe("free");
    expect(snap([0.4, -0.3], empty, { px: 0.1, grid: 1, off: true }).kind).toBe("free");
  });
});
