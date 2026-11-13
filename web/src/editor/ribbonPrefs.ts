import { useEffect, useState } from "react";

/** The ribbon's tabs. Sketch takes over while a sketch is open. */
export type RibbonTab = "model" | "assemble" | "inspect" | "sketch";

/** Which tool bar shows: the ribbon on wide screens with a mouse, the compact bar elsewhere, or one of them always. */
export type ToolbarMode = "auto" | "ribbon" | "compact";

const MODE = "bettercad.toolbar";
const PINS = "bettercad.ribbonPins";
/** Wide enough for the ribbon's groups, with a mouse or trackpad to point at them. */
export const RIBBON_MEDIA = "(min-width: 1200px) and (pointer: fine)";

const listeners = new Set<() => void>();

export function toolbarMode(): ToolbarMode {
  try {
    const v = localStorage.getItem(MODE);
    return v === "ribbon" || v === "compact" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setToolbarMode(m: ToolbarMode): void {
  try {
    if (m === "auto") localStorage.removeItem(MODE);
    else localStorage.setItem(MODE, m);
  } catch {
    // Private windows may refuse storage; the choice lasts until the page closes.
  }
  listeners.forEach((f) => f());
}

/** True when the ribbon shows: the setting, or on Automatic the window's width and pointer. */
export function useRibbon(): boolean {
  const mq = typeof window !== "undefined" ? window.matchMedia?.(RIBBON_MEDIA) : undefined;
  const get = () => {
    const m = toolbarMode();
    return m === "ribbon" || (m === "auto" && !!mq?.matches);
  };
  const [on, setOn] = useState(get);
  useEffect(() => {
    const change = () => setOn(get());
    listeners.add(change);
    mq?.addEventListener?.("change", change);
    return () => {
      listeners.delete(change);
      mq?.removeEventListener?.("change", change);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return on;
}

/** The tools pinned big on each ribbon group, by "tab.group", where you have changed them. */
export function pinnedTools(): Record<string, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(PINS) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function setPinnedTools(pins: Record<string, string[]>): void {
  try {
    localStorage.setItem(PINS, JSON.stringify(pins));
  } catch {
    // Private windows may refuse storage; the pins last until the page closes.
  }
}
