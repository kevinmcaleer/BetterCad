import { Color } from "three";
import { cycleHsl } from "./cycleHue";

/**
 * Colour cycling (as Fusion's component colour cycling): a distinct colour for each key, in the order the keys first
 * come. The colours come from cycleHsl, which the timeline's component bars share.
 */
export function cycleColours(keys: readonly string[]): Map<string, Color> {
  const out = new Map<string, Color>();
  for (const k of keys) {
    if (out.has(k)) continue;
    const { h, s, l } = cycleHsl(out.size);
    out.set(k, new Color().setHSL(h, s, l));
  }
  return out;
}
