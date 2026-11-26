import type { Clip } from "@bettercad/electronics";
import type { BoardClip } from "@bettercad/electronics/pcb/clip";

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

const BOARD_KEY = "bettercad.electronics.board-clip";
let boardHeld: BoardClip | null = null;

/** What was last copied off a board (#741), kept the same way as the schematic's. */
export function setBoardClip(clip: BoardClip): void {
  boardHeld = clip;
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(clip));
  } catch {
    // Too big or storage is off: it still pastes in this tab.
  }
}

export function getBoardClip(): BoardClip | null {
  try {
    const c = JSON.parse(localStorage.getItem(BOARD_KEY) ?? "null") as BoardClip | null;
    if (c && c.kind === "board" && Array.isArray(c.tracks) && Array.isArray(c.vias) && Array.isArray(c.parts)) return c;
  } catch {
    // Not ours, or storage is off.
  }
  return boardHeld;
}
