import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { overlayRoot, placeInWindow } from "./overlay";

const DELAY = 400;

/**
 * One tooltip for the whole app. Any element with `data-tip` shows it after 400ms of hover or on keyboard focus,
 * on `bar` with `shadow-pop`, kept inside the window. Mount <TooltipLayer /> once near the root.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: HTMLElement | null = null;
    const show = (el: HTMLElement, now: boolean) => {
      const text = el.dataset.tip;
      if (!text) return;
      current = el;
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => {
          if (current !== el || !el.isConnected) return;
          const r = el.getBoundingClientRect();
          const below = r.top < 40;
          setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
        },
        now ? 0 : DELAY,
      );
    };
    const hide = () => {
      current = null;
      window.clearTimeout(timer);
      setTip(null);
    };
    const over = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]");
      if (el && el !== current) show(el, false);
      else if (!el) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]");
      if (el && el.matches(":focus-visible")) show(el, false);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!tip) return null;
  return createPortal(<TooltipBubble {...tip} />, overlayRoot());
}

function TooltipBubble({ text, x, y, below }: { text: string; x: number; y: number; below: boolean }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  return (
    <div
      role="tooltip"
      className="bc-tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: "hidden" }}
      ref={(el) => {
        if (!el || pos) return;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        setPos(placeInWindow(x - w / 2, below ? y : y - h, w, h));
      }}
    >
      {text}
    </div>
  );
}

/** A static tooltip for the gallery. */
export function TooltipSample({ text }: { text: string }) {
  return (
    <div role="tooltip" className="bc-tooltip bc-tooltip-static">
      {text}
    </div>
  );
}
