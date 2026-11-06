import type { ThemeId } from "@bettercad/ui";

export type ThemeSetting = ThemeId | "system";
export const THEME_KEY = "bettercad.theme";

export function loadThemeSetting(): ThemeSetting {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "holodeck" || v === "system") return v;
  } catch {
    /* storage blocked: fall through */
  }
  return "system";
}

export function saveThemeSetting(s: ThemeSetting) {
  try {
    localStorage.setItem(THEME_KEY, s);
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(s: ThemeSetting, prefersDark = systemPrefersDark()): ThemeId {
  if (s === "system") return prefersDark ? "dark" : "light";
  return s;
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
}
