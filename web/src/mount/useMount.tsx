import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { toSketch, type Frame, type Vec2 } from "@bettercad/sketch";
import { MOUNT_DEFAULTS, addMount, holeOffsetOf, newId, updateMount, type ModelDoc, type MountFeature, type MountParams, type Part } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine } from "../viewport/engine";
import { snapPoint } from "../hole/useHole";

/**
 * The Mount tool (#189): click a flat face, and standoffs or a servo horn mount go there as one step. More clicks on
 * the same face add standoffs (or move the horn). Patterns, sizes and the rest are on the bar; the step is on the
 * timeline from the first click, so the model shows it as you change it.
 */
export interface MountDeps {
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

const KEY = (id: string) => `mount:${id}`;
type Settings = Omit<MountParams, "part" | "frame" | "points" | "offset">;
const FIRST: Settings = { ...MOUNT_DEFAULTS, kind: "standoffs" };
const KEPT = ["kind", "size", "height", "outer", "hole", "horn", "hub", "recess", "arm", "access"] as const;

export function useMount(d: MountDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const [last, setLast] = useState<Settings>(FIRST);
  const feature = (d.doc.features.find((f) => f.id === session?.id && f.type === "mount") as MountFeature | undefined) ?? null;
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
    (c: Partial<MountParams>) => {
      const s = live.current.session;
      if (!s) return;
      const kept: Partial<Settings> = {};
      for (const k of KEPT) if (k in c) Object.assign(kept, { [k]: c[k] });
      if (Object.keys(kept).length) setLast((l) => ({ ...l, ...kept }));
      store.edit((doc) => updateMount(doc, s.id, c), s.isNew ? "Mount" : "Edit mount", KEY(s.id));
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
          const hit = eng.pick(p.x, p.y, "face");
          const w = hit && hit.body === f.part ? eng.rayPlane(p.x, p.y, f.frame.origin, f.frame.normal) : null;
          if (!w) {
            deps.current.say("Mounts go on the face you picked first. Press Enter to keep this one, then pick another face.", true);
            return true;
          }
          const q = snapPoint(toSketch(f.frame, w));
          change({ points: f.kind === "horn" ? [q] : [...f.points, q] });
          return true;
        }
        const hit = eng.pick(p.x, p.y, "face");
        if (!hit) return false;
        const info = eng.faceInfo(hit.body, hit.index);
        if (!info?.flat) {
          deps.current.say("Mounts go on flat faces", true);
          return true;
        }
        const len = Math.hypot(...info.edge) || 1;
        const frame: Frame = { origin: info.centroid, x: info.edge.map((v) => v / len) as Frame["x"], normal: info.normal };
        const w = eng.rayPlane(p.x, p.y, frame.origin, frame.normal);
        const id = newId("f");
        const params: MountParams = {
          ...live.current.last,
          part: hit.body,
          frame,
          points: [snapPoint(w ? toSketch(frame, w) : [0, 0])],
          offset: holeOffsetOf(deps.current.doc.print),
        };
        deps.current.record((doc, at) => addMount(doc, params, id, at), "Mount", KEY(id));
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
    const f = s && (store.get().features.find((x) => x.id === s.id) as MountFeature | undefined);
    if (s && f) {
      store.seal();
      const name = deps.current.parts.find((p) => p.id === f.part)?.name ?? "the body";
      const n = f.points.length;
      deps.current.say(`${s.isNew ? "Made" : "Changed"} ${f.kind === "horn" ? "a horn mount" : n === 1 ? "1 standoff" : `${n} standoffs`} on ${name}`);
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

  /** Opens an existing step to change it (the timeline's Edit mount). */
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
      ? feature?.kind === "horn"
        ? "Click to move the horn, or type where it goes. Enter keeps it, Esc takes it back."
        : "Click to add standoffs, or pick a pattern. Enter keeps them, Esc takes them back."
      : "Click a flat face where the mount goes.";

  return { session, feature, change, done, cancel, edit, help };
}

/** The middle of some points: where a pattern is centred when it replaces them. */
export const middle = (pts: Vec2[]): Vec2 =>
  pts.length ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] : [0, 0];

export type MountSession = ReturnType<typeof useMount>;
