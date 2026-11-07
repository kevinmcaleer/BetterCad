import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { toSketch, type Frame, type Vec2 } from "@bettercad/sketch";
import { addHole, holeOffsetOf, newId, updateHole, type HoleFeature, type HoleStepParams, type ModelDoc, type Part } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine } from "../viewport/engine";

/**
 * The Hole tool (#70): click a flat face, then each click puts a screw hole there. Size, fit, head and depth come from
 * the screw table; the step is on the timeline from the first click, so the model shows the holes as you place them.
 */
export interface HoleDeps {
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

const KEY = (id: string) => `hole:${id}`;
/** Holes land on a 0.5 mm grid from the face's centre. */
const SNAP = 0.5;
export const snapPoint = (p: Vec2): Vec2 => [Math.round(p[0] / SNAP) * SNAP + 0, Math.round(p[1] / SNAP) * SNAP + 0];

/** Settings carried from one hole step to the next, so a row of M3s is quick. */
type Settings = Pick<HoleStepParams, "size" | "fit" | "diameter" | "head" | "depth">;
const FIRST: Settings = { size: "M3", fit: "printed", head: "none", depth: null };

export function useHole(d: HoleDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const [last, setLast] = useState<Settings>(FIRST);
  const feature = (d.doc.features.find((f) => f.id === session?.id && f.type === "hole") as HoleFeature | undefined) ?? null;
  const live = useRef({ session, feature, last });
  live.current = { session, feature, last };
  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);

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
    (c: Partial<HoleStepParams>) => {
      const s = live.current.session;
      if (!s) return;
      const kept: Partial<Settings> = {};
      for (const k of ["size", "fit", "diameter", "head", "depth"] as const) if (k in c) Object.assign(kept, { [k]: c[k] });
      if (Object.keys(kept).length) setLast((l) => ({ ...l, ...kept }));
      store.edit((doc) => updateHole(doc, s.id, c), s.isNew ? "Hole" : "Edit hole", KEY(s.id));
    },
    [store],
  );

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    /** Where the pointer meets the step's face, or null when it is off the body. */
    const onFace = (x: number, y: number, f: HoleFeature): Vec2 | null => {
      const hit = eng.pick(x, y, "face");
      if (!hit || hit.body !== f.part) return null;
      const w = eng.rayPlane(x, y, f.frame.origin, f.frame.normal);
      return w ? toSketch(f.frame, w) : null;
    };
    eng.setInput({
      move: (p, _m, pressed) => {
        if (pressed) return;
        const f = live.current.feature;
        if (f) return;
        eng.showHover(eng.pick(p.x, p.y, "face"));
      },
      down: (p) => {
        const f = live.current.feature;
        if (f) {
          const q = onFace(p.x, p.y, f);
          if (!q) {
            deps.current.say("Holes go on the face you picked first. Press Enter to keep these, then pick another face.", true);
            return true;
          }
          change({ points: [...f.points, snapPoint(q)] });
          return true;
        }
        const hit = eng.pick(p.x, p.y, "face");
        if (!hit) return false;
        const info = eng.faceInfo(hit.body, hit.index);
        if (!info?.flat) {
          deps.current.say("Holes go on flat faces", true);
          return true;
        }
        const len = Math.hypot(...info.edge) || 1;
        const frame: Frame = { origin: info.centroid, x: info.edge.map((v) => v / len) as Frame["x"], normal: info.normal };
        const w = eng.rayPlane(p.x, p.y, frame.origin, frame.normal);
        const id = newId("f");
        const params: HoleStepParams = {
          part: hit.body,
          frame,
          points: [snapPoint(w ? toSketch(frame, w) : [0, 0])],
          ...live.current.last,
          // The printer's hole offset now (#104): kept on the step, so changing it later is an edit, not a surprise.
          offset: holeOffsetOf(deps.current.doc.print),
        };
        deps.current.record((doc, at) => addHole(doc, params, id, at), "Hole", KEY(id));
        setSession({ id, isNew: true });
        eng.showHover(null);
        return true;
      },
      leave: () => eng.showHover(null),
    });
    return () => {
      eng.setInput(null);
      eng.showHover(null);
    };
  }, [d.active, engineOf, change]);

  const done = useCallback(() => {
    const s = live.current.session;
    const f = s && (store.get().features.find((x) => x.id === s.id) as HoleFeature | undefined);
    if (s && f) {
      store.seal();
      const n = f.points.length;
      const name = deps.current.parts.find((p) => p.id === f.part)?.name ?? "the body";
      deps.current.say(`${s.isNew ? "Made" : "Changed"} ${n === 1 ? "1 hole" : `${n} holes`} in ${name}`);
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

  /** Opens an existing step to change it (the timeline's Edit hole). */
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
    : session
      ? "Click to add more holes on this face, or type their positions. Enter keeps them, Esc takes them back."
      : "Click a flat face where the hole goes.";

  return { session, feature, change, done, cancel, edit, help };
}

export type HoleSession = ReturnType<typeof useHole>;
