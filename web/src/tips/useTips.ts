import { useCallback, useEffect, useRef, useState } from "react";

/** Set once you put the tips away, so they don't come back on their own. Help → Tips still shows them. */
export const TIPS_KEY = "bettercad.tips.hidden";

/** How long after the editor is ready the tips appear, so they never compete with first paint. */
export const TIPS_DELAY_MS = 1500;

export function tipsHidden(): boolean {
  try {
    return localStorage.getItem(TIPS_KEY) === "1";
  } catch {
    return false;
  }
}

function hideTips() {
  try {
    localStorage.setItem(TIPS_KEY, "1");
  } catch {
    /* storage blocked: the tips show again next visit */
  }
}

/**
 * The tips card. It appears a moment after start-up until you dismiss it, and waits while the tour or the What's new
 * card is up (`enabled` false). Help → Tips shows it again. The shell holds only this hook; the card and its tips
 * load in their own chunk.
 */
export function useTips(enabled: boolean, delay = TIPS_DELAY_MS) {
  const [open, setOpen] = useState(false);
  // "auto": it appeared on its own; "help": you asked for it, so it grows out of the Help button.
  const [from, setFrom] = useState<"auto" | "help">("auto");
  const offered = useRef(false);

  useEffect(() => {
    if (!enabled || offered.current || tipsHidden()) return;
    const t = setTimeout(() => {
      offered.current = true;
      setFrom("auto");
      setOpen(true);
    }, delay);
    return () => clearTimeout(t);
  }, [enabled, delay]);

  const show = useCallback(() => {
    offered.current = true;
    setFrom("help");
    setOpen(true);
  }, []);
  /** Called once the card has finished shrinking into the Help button. */
  const dismiss = useCallback(() => {
    offered.current = true;
    hideTips();
    setOpen(false);
  }, []);

  return { open, from, show, dismiss };
}
