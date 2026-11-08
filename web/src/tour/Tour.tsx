import { Suspense, lazy, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { drawRectangle, regions } from "@bettercad/sketch";
import { addExtrude, addSketch, seedOf, updateSketch, type ModelDoc } from "../state/document";
import type { Store } from "../state/store";
import type { View3DHandle } from "../viewport/View3D";
import type { ToolId } from "../editor/tools";
import { TOUR_STEPS, markTourDone, nextStep, tourDone } from "./tour";

/** The card itself loads when the tour starts, so it costs the first paint nothing. */
const TourCard = lazy(() => import("./TourCard").then((m) => ({ default: m.TourCard })));

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
      <Suspense fallback={null}>
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
      </Suspense>
    );
  return { card, start, onCamera, onExported };
}
