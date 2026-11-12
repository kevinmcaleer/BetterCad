import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import {
  addPattern,
  copiesWhat,
  featureParts,
  mirrorFace,
  mirrorableFeatures,
  newId,
  patternCopyIds,
  updatePattern,
  type BuiltConstruct,
  type BuiltLink,
  type MirrorOf,
  type ModelDoc,
  type Part,
  type PatternFeature,
  type PatternKind,
  type PatternParams,
} from "../state/document";
import type { MeasureResult, TopoRef } from "@bettercad/kernel";
import type { View3DHandle } from "../viewport/View3D";
import type { Pick as ViewPick } from "../viewport/ids";
import type { TrackSlot } from "./trackPick";

/**
 * Mirror and Pattern (#69). Pick the bodies (or have them picked when the tool comes up), and the step goes on the
 * timeline at once, so the copies show as you change the settings on the bar. The step copies whatever is picked:
 * Shift-click adds a body or takes it out. Enter keeps the step, Esc takes it back.
 *
 * A Mirror or Pattern can copy bodies, or the cuts, joins, holes, fillets and chamfers of chosen features onto the same bodies (click the
 * steps on the timeline, or have one picked there when the tool comes up). A Mirror can also copy a whole component
 * (click one of its bodies, or choose it from the bar). Its plane is an origin plane, or a flat face picked in the view.
 * A circular pattern turns round X, Y or Z, a construction axis clicked in the view or chosen from the bar, or the
 * centre line of a round edge or face (or a straight edge) clicked on the model.
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
  /** Construction geometry as built up to the marker: a circular pattern can turn round one of its axes. */
  construct: BuiltConstruct[];
  upTo: number;
  /** The step picked on the timeline, if any: the tool starts by copying that feature. */
  pickedStep: () => string | null;
  view: RefObject<View3DHandle>;
  active: boolean;
  /** What the tool starts as: Mirror from its command, the last kind used otherwise. */
  startKind: PatternKind | null;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
  /** The kernel's description of a pick: what a clicked edge or face is, for a circle's axis. */
  measure: (refs: TopoRef[]) => Promise<MeasureResult | null>;
}

const KEY = (id: string) => `pattern:${id}`;
const label = (k: PatternKind) => (k === "mirror" ? "Mirror" : "Pattern");

const PLANES_ONLY = new Set(["plane"] as const);
const AXES_ONLY = new Set(["axis"] as const);
/** The world axis an origin axis in the view names (`origin:X` is "x"), if it is one. */
export function originAxis(id: string): "x" | "y" | "z" | null {
  const m = /^origin:([XYZ])$/.exec(id);
  return m ? (m[1]!.toLowerCase() as "x" | "y" | "z") : null;
}

export function usePattern(d: PatternDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const [last, setLast] = useState<Partial<PatternParams> & { kind: PatternKind }>({ kind: "rect" });
  /** Picking the mirror plane in the view: a flat face or an origin plane. */
  const [pickingPlane, setPickingPlane] = useState(false);
  /** Picking a construction axis in the view, for a circular pattern to turn round. */
  const [pickingAxis, setPickingAxis] = useState(false);
  /** Picking for a track: a pin on its piece, or the wheels' round edges. */
  const [pickingTrack, setPickingTrack] = useState<TrackSlot | null>(null);
  const feature = (d.doc.features.find((f) => f.id === session?.id && f.type === "pattern") as PatternFeature | undefined) ?? null;
  // Mirror has its own button (it always says so), so Pattern starts as the last row or circle used.
  const kind = feature?.kind ?? d.startKind ?? (last.kind === "mirror" ? "rect" : last.kind);
  /** What it copies: bodies, features, or (a Mirror only) a component. */
  const of: MirrorOf = copiesWhat({ kind, of: feature ? feature.of : last.of });
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
    (c: Pick<Partial<PatternParams>, "parts" | "features" | "link" | "of">) => {
      const s = live.current.session;
      const f = live.current.feature;
      if (!s) {
        const id = newId("f");
        const kind = deps.current.startKind ?? (live.current.last.kind === "mirror" ? "rect" : live.current.last.kind);
        const params = { ...live.current.last, kind, parts: [], ...c };
        deps.current.record((doc, at) => addPattern(doc, params, id, at), label(kind), KEY(id));
        setSession({ id, isNew: true });
        if (c.of) setLast((l) => ({ ...l, of: c.of }));
        return;
      }
      if (f) store.edit((doc) => updatePattern(doc, s.id, c), s.isNew ? label(f.kind) : `Edit ${f.name}`, KEY(s.id));
    },
    [store],
  );

  // A step picked on the timeline when the tool comes up is what it copies: the feature, not the bodies it changed.
  useEffect(() => {
    if (!d.active || live.current.session || live.current.of === "component") return;
    const step = deps.current.pickedStep();
    if (!step || !mirrorableFeatures(deps.current.doc, deps.current.upTo).some((f) => f.id === step)) return;
    deps.current.setSelection([]);
    pick({ of: "features", features: [step] });
    // Only as the tool comes up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.active]);

  // The picked bodies become the step's bodies: the first pick starts it, and it follows the picks after that. A
  // Mirror of a component takes the component of the body clicked; features are picked on the timeline or the bar.
  const copies = feature ? new Set(featureParts(feature)) : null;
  const picked = d.selection.filter((id) => !copies?.has(id));
  const pickedKey = picked.join(",");
  useEffect(() => {
    if (!d.active) return;
    // A step picked on the timeline starts the tool on that feature (above), not on the bodies it selects.
    if (!live.current.session && deps.current.pickedStep()) return;
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
      delete kept.axisStep;
      delete kept.axisRef;
      delete kept.track;
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

  /** The steps a Mirror or Pattern of features can copy, before the step (or the marker, before it starts). */
  const index = feature ? d.doc.features.indexOf(feature) : d.upTo;
  const mirrorable = useMemo(
    () => (d.active && of === "features" ? mirrorableFeatures(d.doc, index).map((f) => ({ id: f.id, name: f.name })) : []),
    [d.active, of, d.doc, index],
  );

  /** Ticks a feature in or out of a Mirror or Pattern of features. */
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

  // Picking the axis: construction axes light up under the pointer, and so do the model's edges and faces (a round
  // one turns the copies round its centre). The pick code loads with the first pick.
  useEffect(() => {
    const eng = d.view.current?.engine();
    if (!d.active || !pickingAxis || !session || !eng) return;
    let gone = false;
    let mod: typeof import("./axisPick") | null = null;
    void import("./axisPick").then((m) => (mod = m));
    // Its own copies aren't picked: they're made from the axis.
    const own = () => new Set(live.current.feature ? patternCopyIds(live.current.feature) : []);
    const bodyAt = (p: { x: number; y: number }): ViewPick | null => (mod ? mod.bodyUnder(eng, p, own()) : null);
    eng.setInput({
      move: (p, _m, pressed) => {
        if (pressed) return;
        eng.showHover(eng.constructAt(p.x, p.y, AXES_ONLY) ? null : bodyAt(p));
      },
      down: (p) => {
        const step = eng.constructAt(p.x, p.y, AXES_ONLY);
        if (step) {
          // An origin axis is the world axis of the same name.
          const o = originAxis(step);
          change(o ? { axis: o, axisStep: undefined, axisRef: undefined } : { axisStep: step, axisRef: undefined });
          setPickingAxis(false);
          return true;
        }
        const hit = bodyAt(p);
        if (!hit || !mod) {
          deps.current.say("Click a round edge or face on the model, the X, Y or Z axis, or a construction axis.", true);
          return true;
        }
        const m = mod;
        void m.axisOfPick(eng, hit, p, deps.current.parts, deps.current.measure).then(
          (ref) => {
            if (gone) return;
            if (typeof ref === "string") return deps.current.say(ref, true);
            change({ axisRef: ref, axisStep: undefined });
            setPickingAxis(false);
          },
          () => !gone && deps.current.say(m.NO_AXIS, true),
        );
        return true;
      },
      leave: () => eng.showHover(null),
    });
    return () => {
      gone = true;
      eng.setInput(null);
      eng.showHover(null);
    };
  }, [d.active, d.view, pickingAxis, session, change]);
  useEffect(() => {
    if (!session || !d.active || kind !== "circle") setPickingAxis(false);
    if (!session || !d.active || kind !== "track") setPickingTrack(null);
  }, [session, d.active, kind]);

  // Picking for a track: the pins on its piece, then each wheel's round edge. Each pick lays the track again. The
  // picking loads with the first pick.
  useEffect(() => {
    const eng = d.view.current?.engine();
    if (!d.active || !pickingTrack || !session || !eng) return;
    let stop: (() => void) | null = null;
    let gone = false;
    void import("./trackPick").then((m) => {
      if (gone) return;
      stop = m.trackInput(eng, pickingTrack, {
        feature: () => live.current.feature,
        doc: store.get,
        measure: deps.current.measure,
        say: deps.current.say,
        change: (track) => change({ track }),
        next: setPickingTrack,
      });
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, [d.active, d.view, pickingTrack, session, change, store]);

  const done = useCallback(() => {
    const s = live.current.session;
    const f = s && (store.get().features.find((x) => x.id === s.id) as PatternFeature | undefined);
    if (s && f) {
      store.seal();
      const n = f.parts.length;
      const k = f.features?.length ?? 0;
      const of = copiesWhat(f);
      const what =
        of === "features"
          ? k === 1
            ? "1 feature"
            : `${k} features`
          : of === "component"
            ? (deps.current.links.find((l) => l.id === f.link)?.name ?? "the component")
            : n === 1
              ? "1 body"
              : `${n} bodies`;
      deps.current.say(`${s.isNew ? (f.kind === "mirror" ? "Mirrored" : "Patterned") : "Changed"} ${what}${f.join ? ", joined" : ""}`);
      deps.current.setSelection(of === "features" ? [] : f.parts);
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
      if (f?.type === "pattern") deps.current.setSelection(copiesWhat(f) === "features" ? [] : f.parts);
      setSession({ id, isNew: false });
    },
    [store],
  );

  useEscape(!!session, cancel, ESC.tool + 1);
  // Esc while picking the plane stops picking, and keeps the step.
  useEscape(pickingPlane, () => setPickingPlane(false), ESC.tool + 2);
  useEscape(pickingAxis, () => setPickingAxis(false), ESC.tool + 2);
  useEscape(!!pickingTrack, () => setPickingTrack(null), ESC.tool + 2);

  const help = !d.active
    ? null
    : pickingPlane
      ? "Click a flat face, a construction plane or an origin plane to mirror across. Esc stops picking."
      : pickingAxis
        ? "Click a round edge or face to turn round its centre, or an axis. Esc stops picking."
        : pickingTrack
          ? "Click a round edge on the piece or a wheel. Esc stops picking."
          : of === "features"
            ? session
              ? `Click more steps on the timeline to ${kind === "mirror" ? "mirror" : "copy"} them too. Enter keeps it, Esc takes it back.`
              : `Click the steps to ${kind === "mirror" ? "mirror" : "copy"} on the timeline, or choose them on the bar.`
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
    setPickingPlane: (on: boolean) => {
      setPickingAxis(false);
      setPickingPlane(on);
    },
    pickingAxis,
    setPickingAxis: (on: boolean) => {
      setPickingPlane(false);
      setPickingTrack(null);
      setPickingAxis(on);
    },
    pickingTrack,
    setPickingTrack: (slot: TrackSlot | null) => {
      setPickingPlane(false);
      setPickingAxis(false);
      setPickingTrack(slot);
    },
    /** For a track: the model, the view, and the steps before it. */
    doc: d.doc,
    engine: () => d.view.current?.engine() ?? null,
    /** Construction geometry up to the marker: a circle turns round one of its axes. */
    construct: d.construct,
    /** A step's name, by id. */
    nameOf: (id: string) => d.doc.features.find((f) => f.id === id)?.name,
    stepName: feature?.step ? d.doc.features.find((f) => f.id === feature.step)?.name : undefined,
    change,
    /** Sets what it copies before it starts, or switches an open one. */
    setOf: (o: MirrorOf) => (live.current.session ? change({ of: o }) : (setLast((l) => ({ ...l, of: o })), deps.current.setSelection([]))),
    done,
    cancel,
    edit,
    help,
  };
}

export type PatternSession = ReturnType<typeof usePattern>;
