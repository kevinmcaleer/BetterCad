import type { P2 } from "../model";

/**
 * A stroke font for silkscreen and copper text (#655). Board houses are sent lines, not fonts, so text is drawn as
 * strokes with a round pen. Each glyph sits on a grid 4 wide and 6 tall (a capital's height); a stroke is a run of
 * "xy" digit pairs, and strokes are split by spaces. Small letters are drawn as small capitals, so "m" and "M" still
 * read apart. Our own drawing, no font file.
 */
const O = "100105163645413010";
const P = "00063645443303";
const GLYPHS: Record<string, string> = {
  A: "0004264440 0242",
  B: "00063645443303 3342413000",
  C: "4536160501103041",
  D: "00062644422000",
  E: "46060040 0333",
  F: "460600 0333",
  G: "45361605011030414323",
  H: "0006 4046 0343",
  I: "1030 1636 2026",
  J: "0110304146",
  K: "0006 4602 1340",
  L: "060040",
  M: "0006234640",
  N: "00064046",
  O,
  P,
  Q: `${O} 2240`,
  R: `${P} 2340`,
  S: "453616050413334241301001",
  T: "0646 2026",
  U: "060110304146",
  V: "062046",
  W: "0610233046",
  X: "0046 0640",
  Y: "062346 2320",
  Z: "06460040",
  "0": `${O} 1135`,
  "1": "152620 1030",
  "2": "05163645440040",
  "3": "0516364544334241301001 1333",
  "4": "30360242",
  "5": "460603334241301001",
  "6": "4536160501103041423303",
  "7": "064610",
  "8": "13040516364544331302011030414233",
  "9": "0110304145361605041343",
  ".": "2020",
  ",": "2110",
  ":": "2121 2424",
  ";": "2110 2424",
  "-": "1343",
  "+": "0343 2125",
  "/": "0046",
  "\\": "0640",
  _: "0040",
  "=": "0242 0444",
  "(": "36242230",
  ")": "16242210",
  "[": "36161030",
  "]": "16363010",
  "%": "0046 0606 4040",
  "#": "1016 3036 0242 0444",
  "*": "1145 1541 0343",
  "!": "2226 2020",
  "?": "05163645442322 2020",
  "<": "460340",
  ">": "064300",
  "'": "2624",
  '"': "1614 3634",
  "&": "40150616252401103042",
  "~": "0314233243",
  "|": "2026",
  "^": "042644",
  µ: "0400 02113142 4441",
  Ω: "001012030516364543323040",
  "°": "1526352415",
};
/** Drawn for a character the font has no glyph for. */
const BOX = "0006464000";

/** Every glyph the font draws, for its test. */
export const FONT_GLYPHS: Readonly<Record<string, string>> = GLYPHS;

const strokes = (g: string): P2[][] =>
  g
    .split(" ")
    .filter(Boolean)
    .map((s) => Array.from({ length: s.length / 2 }, (_, i): P2 => [Number(s[2 * i]), Number(s[2 * i + 1])]));

/** A character's strokes on the grid, and how tall it is drawn against a capital (1). */
function glyph(ch: string): { lines: P2[][]; scale: number } {
  if (ch === " ") return { lines: [], scale: 1 };
  if (GLYPHS[ch]) return { lines: strokes(GLYPHS[ch]), scale: 1 };
  const up = ch.toUpperCase();
  if (up !== ch && up.length === 1 && GLYPHS[up]) return { lines: strokes(GLYPHS[up]), scale: 0.72 };
  return { lines: strokes(BOX), scale: 1 };
}

/** How far the pen moves on per character, in grid units: 4 for the glyph and 2 of space. */
const ADVANCE = 6;

/** Capital height of a part's name on the silkscreen, mm. */
export const REF_SIZE = 1;

/** From one line's baseline down to the next, in capital heights. */
export const LINE_GAP = 1.6;

function lineWidth(text: string, size: number): number {
  let w = 0;
  let last = 1;
  for (const ch of text) {
    last = glyph(ch).scale;
    w += ADVANCE * last;
  }
  // The space after the last character is not part of the text: a small letter's is smaller (#730).
  return text ? ((w - 2 * last) * size) / 6 : 0;
}

/** How wide text is, mm, for capitals `size` tall: its widest line. */
export function textWidth(text: string, size: number): number {
  return Math.max(0, ...text.split("\n").map((l) => lineWidth(l, size)));
}

/** The pen width that suits text of a size: 15% of a capital's height. */
export const penFor = (size: number, least = 0): number => Math.max(least, Math.round(size * 150) / 1000);

/**
 * Text as strokes, mm. `at` is where the text is anchored: its left end, middle or right end along the baseline
 * (`align`), and the baseline itself or the middle of a capital (`middle`). `angle` turns it anticlockwise about the
 * anchor. `mirror` flips it left to right about the anchor, for text read from the bottom of the board. The anchor
 * is the first line's; further lines go below it.
 */
export function textStrokes(
  text: string,
  size: number,
  at: P2,
  opts: { angle?: number; align?: "left" | "centre" | "right"; middle?: boolean; mirror?: boolean } = {},
): P2[][] {
  const k = size / 6;
  const a = ((opts.angle ?? 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out: P2[][] = [];
  text.split("\n").forEach((row, n) => {
    const width = lineWidth(row, size);
    const x0 = opts.align === "centre" ? -width / 2 : opts.align === "right" ? -width : 0;
    const y0 = (opts.middle ? -size / 2 : 0) - n * size * LINE_GAP;
    let pen = 0;
    for (const ch of row) {
      const g = glyph(ch);
      for (const line of g.lines)
        out.push(
          line.map(([gx, gy]): P2 => {
            let x = x0 + (pen + gx * g.scale) * k;
            const y = y0 + gy * g.scale * k;
            if (opts.mirror) x = -x;
            return [Math.round((at[0] + x * c - y * s) * 1e6) / 1e6, Math.round((at[1] + x * s + y * c) * 1e6) / 1e6];
          }),
        );
      pen += ADVANCE * g.scale;
    }
  });
  return out;
}
