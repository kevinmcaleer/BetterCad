import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import {
  addPattern,
  featureParts,
  mirrorFace,
  mirrorableFeatures,
  newId,
  updatePattern,
  type BuiltLink,
  type MirrorOf,
  type ModelDoc,
  type Part,
  type PatternFeature,
  type PatternKind,
  type PatternParams,
} from "../state/document";
import type { View3DHandle } from "../viewport/View3D";

/**
 * Mirror and Pattern (#69). Pick the bodies (or have them picked when the tool comes up), and the step goes on the
 * timeline at once, so the copies show as you change the settings on the bar. The step copies whatever is picked:
 * Shift-click adds a body or takes it out. Enter keeps the step, Esc takes it back.
 *
 * A Mirror can copy bodies, the cuts, joins and holes of chosen features, or a whole component (click one of its bodies,
 * or choose it from the bar). Its plane is an origin plane, or a flat face picked in the view.
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
  /** The bodies and components as built up to the marker, and how many steps that is. */
  parts: Part[];
  links: BuiltLink[];
  upTo: number;
  view: RefObject<View3DHandle>;
  active: boolean;
  /** What the tool starts as: Mirror from its command, the last kind used otherwise. */
  startKind: PatternKind | null;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
}

const KEY = (id: string) => `pattern:${id}`;
const label = (k: PatternKind) => (k === "mirror" ? "Mirror" : "Pattern");

const PLANES_ONLY = new Set(["plane"] as const);

export function usePattern(d: PatternDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const [last, setLast] = useState<Partial<PatternParams> & { kind: PatternKind }>({ kind: "mirror" });
  /** Picking the mirror plane in the view: a flat face or an origin plane. */
  const [pickingPlane, setPickingPlane] = useState(false);
  const feature = (d.doc.features.find((f) => f.id === session?.id && f.type === "pattern") as PatternFeature | undefined) ?? null;
  const kind = feature?.kind ?? d.startKind ?? last.kind;
  /** What a Mirror copies; a pattern always copies bodies. */
  const of: MirrorOf = kind !== "mirror" ? "bodies" : ((feature ? feature.of : last.of) ?? "bodies");
  const live = useRef({ session, feature, last, of });
  live.current = { session, feature, last, of };

  useEffect(() => {
    if (session && !feature) setSession(null);
  }, [session, feature]);

  useEffect(() => {
    if (!d.active && live.current.session) {
      store.seal();
      setSession(null);
    }
  }, [d.active, store]);

  /** Starts the step with what it copies, or changes what an open one copies. */
  const pick = useCallback(
    (c: Pick<Partial<PatternParams>, "parts" | "features" | "link">) => {
      const s = live.current.session;
      const f = live.current.feature;
      if (!s) {
        const id = newId("f");
        const kind = deps.current.startKind ?? live.current.last.kind;
        const params = { ...live.current.last, kind, parts: [], ...c };
        deps.current.record((doc, at) => addPattern(doc, params, id, at), label(kind), KEY(id));
        setSession({ id, isNew: true });
        return;
      }
      if (f) store.edit((doc) => updatePattern(doc, s.id, c), s.isNew ? label(f.kind) : `Edit ${f.name}`, KEY(s.id));
    },
    [store],
  );

  // The picked bodies become the step's bodies: the first pick starts it, and it follows the picks after that. A
  // Mirror of a component takes the component of the body clicked; a Mirror of features is picked on the bar.
  const copies = feature ? new Set(featureParts(feature)) : null;
  const picked = d.selection.filter((id) => !copies?.has(id));
  const pickedKey = picked.join(",");
  useEffect(() => {
    if (!d.active) return;
    const ids = pickedKey ? pickedKey.split(",") : [];
    const f = live.current.feature;
    const what = live.current.of;
    if (what === "features" || !ids.length) return;
    if (what === "component") {
      const link = deps.current.parts.find((p) => p.id === ids.at(-1))?.link;
      if (!link) deps.current.say("That body isn't in a component. Make one with Link first.", true);
      else if (link !== f?.link) pick({ link });
      return;
    }
    if (!f || ids.join(",") !== f.parts.join(",")) pick({ parts: ids });
  }, [d.active, pickedKey, pick]);

  const change = useCallback(
    (c: Partial<PatternParams>) => {
      const kept = { ...c };
      delete kept.parts;
      delete kept.features;
      delete kept.link;
      delete kept.face;
      setLast((l) => ({ ...l, ...kept }));
      const s = live.current.session;
      const f = live.current.feature;
      if (!s || !f) return;
      // Switching what a Mirror copies starts its picks over.
      const what = c.of && c.of !== (f.of ?? "bodies") ? { parts: [], features: [], link: undefined } : {};
      if (c.of) deps.current.setSelection([]);
      store.edit((doc) => updatePattern(doc, s.id, { ...what, ...c }), s.isNew ? label(c.kind ?? f.kind) : `Edit ${f.name}`, KEY(s.id));
    },
    [store],
  );

  /** The steps a Mirror of features can copy, before the step (or the marker, before it starts). */
  const index = feature ? d.doc.features.indexOf(feature) : d.upTo;
  const mirrorable = useMemo(
    () => (d.active && of === "features" ? mirrorableFeatures(d.doc, index).map((f) => ({ id: f.id, name: f.name })) : []),
    [d.active, of, d.doc, index],
  );

  /** Ticks a feature in or out of a Mirror of features. */
  const toggleFeature = useCallback(
    (id: string) => {
      const now = live.current.feature?.features ?? [];
      pick({ features: now.includes(id) ? now.filter((x) => x !== id) : [...now, id] });
    },
    [pick],
  );

  // Picking the plane: the origin planes show, and flat faces light up under the pointer.
  useEffect(() => {
    const eng = d.view.current?.engine();
    if (!d.active || !pickingPlane || !session || !eng) return;
    eng.showPlanes(true);
    const target = (x: number, y: number) => {
      const hit = eng.pick(x, y, "face");
      const info = hit && eng.faceInfo(hit.body, hit.index);
      if (hit && info?.flat) return { hit, info };
      // A construction plane (#265), where no face is.
      const step = eng.constructAt(x, y, PLANES_ONLY);
      if (step) return { step };
      const plane = eng.planeAt(x, y);
      return plane ? { plane } : null;
    };
    eng.setInput({
      move: (p, _m, pressed) => {
        if (pressed) return;
        const t = target(p.x, p.y);
        eng.showHover((t && "hit" in t ? t.hit : null) ?? null);
        eng.hoverPlane((t && "plane" in t ? t.plane : null) ?? null);
      },
      down: (p) => {
        const t = target(p.x, p.y);
        if (!t) return false;
        if ("plane" in t) change({ plane: t.plane, face: undefined, step: undefined });
        else if ("step" in t) change({ step: t.step, face: undefined });
        else {
          const part = deps.current.parts.find((q) => q.id === t.hit.body);
          if (!part) return true;
          const [x, y, z] = t.info.centroid;
          const [nx, ny, nz] = t.info.normal;
          change({ face: mirrorFace(part, t.hit.index, { x, y, z }, { x: nx, y: ny, z: nz }), step: undefined });
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
  }, [d.active, d.view, pickingPlane, session, change]);
  useEffect(() => {
    if (!session || !d.active) setPickingPlane(false);
  }, [session, d.active]);

  const done = useCallback(() => {
    const s = live.current.session;
    const f = s && (store.get().features.find((x) => x.id === s.id) as PatternFeature | undefined);
    if (s && f) {
      store.seal();
      const n = f.parts.length;
      const k = f.features?.length ?? 0;
      const what =
        f.kind === "mirror" && f.of === "features"
          ? k === 1
            ? "1 feature"
            : `${k} features`
          : f.kind === "mirror" && f.of === "component"
            ? (deps.current.links.find((l) => l.id === f.link)?.name ?? "the component")
            : n === 1
              ? "1 body"
              : `${n} bodies`;
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
  // Esc while picking the plane stops picking, and keeps the step.
  useEscape(pickingPlane, () => setPickingPlane(false), ESC.tool + 2);

  const help = !d.active
    ? null
    : pickingPlane
      ? "Click a flat face, a construction plane or an origin plane to mirror across. Esc stops picking."
      : of === "features"
        ? session
          ? "Tick more features on the bar, or click Face to mirror across a face. Enter keeps the mirror, Esc takes it back."
          : "Choose the features to mirror on the bar."
        : of === "component"
          ? session
            ? "Click a body in another component to mirror that one instead. Enter keeps the mirror, Esc takes it back."
            : "Click a body in the component to mirror, or choose it on the bar."
          : session
            ? "Shift-click to add a body or take one out. Enter keeps the copies, Esc takes them back."
            : "Click the bodies to copy. Shift-click picks more than one.";

  return {
    session,
    feature,
    kind,
    of,
    links: d.links,
    mirrorable,
    pick,
    toggleFeature,
    pickingPlane,
    setPickingPlane,
    /** The construction plane a Mirror goes across (#265), by name. */
    stepName: feature?.step ? d.doc.features.find((f) => f.id === feature.step)?.name : undefined,
    change,
    /** Sets what a Mirror copies before it starts, or switches an open one. */
    setOf: (o: MirrorOf) => (live.current.session ? change({ of: o }) : (setLast((l) => ({ ...l, of: o })), deps.current.setSelection([]))),
    done,
    cancel,
    edit,
    help,
  };
}

export type PatternSession = ReturnType<typeof usePattern>;
