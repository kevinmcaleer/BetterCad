import { useEffect, useRef, useState } from "react";
import type { ModelView, ModelViewRequest } from "@bettercad/kernel/view";
import type { ModelDoc } from "../state/document";

/** Asks the kernel for a view. Null while the kernel is starting (and in tests that give none). */
export type ViewCall = (params: { doc: ModelDoc; upTo?: number } & ModelViewRequest) => (Promise<ModelView> & { cancel?: () => void }) | null;

export interface ViewWanted {
  id: string;
  request: ModelViewRequest;
}
export interface ViewGot {
  /** The latest picture: it stays up while a newer one is worked out, so views do not blink when the model changes. */
  view?: ModelView;
  busy: boolean;
  /** Why the kernel could not draw it. */
  error?: string;
}

// Each model the views were asked of gets a number, so a request can be told from the last one cheaply.
const seen = new WeakMap<object, number>();
let count = 0;
const stamp = (o: object) => seen.get(o) ?? (seen.set(o, ++count), count);

/**
 * The kernel's views for a sheet (#558), by view id. Each is asked for again when what it shows or the model changes;
 * title block edits and moving a view change neither, so they ask for nothing.
 */
export function useModelViews(wanted: ViewWanted[], doc: ModelDoc, upTo: number | undefined, call: ViewCall | undefined): Map<string, ViewGot> {
  const [got, setGot] = useState<Map<string, ViewGot>>(new Map());
  const asked = useRef(new Map<string, { key: string; cancel?: () => void }>());
  // The model without its drawings: they never change a view, and leaving them out keeps the key steady while you
  // fill in a title block.
  const modelRef = useRef<{ features: unknown; model: ModelDoc } | null>(null);
  if (!modelRef.current || modelRef.current.features !== doc.features || stripped(modelRef.current.model, doc)) {
    const model = { ...doc };
    delete model.drawings;
    modelRef.current = { features: doc.features, model };
  }
  const model = modelRef.current.model;

  useEffect(() => {
    if (!call) return;
    const live = new Set(wanted.map((w) => w.id));
    for (const [id, a] of asked.current) {
      if (live.has(id)) continue;
      a.cancel?.();
      asked.current.delete(id);
    }
    setGot((g) => ([...g.keys()].some((id) => !live.has(id)) ? new Map([...g].filter(([id]) => live.has(id))) : g));
    for (const w of wanted) {
      const key = `${stamp(model)}:${upTo ?? ""}:${JSON.stringify(w.request)}`;
      const was = asked.current.get(w.id);
      if (was?.key === key) continue;
      was?.cancel?.();
      const p = call({ doc: model, upTo, ...w.request });
      if (!p) continue;
      asked.current.set(w.id, { key, cancel: p.cancel });
      setGot((g) => new Map(g).set(w.id, { ...g.get(w.id), busy: true, error: undefined }));
      const mine = () => asked.current.get(w.id)?.key === key;
      p.then(
        (view) => mine() && setGot((g) => new Map(g).set(w.id, { view, busy: false })),
        (e: unknown) => mine() && setGot((g) => new Map(g).set(w.id, { ...g.get(w.id), busy: false, error: e instanceof Error ? e.message : String(e) })),
      );
    }
  }, [call, wanted, model, upTo]);
  useEffect(() => {
    const all = asked.current;
    return () => all.forEach((a) => a.cancel?.());
  }, []);
  return got;
}

/** True when anything but the drawings differs between the model last sent and this one. */
function stripped(sent: ModelDoc, doc: ModelDoc): boolean {
  for (const k of Object.keys(doc) as (keyof ModelDoc)[]) if (k !== "drawings" && sent[k] !== doc[k]) return true;
  for (const k of Object.keys(sent) as (keyof ModelDoc)[]) if (!(k in doc)) return true;
  return false;
}
