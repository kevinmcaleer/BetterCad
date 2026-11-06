import { useCallback, useEffect, useRef, useState } from "react";

export interface Status {
  text: string;
  bad?: boolean;
}

/** Status text for the top bar. A message clears after 5 seconds; an error stays until replaced. */
export function useStatus() {
  const [status, setStatus] = useState<Status>({ text: "" });
  const timer = useRef<number | undefined>(undefined);
  const say = useCallback((text: string, bad = false) => {
    window.clearTimeout(timer.current);
    setStatus({ text, bad });
    if (!bad) timer.current = window.setTimeout(() => setStatus({ text: "" }), 5000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [status, say] as const;
}
