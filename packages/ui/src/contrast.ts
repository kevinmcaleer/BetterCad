import { COLOURS, THEME_IDS, THEME_NAMES, type ColourName, type ThemeId } from "./tokens";

export type { ThemeId, ColourName };
export const THEMES: { id: ThemeId; name: string }[] = THEME_IDS.map((id) => ({ id, name: THEME_NAMES[id] }));

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h.slice(0, 6), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two opaque hex colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour token's hex value in a theme. */
export function colour(name: ColourName, theme: ThemeId): string {
  return COLOURS[theme][name];
}
