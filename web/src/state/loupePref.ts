/**
 * Whether the magnifier loupe opens by itself where points crowd the pointer (#387), in sketches and joints alike.
 * Kept in this browser; on unless you turn it off in Settings. Holding Alt opens it either way.
 */
const KEY = "bettercad.loupe";

export function loupeAuto(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setLoupeAuto(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "off");
  } catch {
    // Private windows may refuse storage; the loupe stays on.
  }
}
