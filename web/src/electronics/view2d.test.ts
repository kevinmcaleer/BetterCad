import { fit, gridStep, snap, toScreen, toWorld, zoomAt } from "./view2d";

describe("the 2D view", () => {
  const v = { scale: 10, ox: 100, oy: 200 };

  it("maps world to screen and back, y up", () => {
    expect(toScreen(v, [2, 3])).toEqual([120, 170]);
    expect(toWorld(v, [120, 170])).toEqual([2, 3]);
  });

  it("zooms about the pointer", () => {
    const z = zoomAt(v, [120, 170], 2);
    expect(z.scale).toBe(20);
    expect(toScreen(z, [2, 3])).toEqual([120, 170]);
  });

  it("fits a box in the clear part of the canvas", () => {
    const f = fit({ x1: 0, y1: 0, x2: 50, y2: 40 }, { w: 1000, h: 800 }, { top: 100, right: 260, bottom: 60, left: 260 }, 20);
    const a = toScreen(f, [0, 0]);
    const b = toScreen(f, [50, 40]);
    expect(a[0]).toBeGreaterThanOrEqual(280 - 1e-6);
    expect(b[0]).toBeLessThanOrEqual(720 + 1e-6);
    expect(b[1]).toBeGreaterThanOrEqual(120 - 1e-6);
    expect(a[1]).toBeLessThanOrEqual(720 + 1e-6);
  });

  it("snaps to the grid and thins the grid out when zoomed away", () => {
    expect(snap([2.6, -1.2], 2.54)).toEqual([2.54, -0]);
    expect(snap([3.9, 5.2], 2.54)).toEqual([5.08, 5.08]);
    expect(gridStep({ scale: 10, ox: 0, oy: 0 }, 2.54)).toBe(2.54);
    expect(gridStep({ scale: 1, ox: 0, oy: 0 }, 2.54)).toBe(12.7);
  });
});
