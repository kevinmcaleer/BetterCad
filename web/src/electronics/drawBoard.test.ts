import { describe, expect, it } from "vitest";
import { textStrokes, textWidth } from "@bettercad/electronics/fab/font";
import { FAR_ALPHA, boardTextStrokes, pourAlpha } from "./drawBoard";
import { textBox } from "./hitBoard";

describe("pours on screen (#728)", () => {
  it("paints pours light, lighter on the far side, and faint when another net is lit", () => {
    expect(pourAlpha(true, true)).toBeLessThan(0.5);
    expect(pourAlpha(false, true)).toBeLessThan(pourAlpha(true, true));
    expect(pourAlpha(true, false)).toBeLessThan(pourAlpha(false, true));
    expect(FAR_ALPHA).toBeLessThan(0.75);
  });
});

describe("board text in the files' own font (#730)", () => {
  const t = { id: "t1", layer: "silk-top" as const, x: 10, y: 5, text: "BetterCad", size: 2 };

  it("draws the same strokes the silkscreen file has", () => {
    const { lines, pen } = boardTextStrokes(t);
    expect(lines).toEqual(textStrokes("BetterCad", 1.44, [10, 5], { angle: 0, mirror: false }));
    expect(pen).toBeCloseTo(0.216, 3);
  });

  it("mirrors text on the bottom, as it reads from below", () => {
    const { lines } = boardTextStrokes({ ...t, layer: "silk-bottom" });
    expect(Math.max(...lines.flat().map((p) => p[0]))).toBeLessThanOrEqual(10.2);
  });

  it("picks text by the box round what is drawn", () => {
    const b = textBox(t);
    const w = textWidth("BetterCad", 1.44);
    expect(b.x1).toBeCloseTo(10 - 0.108, 2);
    expect(b.x2).toBeGreaterThan(10 + w * 0.9);
    expect(b.x2).toBeLessThanOrEqual(10 + w + 0.108 + 1e-9);
    expect(b.y2).toBeCloseTo(5 + 1.44 + 0.108, 2);
    // A second line goes below the first, and the box takes it in.
    expect(textBox({ ...t, text: "A\nB" }).y1).toBeLessThan(5 - 1.44);
  });
});
