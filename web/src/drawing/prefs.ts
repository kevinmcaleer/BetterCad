import { SHEET_SIZES, type DrawingStandard, type SheetSize } from "@bettercad/kernel/drawing";

/** The sheet you last set up, so the next New drawing starts the same way (#560). */
export interface SheetPick {
  size: SheetSize;
  landscape: boolean;
  /** Left out while the standard follows the page size. */
  standard?: DrawingStandard;
  border: boolean;
}

const KEY = "bettercad.sheet";
export const FIRST_PICK: SheetPick = { size: "A4", landscape: true, border: true };

export function lastSheet(): SheetPick {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SheetPick> | null;
    if (!v || typeof v.size !== "string" || !(v.size in SHEET_SIZES)) return FIRST_PICK;
    const pick: SheetPick = { size: v.size, landscape: v.landscape !== false, border: v.border !== false };
    if (v.standard === "iso" || v.standard === "asme") pick.standard = v.standard;
    return pick;
  } catch {
    return FIRST_PICK;
  }
}

export function rememberSheet(pick: SheetPick): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pick));
  } catch {
    // Private windows may refuse storage; the next drawing starts from A4.
  }
}
