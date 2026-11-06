import { useEffect, useRef } from "react";
import { ESC, pushEscape } from "./escape";

/** While `active`, Escape runs `handler` before anything opened earlier. */
export function useEscape(active: boolean, handler: () => void, priority: number = ESC.overlay) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return pushEscape(() => ref.current(), priority);
  }, [active, priority]);
}
