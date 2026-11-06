/** Selection rules shared by the parts tree and, later, the viewport (#3). Pure functions, tested on their own. */
export interface Modifiers {
  shift?: boolean;
  /** Ctrl, or Cmd on a Mac. */
  toggle?: boolean;
}

/**
 * The selection after clicking `id`. Plain click selects only it; Ctrl/Cmd adds or removes it; Shift selects the
 * range from the anchor (the last plain or Ctrl click) to it, in `order`.
 */
export function clickSelect(
  order: string[],
  selection: string[],
  anchor: string | null,
  id: string,
  mods: Modifiers = {},
): { selection: string[]; anchor: string } {
  if (mods.shift && anchor && order.includes(anchor)) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const range = order.slice(lo, hi + 1);
    const base = mods.toggle ? selection.filter((s) => !range.includes(s)) : [];
    return { selection: [...base, ...range], anchor };
  }
  if (mods.toggle) {
    const has = selection.includes(id);
    return { selection: has ? selection.filter((s) => s !== id) : [...selection, id], anchor: id };
  }
  return { selection: [id], anchor: id };
}
