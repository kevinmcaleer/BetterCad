import { useCallback, useEffect, useRef, useState } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { addPattern, featureParts, newId, updatePattern, type ModelDoc, type PatternFeature, type PatternKind, type PatternParams } from "../state/document";

/**
 * Mirror and Pattern (#69). Pick the bodies (or have them picked when the tool comes up), and the step goes on the
 * timeline at once, so the copies show as you change the settings on the bar. The step copies whatever is picked:
 * Shift-click adds a body or takes it out. Enter keeps the step, Esc takes it back.
 */
export interface PatternDeps {
  store: {
    get(): ModelDoc;
    edit(fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string): void;
    seal(): void;
    discard(key: string): void;
  };
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => void;
  doc: ModelDoc;
  /** The picked parts, in the order they were picked. */
  selection: string[];
  setSelection: (ids: string[]) => void;
  active: boolean;
  /** What the tool starts as: Mirror from its command, the last kind used otherwise. */
  startKind: PatternKind | null;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
}

const KEY = (id: string) => `pattern:${id}`;
const label = (k: PatternKind) => (k === "mirror" ? "Mirror" : "Pattern");

export function usePattern(d: PatternDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const [last, setLast] = useState<Partial<PatternParams> & { kind: PatternKind }>({ kind: "mirror" });
  const feature = (d.doc.features.find((f) => f.id === session?.id && f.type === "pattern") as PatternFeature | undefined) ?? null;
  const live = useRef({ session, feature, last });
  live.current = { session, feature, last };

  useEffect(() => {
    if (session && !feature) setSession(null);
  }, [session, feature]);

  useEffect(() => {
    if (!d.active && live.current.session) {
      store.seal();
      setSession(null);
    }
  }, [d.active, store]);

  // The picked bodies become the step's bodies: the first pick starts it, and it follows the picks after that.
  const copies = feature ? new Set(featureParts(feature)) : null;
  const picked = d.selection.filter((id) => !copies?.has(id));
  const pickedKey = picked.join(",");
  useEffect(() => {
    if (!d.active) return;
    const ids = pickedKey ? pickedKey.split(",") : [];
    const s = live.current.session;
    const f = live.current.feature;
    if (!s) {
      if (!ids.length) return;
      const id = newId("f");
      const kind = deps.current.startKind ?? live.current.last.kind;
      const params = { ...live.current.last, kind, parts: ids };
      deps.current.record((doc, at) => addPattern(doc, params, id, at), label(kind), KEY(id));
      setSession({ id, isNew: true });
      return;
    }
    if (f && ids.length && ids.join(",") !== f.parts.join(",")) {
      store.edit((doc) => updatePattern(doc, s.id, { parts: ids }), s.isNew ? label(f.kind) : `Edit ${f.name}`, KEY(s.id));
    }
  }, [d.active, pickedKey, store]);

  const change = useCallback(
    (c: Partial<PatternParams>) => {
      const s = live.current.session;
      const f = live.current.feature;
      if (!s || !f) return;
      const kept = { ...c };
      delete kept.parts;
      setLast((l) => ({ ...l, ...kept }));
      store.edit((doc) => updatePattern(doc, s.id, c), s.isNew ? label(c.kind ?? f.kind) : `Edit ${f.name}`, KEY(s.id));
    },
    [store],
  );

  const done = useCallback(() => {
    const s = live.current.session;
    const f = s && (store.get().features.find((x) => x.id === s.id) as PatternFeature | undefined);
    if (s && f) {
      store.seal();
      const n = f.parts.length;
      const what = n === 1 ? "1 body" : `${n} bodies`;
      deps.current.say(`${s.isNew ? (f.kind === "mirror" ? "Mirrored" : "Patterned") : "Changed"} ${what}${f.join ? ", joined" : ""}`);
      deps.current.setSelection(f.parts);
    }
    setSession(null);
    deps.current.onClose();
  }, [store]);

  const cancel = useCallback(() => {
    const s = live.current.session;
    if (s) store.discard(KEY(s.id));
    setSession(null);
    deps.current.onClose();
  }, [store]);

  /** Opens an existing step to change it (the timeline's Edit pattern). */
  const edit = useCallback(
    (id: string) => {
      store.seal();
      const f = store.get().features.find((x) => x.id === id);
      if (f?.type === "pattern") deps.current.setSelection(f.parts);
      setSession({ id, isNew: false });
    },
    [store],
  );

  useEscape(!!session, cancel, ESC.tool + 1);

  const help = !d.active
    ? null
    : session
      ? "Shift-click to add a body or take one out. Enter keeps the copies, Esc takes them back."
      : "Click the bodies to copy. Shift-click picks more than one.";

  return { session, feature, change, done, cancel, edit, help };
}

export type PatternSession = ReturnType<typeof usePattern>;
