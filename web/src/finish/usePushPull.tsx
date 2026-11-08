import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { addFinish, newId, updateFinish, type ModelDoc, type Part } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine, ScreenPoint } from "../viewport/engine";

/**
 * Push/pull (#65): press on a flat face and drag it out (adds material) or in (cuts it away), or type the distance.
 * The step is on the timeline from the press and the model follows the drag; Done (or Enter) keeps it, Esc takes it back.
 */
export interface PushPullDeps {
  store: {
    get(): ModelDoc;
    edit(fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string): void;
    seal(): void;
    discard(key: string): void;
  };
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => void;
  doc: ModelDoc;
  parts: Part[];
  view: RefObject<View3DHandle>;
  active: boolean;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
}

const KEY = (id: string) => `pushpull:${id}`;

/** How far along the face's normal a drag on screen goes: the pointer's movement along the normal's on-screen image. */
export function dragDistance(from: ScreenPoint, to: ScreenPoint, base: ScreenPoint, tip: ScreenPoint, fine: boolean): number {
  const dir = { x: tip.x - base.x, y: tip.y - base.y };
  const len2 = dir.x * dir.x + dir.y * dir.y;
  if (len2 < 1e-6) return 0;
  const raw = ((to.x - from.x) * dir.x + (to.y - from.y) * dir.y) / len2;
  const step = fine ? 0.1 : 1;
  return Math.round(raw / step) * step;
}

export function usePushPull(d: PushPullDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [session, setSession] = useState<{ id: string; part: string } | null>(null);
  const drag = useRef<{ id: string; from: ScreenPoint; base: ScreenPoint; tip: ScreenPoint } | null>(null);
  const feature = d.doc.features.find((f) => f.id === session?.id && f.type === "pushpull") ?? null;
  const distance = feature && feature.type === "pushpull" ? feature.size : 0;
  const live = useRef({ session });
  live.current = { session };
  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);

  // An undo that takes the step away ends the session with it.
  useEffect(() => {
    if (session && !feature) setSession(null);
  }, [session, feature]);

  // Putting the tool down some other way keeps what was made.
  useEffect(() => {
    if (!d.active && live.current.session) {
      store.seal();
      setSession(null);
    }
  }, [d.active, store]);

  const setDistance = useCallback(
    (v: number) => {
      const s = live.current.session;
      if (!s) return;
      store.edit((doc) => updateFinish(doc, s.id, { size: v }), "Push/pull", KEY(s.id));
    },
    [store],
  );

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    eng.setInput({
      move: (p, m, pressed) => {
        const g = drag.current;
        if (pressed && g) {
          const v = dragDistance(g.from, p, g.base, g.tip, !m.shift);
          store.edit((doc) => updateFinish(doc, g.id, { size: Number(v.toFixed(2)) }), "Push/pull", KEY(g.id));
          return;
        }
        if (pressed) return;
        eng.showHover(eng.pick(p.x, p.y, "face"));
      },
      down: (p) => {
        const hit = eng.pick(p.x, p.y, "face");
        if (!hit) return false;
        const info = eng.faceInfo(hit.body, hit.index);
        if (!info?.flat) {
          deps.current.say("Push/pull works on flat faces", true);
          return true;
        }
        // A new face is a new step: keep the last one as it is.
        store.seal();
        const id = newId("f");
        deps.current.record((doc, at) => addFinish(doc, { type: "pushpull", part: hit.body, refs: [hit.index], size: 0 }, id, at), "Push/pull", KEY(id));
        setSession({ id, part: hit.body });
        const tip = info.centroid.map((c, i) => c + info.normal[i]!) as typeof info.centroid;
        drag.current = { id, from: p, base: eng.project(info.centroid), tip: eng.project(tip) };
        eng.showHover(null);
        return true;
      },
      up: () => {
        drag.current = null;
        setTimeout(() => document.getElementById("bc-pp-distance")?.focus(), 0);
      },
      cancel: () => {
        drag.current = null;
      },
      leave: () => eng.showHover(null),
    });
    return () => {
      eng.setInput(null);
      eng.showHover(null);
      drag.current = null;
    };
  }, [d.active, engineOf, store]);

  const done = useCallback(
    (sizeNow?: number) => {
      const s = live.current.session;
      if (s && sizeNow !== undefined) setDistance(sizeNow);
      const f = s && store.get().features.find((x) => x.id === s.id);
      if (s && f && f.type === "pushpull") {
        if (!f.size) {
          // Nothing moved: no step.
          store.discard(KEY(s.id));
        } else {
          store.seal();
          const name = deps.current.parts.find((p) => p.id === s.part)?.name ?? "the body";
          deps.current.say(`${f.size > 0 ? "Pulled" : "Pushed"} a face of ${name} ${f.size > 0 ? "out" : "in"} ${Math.abs(f.size)} mm`);
        }
      }
      setSession(null);
      deps.current.onClose();
    },
    [store, setDistance],
  );

  const cancel = useCallback(() => {
    const s = live.current.session;
    if (s) store.discard(KEY(s.id));
    setSession(null);
    deps.current.onClose();
  }, [store]);

  useEscape(!!session, cancel, ESC.tool + 1);

  const partName = session ? (d.parts.find((p) => p.id === session.part)?.name ?? null) : null;
  const help = !d.active
    ? null
    : session
      ? `Drag again or type how far. Out adds to ${partName}, in cuts it away. Enter keeps it, Esc takes it back.`
      : "Press on a flat face and drag it out or in. Shift drags in 1 mm steps.";

  /** Opens an existing push/pull to change its distance (a double-click on its timeline tile). */
  const edit = useCallback(
    (id: string) => {
      const f = store.get().features.find((x) => x.id === id);
      if (f?.type !== "pushpull") return;
      store.seal();
      setSession({ id, part: f.part });
    },
    [store],
  );

  return { session, partName, distance, setDistance, done, cancel, edit, help };
}

export type PushPullSession = ReturnType<typeof usePushPull>;
