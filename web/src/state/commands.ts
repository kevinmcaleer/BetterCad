import type { IconName } from "@bettercad/ui";

/** What a command's `when` can ask about. */
export interface CommandContext {
  hasSelection: boolean;
  inSketch: boolean;
  toolActive: boolean;
  canUndo: boolean;
  canRedo: boolean;
  dialogOpen: boolean;
}

export type CommandGroup = "File" | "Edit" | "Tools" | "Timeline" | "View" | "Panels" | "Theme" | "Help";

/** One action reachable from the keyboard, the command palette, menus and tool bars. */
export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  icon?: IconName;
  /** Key combos, such as "mod+z", "shift+mod+z", "m", "?". "mod" is Ctrl, or Cmd on a Mac. */
  keys?: string[];
  /** Extra words for the palette's search. */
  keywords?: string;
  /** Whether the command can run now. */
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const dev = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

/** Normalises a key event to "shift+mod+z" form. Shift is left out for printed symbols such as "?". */
export function comboOf(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): string {
  const key = e.key.toLowerCase();
  const parts: string[] = [];
  const symbol = e.key.length === 1 && !/[a-z0-9]/i.test(e.key);
  if (e.altKey) parts.push("alt");
  if (e.shiftKey && !symbol) parts.push("shift");
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  parts.push(key);
  return parts.join("+");
}

/** "shift+mod+z" → "Ctrl+Shift+Z" (or ⇧⌘Z on a Mac). */
export function formatCombo(combo: string, mac = isMac): string {
  const parts = combo.split("+");
  const key = parts.pop()!;
  const names: Record<string, string> = { escape: "Esc", delete: "Del", backspace: "Backspace", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→" };
  const pretty = key.length === 1 ? key.toUpperCase() : (names[key] ?? key[0]!.toUpperCase() + key.slice(1));
  if (mac) {
    const sym: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥" };
    return (
      ["shift", "alt", "mod"]
        .filter((o) => parts.includes(o))
        .map((p) => sym[p])
        .join("") + pretty
    );
  }
  const word: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt" };
  return [...["mod", "alt", "shift"].filter((o) => parts.includes(o)).map((p) => word[p]), pretty].join("+");
}

/** Is the event typed into a text field (a text input, a NumberField, a textarea)? */
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

/** Combos a text field keeps for itself even though they carry a modifier. */
const FIELD_KEYS = new Set(["mod+a", "mod+c", "mod+v", "mod+x", "mod+arrowleft", "mod+arrowright", "mod+backspace"]);

/**
 * The registry. Framework-free, so the viewport (#3) and the kernel bridge (#4) can register commands without
 * React. Registering a key another command already uses throws in development.
 */
export function createRegistry(getContext: () => CommandContext) {
  const commands = new Map<string, Command>();
  const listeners = new Set<() => void>();
  let version = 0;
  const notify = () => {
    version++;
    listeners.forEach((l) => l());
  };

  function register(list: Command | Command[]): () => void {
    const added = Array.isArray(list) ? list : [list];
    for (const c of added) {
      for (const k of c.keys ?? []) {
        const clash = [...commands.values()].find((o) => o.id !== c.id && o.keys?.includes(k));
        if (clash && dev) throw new Error(`Shortcut ${k} is already used by ${clash.id}; ${c.id} cannot take it.`);
      }
      commands.set(c.id, c);
    }
    notify();
    return () => {
      for (const c of added) if (commands.get(c.id) === c) commands.delete(c.id);
      notify();
    };
  }

  const enabled = (c: Command, ctx = getContext()) => !c.when || c.when(ctx);

  function run(id: string): boolean {
    const c = commands.get(id);
    const ctx = getContext();
    if (!c || !enabled(c, ctx)) return false;
    c.run(ctx);
    notify();
    return true;
  }

  /** Finds the command for a key event. Plain keys never fire while typing; modifier combos do, except a field's own. */
  function match(e: KeyboardEvent): Command | undefined {
    const combo = comboOf(e);
    if (isTyping(e.target) && (!combo.includes("mod") || FIELD_KEYS.has(combo))) return undefined;
    const ctx = getContext();
    return [...commands.values()].find((c) => c.keys?.includes(combo) && enabled(c, ctx));
  }

  /** Handles a keydown. Returns true when a command ran. */
  function dispatch(e: KeyboardEvent): boolean {
    const c = match(e);
    if (!c) return false;
    e.preventDefault();
    c.run(getContext());
    notify();
    return true;
  }

  return {
    register,
    run,
    match,
    dispatch,
    get: (id: string) => commands.get(id),
    list: () => [...commands.values()],
    enabled: (id: string) => {
      const c = commands.get(id);
      return !!c && enabled(c);
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    version: () => version,
  };
}

export type Registry = ReturnType<typeof createRegistry>;

/**
 * Fuzzy match for the palette: the query's letters in order. Returns a score (higher is better) or -1. Letters at
 * the start of a word and runs of letters score more.
 */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    const wordStart = found === 0 || /[\s\-/:(]/.test(t[found - 1]!);
    run = found === ti ? run + 1 : 0;
    score += 1 + (wordStart ? 3 : 0) + run * 2 - Math.min(found - ti, 3) * 0.5;
    ti = found + 1;
  }
  if (t.startsWith(q)) score += 5;
  return score;
}

/** Palette search over label, group and keywords, best first. */
export function search(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands;
  return commands
    .map((c) => {
      const s = Math.max(fuzzyScore(c.label, query), fuzzyScore(`${c.group} ${c.label}`, query) - 2, fuzzyScore(c.keywords ?? "", query) - 4);
      return { c, s };
    })
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}
