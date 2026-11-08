import type { Id, Sketch, SketchText, TextStyle, Vec2 } from "./model";
import { insidePolygon, polygonArea } from "./geom2d";

/**
 * Text in a sketch: words laid out in a font and flattened to closed outlines, so they extrude, cut and emboss like
 * any other shape. The font parser is not here: the app hands in a `GlyphFont` (opentype.js, loaded on demand), and
 * the outlines it makes are kept on the text, so profiles, the kernel and saved files never need the font again.
 */

/** A path command in font units, Y up: opentype.js's `glyph.path.commands`. */
export type PathCommand =
  | { type: "M" | "L"; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Z" };

export interface Glyph {
  /** Font units. */
  advance: number;
  commands: PathCommand[];
}

export interface GlyphFont {
  unitsPerEm: number;
  /** How tall capitals stand, font units: the text's height is measured to it. */
  capHeight: number;
  ascender: number;
  /** Negative, below the baseline. */
  descender: number;
  lineGap: number;
  glyph(char: string): Glyph;
  /** Extra space between a pair, font units (negative pulls them together). */
  kerning?(left: string, right: string): number;
}

export const TEXT_DEFAULTS: Omit<TextStyle, "text" | "font"> = { height: 10, angle: 0, letterSpacing: 0, lineSpacing: 1 };

/** How far a flattened curve strays from the true one, at most, mm. Fine enough to print, coarse enough to stay light. */
const TOLERANCE = 0.02;
const MAX_STEPS = 24;

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Lays text out from its anchor (the first line's baseline, at its left) and flattens each glyph to closed loops, in
 * mm, before any turn. Lines go down by the font's line height times `lineSpacing`; `letterSpacing` mm goes between
 * letters.
 */
export function layoutText(font: GlyphFont, style: Pick<TextStyle, "text" | "height" | "letterSpacing" | "lineSpacing">): Vec2[][] {
  const k = style.height / (font.capHeight || font.unitsPerEm * 0.7);
  const lineHeight = (font.ascender - font.descender + font.lineGap) * k * Math.max(0, style.lineSpacing);
  const loops: Vec2[][] = [];
  style.text.split(/\r?\n/).forEach((line, row) => {
    let x = 0;
    const y = -row * lineHeight;
    const chars = [...line];
    chars.forEach((ch, i) => {
      const g = font.glyph(ch);
      for (const l of flatten(g.commands, k, x, y)) loops.push(l);
      x += g.advance * k + style.letterSpacing;
      const next = chars[i + 1];
      if (next && font.kerning) x += font.kerning(ch, next) * k;
    });
  });
  return loops;
}

/** A glyph's contours as polylines, scaled by `k` and moved to (`ox`, `oy`). Open ends are closed; specks dropped. */
function flatten(cmds: PathCommand[], k: number, ox: number, oy: number): Vec2[][] {
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  let at: Vec2 = [0, 0];
  const P = (x: number, y: number): Vec2 => [ox + x * k, oy + y * k];
  // Points closer than this merge, so no edge is too short for the kernel to make.
  const MERGE = 1e-3;
  const push = (p: Vec2) => {
    const q: Vec2 = [r4(p[0]), r4(p[1])];
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > MERGE) cur.push(q);
  };
  const close = () => {
    while (cur.length > 1 && Math.hypot(cur[0]![0] - cur[cur.length - 1]![0], cur[0]![1] - cur[cur.length - 1]![1]) <= MERGE) cur.pop();
    cur = straighten(cur);
    if (cur.length >= 3 && Math.abs(polygonArea(cur)) > 1e-6) out.push(cur);
    cur = [];
  };
  for (const c of cmds) {
    if (c.type === "M") {
      close();
      at = P(c.x, c.y);
      push(at);
    } else if (c.type === "L") {
      at = P(c.x, c.y);
      push(at);
    } else if (c.type === "Q") {
      const p1 = P(c.x1, c.y1);
      const p2 = P(c.x, c.y);
      const dev = Math.hypot(at[0] - 2 * p1[0] + p2[0], at[1] - 2 * p1[1] + p2[1]) / 4;
      const n = steps(dev);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        push([u * u * at[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * at[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
      }
      at = p2;
    } else if (c.type === "C") {
      const p1 = P(c.x1, c.y1);
      const p2 = P(c.x2, c.y2);
      const p3 = P(c.x, c.y);
      const dev =
        (Math.max(Math.hypot(at[0] - 2 * p1[0] + p2[0], at[1] - 2 * p1[1] + p2[1]), Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1])) * 3) / 4;
      const n = steps(dev);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const d = 3 * u * t * t;
        const e = t * t * t;
        push([a * at[0] + b * p1[0] + d * p2[0] + e * p3[0], a * at[1] + b * p1[1] + d * p2[1] + e * p3[1]]);
      }
      at = p3;
    } else close();
  }
  close();
  return out;
}

/**
 * Drops points in line with their neighbours, including where an outline doubles back on itself (some fonts have
 * such spikes), which would leave edges lying on each other.
 */
function straighten(pts: Vec2[]): Vec2[] {
  const out = [...pts];
  for (let changed = true; changed && out.length >= 3;) {
    changed = false;
    for (let i = 0; i < out.length && out.length >= 3; i++) {
      const a = out[(i - 1 + out.length) % out.length]!;
      const b = out[i]!;
      const c = out[(i + 1) % out.length]!;
      const u: Vec2 = [b[0] - a[0], b[1] - a[1]];
      const v: Vec2 = [c[0] - b[0], c[1] - b[1]];
      const sin = (u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
      if (Math.abs(sin) < 1e-4) {
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}

const steps = (deviation: number) => Math.min(MAX_STEPS, Math.max(1, Math.ceil(Math.sqrt(deviation / TOLERANCE))));

/** A text's loops where they sit in the sketch: turned by its angle about the anchor, then moved to it. */
export function placedLoops(t: Pick<SketchText, "loops" | "angle">, anchor: Vec2): Vec2[][] {
  const a = (t.angle * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return t.loops.map((l) => l.map(([x, y]): Vec2 => [anchor[0] + x * c - y * s, anchor[1] + x * s + y * c]));
}

/** The loops of a text that are solid (not the holes in letters such as "o"): those inside an even number of others. */
export function solidLoops(loops: Vec2[][]): Set<number> {
  const out = new Set<number>();
  const areas = loops.map((l) => Math.abs(polygonArea(l)));
  loops.forEach((l, i) => {
    let depth = 0;
    loops.forEach((o, j) => {
      if (j !== i && areas[j]! > areas[i]! && insidePolygon(l[0]!, o)) depth++;
    });
    if (depth % 2 === 0) out.add(i);
  });
  return out;
}

/** The sketch's texts, placed: each with its anchor's position and its loops in sketch coordinates. */
export function textsOf(s: Sketch): { text: SketchText; loops: Vec2[][] }[] {
  const pts = new Map<Id, Vec2>();
  for (const e of s.entities) if (e.kind === "point") pts.set(e.id, [e.x, e.y]);
  return (s.texts ?? []).flatMap((t) => {
    const at = pts.get(t.p);
    return at ? [{ text: t, loops: placedLoops(t, at) }] : [];
  });
}

/** The box round a text as placed, in sketch coordinates: its corners, anticlockwise. Empty text gives a small box. */
export function textBox(t: Pick<SketchText, "loops" | "angle" | "height">, anchor: Vec2): Vec2[] {
  const xs = t.loops.flatMap((l) => l.map((p) => p[0]));
  const ys = t.loops.flatMap((l) => l.map((p) => p[1]));
  const [x0, x1, y0, y1] = xs.length ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] : [0, t.height * 0.6, 0, t.height];
  return placedLoops(
    {
      loops: [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
      ],
      angle: t.angle,
    },
    anchor,
  )[0]!;
}

/** The text whose box holds a point, or null. The last placed wins, as it draws on top. */
export function textAt(s: Sketch, p: Vec2, pad = 0): SketchText | null {
  const idx = new Map<Id, Vec2>();
  for (const e of s.entities) if (e.kind === "point") idx.set(e.id, [e.x, e.y]);
  const list = s.texts ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i]!;
    const at = idx.get(t.p);
    if (!at) continue;
    // Pad the box in the text's own frame, so a click just outside thin letters still counts.
    const box = textBox(t, at);
    const c: Vec2 = [(box[0]![0] + box[2]![0]) / 2, (box[0]![1] + box[2]![1]) / 2];
    const grown = box.map((q): Vec2 => {
      const d: Vec2 = [q[0] - c[0], q[1] - c[1]];
      const l = Math.hypot(d[0], d[1]) || 1;
      return [q[0] + (d[0] / l) * pad, q[1] + (d[1] / l) * pad];
    });
    if (insidePolygon(p, grown)) return t;
  }
  return null;
}
