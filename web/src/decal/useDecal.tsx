import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import type { BodyMesh } from "@bettercad/kernel";
import { addDecal, updateDecal, type DecalFeature, type DecalParams, type ModelDoc } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine } from "../viewport/engine";

/**
 * The Decal tool (#263): click a flat face, choose a picture, and it sits on the face as one Decal step. Drag it about
 * the face, or set its size, turn and flip on the bar; the model shows each change as you make it. Enter keeps it,
 * Esc takes it back.
 */
export interface DecalDeps {
  store: {
    get(): ModelDoc;
    edit(fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string): void;
    seal(): void;
    discard(key: string): void;
  };
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => void;
  doc: ModelDoc;
  /** The kernel's meshes of the bodies, with their faces' names (#47). */
  meshes?: Map<string, { mesh: BodyMesh; names?: { faces: string[] } }>;
  view: RefObject<View3DHandle>;
  active: boolean;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
}

export const KEY = (id: string) => `decal:${id}`;

/** The pointer work, placement maths and picture reader load when the tool is first armed. */
let input: typeof import("./input") | undefined;
const load = () =>
  import("./input").then((m) => {
    input = m;
  });

export function useDecal(d: DecalDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  /** A picture being read, so a second click waits for it. */
  const [busy, setBusy] = useState(false);
  const feature = (d.doc.features.find((f) => f.id === session?.id && f.type === "decal") as DecalFeature | undefined) ?? null;
  const live = useRef({ session, feature, busy });
  live.current = { session, feature, busy };
  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);

  const [ready, setReady] = useState(!!input);
  useEffect(() => {
    if (d.active && !input) void load().then(() => setReady(true));
  }, [d.active]);

  useEffect(() => {
    if (session && !feature) setSession(null);
  }, [session, feature]);

  useEffect(() => {
    if (!d.active && live.current.session) {
      store.seal();
      setSession(null);
    }
  }, [d.active, store]);

  const change = useCallback(
    (c: Partial<DecalParams>, data?: string) => {
      const s = live.current.session;
      if (!s) return;
      store.edit((doc) => updateDecal(doc, s.id, c, data), s.isNew ? "Decal" : "Edit decal", KEY(s.id));
    },
    [store],
  );

  const ctx = useMemo(
    (): import("./input").DecalInputCtx => ({
      feature: () => live.current.feature,
      busy: () => live.current.busy,
      setBusy,
      meshes: () => deps.current.meshes,
      change,
      add: (params, data, id) => {
        deps.current.record((dd, i) => addDecal(dd, params, data, id, i), "Decal", KEY(id));
        setSession({ id, isNew: true });
      },
      say: (text, error) => deps.current.say(text, error),
    }),
    [change],
  );

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng || !ready || !input) return;
    return input.attachDecalInput(eng, ctx);
  }, [d.active, engineOf, ctx, ready]);

  const changePicture = useCallback(() => input?.changePicture(ctx), [ctx]);

  const done = useCallback(() => {
    const s = live.current.session;
    const f = s && (store.get().features.find((x) => x.id === s.id) as DecalFeature | undefined);
    if (s && f) {
      store.seal();
      deps.current.say(`${s.isNew ? "Put" : "Changed"} ${f.image.file} on the face, ${f.width} × ${f.height} mm`);
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

  /** Opens a Decal step to change it, from the timeline. */
  const edit = useCallback(
    (id: string) => {
      store.seal();
      setSession({ id, isNew: false });
    },
    [store],
  );

  useEscape(!!session, cancel, ESC.tool + 1);

  const help = !d.active
    ? null
    : busy
      ? "Reading the picture…"
      : session
        ? "Drag the picture about the face, or click another flat face to move it there. Enter keeps it, Esc takes it back."
        : "Click a flat face, then choose a picture to put on it.";

  return { session, feature, busy, change, changePicture, done, cancel, edit, help };
}

export type DecalSession = ReturnType<typeof useDecal>;
