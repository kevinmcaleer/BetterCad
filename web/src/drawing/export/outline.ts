import type { GlyphFont, PathCommand } from "@bettercad/sketch";
import type { Label } from "./scene";

/**
 * Text as the outlines of its letters (#569), so a PDF, a PNG and a print look the same on every machine with no
 * font to find. Millimetres, y up, like the rest of an export's scene.
 */
export function outline(label: Label, font: GlyphFont): PathCommand[] {
  const k = label.size / font.unitsPerEm;
  const chars = [...label.text];
  const advances = chars.map((ch, i) => font.glyph(ch).advance + (i + 1 < chars.length ? (font.kerning?.(ch, chars[i + 1]!) ?? 0) : 0));
  const width = advances.reduce((s, a) => s + a, 0) * k;
  let x = label.at[0] - (label.anchor === "middle" ? width / 2 : label.anchor === "end" ? width : 0);
  // "central" is the middle of the letters' box: halfway between the ascender and the descender.
  const y = label.baseline === "central" ? label.at[1] - ((font.ascender + font.descender) / 2) * k : label.at[1];
  const out: PathCommand[] = [];
  chars.forEach((ch, i) => {
    for (const c of font.glyph(ch).commands) {
      if (c.type === "Z") out.push(c);
      else if (c.type === "Q") out.push({ type: "Q", x1: x + c.x1 * k, y1: y + c.y1 * k, x: x + c.x * k, y: y + c.y * k });
      else if (c.type === "C") out.push({ type: "C", x1: x + c.x1 * k, y1: y + c.y1 * k, x2: x + c.x2 * k, y2: y + c.y2 * k, x: x + c.x * k, y: y + c.y * k });
      else out.push({ type: c.type, x: x + c.x * k, y: y + c.y * k });
    }
    x += advances[i]! * k;
  });
  if (!label.turn) return out;
  // Turned about where it is anchored.
  const [cs, sn] = [Math.cos(label.turn), Math.sin(label.turn)];
  const [ax, ay] = label.at;
  const spin = (px: number, py: number): [number, number] => [ax + (px - ax) * cs - (py - ay) * sn, ay + (px - ax) * sn + (py - ay) * cs];
  return out.map((c) => {
    if (c.type === "Z") return c;
    const [px, py] = spin(c.x, c.y);
    if (c.type === "Q") {
      const [x1, y1] = spin(c.x1, c.y1);
      return { type: "Q", x1, y1, x: px, y: py };
    }
    if (c.type === "C") {
      const [x1, y1] = spin(c.x1, c.y1);
      const [x2, y2] = spin(c.x2, c.y2);
      return { type: "C", x1, y1, x2, y2, x: px, y: py };
    }
    return { type: c.type, x: px, y: py };
  });
}

/** Every label of a scene as one run of outlines. */
export const outlines = (labels: Label[], font: GlyphFont): PathCommand[] => labels.flatMap((l) => outline(l, font));
