import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button, ESC, overlayRoot, useEscape } from "@bettercad/ui";
import { drawRectangle, regions } from "@bettercad/sketch";
import { addExtrude, addSketch, seedOf, updateSketch, type ModelDoc } from "../state/document";
import type { Store } from "../state/store";
import type { View3DHandle } from "../viewport/View3D";
import type { ToolId } from "../editor/tools";
import { SampleCards } from "../samples/SampleCards";
import { TOUR_FINISH, TOUR_STEPS, markTourDone, nextStep, tourDone, type TourAnchor } from "./tour";

/**
 * The first-run tour (#98): a card beside the control each step needs. It dims and blocks nothing; each step waits
 * for the person to do it (seen in the document and the editor's state), and Show me does it for them.
 */
export interface TourDeps {
  doc: ModelDoc;
  store: Store<ModelDoc>;
  view: RefObject<View3DHandle | null>;
  sketching: boolean;
  /** Share links never run it. */
  enabled: boolean;
  armTool: (id: ToolId) => void;
  openExport: () => void;
  openSample: (id: string) => void;
}

export interface TourApi {
  card: React.ReactNode;
  start: () => void;
  /** The camera moved. */
  onCamera: () => void;
  /** An export finished. */
  onExported: () => void;
}

export function useTour(d: TourDeps): TourApi {
  // null: not running; TOUR_STEPS.length: the closing card.
  const [step, setStep] = useState<number | null>(null);
  const [looked, setLooked] = useState(false);
  const [exported, setExported] = useState(false);
  const since = useRef(0);
  const deps = useRef(d);
  deps.current = d;

  const go = useCallback((n: number) => {
    setStep(n);
    setLooked(false);
    setExported(false);
    since.current = performance.now();
  }, []);

  const start = useCallback(() => go(0), [go]);
  const close = useCallback(() => {
    markTourDone();
    setStep(null);
  }, []);

  // The first visit, on an empty model.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !d.enabled) return;
    asked.current = true;
    if (!tourDone() && d.doc.features.length === 0) go(0);
  }, [d.enabled, d.doc.features.length, go]);
  useEffect(() => {
    if (!d.enabled && step !== null) setStep(null);
  }, [d.enabled, step]);

  // Moves on when the step is done.
  useEffect(() => {
    if (step === null || step >= TOUR_STEPS.length) return;
    const n = nextStep(step, { doc: d.doc, looked, sketching: d.sketching, exported });
    if (n !== step) go(n);
  }, [step, d.doc, d.sketching, looked, exported, go]);

  // Only a move the person made counts: the view also moves on its own (fitting, settling after a sketch).
  const touched = useRef(0);
  useEffect(() => {
    if (step === null) return;
    const on = (e: Event) => {
      if ((e.target as Element | null)?.closest?.(".bc-viewport")) touched.current = performance.now();
    };
    window.addEventListener("pointerdown", on, true);
    window.addEventListener("wheel", on, true);
    window.addEventListener("keydown", on, true);
    return () => {
      window.removeEventListener("pointerdown", on, true);
      window.removeEventListener("wheel", on, true);
      window.removeEventListener("keydown", on, true);
    };
  }, [step]);
  const onCamera = useCallback(() => {
    const now = performance.now();
    if (touched.current > since.current && now - touched.current < 2000) setLooked(true);
  }, []);
  const onExported = useCallback(() => setExported(true), []);

  const showMe = useCallback(() => {
    const x = deps.current;
    const id = TOUR_STEPS[step ?? 0]?.id;
    if (id === "look") {
      x.view.current?.preset("front");
      setTimeout(() => x.view.current?.preset("iso"), 700);
      setTimeout(() => setLooked(true), 1400);
    } else if (id === "sketch") {
      // A fixed 40 × 30 mm rectangle on the ground, with its sizes typed, so the demonstration is the same each time.
      x.store.edit((doc) => {
        const added = addSketch(doc, { kind: "world", plane: "XY", offset: 0 });
        const f = added.features.at(-1)!;
        return updateSketch(added, f.id, (s) => drawRectangle(s, [-20, -15], [20, 15], { width: 40, height: 30 }).sketch);
      }, "Sketch a rectangle");
      x.view.current?.preset("iso");
    } else if (id === "extrude") {
      x.store.edit((doc) => {
        const f = [...doc.features].reverse().find((g) => g.type === "sketch");
        const region = f?.type === "sketch" ? regions(f.sketch)[0] : undefined;
        if (!f || !region) return doc;
        return addExtrude(doc, { sketch: f.id, seeds: [seedOf(region)], distance: 10, direction: "one", operation: "new" });
      }, "Extrude 10 mm");
    } else if (id === "fillet") {
      x.armTool("fillet");
    } else if (id === "export") {
      x.openExport();
    }
  }, [step]);

  useEscape(step !== null, close, ESC.panel);

  const card =
    step === null ? null : (
      <TourCard
        key={step}
        step={step}
        onBack={() => go(Math.max(0, step - 1))}
        onSkip={close}
        onShowMe={showMe}
        onSample={(sample) => {
          close();
          d.openSample(sample);
        }}
      />
    );
  return { card, start, onCamera, onExported };
}

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

function TourCard(p: { step: number; onBack: () => void; onSkip: () => void; onShowMe: () => void; onSample: (id: string) => void }) {
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
