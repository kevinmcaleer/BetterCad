import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { toSketch, toWorld, type Frame } from "@bettercad/sketch";
import { GEAR_DEFAULTS, addGear, fitGap, newId, updateGear, type GearFeature, type GearParamsStep, type ModelDoc } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine } from "../viewport/engine";
import { snapPoint } from "../hole/useHole";

/**
 * The Spur gear tool (#191): click the ground or a flat face and a gear stands there as one Gear step. Its teeth,
 * module, width, bore and the rest are on the bar, and the model shows each change as you make it. Another click on
 * the same plane moves it.
 */
export interface GearDeps {
  store: {
    get(): ModelDoc;
    edit(fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string): void;
    seal(): void;
    discard(key: string): void;
  };
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => void;
  doc: ModelDoc;
  view: RefObject<View3DHandle>;
  active: boolean;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
}

const KEY = (id: string) => `gear:${id}`;
type Settings = Omit<GearParamsStep, "frame" | "turn">;
/** The first gear: 20 teeth, module 1, 5 mm wide on a 5 mm round bore. */
export const FIRST_GEAR: Settings = { gear: GEAR_DEFAULTS, width: 5, bore: { kind: "round", diameter: 5 } };

export function useGear(d: GearDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const [last, setLast] = useState<Settings | null>(null);
  const feature = (d.doc.features.find((f) => f.id === session?.id && f.type === "gear") as GearFeature | undefined) ?? null;
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
    (c: Partial<GearParamsStep>) => {
      const s = live.current.session;
      const f = live.current.feature;
      if (!s || !f) return;
      const next = { ...f, ...c };
      setLast({ gear: next.gear, width: next.width, bore: next.bore, ...(next.hub ? { hub: next.hub } : {}) });
      store.edit((doc) => updateGear(doc, s.id, c), s.isNew ? "Spur gear" : "Edit gear", KEY(s.id));
    },
    [store],
  );

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    eng.setInput({
      move: (p, _m, pressed) => {
        if (!pressed && !live.current.feature) eng.showHover(eng.pick(p.x, p.y, "face"));
      },
      down: (p) => {
        const f = live.current.feature;
        if (f) {
          // Move it about its own plane.
          const w = eng.rayPlane(p.x, p.y, f.frame.origin, f.frame.normal);
          if (!w) return true;
          const q = snapPoint(toSketch(f.frame, w));
          change({ frame: { ...f.frame, origin: toWorld(f.frame, q) } });
          return true;
        }
        const hit = eng.pick(p.x, p.y, "face");
        let frame: Frame;
        if (hit) {
          const info = eng.faceInfo(hit.body, hit.index);
          if (!info?.flat) {
            deps.current.say("Gears go on flat faces, or the ground", true);
            return true;
          }
          const len = Math.hypot(...info.edge) || 1;
          // Square to the world where the face allows.
          const x = Math.abs(info.normal[2]) > 0.999 ? ([1, 0, 0] as Frame["x"]) : (info.edge.map((v) => v / len) as Frame["x"]);
          const plane: Frame = { origin: info.centroid, x, normal: info.normal };
          const w = eng.rayPlane(p.x, p.y, plane.origin, plane.normal);
          frame = { ...plane, origin: toWorld(plane, snapPoint(w ? toSketch(plane, w) : [0, 0])) };
        } else {
          const w = eng.rayPlane(p.x, p.y, [0, 0, 0], [0, 0, 1]);
          if (!w) return false;
          frame = { origin: [...snapPoint([w[0], w[1]]), 0], x: [1, 0, 0], normal: [0, 0, 1] };
        }
        const id = newId("f");
        const doc = deps.current.doc;
        const first = live.current.last ?? { ...FIRST_GEAR, gear: { ...GEAR_DEFAULTS, backlash: fitGap("press", doc.print?.fits) } };
        deps.current.record((dd, at) => addGear(dd, { ...first, frame }, id, newId(), at), "Spur gear", KEY(id));
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
    const f = s && (store.get().features.find((x) => x.id === s.id) as GearFeature | undefined);
    if (s && f) {
      store.seal();
      deps.current.say(`${s.isNew ? "Made" : "Changed"} ${f.name}: ${f.gear.teeth} teeth, module ${f.gear.module}`);
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

  /** Opens an existing step to change it (the timeline's Edit gear). */
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
      ? "Set the teeth and size, or click to move it. Enter keeps it, Esc takes it back."
      : "Click the ground or a flat face where the gear goes.";

  return { session, feature, change, done, cancel, edit, help };
}

export type GearSession = ReturnType<typeof useGear>;
