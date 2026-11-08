import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, overlayRoot } from "@bettercad/ui";
import { SampleCards } from "../samples/SampleCards";
import { TOUR_FINISH, TOUR_STEPS, type TourAnchor } from "./tour";

/** Where the card goes: below a toolbar button, or near the bottom of the view; always on screen. */
function place(anchor: TourAnchor, card: HTMLElement): { left: number; top: number } {
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  let target: DOMRect | undefined;
  if (anchor.kind === "button") {
    const buttons = [...document.querySelectorAll<HTMLElement>(".bc-app button")];
    const el = buttons.find((b) => b.offsetParent && (b.textContent ?? "").trim().startsWith(anchor.label));
    target = el?.getBoundingClientRect();
  }
  if (target) return { left: clamp(target.left + target.width / 2 - w / 2, 8, vw - w - 8), top: clamp(target.bottom + 10, 8, vh - h - 8) };
  const view = document.querySelector(".bc-viewport")?.getBoundingClientRect();
  if (view) return { left: clamp(view.left + 16, 8, vw - w - 8), top: clamp(view.bottom - h - 56, 8, vh - h - 8) };
  return { left: clamp(vw / 2 - w / 2, 8, vw), top: vh - h - 24 };
}

export function TourCard(p: { step: number; onBack: () => void; onSkip: () => void; onShowMe: () => void; onSample: (id: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const s = TOUR_STEPS[p.step];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anchor: TourAnchor = s?.anchor ?? { kind: "view" };
    const move = () => setAt(place(anchor, el));
    move();
    window.addEventListener("resize", move);
    // Toolbars can move as panels open; follow them.
    const t = setInterval(move, 500);
    return () => {
      window.removeEventListener("resize", move);
      clearInterval(t);
    };
  }, [s]);

  // Focus moves into the card on each step, without scrolling the page.
  const placed = at !== null;
  useEffect(() => {
    if (placed) ref.current?.focus({ preventScroll: true });
  }, [placed]);

  const title = s ? s.title : TOUR_FINISH.title;
  return createPortal(
    <section
      ref={ref}
      className="bc-tour"
      role="dialog"
      aria-modal="false"
      aria-live="polite"
      aria-labelledby="bc-tour-title"
      tabIndex={-1}
      style={at ? { left: at.left, top: at.top } : { visibility: "hidden" }}
    >
      <div className="bc-tour-head">
        <h2 id="bc-tour-title" className="bc-tour-title">
          {title}
        </h2>
        {s && (
          <span className="bc-tour-count">
            {p.step + 1} of {TOUR_STEPS.length}
          </span>
        )}
      </div>
      {s ? (
        <p className="bc-tour-body">{s.body}</p>
      ) : (
        <>
          <p className="bc-tour-body">{TOUR_FINISH.body}</p>
          <SampleCards onOpen={p.onSample} title="Samples" />
          {/* The Learn course (#12, #110) goes here when it's written. */}
        </>
      )}
      <div className="bc-tour-actions">
        {s ? (
          <>
            <Button size="dense" label="Skip" onClick={p.onSkip} />
            <span className="bc-grow" />
            <Button size="dense" label="Back" disabled={p.step === 0} onClick={p.onBack} />
            <Button size="dense" variant="primary" label="Show me" onClick={p.onShowMe} />
          </>
        ) : (
          <>
            <span className="bc-grow" />
            <Button size="dense" variant="primary" label="Done" onClick={p.onSkip} />
          </>
        )}
      </div>
    </section>,
    overlayRoot(),
  );
}
