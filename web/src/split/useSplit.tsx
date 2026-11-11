import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { addSplit, mirrorFace, newId, updateSplit, type MirrorPlane, type ModelDoc, type Part, type SplitFeature, type SplitParams } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine } from "../viewport/engine";

/**
 * The Split body tool (#406): click a body, then the plane to split it along: a flat face, a construction plane or an
 * origin plane. The step is on the timeline from the first click and the model follows each change; Enter keeps it
 * as one undo step, Esc takes it back.
 */
export interface SplitDeps {
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
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
}

const KEY = (id: string) => `split:${id}`;
const PLANES_ONLY = new Set(["plane"] as const);
/** Which axis each origin plane faces along, for the offset that puts it through a body's middle. */
const AXIS_OF: Record<MirrorPlane, 0 | 1 | 2> = { YZ: 0, XZ: 1, XY: 2 };

export function useSplit(d: SplitDeps) {
  const { store, say } = d;
  const deps = useRef(d);
  deps.current = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const [pickingPlane, setPickingPlane] = useState(false);
  const feature = d.doc.features.find((f): f is SplitFeature => f.id === session?.id && f.type === "split") ?? null;
  const live = useRef({ session, feature });
  live.current = { session, feature };
  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);

  // Putting the tool down some other way (another tool, the toolbar) keeps what was made.
  useEffect(
    () => () => {
      if (live.current.session) store.seal();
    },
    [store],
  );

  // An undo that takes the step away ends the session with it.
  useEffect(() => {
    if (session && !feature) setSession(null);
  }, [session, feature]);

  const change = useCallback(
    (c: Partial<SplitParams>) => {
      const s = live.current.session;
      if (!s) return;
      store.edit((doc) => updateSplit(doc, s.id, c), s.isNew ? "Split body" : `Edit ${live.current.feature?.name ?? "split"}`, KEY(s.id));
    },
    [store],
  );

  /** How far along an origin plane's axis the middle of a body is, so the plane starts through it. */
  const middle = useCallback(
    (part: string, plane: MirrorPlane): number => {
      const box = engineOf()?.bodyBox(part);
      if (!box) return 0;
      const i = AXIS_OF[plane];
      return Math.round(((box.min[i]! + box.max[i]!) / 2) * 100) / 100;
    },
    [engineOf],
  );

  const pickBody = useCallback(
    (part: string) => {
      const L = live.current;
      if (!L.session) {
        const id = newId("f");
        const params: SplitParams = { part, plane: "YZ", offset: middle(part, "YZ"), keep: "both" };
        deps.current.record((doc, i) => addSplit(doc, params, id, newId(), i), "Split body", KEY(id));
        setSession({ id, isNew: true });
        setPickingPlane(true);
        return;
      }
      if (L.feature?.keep === "both" && part === L.feature.body.id) return;
      change({ part });
    },
    [change, middle],
  );

  /** An origin plane from the panel, moved to the body's middle. */
  const setPlane = useCallback(
    (plane: MirrorPlane) => {
      const f = live.current.feature;
      if (!f) return;
      setPickingPlane(false);
      change({ plane, offset: middle(f.part, plane), face: undefined, step: undefined });
    },
    [change, middle],
  );

  // Clicks: a body while none is picked (or to change it), or the plane while picking one.
  useEffect(() => {
    const eng = engineOf();
    if (!eng) return;
    if (pickingPlane && session) {
      eng.showPlanes(true);
      type Target =
        | { kind: "face"; hit: NonNullable<ReturnType<Engine["pick"]>>; info: NonNullable<ReturnType<Engine["faceInfo"]>> }
        | { kind: "step"; step: string }
        | { kind: "plane"; plane: MirrorPlane };
      const target = (x: number, y: number): Target | null => {
        const hit = eng.pick(x, y, "face");
        const info = hit && eng.faceInfo(hit.body, hit.index);
        if (hit && info?.flat) return { kind: "face", hit, info };
        const step = eng.constructAt(x, y, PLANES_ONLY);
        if (step) return { kind: "step", step };
        const plane = eng.planeAt(x, y);
        return plane ? { kind: "plane", plane } : null;
      };
      eng.setInput({
        move: (p, _m, pressed) => {
          if (pressed) return;
          const t = target(p.x, p.y);
          eng.showHover(t?.kind === "face" ? t.hit : null);
          eng.hoverPlane(t?.kind === "plane" ? t.plane : null);
        },
        down: (p) => {
          const t = target(p.x, p.y);
          if (!t) return false;
          if (t.kind === "plane") setPlane(t.plane);
          else if (t.kind === "step") change({ step: t.step, face: undefined, offset: 0 });
          else {
            const part = deps.current.parts.find((q) => q.id === t.hit.body);
            if (!part) return true;
            const [x, y, z] = t.info.centroid;
            const [nx, ny, nz] = t.info.normal;
            change({ face: mirrorFace(part, t.hit.index, { x, y, z }, { x: nx, y: ny, z: nz }), step: undefined, offset: 0 });
          }
          setPickingPlane(false);
          return true;
        },
        leave: () => {
          eng.showHover(null);
          eng.hoverPlane(null);
        },
      });
      return () => {
        eng.setInput(null);
        eng.showPlanes(false);
        eng.showHover(null);
        eng.hoverPlane(null);
      };
    }
    eng.setInput({
      move: (p, _m, pressed) => {
        if (pressed) return;
        eng.showHover(eng.pick(p.x, p.y, "body"));
      },
      down: (p) => {
        const b = eng.pick(p.x, p.y, "body");
        if (!b) return false;
        pickBody(b.body);
        return true;
      },
      leave: () => eng.showHover(null),
    });
    return () => {
      eng.setInput(null);
      eng.showHover(null);
    };
  }, [engineOf, pickingPlane, session, pickBody, setPlane, change]);

  const done = useCallback(() => {
    const L = live.current;
    if (L.session && L.feature) {
      store.seal();
      say(`${L.session.isNew ? "Split" : "Changed the split of"} ${deps.current.parts.find((p) => p.id === L.feature!.part)?.name ?? "the body"}`);
    }
    setSession(null);
    setPickingPlane(false);
    deps.current.onClose();
  }, [store, say]);

  const cancel = useCallback(() => {
    const s = live.current.session;
    if (s) store.discard(KEY(s.id));
    setSession(null);
    setPickingPlane(false);
    deps.current.onClose();
  }, [store]);

  /** Opens an existing step to change it (the timeline's Edit split). */
  const edit = useCallback(
    (id: string) => {
      store.seal();
      setSession({ id, isNew: false });
      setPickingPlane(false);
    },
    [store],
  );

  useEscape(pickingPlane && !!session, () => setPickingPlane(false), ESC.tool + 2);
  useEscape(!!session, cancel, ESC.tool + 1);

  const help = !feature
    ? "Click the body to split."
    : pickingPlane
      ? "Click a flat face, a construction plane or an origin plane to split along."
      : "Pick which halves to keep. Enter keeps the split, Esc cancels it.";

  return {
    session,
    feature,
    help,
    pickingPlane,
    setPickingPlane,
    setPlane,
    setOffset: (offset: number) => change({ offset }),
    setKeep: (keep: SplitFeature["keep"]) => change({ keep }),
    done,
    cancel,
    edit,
  };
}

export type SplitSession = ReturnType<typeof useSplit>;
