import { useEffect, type RefObject } from "react";

/** Calls onClose on a pointer press outside `ref`. (Escape is layered: see useEscape.) */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, ignore?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ignore?.current?.contains(t)) return;
      if (ref.current && !ref.current.contains(t)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [ref, open, onClose, ignore]);
}
