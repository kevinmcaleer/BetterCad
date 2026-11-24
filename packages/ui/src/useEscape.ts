import { useLayoutEffect, useRef } from "react";
import { ESC, pushEscape } from "./escape";

/** While `active`, Escape runs `handler` before anything opened earlier. */
export function useEscape(active: boolean, handler: () => void, priority: number = ESC.overlay) {
  const ref = useRef(handler);
  ref.current = handler;
  // A layout effect, so the layer is there before the screen shows what it closes: a passive effect can wait a frame
  // after a lazy sheet appears, and an Esc pressed in that frame went to the layer underneath.
  useLayoutEffect(() => {
    if (!active) return;
    return pushEscape(() => ref.current(), priority);
  }, [active, priority]);
}
