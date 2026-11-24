import { describe, expect, it } from "vitest";
import { FONT_GLYPHS, penFor, textStrokes, textWidth } from "./font";

describe("the stroke font", () => {
  it("keeps every glyph on its 4 by 6 grid", () => {
    for (const [ch, g] of Object.entries(FONT_GLYPHS))
      for (const stroke of g.split(" ")) {
        expect(stroke, ch).toMatch(/^([0-4][0-6]){2,}$/);
      }
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") expect(FONT_GLYPHS[ch], ch).toBeTruthy();
  });

  it("sizes text by the height of a capital", () => {
    const lines = textStrokes("R1", 1.2, [10, 5]);
    const ys = lines.flat().map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(5, 6);
    expect(Math.max(...ys)).toBeCloseTo(6.2, 6);
    expect(textWidth("R1", 1.2)).toBeCloseTo(2, 6);
    expect(textWidth("", 1)).toBe(0);
    expect(penFor(1)).toBe(0.15);
    expect(penFor(0.5, 0.15)).toBe(0.15);
  });

  it("centres, turns and mirrors about its anchor", () => {
    const centred = textStrokes("H", 6, [0, 0], { align: "centre", middle: true }).flat();
    expect(Math.min(...centred.map((p) => p[0]))).toBe(-2);
    expect(Math.max(...centred.map((p) => p[1]))).toBe(3);
    // Turned a quarter, along becomes up.
    const turned = textStrokes("L", 6, [0, 0], { angle: 90 }).flat();
    expect(Math.min(...turned.map((p) => p[0]))).toBe(-6);
    // Mirrored, the L's foot points left.
    const mirrored = textStrokes("L", 6, [0, 0], { mirror: true }).flat();
    expect(Math.min(...mirrored.map((p) => p[0]))).toBe(-4);
  });

  it("draws small letters as small capitals and a box for what it does not know", () => {
    const m = textStrokes("m", 6, [0, 0]).flat();
    expect(Math.max(...m.map((p) => p[1]))).toBeCloseTo(4.32, 6);
    expect(textStrokes("中", 6, [0, 0])).toHaveLength(1);
  });
});
