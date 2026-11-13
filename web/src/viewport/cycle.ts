import { Color } from "three";

/** The golden angle as a fraction of a turn: each next hue lands in the widest gap the ones before it left. */
const STEP = 0.381966;

/**
 * Colour cycling (as Fusion's component colour cycling): a distinct colour for each key, in the order the keys first
 * come. Hues step round the wheel by the golden angle from orange, and every third one is a little darker, so
 * neighbours differ even with many parts. Made from hue, not from a list, so no literal colours.
 */
export function cycleColours(keys: readonly string[]): Map<string, Color> {
  const out = new Map<string, Color>();
  for (const k of keys) {
    if (out.has(k)) continue;
    const i = out.size;
    const hue = (0.08 + i * STEP) % 1;
    out.set(k, new Color().setHSL(hue, 0.62, i % 3 === 2 ? 0.42 : 0.56));
  }
  return out;
}
