import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { MeasureResult, TopoRef } from "@bettercad/kernel";
import type { ModelDoc, Part } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine, ScreenPoint } from "../viewport/engine";
import type { Pick } from "../viewport/ids";
import { MeasureOverlay } from "./overlay";

/**
 * The Measure tool (#71): click one thing for what it is, a second for the distance and angle between them. A third
 * click starts again; Alt-click takes the whole body. The numbers come from the kernel's exact B-rep and follow the
 * model as it changes.
 */
export interface MeasureDeps {
  doc: ModelDoc;
  parts: Part[];
  view: RefObject<View3DHandle>;
  active: boolean;
  measure: (refs: TopoRef[]) => Promise<MeasureResult | null>;
}

/** The nearest thing under the pointer: a vertex, then an edge, then a face. */
export function pickAny(eng: { pick: Engine["pick"] }, p: ScreenPoint, body: boolean): Pick | null {
  if (body) return eng.pick(p.x, p.y, "body");
  return eng.pick(p.x, p.y, "vertex") ?? eng.pick(p.x, p.y, "edge") ?? eng.pick(p.x, p.y, "face");
}

export function useMeasure(d: MeasureDeps) {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [result, setResult] = useState<MeasureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [components, setComponents] = useState(false);
  const deps = useRef(d);
  deps.current = d;
  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);

  // Leaving the tool clears the measurement.
  useEffect(() => {
    if (!d.active) {
      setPicks([]);
      setResult(null);
      setError(null);
    }
  }, [d.active]);

  // A body that goes away takes its picks with it.
  useEffect(() => {
    setPicks((ps) => (ps.every((p) => d.parts.some((x) => x.id === p.body)) ? ps : ps.filter((p) => d.parts.some((x) => x.id === p.body))));
  }, [d.parts]);

  // Ask the kernel each time the picks or the model change.
  useEffect(() => {
    if (!picks.length) {
      setResult(null);
      setError(null);
      return;
    }
    let stale = false;
    deps.current.measure(picks.map((p) => ({ body: p.body, kind: p.kind, index: p.index }))).then(
      (r) => {
        if (stale) return;
        setResult(r);
        setError(r ? null : "The geometry engine is not running, so there is nothing to measure with.");
      },
      (e: unknown) => {
        if (stale) return;
        setResult(null);
        setError((e as { message?: string })?.message ?? "That could not be measured.");
      },
    );
    return () => {
      stale = true;
    };
  }, [picks, d.doc]);

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    eng.setInput({
      move: (p, m, pressed) => {
        if (!pressed) eng.showHover(pickAny(eng, p, m.alt));
      },
      down: (p, m) => {
        const hit = pickAny(eng, p, m.alt);
        if (!hit) {
          setPicks([]);
          return false;
        }
        setPicks((ps) => (ps.length >= 2 ? [hit] : ps.some((x) => x.body === hit.body && x.kind === hit.kind && x.index === hit.index) ? ps : [...ps, hit]));
        return true;
      },
      leave: () => eng.showHover(null),
    });
    return () => {
      eng.setInput(null);
      eng.showHover(null);
    };
  }, [d.active, engineOf]);

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    const o = new MeasureOverlay(eng);
    o.update(result?.pair, components);
    return () => o.dispose();
  }, [d.active, engineOf, result, components]);

  const clear = useCallback(() => setPicks([]), []);
  const help = !d.active
    ? null
    : picks.length === 0
      ? "Pick something to measure, then something else for the distance. Alt-click takes a whole body."
      : picks.length === 1
        ? "Pick something else for the distance between them, or Esc to stop."
        : "Click again to start a new measurement.";

  return useMemo(() => ({ picks, result, error, components, setComponents, clear, help }), [picks, result, error, components, clear, help]);
}

export type MeasureSession = ReturnType<typeof useMeasure>;
