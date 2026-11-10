import { Color } from "three";
import type { ColourName } from "@bettercad/ui";

/** The token colours the viewport draws with, read from the live theme's CSS custom properties. */
export const VIEW_COLOURS = [
  "viewport",
  "part-fill",
  "part-line",
  "part-line-dark",
  "part-highlight",
  "part-ghost",
  "snap",
  "snap-face",
  "snap-point",
  "snap-point-ring",
  "picked",
  "grid",
  "grid-major",
  "room",
  "axis-x",
  "axis-y",
  "axis-z",
  "stage",
  "accent",
  "ink",
  "muted",
  "danger",
  "warn",
  "rail",
  "line",
] as const satisfies readonly ColourName[];
export type ViewColour = (typeof VIEW_COLOURS)[number];
export type Palette = Record<ViewColour, Color>;

export function readPalette(el: Element = document.documentElement): Palette {
  const style = getComputedStyle(el);
  const out = {} as Palette;
  for (const name of VIEW_COLOURS) {
    const c = new Color();
    const v = style.getPropertyValue(`--bc-color-${name}`).trim();
    // Tokens may carry alpha (#rrggbbaa); three wants the colour alone.
    if (v) c.setStyle(v.length === 9 && v.startsWith("#") ? v.slice(0, 7) : v);
    out[name] = c;
  }
  return out;
}
