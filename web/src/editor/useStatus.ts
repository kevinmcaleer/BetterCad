import { useCallback, useEffect, useRef, useState } from "react";

export interface Status {
  text: string;
  bad?: boolean;
}

/**
 * Status text for the top bar. A message clears after 5 seconds; an error stays until replaced. A quiet message
 * ("Autosaved") only shows when nothing else is showing, and clears sooner.
 */
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
    timer.current = bad ? undefined : window.setTimeout(() => setStatus({ text: "" }), 5000);
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
