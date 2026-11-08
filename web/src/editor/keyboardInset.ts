/**
 * How much of the bottom of the window an on-screen keyboard covers, in CSS px. iPad and iPhone Safari keep the
 * layout the same size and shrink only the visual viewport, so a bar pinned to the bottom ends up under the keys.
 */
export function keyboardInset(w: { innerHeight: number; visualViewport?: { height: number; offsetTop: number } | null }): number {
  const v = w.visualViewport;
  if (!v) return 0;
  const covered = w.innerHeight - v.height - v.offsetTop;
  // Small gaps are browser chrome sliding about, not a keyboard.
  return covered > 60 ? Math.round(covered) : 0;
}

/** Keeps `--bc-keyboard` on the element up to date, so floating bars can sit above the keyboard. Returns a stop function. */
export function trackKeyboard(el: HTMLElement, w: Window = window): () => void {
  const v = w.visualViewport;
  if (!v) return () => undefined;
  const publish = () => el.style.setProperty("--bc-keyboard", keyboardInset(w) + "px");
  publish();
  v.addEventListener("resize", publish);
  v.addEventListener("scroll", publish);
  return () => {
    v.removeEventListener("resize", publish);
    v.removeEventListener("scroll", publish);
  };
}
