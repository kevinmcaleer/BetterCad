import { useCallback, useEffect, useRef, useState } from "react";

export interface Status {
  text: string;
  bad?: boolean;
}

/** A save notice in the top-right toast. `id` changes with every notice so its fade starts over. */
export interface Toast {
  text: string;
  id: number;
}

/** How long an error stays: long enough to read, not so long it outlives the problem. */
export const ERROR_MS = 12000;
/** How long a toast stays, fade in and out included. Short, so it never sits over the view or a panel for long. */
export const TOAST_MS = 3000;

/**
 * Status text over the help line, and a toast at the top right of the view. A message clears after 5 seconds and
 * an error after 12, so an old error ("No value called hole") never sits there after it has been put right.
 * A toast ("Autosaved", "Saved to Bracket.bcad") floats over the view and fades out, so a save never moves the
 * timeline or anything else.
 */
export function useStatus() {
  const [status, setStatus] = useState<Status>({ text: "" });
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const showing = useRef(false);
  /** `asToast` "minor" (Autosaved) never covers a toast still showing, such as "Saved Bracket to your account". */
  const say = useCallback((text: string, bad = false, asToast: boolean | "minor" = false) => {
    if (asToast && !bad) {
      if (asToast === "minor" && showing.current) return;
      showing.current = asToast !== "minor";
      setToast((t) => ({ text, id: (t?.id ?? 0) + 1 }));
      return;
    }
    window.clearTimeout(timer.current);
    setStatus({ text, bad });
    timer.current = window.setTimeout(() => setStatus({ text: "" }), bad ? ERROR_MS : 5000);
  }, []);
  // The toast's clock starts once it is on screen, not when it was asked for: a save that ends in a long frame (the
  // thumbnail render) would otherwise spend the whole 3 s before the toast was ever drawn.
  const toastId = toast?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    toastTimer.current = window.setTimeout(() => {
      showing.current = false;
      setToast(null);
    }, TOAST_MS);
    return () => window.clearTimeout(toastTimer.current);
  }, [toastId]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [status, say, toast] as const;
}
