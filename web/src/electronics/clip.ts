import type { Clip } from "@bettercad/electronics";

const KEY = "bettercad.electronics.clip";
let held: Clip | null = null;

/** What was last copied off a schematic. Kept in the browser too, so it pastes into another model or another tab. */
export function setClip(clip: Clip): void {
  held = clip;
  try {
    localStorage.setItem(KEY, JSON.stringify(clip));
  } catch {
    // Too big or storage is off: it still pastes in this tab.
  }
}

export function getClip(): Clip | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null") as Clip | null;
    if (c && Array.isArray(c.symbols) && Array.isArray(c.wires) && Array.isArray(c.parts) && c.defs) return c;
  } catch {
    // Not ours, or storage is off.
  }
  return held;
}
