import { useCallback, useEffect, useRef, useState } from "react";

export interface Status {
  text: string;
  bad?: boolean;
}

/**
 * Status text for the top bar. A message clears after 5 seconds and an error after 12, so an old error ("No value
 * called hole") never sits there after it has been put right. A quiet message
 * ("Autosaved") only shows when nothing else is showing, and clears sooner.
 */
/** How long an error stays: long enough to read, not so long it outlives the problem. */
export const ERROR_MS = 12000;

export function useStatus() {
  const [status, setStatus] = useState<Status>({ text: "" });
  const timer = useRef<number | undefined>(undefined);
  const quietTimer = useRef<number | undefined>(undefined);
  const say = useCallback((text: string, bad = false, quiet = false) => {
    if (quiet) {
      setStatus((s) => (s.text ? s : { text }));
      window.clearTimeout(quietTimer.current);
      quietTimer.current = window.setTimeout(() => setStatus((s) => (s.text === text && !s.bad ? { text: "" } : s)), 2000);
      return;
    }
    window.clearTimeout(timer.current);
    setStatus({ text, bad });
    timer.current = window.setTimeout(() => setStatus({ text: "" }), bad ? ERROR_MS : 5000);
  }, []);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(quietTimer.current);
    },
    [],
  );
  return [status, say] as const;
}
