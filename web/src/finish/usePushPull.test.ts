import { describe, expect, it } from "vitest";
import { dragDistance } from "./usePushPull";

describe("dragDistance", () => {
  // The normal's on-screen image: 20 px up per millimetre.
  const base = { x: 100, y: 100 };
  const tip = { x: 100, y: 80 };

  it("goes out as the pointer follows the normal and in as it goes against it", () => {
    expect(dragDistance({ x: 0, y: 0 }, { x: 0, y: -100 }, base, tip, false)).toBe(5);
    expect(dragDistance({ x: 0, y: 0 }, { x: 0, y: 60 }, base, tip, false)).toBe(-3);
  });

  it("ignores movement across the normal", () => {
    expect(dragDistance({ x: 0, y: 0 }, { x: 300, y: 0 }, base, tip, false)).toBe(0);
  });

  it("goes in tenths when fine and whole millimetres otherwise", () => {
    expect(dragDistance({ x: 0, y: 0 }, { x: 0, y: -47 }, base, tip, true)).toBeCloseTo(2.4);
    expect(dragDistance({ x: 0, y: 0 }, { x: 0, y: -47 }, base, tip, false)).toBe(2);
  });

  it("gives nothing when the normal points at the camera", () => {
    expect(dragDistance({ x: 0, y: 0 }, { x: 0, y: -50 }, base, base, false)).toBe(0);
  });
});
