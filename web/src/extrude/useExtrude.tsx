import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { planeFrame, regions, toSketch, type Profile, type Sketch, type Vec2 } from "@bettercad/sketch";
import {
  addExtrude,
  addRevolve,
  axisOf,
  crossesAxis,
  newId,
  profileAt,
  seedOf,
  updateExtrude,
  updateRevolve,
  type AxisRef,
  type RevolveFeature,
  type RevolveParams,
  type ExtrudeDirection,
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
  const [hover, setHover] = useState<{ sketch: string; profile: Profile } | null>(null);

  const feature = d.doc.features.find((f): f is ProfileFeature => f.id === session?.id && f.type === d.kind) ?? null;
  const live = useRef({ session, feature, autoOp });
  live.current = { session, feature, autoOp };

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
      const label = deps.current.kind === "revolve" ? "Revolve" : "Extrude";
      store.edit(
        (doc) => (deps.current.kind === "revolve" ? updateRevolve(doc, s.id, c) : updateExtrude(doc, s.id, c)),
        s.isNew ? label : `Edit ${f?.name ?? label.toLowerCase()}`,
        KEY(s.id),
      );
    },
    [store],
  );

  const pick = useCallback(
    (h: { sketch: string; profile: Profile; xy: Vec2 }) => {
      const L = live.current;
      if (!L.session) {
        const id = newId("f");
        const params = defaults(h.sketch, seedOf(h.profile), h.profile);
        const revolve = deps.current.kind === "revolve";
        deps.current.record(
          (doc, at) => (revolve ? addRevolve(doc, params as RevolveParams, id, newId(), at) : addExtrude(doc, params as ExtrudeParams, id, newId(), at)),
          revolve ? "Revolve" : "Extrude",
          KEY(id),
        );
        setSession({ id, isNew: true });
        setAutoOp(true);
        // Digits go straight to the distance.
        setTimeout(() => document.getElementById("bc-ex-distance")?.focus(), 0);
        return;
      }
      const f = L.feature;
      if (!f) return;
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
        if (!h) return false;
        pick(h);
        return true;
      },
      leave: () => setHover(null),
    });
    return () => {
      eng.setInput(null);
      setHover(null);
    };
  }, [d.active, engineOf, hit, pick]);

  // The shapes in the step, shaded; the one under the pointer lit.
  const picked = useMemo(() => {
    if (!feature) return [];
    const all = regionsOf.get(feature.sketch) ?? [];
    return [...new Set(feature.seeds.map((s) => profileAt(all, s)).filter((p): p is Profile => !!p))];
  }, [feature, regionsOf]);

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    const bySketch = new Map<string, OverlayFill[]>();
    const add = (id: string, f: OverlayFill) => bySketch.set(id, [...(bySketch.get(id) ?? []), f]);
    if (feature) picked.forEach((p) => add(feature.sketch, outlineFill(p, "picked")));
    if (hover && !picked.includes(hover.profile)) add(hover.sketch, outlineFill(hover.profile, "hover"));
    const list = [...bySketch].map(([id, fills]) => {
      const s = deps.current.sketches.find((x) => x.id === id);
      const o = new SketchOverlay(eng);
      if (s) o.update({ frame: planeFrame(s.sketch.plane), curves: [], points: [], fills });
      return o;
    });
    return () => list.forEach((o) => o.dispose());
  }, [d.active, engineOf, feature, picked, hover, d.theme]);

  const done = useCallback(() => {
    const L = live.current;
    // The document, not the last render: Enter in the distance field commits it just before this.
    const f = L.session && store.get().features.find((x): x is ProfileFeature => x.id === L.session!.id && (x.type === "extrude" || x.type === "revolve"));
    if (L.session && f) {
      store.seal();
      const n = f.seeds.length;
      const how = f.type === "revolve" ? `${fmt(f.angle)}°` : `${fmt(f.distance)} mm`;
      say(`${L.session.isNew ? (f.type === "revolve" ? "Revolved" : "Extruded") : "Changed"} ${n === 1 ? "one shape" : `${n} shapes`} ${how}`);
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
        ? `Click more shapes to add them, or a picked one to take it out. Enter keeps the ${d.kind}, Esc cancels it.`
        : `Click inside a closed sketch shape to ${d.kind} it.`;

  return {
    active: d.active,
    kind: d.kind,
    sketch: feature ? (d.sketches.find((s) => s.id === feature.sketch)?.sketch ?? null) : null,
    session,
    feature,
    picked: picked.length,
    autoOp,
    setOperation: (op: ExtrudeOperation) => {
      setAutoOp(false);
      change({ operation: op });
    },
    change,
    done,
    cancel,
    edit,
    commands,
    help,
  };
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

export type ExtrudeSession = ReturnType<typeof useExtrude>;
