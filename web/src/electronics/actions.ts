import type { ElectronicsDesign } from "@bettercad/electronics";
import { eui, type EView } from "./ui";

/** A change to the design, as the history store takes it: one undo step, merged with its neighbours by `key`. */
export type EEdit = (change: (d: ElectronicsDesign) => ElectronicsDesign, label: string, key?: string) => void;

/**
 * What the open view can do right now. The view fills these in while it is mounted, so the ribbon, the compact bar,
 * the keyboard and the browser can all ask for the same thing without knowing which view is up.
 */
export interface EActions {
  fit(): void;
  rotate(): void;
  mirror(): void;
  remove(): void;
  /** Lists what the board needs to match the schematic, in the change card. */
  push(): void;
  selectAll(): void;
}
export const eactions: { current: EActions | null } = { current: null };

/** Opens a view, or goes back to the model. The selection is carried across: a part stays picked in every view. */
export function showView(to: EView | null, d?: ElectronicsDesign): void {
  const ui = eui.get();
  if (ui.view === to) return;
  let selected = ui.selected;
  if (d && to && ui.view) {
    const sheet = d.sheets.find((s) => s.id === ui.sheet) ?? d.sheets[0];
    if (to === "pcb") {
      // Symbols become their parts.
      const partOf = new Map(d.sheets.flatMap((s) => s.symbols.map((y) => [y.id, y.part] as const)));
      selected = [...new Set(selected.flatMap((id) => (partOf.has(id) ? [partOf.get(id)!] : [])))];
    } else {
      const parts = new Set(selected);
      const here = sheet?.symbols.filter((y) => parts.has(y.part)).map((y) => y.id) ?? [];
      // A part on another sheet: go to the first sheet that has it.
      const other = here.length ? undefined : d.sheets.find((s) => s.symbols.some((y) => parts.has(y.part)));
      selected = other ? other.symbols.filter((y) => parts.has(y.part)).map((y) => y.id) : here;
      if (other) eui.set({ sheet: other.id });
    }
  }
  eui.set({
    view: to,
    selected: to ? selected : [],
    placing: null,
    schTool: "select",
    pcbTool: "select",
    card: null,
    focus: selected.length ? ui.focus + 1 : ui.focus,
  });
}
