import { describe, expect, it } from "vitest";
import { jointMove, mat4Apply } from "../state/document";
import { lineUpHoles, type Hole } from "./holePattern";
import type { V3 } from "./snapPoints";

const square = (c: V3, half: number, turn = 0, radius = 1.5): Hole[] =>
  [0, 1, 2, 3].map((k) => {
    const a = ((45 + turn + k * 90) * Math.PI) / 180;
    const r = half * Math.SQRT2;
    return { point: [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2]] as V3, radius };
  });

/** A 4-hole plate (16 mm square pattern) snapped by one hole onto another plate's 4 holes, turned 45°. */
const child = square([20, 0, 5], 8);
const parent = square([0, 0, 10], 8, 45);
const joint = { origin: parent[0]!.point, axis: [0, 0, 1] as V3, from: { point: child[1]!.point, normal: [0, 0, 1] as V3 } };

describe("lineUpHoles", () => {
  it("finds the turn that lines up all four holes of two plates", () => {
    const r = lineUpHoles(joint, child, parent)!;
    expect(r.count).toBe(4);
    const m = jointMove({ ...joint, angle: r.angle })!;
    for (const h of child) {
      const p = mat4Apply(m, h.point);
      expect(parent.some((q) => Math.hypot(q.point[0] - p[0], q.point[1] - p[1]) < 1e-6)).toBe(true);
    }
  });

  it("turns from wherever the joint is turned now", () => {
    const a = lineUpHoles(joint, child, parent)!.angle;
    expect(lineUpHoles(joint, child, parent, a + 90)!.angle).toBeCloseTo(a);
    expect(lineUpHoles(joint, child, parent, a)!.angle).toBeCloseTo(a);
  });

  it("lines up only the snapped hole when the spacing or size differ", () => {
    expect(
      lineUpHoles(
        joint,
        child,
        square([0, 0, 10], 9, 45).map((h, i) => (i ? h : parent[0]!)),
      )!.count,
    ).toBe(1);
    expect(
      lineUpHoles(
        joint,
        child,
        parent.map((h, i) => (i ? { ...h, radius: 2 } : h)),
      )!.count,
    ).toBe(1);
  });

  it("has nothing to line up with one hole a side", () => {
    expect(lineUpHoles(joint, child.slice(0, 1), parent)).toBeNull();
  });
});
