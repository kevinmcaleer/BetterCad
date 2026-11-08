import type { TextStyle, Vec2 } from "@bettercad/sketch";

/**
 * The fonts the Text tool offers: open-licence faces bundled with the app (OFL, Roboto Slab Apache 2.0), Latin
 * letters. Only this list is in the first load; a font and the glyph parser load the first time text uses them.
 */
export interface FontChoice {
  id: string;
  label: string;
}

export const FONTS: FontChoice[] = [
  { id: "inter", label: "Inter" },
  { id: "inter-bold", label: "Inter Bold" },
  { id: "archivo-black", label: "Archivo Black" },
  { id: "roboto-slab", label: "Roboto Slab" },
  { id: "jetbrains-mono", label: "JetBrains Mono" },
  { id: "stencil", label: "Allerta Stencil" },
];

export const DEFAULT_FONT = "inter";

export const fontLabel = (id: string) => FONTS.find((f) => f.id === id)?.label ?? id;

/** A text's outline in its font, laid out in the lazy chunk so the layout code stays out of the first load too. */
export function layOut(style: TextStyle): Promise<Vec2[][]> {
  return import("./glyphs").then((m) => m.layOut(style));
}
