import { describe, expect, it } from "vitest";
import { combine, formatMass, scaledTo, shellAndInfill, subtract, type MassProps } from "./mass";

const point = (mass: number, com: [number, number, number]): MassProps => ({ mass, com, inertia: [0, 0, 0, 0, 0, 0] });

describe("mass maths (#174)", () => {
  it("combines point masses by the parallel axis theorem", () => {
    const c = combine([point(2, [-10, 0, 0]), point(2, [10, 0, 0])]);
    expect(c.mass).toBe(4);
    expect(c.com).toEqual([0, 0, 0]);
    // 2 × 2 g × (10 mm)² about Y and Z, nothing about X.
    expect(c.inertia.map((v) => v + 0)).toEqual([0, 400, 400, 0, 0, 0]);
    const d = combine([point(1, [1, 1, 0]), point(1, [-1, -1, 0])]);
    expect(d.inertia[3]).toBe(-2);
  });

  it("takes a part away again", () => {
    const a = point(3, [0, 0, 0]);
    const b = point(1, [3, 0, 0]);
    const whole = combine([a, b]);
    const back = subtract(whole, b);
    expect(back.mass).toBeCloseTo(3, 9);
    back.com.forEach((v) => expect(v).toBeCloseTo(0, 9));
    back.inertia.forEach((v) => expect(v).toBeCloseTo(0, 9));
  });

  it("weighs a shell and infill, and scales to a datasheet mass", () => {
    const full = { volume: 1000, centroid: [0, 0, 0] as [number, number, number], inertia: [100, 100, 100, 0, 0, 0] as MassProps["inertia"] };
    const core = { volume: 500, centroid: [0, 0, 0] as [number, number, number], inertia: [40, 40, 40, 0, 0, 0] as MassProps["inertia"] };
    const p = shellAndInfill(full, core, 1, 20);
    expect(p.mass).toBeCloseTo(1 - 0.5 * 0.8, 9);
    expect(p.inertia[0]).toBeCloseTo((100 - 40 * 0.8) / 1000, 9);
    expect(scaledTo(full, 50).mass).toBeCloseTo(50, 9);
  });

  it("says roughly how heavy", () => {
    expect(formatMass(42.4)).toBe("about 42 g");
    expect(formatMass(12.34)).toBe("about 12.3 g");
    expect(formatMass(0.4)).toBe("under 1 g");
  });
});
