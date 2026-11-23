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
  let x = label.anchor === "middle" ? label.at[0] - width / 2 : label.at[0];
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
  return out;
}

/** Every label of a scene as one run of outlines. */
export const outlines = (labels: Label[], font: GlyphFont): PathCommand[] => labels.flatMap((l) => outline(l, font));
