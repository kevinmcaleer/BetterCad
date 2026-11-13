/** The golden angle as a fraction of a turn: each next hue lands in the widest gap the ones before it left. */
const STEP = 0.381966;

/**
 * The colour cycle's nth colour as hue, saturation and lightness, each 0 to 1. Hues step round the wheel by the golden
 * angle from orange, and every third one is a little darker, so neighbours differ even with many parts. Made from hue,
 * not from a list, so no literal colours. The view (cycle.ts) and the timeline's component bars share it.
 */
export function cycleHsl(i: number): { h: number; s: number; l: number } {
  return { h: (0.08 + i * STEP) % 1, s: 0.62, l: i % 3 === 2 ? 0.42 : 0.56 };
}

/** The nth colour as a CSS colour, for a style. */
export function cycleCss(i: number): string {
  const { h, s, l } = cycleHsl(i);
  return `hsl(${Math.round(h * 360)}deg ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}
