import { describe, expect, it } from "vitest";
import { crowding, lensed, loupeBox, loupeZoom, LOUPE_SIZE } from "./loupe";

describe("the magnifier loupe", () => {
  it("opens only when two or more points crowd the pointer", () => {
    const p = { x: 100, y: 100 };
    expect(crowding([{ x: 101, y: 100 }], p)).toBeNull();
    // Two points 20 px apart are easy to tell apart.
    expect(
      crowding(
        [
          { x: 100, y: 100 },
          { x: 120, y: 100 },
        ],
        p,
      ),
    ).toBeNull();
    const c = crowding(
      [
        { x: 100, y: 100 },
        { x: 102, y: 100 },
        { x: 300, y: 300 },
      ],
      p,
    );
    expect(c).toEqual({ count: 2, gap: 2 });
  });

  it("zooms until the closest pair is well apart, within limits", () => {
    expect(loupeZoom(2)).toBe(14);
    expect(loupeZoom(0.1)).toBe(40);
    expect(loupeZoom(0)).toBe(40);
    expect(loupeZoom(7)).toBe(4);
    expect(loupeZoom(null)).toBe(6);
  });

  it("slows the pointer by the zoom around where it opened", () => {
    const l = { anchor: { x: 100, y: 100 }, pointer: { x: 100, y: 100 }, zoom: 10, why: "crowd" as const };
    expect(lensed(l, { x: 130, y: 80 })).toEqual({ x: 103, y: 98 });
    expect(lensed(null, { x: 130, y: 80 })).toEqual({ x: 130, y: 80 });
    // Under a finger the loupe only shows; the finger places where it is.
    expect(lensed({ ...l, why: "touch" }, { x: 130, y: 80 })).toEqual({ x: 130, y: 80 });
  });

  it("sits above the pointer, or below it near the top, and stays in the view", () => {
    const view = { width: 1000, height: 700, top: 140 };
    const above = loupeBox({ x: 500, y: 500 }, view);
    expect(above.below).toBe(false);
    expect(above.top + LOUPE_SIZE).toBeLessThan(500);
    const below = loupeBox({ x: 500, y: 200 }, view);
    expect(below.below).toBe(true);
    expect(below.top).toBeGreaterThan(200);
    expect(loupeBox({ x: 5, y: 500 }, view).left).toBe(8);
    expect(loupeBox({ x: 995, y: 500 }, view).left).toBe(1000 - LOUPE_SIZE - 8);
  });
});
