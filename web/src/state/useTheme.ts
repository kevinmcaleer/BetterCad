import { useCallback, useEffect, useState } from "react";
import type { ThemeId } from "@bettercad/ui";
import { applyTheme, loadThemeSetting, resolveTheme, saveThemeSetting, systemPrefersDark, type ThemeSetting } from "./theme";

// Every useTheme on the page (the editor, the account pages) shares one choice.
const listeners = new Set<(t: ThemeSetting) => void>();

/** The theme: what you chose (`theme`, maybe "system") and what is applied (`resolved`). */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeSetting>(loadThemeSetting);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const resolved: ThemeId = resolveTheme(theme, prefersDark);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const on = () => setPrefersDark(!!mq?.matches);
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);

  useEffect(() => {
    listeners.add(setThemeState);
    return () => void listeners.delete(setThemeState);
  }, []);

  useEffect(() => applyTheme(resolved), [resolved]);

  // Saved only when you choose, never on load, so another tab's (or a test's) choice is not overwritten.
  const setTheme = useCallback((t: ThemeSetting) => {
    saveThemeSetting(t);
    for (const l of listeners) l(t);
    setThemeState(t);
  }, []);

  return { theme, setTheme, resolved };
}
