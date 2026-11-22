import { describe, expect, it } from "vitest";
import { crowding, follow, loupeBox, loupeZoom, LOUPE_REACH, LOUPE_SIZE } from "./loupe";

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

  it("follows the pointer, and a crowd's loupe closes once the pointer leaves the crowd", () => {
    const l = { anchor: { x: 100, y: 100 }, opened: { x: 100, y: 100 }, zoom: 10, why: "crowd" as const };
    expect(follow(l, { x: 130, y: 80 })).toEqual({ ...l, anchor: { x: 130, y: 80 } });
    expect(follow(l, { x: 100 + LOUPE_REACH + 1, y: 100 })).toBeNull();
    // Held down, it stays open for the drag; Alt's goes wherever the pointer goes.
    expect(follow(l, { x: 400, y: 100 }, true)?.anchor).toEqual({ x: 400, y: 100 });
    expect(follow({ ...l, why: "alt" }, { x: 400, y: 100 })?.anchor).toEqual({ x: 400, y: 100 });
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
