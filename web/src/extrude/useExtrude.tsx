import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { planeFrame, regions, toSketch, type Frame, type Profile, type Sketch, type Vec2 } from "@bettercad/sketch";
import {
  addExtrude,
  addRevolve,
  axisOf,
  crossesAxis,
  extent,
  newId,
  targetsOf,
  throughAllAllowed,
  setExpr,
  profileAt,
  seedOf,
  textProfiles,
  updateExtrude,
  updateRevolve,
  type AxisRef,
  type RevolveFeature,
  type RevolveParams,
  type ExtrudeDirection,
  type ExtrudeExtent,
  type ExtrudeFeature,
  type ExtrudeOperation,
  type ExtrudeParams,
  type ModelDoc,
  type Part,
} from "../state/document";
import type { Command } from "../state/commands";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine, ScreenPoint } from "../viewport/engine";
import { SketchOverlay, type OverlayFill } from "../sketch/overlay";

/**
 * The Extrude tool (#61): click inside closed sketch shapes, then set how far, which way and what it does to the
 * model. The step is on the timeline from the first click and the model follows each change live; Done (or Enter)
 * keeps it as one undo step, Cancel (or Esc) takes it back.
 */
export interface ExtrudeDeps {
  /** Extrude pushes the shapes along the sketch's normal; Revolve (#62) turns them round an axis. */
  kind: "extrude" | "revolve";
  store: {
    get(): ModelDoc;
    edit(fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string): void;
    seal(): void;
    discard(key: string): void;
  };
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => void;
  doc: ModelDoc;
  /** Sketches built up to the timeline marker, in order. */
  sketches: { id: string; name: string; sketch: Sketch }[];
  parts: Part[];
  /** The built bodies' boxes in the world, for the bodies a cut touches. */
  bounds?: Map<string, Box>;
  selection: string[];
  view: RefObject<View3DHandle>;
  /** Whether the Extrude tool is armed. */
  active: boolean;
  /** The step is kept or cancelled: the editor puts the tool down. */
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
  theme: string;
}

export const DIRECTIONS: { id: ExtrudeDirection; label: string; title: string }[] = [
  { id: "one", label: "One side", title: "Extrude to one side of the sketch" },
  { id: "symmetric", label: "Symmetric", title: "Extrude the same distance both ways" },
  { id: "two", label: "Two sides", title: "Set a distance for each side" },
];

export const OPERATIONS: { id: ExtrudeOperation; label: string; title: string }[] = [
  { id: "new", label: "New body", title: "Make a separate body" },
  { id: "join", label: "Join", title: "Add to a body" },
  { id: "cut", label: "Cut", title: "Cut away from a body" },
  { id: "intersect", label: "Intersect", title: "Keep only where it overlaps a body" },
];

export const EXTENTS: { id: ExtrudeExtent; label: string; title: string }[] = [
  { id: "distance", label: "Distance", title: "Go a set distance" },
  { id: "all", label: "Through all", title: "Go right through every body in the way" },
];

type V3 = [number, number, number];
export type Box = { min: V3; max: V3 };

/**
 * The bodies an extrude's solid would touch: whose boxes overlap the box round its shapes, pushed out from the sketch
 * as far as it goes. A box test, so it can name a body the shape only passes close to; that body is left as it is.
 */
export function touchedBodies(frame: Frame, outlines: Vec2[][], from: number, to: number, bounds: Map<string, Box>, skip?: string): string[] {
  const n = frame.normal;
  const x = frame.x;
  const y: V3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const pts of outlines)
    for (const [u, v] of pts)
      for (const w of [from, to])
        for (let i = 0; i < 3; i++) {
          const c = frame.origin[i]! + x[i]! * u + y[i]! * v + n[i]! * w;
          lo[i] = Math.min(lo[i]!, c);
          hi[i] = Math.max(hi[i]!, c);
        }
  const eps = 1e-6;
  return [...bounds].filter(([id, b]) => id !== skip && [0, 1, 2].every((i) => b.min[i]! <= hi[i]! + eps && b.max[i]! >= lo[i]! - eps)).map(([id]) => id);
}

const KEY = (id: string) => `profile:${id}`;
type ProfileFeature = ExtrudeFeature | RevolveFeature;
type Params = Partial<ExtrudeParams> & Partial<RevolveParams>;

/** A revolve's first axis: a construction line if the sketch has one, else whichever sketch axis the shapes clear. */
export function defaultAxis(sketch: Sketch, picked: Profile[]): AxisRef {
  const guide = sketch.entities.find((e) => e.kind === "line" && e.construction);
  if (guide) return { kind: "line", id: guide.id };
  for (const a of [{ kind: "y" }, { kind: "x" }] as AxisRef[]) if (!crossesAxis(picked, axisOf(sketch, a)!)) return a;
  return { kind: "y" };
}

const outlineFill = (pr: Profile, shade: OverlayFill["shade"]): OverlayFill => ({ outer: pr.points, holes: pr.holes.map((h) => h.points), shade });

export function useExtrude(d: ExtrudeDeps) {
  const { store, say } = d;
  const deps = useRef(d);
  deps.current = d;
  /** The step being made or edited, and whether it existed before (an edit) or was made by this session. */
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  /** The operation follows the distance's sign until the person picks one. */
  const [autoOp, setAutoOp] = useState(true);
  /** A cut's bodies follow what its shapes touch until the person picks them. */
  const [autoTargets, setAutoTargets] = useState(true);
  const [hover, setHover] = useState<{ sketch: string; profile: Profile } | null>(null);

  const feature = d.doc.features.find((f): f is ProfileFeature => f.id === session?.id && f.type === d.kind) ?? null;
  const live = useRef({ session, feature, autoOp, autoTargets });
  live.current = { session, feature, autoOp, autoTargets };

  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);

  // An undo that takes the step away ends the session with it.
  useEffect(() => {
    if (session && !feature) setSession(null);
  }, [session, feature]);

  // Putting the tool down some other way (another tool, the toolbar) keeps what was made.
  useEffect(() => {
    if (!d.active && live.current.session) {
      store.seal();
      setSession(null);
    }
  }, [d.active, store]);

  const regionsOf = useMemo(() => new Map(d.sketches.map((s) => [s.id, regions(s.sketch)])), [d.sketches]);

  /** The closed shape under the pointer: in the step's own sketch once there is one, else the latest sketch that has one. */
  const hit = useCallback(
    (p: ScreenPoint): { sketch: string; profile: Profile; xy: Vec2 } | null => {
      const eng = engineOf();
      if (!eng) return null;
      const L = deps.current;
      const only = live.current.feature?.sketch;
      for (const s of [...L.sketches].reverse()) {
        if (only && s.id !== only) continue;
        const f = planeFrame(s.sketch.plane);
        const w = eng.rayPlane(p.x, p.y, f.origin, f.normal);
        if (!w) continue;
        const xy = toSketch(f, w);
        const pr = profileAt(regionsOf.get(s.id) ?? [], xy);
        if (pr) return { sketch: s.id, profile: pr, xy };
      }
      return null;
    },
    [engineOf, regionsOf],
  );

  /** The defaults for a first pick: on a face, Join that face's body; on an origin plane, a new body. */
  const defaults = useCallback((sketchId: string, seed: Vec2, profile: Profile): ExtrudeParams | RevolveParams => {
    const L = deps.current;
    const sk = L.sketches.find((s) => s.id === sketchId)!.sketch;
    const faceBody = sk.plane.kind === "face" ? sk.plane.face.body : undefined;
    const here = (id?: string) => (id && L.parts.some((p) => p.id === id) ? id : undefined);
    const target = here(faceBody) ?? here(L.selection[0]) ?? L.parts[L.parts.length - 1]?.id;
    const operation = here(faceBody) ? "join" : "new";
    if (L.kind === "revolve") return { sketch: sketchId, seeds: [seed], axis: defaultAxis(sk, [profile]), angle: 360, operation, target };
    return { sketch: sketchId, seeds: [seed], distance: 10, direction: "one", operation, target };
  }, []);

  /** The bodies an extrude's solid touches, by their boxes. Empty when nothing is built yet. */
  const touchedOf = useCallback(
    (f: ExtrudeFeature): string[] => {
      const L = deps.current;
      const s = L.sketches.find((x) => x.id === f.sketch);
      if (!s || !L.bounds?.size) return [];
      const all = regionsOf.get(f.sketch) ?? [];
      const letters = (f.texts ?? []).flatMap((t) => textProfiles(s.sketch, t, all).map((p) => p.points));
      const outlines = [...f.seeds.map((p) => profileAt(all, p)?.points).filter((p): p is Vec2[] => !!p), ...letters];
      if (!outlines.length) return [];
      const { from, to } = extent(f.direction, f.distance, f.distance2, f.extent === "all" && throughAllAllowed(f.operation));
      // Reference bodies are there to design round, and hidden ones out of mind: neither is cut unless picked.
      const ids = new Set(L.parts.filter((p) => !p.reference && !p.hidden).map((p) => p.id));
      const own = new Map([...L.bounds].filter(([id]) => ids.has(id)));
      return touchedBodies(planeFrame(s.sketch.plane), outlines, from, to, own, f.body.id);
    },
    [regionsOf],
  );

  const change = useCallback(
    (c: Params) => {
      const s = live.current.session;
      if (!s) return;
      const f = live.current.feature;
      // On a face, pulling out joins and pushing in cuts, until an operation is picked.
      if (c.distance !== undefined && f?.type === "extrude" && live.current.autoOp && c.operation === undefined) {
        const sk = deps.current.sketches.find((x) => x.id === f.sketch)?.sketch;
        if (sk?.plane.kind === "face" && f.operation !== "new" && f.operation !== "intersect") c = { ...c, operation: c.distance < 0 ? "cut" : "join" };
      }
      if (f) {
        const op = c.operation ?? f.operation;
        // Join and New body need an end: leaving Cut or Intersect brings the distance back.
        if (!throughAllAllowed(op) && (c.extent ?? (f.type === "extrude" ? f.extent : undefined)) === "all") c = { ...c, extent: "distance" };
        // Join changes one body: keep the first when coming from a cut of several.
        if (op === "join" && c.targets === undefined && (f.targets?.length ?? 0) > 1) c = { ...c, targets: f.targets!.slice(0, 1) };
        // A cut or intersect starts on every body its shapes touch, and follows them until bodies are picked.
        if (f.type === "extrude" && (op === "cut" || op === "intersect") && live.current.autoTargets && c.targets === undefined) {
          const touched = touchedOf({ ...f, ...c } as ExtrudeFeature);
          if (touched.length) c = { ...c, targets: touched, target: touched[0] };
        }
      }
      const label = deps.current.kind === "revolve" ? "Revolve" : "Extrude";
      store.edit(
        (doc) => (deps.current.kind === "revolve" ? updateRevolve(doc, s.id, c) : updateExtrude(doc, s.id, c)),
        s.isNew ? label : `Edit ${f?.name ?? label.toLowerCase()}`,
        KEY(s.id),
      );
    },
    [store, touchedOf],
  );

  /** Keeps (or drops) the expression typed into a field (#75), in the same undo step as the value. */
  const setFieldExpr = useCallback(
    (path: string, expression: string | undefined) => {
      const s = live.current.session;
      const f = live.current.feature;
      if (!s || (!expression && !f?.exprs?.[path])) return;
      const label = deps.current.kind === "revolve" ? "Revolve" : "Extrude";
      store.edit((doc) => setExpr(doc, s.id, path, expression), s.isNew ? label : `Edit ${f?.name ?? label.toLowerCase()}`, KEY(s.id));
    },
    [store],
  );

  /** Whether clicks on bodies pick what the step changes: once there is a step that changes bodies. */
  const targeting = !!feature && feature.operation !== "new";

  /** Picks the bodies it changes. Join takes one; Cut and Intersect any number, but at least one. */
  const setTargets = useCallback(
    (ids: string[]) => {
      const f = live.current.feature;
      if (!f || f.operation === "new") return;
      const own = f.body.id;
      let list = [...new Set(ids.filter((id) => id !== own && deps.current.parts.some((p) => p.id === id)))];
      if (f.operation === "join") list = list.slice(-1);
      if (!list.length) return;
      setAutoTargets(false);
      change({ targets: list, target: list[0] });
    },
    [change],
  );

  /** A click on a body: Join moves to it; Cut and Intersect add it, or take it out. */
  const toggleTarget = useCallback(
    (id: string) => {
      const f = live.current.feature;
      if (!f || f.operation === "new") return;
      const now = targetsOf(f);
      if (f.operation === "join") return setTargets([id]);
      if (now.includes(id)) {
        if (now.length === 1) return say("It needs at least one body to change. Pick another first.");
        return setTargets(now.filter((x) => x !== id));
      }
      setTargets([...now, id]);
    },
    [setTargets, say],
  );

  const pick = useCallback(
    (h: { sketch: string; profile: Profile; xy: Vec2 }) => {
      const L = live.current;
      if (!L.session) {
        const id = newId("f");
        const base = defaults(h.sketch, seedOf(h.profile), h.profile);
        // A text is picked whole, by its id, so its letters follow the words when they change.
        const tid = textOf(h.profile);
        const params = tid ? { ...base, seeds: [], texts: [tid] } : base;
        const revolve = deps.current.kind === "revolve";
        deps.current.record(
          (doc, at) => (revolve ? addRevolve(doc, params as RevolveParams, id, newId(), at) : addExtrude(doc, params as ExtrudeParams, id, newId(), at)),
          revolve ? "Revolve" : "Extrude",
          KEY(id),
        );
        setSession({ id, isNew: true });
        setAutoOp(true);
        setAutoTargets(true);
        // Digits go straight to the distance.
        setTimeout(() => document.getElementById("bc-ex-distance")?.focus(), 0);
        return;
      }
      const f = L.feature;
      if (!f) return;
      const tid = textOf(h.profile);
      if (tid) {
        const texts = f.texts ?? [];
        change({ texts: texts.includes(tid) ? texts.filter((x) => x !== tid) : [...texts, tid] });
        return;
      }
      const all = regionsOf.get(f.sketch) ?? [];
      const has = f.seeds.findIndex((s) => profileAt(all, s) === h.profile);
      change({ seeds: has >= 0 ? f.seeds.filter((_, i) => i !== has) : [...f.seeds, seedOf(h.profile)] });
    },
    [defaults, change, regionsOf],
  );

  // The pointer: hovering lights a closed shape, a click adds it to the step or takes it out.
  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    eng.setInput({
      move: (p, _m, pressed) => {
        if (pressed) return;
        const h = hit(p);
        setHover((o) => (o?.profile === h?.profile ? o : h && { sketch: h.sketch, profile: h.profile }));
      },
      down: (p) => {
        const h = hit(p);
        if (h) {
          pick(h);
          return true;
        }
        // Off the shapes, a click on a body picks it as one the step changes.
        const f = live.current.feature;
        if (!f || f.operation === "new") return false;
        const b = eng.pick(p.x, p.y, "body");
        if (!b || b.body === f.body.id) return false;
        toggleTarget(b.body);
        return true;
      },
      leave: () => setHover(null),
    });
    return () => {
      eng.setInput(null);
      setHover(null);
    };
  }, [d.active, engineOf, hit, pick, toggleTarget]);

  // The shapes in the step, shaded; the one under the pointer lit.
  const picked = useMemo(() => {
    if (!feature) return [];
    const all = regionsOf.get(feature.sketch) ?? [];
    const sk = d.sketches.find((x) => x.id === feature.sketch)?.sketch;
    const letters = sk ? (feature.texts ?? []).flatMap((t) => textProfiles(sk, t, all)) : [];
    return [...new Set([...feature.seeds.map((s) => profileAt(all, s)).filter((p): p is Profile => !!p), ...letters])];
  }, [feature, regionsOf, d.sketches]);

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    const bySketch = new Map<string, OverlayFill[]>();
    const add = (id: string, f: OverlayFill) => bySketch.set(id, [...(bySketch.get(id) ?? []), f]);
    if (feature) picked.forEach((p) => add(feature.sketch, outlineFill(p, "picked")));
    if (hover && !picked.includes(hover.profile)) {
      // A text lights up whole, as it is picked whole.
      const tid = textOf(hover.profile);
      const sk = tid && deps.current.sketches.find((x) => x.id === hover.sketch)?.sketch;
      const lit = sk ? textProfiles(sk, tid, regionsOf.get(hover.sketch)) : [hover.profile];
      for (const p of lit) add(hover.sketch, outlineFill(p, "hover"));
    }
    const list = [...bySketch].map(([id, fills]) => {
      const s = deps.current.sketches.find((x) => x.id === id);
      const o = new SketchOverlay(eng);
      if (s) o.update({ frame: planeFrame(s.sketch.plane), curves: [], points: [], fills });
      return o;
    });
    return () => list.forEach((o) => o.dispose());
  }, [d.active, engineOf, feature, picked, hover, d.theme, regionsOf]);

  const done = useCallback(() => {
    const L = live.current;
    // The document, not the last render: Enter in the distance field commits it just before this.
    const f = L.session && store.get().features.find((x): x is ProfileFeature => x.id === L.session!.id && (x.type === "extrude" || x.type === "revolve"));
    if (L.session && f) {
      store.seal();
      const n = f.seeds.length + (f.texts?.length ?? 0);
      // A cut reads as a cut, and its depth without a sign: "Cut one shape 10 mm deep".
      const cut = f.operation === "cut";
      const how =
        f.type === "revolve" ? `${fmt(f.angle)}°` : f.extent === "all" ? "through all" : cut ? `${fmt(Math.abs(f.distance))} mm deep` : `${fmt(f.distance)} mm`;
      const verb = !L.session.isNew ? "Changed" : f.type === "revolve" ? "Revolved" : cut ? "Cut" : "Extruded";
      say(`${verb} ${n === 1 ? "one shape" : `${n} shapes`} ${how}`);
    }
    setSession(null);
    deps.current.onClose();
  }, [store, say]);

  const cancel = useCallback(() => {
    const s = live.current.session;
    if (s) store.discard(KEY(s.id));
    setSession(null);
    deps.current.onClose();
  }, [store]);

  /** Opens an existing step to change it (the timeline's Edit extrude). */
  const edit = useCallback(
    (id: string) => {
      store.seal();
      setSession({ id, isNew: false });
      setAutoOp(false);
      setAutoTargets(false);
    },
    [store],
  );

  // Esc backs out of the step before the tool's own Esc puts the tool down.
  useEscape(!!session, cancel, ESC.tool + 1);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: `${d.kind}.done`,
        scope: "model",
        label: `Finish the ${d.kind}`,
        group: "Tools",
        icon: "check",
        // Enter is the editor's tool.confirm, shared with Combine.
        run: () => done(),
        when: () => !!live.current.session,
      },
    ],
    [done, d.kind],
  );

  const sketchCount = d.sketches.filter((s) => (regionsOf.get(s.id)?.length ?? 0) > 0).length;
  const help = !d.active
    ? null
    : !sketchCount
      ? "Draw a closed shape in a sketch first. Press K to start one."
      : session
        ? targeting && feature?.operation !== "join"
          ? `Click shapes to add or take them out, and bodies to choose what it ${feature?.operation === "cut" ? "cuts" : "keeps"}. Enter keeps the ${d.kind}, Esc cancels it.`
          : `Click more shapes to add them, or a picked one to take it out. Enter keeps the ${d.kind}, Esc cancels it.`
        : `Click inside a closed sketch shape to ${d.kind} it.`;

  return {
    active: d.active,
    kind: d.kind,
    sketch: feature ? (d.sketches.find((s) => s.id === feature.sketch)?.sketch ?? null) : null,
    session,
    feature,
    picked: picked.length,
    autoOp,
    targeting,
    targets: feature ? targetsOf(feature) : [],
    setTargets,
    toggleTarget,
    setOperation: (op: ExtrudeOperation) => {
      setAutoOp(false);
      change({ operation: op });
    },
    change,
    setFieldExpr,
    done,
    cancel,
    edit,
    commands,
    help,
  };
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

export type ExtrudeSession = ReturnType<typeof useExtrude>;

/** The text a region belongs to, when it is one of a text's letters (or the hole in one). */
export function textOf(p: Profile): string | null {
  const e = p.edges.length === 1 ? p.edges[0]! : null;
  return e && e.loop !== undefined ? e.id : null;
}
