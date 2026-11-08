import { COLOURS, type ThemeId } from "@bettercad/ui";

export type ThemeSetting = ThemeId | "system";
export const THEME_KEY = "bettercad.theme";

/** Holodeck is now Holoroom: a choice saved under the old id still loads. */
export function renamedTheme<T extends string | null | undefined>(v: T): T | "holoroom" {
  return v === "holodeck" ? "holoroom" : v;
}

export function loadThemeSetting(): ThemeSetting {
  try {
    let v = localStorage.getItem(THEME_KEY);
    v = renamedTheme(v);
    if (v === "light" || v === "dark" || v === "holoroom" || v === "system") return v;
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

/** Sets data-theme on <html> and matches the browser chrome (theme-color) to the theme's bar. */
export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = COLOURS[theme].bar;
}
