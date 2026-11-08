import { describe, expect, it } from "vitest";
import { newSketch, parseSketch, removeEntities, type Sketch, type SketchText } from "./model";
import { profiles, regions } from "./profiles";
import { layoutText, placedLoops, solidLoops, textAt, textBox, type GlyphFont, type PathCommand } from "./text";

/** A test font: every letter is a 600 × 700 unit block with a 200 × 300 hole, on a 1000-unit em, 700 tall capitals. */
const square = (x0: number, y0: number, x1: number, y1: number, cw = false): PathCommand[] => {
  const pts: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  if (cw) pts.reverse();
  return [{ type: "M", x: pts[0]![0], y: pts[0]![1] }, ...pts.slice(1).map(([x, y]) => ({ type: "L" as const, x, y })), { type: "Z" }];
};
const FONT: GlyphFont = {
  unitsPerEm: 1000,
  capHeight: 700,
  ascender: 800,
  descender: -200,
  lineGap: 0,
  glyph: (ch) => (ch === " " ? { advance: 300, commands: [] } : { advance: 700, commands: [...square(0, 0, 600, 700, true), ...square(200, 200, 400, 500)] }),
  kerning: (a, b) => (a === "A" && b === "V" ? -100 : 0),
};

function withText(t: Partial<SketchText> & { text: string }): Sketch {
  const s = newSketch();
  const loops = layoutText(FONT, { height: 7, letterSpacing: 0, lineSpacing: 1, ...t });
  return {
    ...s,
    entities: [{ id: "p1", kind: "point", x: 10, y: 20 }],
    texts: [{ id: "t1", p: "p1", font: "test", height: 7, angle: 0, letterSpacing: 0, lineSpacing: 1, loops, ...t }],
  };
}

describe("text", () => {
  it("scales to the capital height and lays letters out by their advance", () => {
    const loops = layoutText(FONT, { text: "AB", height: 7, letterSpacing: 0, lineSpacing: 1 });
    expect(loops).toHaveLength(4);
    const ys = loops.flat().map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(7);
    expect(Math.min(...loops[2]!.map((p) => p[0]))).toBeCloseTo(7);
  });

  it("adds letter spacing and kerning between letters, and lines go down by the line height", () => {
    const left = (text: string, spacing = 0) => Math.min(...layoutText(FONT, { text, height: 7, letterSpacing: spacing, lineSpacing: 1 })[2]!.map((p) => p[0]));
    expect(left("AB", 2)).toBeCloseTo(9);
    expect(left("AV")).toBeCloseTo(6);
    const two = layoutText(FONT, { text: "A\nB", height: 7, letterSpacing: 0, lineSpacing: 1.5 });
    // Line height 1000 units at 0.01 mm per unit, times 1.5.
    expect(Math.min(...two[2]!.map((p) => p[1]))).toBeCloseTo(-15);
    expect(layoutText(FONT, { text: " ", height: 7, letterSpacing: 0, lineSpacing: 1 })).toEqual([]);
  });

  it("flattens curves within a fine tolerance", () => {
    const font: GlyphFont = {
      ...FONT,
      glyph: () => ({
        advance: 500,
        commands: [{ type: "M", x: 0, y: 0 }, { type: "Q", x1: 500, y1: 1000, x: 1000, y: 0 }, { type: "Z" }],
      }),
    };
    const [loop] = layoutText(font, { text: "a", height: 7, letterSpacing: 0, lineSpacing: 1 });
    expect(loop!.length).toBeGreaterThan(8);
    // The peak of the curve is at (5, 5) mm.
    expect(Math.max(...loop!.map((p) => p[1]))).toBeCloseTo(5, 1);
  });

  it("is a closed profile with a hole for each letter, placed at its anchor and turned", () => {
    const s = withText({ text: "AB", angle: 90 });
    const pr = profiles(s).profiles;
    expect(pr).toHaveLength(2);
    expect(pr.every((p) => p.holes.length === 1)).toBe(true);
    expect(pr[0]!.area - pr[0]!.holes[0]!.area).toBeCloseTo(6 * 7 - 2 * 3);
    // Turned a quarter about the anchor (10, 20): the letters go up from it.
    const xs = pr.flatMap((p) => p.points.map((q) => q[0]));
    expect(Math.max(...xs)).toBeCloseTo(10);
    expect(Math.min(...xs)).toBeCloseTo(3);
    // Each letter and each hole is a region a click can pick.
    expect(regions(s)).toHaveLength(4);
  });

  it("leaves construction text out of profiles", () => {
    const s = withText({ text: "A" });
    expect(profiles({ ...s, texts: [{ ...s.texts![0]!, construction: true }] }).profiles).toHaveLength(0);
  });

  it("tells solid loops from the holes in letters", () => {
    const loops = layoutText(FONT, { text: "AB", height: 7, letterSpacing: 0, lineSpacing: 1 });
    expect([...solidLoops(loops)]).toEqual([0, 2]);
  });

  it("is found by its box, which turns with it", () => {
    const s = withText({ text: "AB" });
    expect(textAt(s, [12, 22])?.id).toBe("t1");
    expect(textAt(s, [5, 22])).toBeNull();
    expect(textAt(s, [9.5, 22], 1)?.id).toBe("t1");
    const box = textBox(s.texts![0]!, [10, 20]);
    expect(box[2]![0]).toBeCloseTo(23);
    expect(placedLoops({ loops: [[[1, 0]]], angle: 90 }, [0, 0])[0]![0]![1]).toBeCloseTo(1);
  });

  it("goes with its anchor, and takes its anchor when deleted", () => {
    const s = withText({ text: "A" });
    expect(removeEntities(s, ["p1"]).texts).toEqual([]);
    const gone = removeEntities(s, ["t1"]);
    expect(gone.texts).toEqual([]);
    expect(gone.entities).toEqual([]);
  });

  it("reads back from a file, and refuses text without its anchor", () => {
    const s = withText({ text: "A" });
    expect(parseSketch(JSON.parse(JSON.stringify(s))).texts).toHaveLength(1);
    expect(() => parseSketch({ ...s, entities: [] })).toThrow(/text/);
  });
});
