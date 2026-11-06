import type { IconName } from "@bettercad/ui";

/** One action reachable from the keyboard, the command palette and the shortcut map. */
export interface Command {
  id: string;
  label: string;
  group: "File" | "Edit" | "Tools" | "View" | "Panels" | "Theme" | "Help";
  icon?: IconName;
  /** Key combos, such as "mod+z", "shift+mod+z", "m", "?". "mod" is Ctrl, or Cmd on a Mac. */
  keys?: string[];
  run: () => void;
  enabled?: boolean;
  /** Extra words for the palette's search. */
  keywords?: string;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Normalises a key event to "shift+mod+z" form. Shift is left out for printed symbols such as "?". */
export function comboOf(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const parts: string[] = [];
  const symbol = e.key.length === 1 && !/[a-z0-9]/i.test(e.key);
  if (e.altKey) parts.push("alt");
  if (e.shiftKey && !symbol) parts.push("shift");
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  parts.push(key);
  return parts.join("+");
}

/** "shift+mod+z" → "Ctrl+Shift+Z" (or ⌘⇧Z on a Mac). */
export function formatCombo(combo: string, mac = isMac): string {
  const parts = combo.split("+");
  const key = parts.pop()!;
  const pretty = key.length === 1 ? key.toUpperCase() : key === "escape" ? "Esc" : key === "delete" ? "Del" : key[0]!.toUpperCase() + key.slice(1);
  if (mac) {
    const sym: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥" };
    return parts.map((p) => sym[p] ?? p).join("") + pretty;
  }
  const word: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt" };
  const order = ["mod", "alt", "shift"];
  return [...order.filter((o) => parts.includes(o)).map((p) => word[p]), pretty].join("+");
}

/** Is the event typed into a text field? Single-key shortcuts must not fire there. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "submit", "reset", "color"].includes(type);
  }
  return false;
}

/** Finds the command for a key event, or undefined. Plain keys are skipped while typing; mod combos are not. */
export function match(commands: Command[], e: KeyboardEvent): Command | undefined {
  const combo = comboOf(e);
  const typing = isTyping(e.target);
  if (typing && !combo.includes("mod")) return undefined;
  // Undo/redo inside a text field belong to the field.
  if (typing && (combo === "mod+z" || combo === "shift+mod+z" || combo === "mod+y")) return undefined;
  return commands.find((c) => c.enabled !== false && c.keys?.includes(combo));
}

/** Palette search: every word must appear in the label, group or keywords. */
export function search(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  return commands.filter((c) => {
    const hay = `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
