/** The colours the canvases draw with, read from the design system's tokens so they follow the theme. */
const NAMES = [
  "viewport",
  "ink",
  "muted",
  "line",
  "accent",
  "on-accent",
  "snap",
  "danger",
  "ec-wire",
  "ec-symbol",
  "ec-symbol-fill",
  "ec-pcb-bg",
  "ec-pcb-ink",
  "ec-board",
  "ec-edge",
  "ec-copper-top",
  "ec-copper-bottom",
  "ec-copper-in1",
  "ec-copper-in2",
  "ec-copper-in3",
  "ec-copper-in4",
  "ec-pad",
  "ec-silk",
  "ec-silk-far",
  "ec-courtyard",
  "ec-hole",
  "ec-mark",
  "ec-pick",
] as const;
export type ColourKey = (typeof NAMES)[number];
export type Colours = Record<ColourKey, string> & { font: string; mono: string };

export function readColours(el: Element | null): Colours {
  const style = el && typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  const get = (name: string) => style?.getPropertyValue(name).trim() || "currentColor";
  const out = { font: get("--bc-font-sans"), mono: get("--bc-font-mono") } as Colours;
  for (const n of NAMES) out[n] = get(`--bc-color-${n}`);
  return out;
}
