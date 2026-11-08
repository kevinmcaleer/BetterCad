import { parse, type Font } from "opentype.js";
import { layoutText, type GlyphFont, type PathCommand, type TextStyle, type Vec2 } from "@bettercad/sketch";
import inter from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import interBold from "@fontsource/inter/files/inter-latin-700-normal.woff?url";
import archivoBlack from "@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff?url";
import robotoSlab from "@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff?url";
import jetbrainsMono from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?url";
import stencil from "@fontsource/allerta-stencil/files/allerta-stencil-latin-400-normal.woff?url";
import { DEFAULT_FONT } from "./fonts";

/** The font files (loaded with the parser, on demand) and opentype.js turning them into glyph outlines. */
const URLS: Record<string, string> = {
  inter,
  "inter-bold": interBold,
  "archivo-black": archivoBlack,
  "roboto-slab": robotoSlab,
  "jetbrains-mono": jetbrainsMono,
  stencil,
};

const cache = new Map<string, Promise<GlyphFont>>();

export function glyphFont(id: string): Promise<GlyphFont> {
  const key = id in URLS ? id : DEFAULT_FONT;
  let p = cache.get(key);
  if (!p) {
    p = fetch(URLS[key]!)
      .then((r) => {
        if (!r.ok) throw new Error(`The font did not load (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => adapt(parse(buf)));
    // A failed load can be tried again.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export async function layOut(style: TextStyle): Promise<Vec2[][]> {
  return layoutText(await glyphFont(style.font), style);
}

/** opentype.js's font as the sketch package's GlyphFont. */
export function adapt(font: Font): GlyphFont {
  const os2 = font.tables.os2 as { sCapHeight?: number } | undefined;
  const hhea = font.tables.hhea as { lineGap?: number } | undefined;
  return {
    unitsPerEm: font.unitsPerEm,
    capHeight: os2?.sCapHeight || font.unitsPerEm * 0.7,
    ascender: font.ascender,
    descender: font.descender,
    lineGap: hhea?.lineGap ?? 0,
    glyph: (ch) => {
      const g = font.charToGlyph(ch);
      return { advance: g.advanceWidth ?? 0, commands: g.path.commands as PathCommand[] };
    },
    kerning: (a, b) => font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)),
  };
}
