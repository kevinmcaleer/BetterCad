import { useCallback, useEffect, useState } from "react";

/**
 * Where BetterCad is in its life. Change this (and the words in StageNotice.tsx) to move to "beta": everyone sees the
 * notice once more. Keep `web/playwright.config.ts` in step, so the end-to-end tests start with it put away.
 */
export const STAGE: "alpha" | "beta" = "alpha";

/** The stage you last put the notice away for. */
export const STAGE_KEY = "bettercad.stage.seen";

/** How long after start-up the notice appears, so it never competes with first paint. */
export const STAGE_DELAY_MS = 1000;

export function stageSeen(): boolean {
  try {
    return localStorage.getItem(STAGE_KEY) === STAGE;
  } catch {
    return false;
  }
}

/**
 * The "BetterCad is in alpha" notice: it appears once, a moment after your first visit, until you put it away. It waits
 * while `enabled` is false. The shell holds only this hook; the notice loads in its own chunk.
 */
export function useStageNotice(enabled = true, delay = STAGE_DELAY_MS) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled || stageSeen()) return;
    const t = setTimeout(() => setOpen(true), delay);
    return () => clearTimeout(t);
  }, [enabled, delay]);

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(STAGE_KEY, STAGE);
    } catch {
      /* storage blocked: the notice shows again next visit */
    }
  }, []);

  return { open, dismiss };
}
