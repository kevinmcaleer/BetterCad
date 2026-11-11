import { useCallback, useEffect, useRef, useState } from "react";
import type { ImportProgress } from "./importFiles";

interface Wait {
  feature: string;
  ids: string[];
  done: () => void;
  /** Bodies seen in the model, so one not there yet (its step lands on the next render) isn't taken for gone. */
  seen: Set<string>;
}

/**
 * The import's progress toast, and when an import is done: once the kernel's mesh for each of its bodies is on show,
 * or its step failed, or the bodies are gone (undone, or the timeline marker moved before them).
 */
export function useImportProgress(view: { bodies: ReadonlyMap<string, unknown>; failed: ReadonlyMap<string, string>; parts: { id: string }[]; off: boolean }) {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const waits = useRef<Wait[]>([]);
  const now = useRef(view);
  now.current = view;
  const settled = useCallback((w: Wait) => {
    const v = now.current;
    for (const p of v.parts) if (w.ids.includes(p.id)) w.seen.add(p.id);
    return v.off || v.failed.has(w.feature) || w.ids.every((id) => v.bodies.has(id) || (w.seen.has(id) && !v.parts.some((p) => p.id === id)));
  }, []);
  useEffect(() => {
    waits.current = waits.current.filter((w) => {
      if (!settled(w)) return true;
      w.done();
      return false;
    });
  }, [view.bodies, view.failed, view.parts, view.off, settled]);
  const ready = useCallback(
    (feature: string, ids: string[]) =>
      new Promise<void>((done) => {
        const w = { feature, ids, done, seen: new Set<string>() };
        if (settled(w)) done();
        else waits.current.push(w);
      }),
    [settled],
  );
  return { progress, setProgress, ready };
}
