import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { planeFrame, regions, toSketch, type Frame, type Profile, type Sketch, type Vec2 } from "@bettercad/sketch";
import {
  addExtrude,
  addRevolve,
  extent,
  newId,
  targetsOf,
  throughAllAllowed,
  setExpr,
  profileAt,
  seedOf,
  seedProfile,
  textProfiles,
  updateExtrude,
  updateRevolve,
  type AxisRef,
  type BuiltConstruct,
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
import type { Pick } from "../viewport/ids";
import type { ExtrudeArrow } from "./arrow";
import type { AxisHit } from "./axisPick";
type ArrowModule = typeof import("./arrow");
import { SketchOverlay, type OverlayCurve, type OverlayFill } from "../sketch/overlay";

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
  /** Construction planes, axes and points as built, for Revolve's axis (#62). */
  construct?: BuiltConstruct[];
  /** Lights a construction axis (or an origin axis, `origin:X`) under the pointer, or none. */
  onConstructHover?: (id: string | null) => void;
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
  { id: "to", label: "To object", title: "Stop at a face, edge or point you click" },
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
  /** "To object" was chosen, and the next click on a face, edge or point sets where it ends. */
  const [wantTo, setWantTo] = useState(false);
  /** Revolve: the next click on an axis, a sketch line or a straight edge sets what it turns round. */
  const [wantAxis, setWantAxis] = useState(false);
  /** Picking the shapes again from the bar: every shape of the step's sketch shows, so hidden sketches can be picked. */
  const [wantShapes, setWantShapes] = useState(false);
  /** Revolve: the sketch line under the pointer while it wants an axis, lit in the sketch. */
  const [axisLine, setAxisLine] = useState<string | null>(null);
  const arrow = useRef<ExtrudeArrow | null>(null);
  /** A drag of the arrow: where it started, the end's length then, and how far the pointer has gone along it. */
  const drag = useRef<{ start: ScreenPoint; last: ScreenPoint; length: number; moved: boolean } | null>(null);
  /** The arrow's end along the normal as last drawn (through all draws a fixed length), where a drag starts from. */
  const arrowLength = useRef(0);
  /** Whether the arrow is being dragged (it has moved since the press), so the ghost shows. */
  const [dragging, setDragging] = useState(false);
  const mod = useRef<ArrowModule | null>(null);
  /** Revolve's axis picking, loaded with the Revolve tool so it costs the first paint nothing. */
  const axisMod = useRef<typeof import("./axisPick") | null>(null);
  useEffect(() => {
    if (d.kind === "revolve" && d.active && !axisMod.current)
      void import("./axisPick").then((m) => {
        axisMod.current = m;
      });
  }, [d.kind, d.active]);

  const feature = d.doc.features.find((f): f is ProfileFeature => f.id === session?.id && f.type === d.kind) ?? null;
  /** Revolve asks for its axis after the shapes, and again when the axis is picked from the bar. */
  const pickingAxis = feature?.type === "revolve" && !wantShapes && (wantAxis || !feature.axis);
  const live = useRef({ session, feature, autoOp, autoTargets, wantTo, pickingAxis });
  live.current = { session, feature, autoOp, autoTargets, wantTo, pickingAxis };

  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);

  // An undo that takes the step away ends the session with it.
  useEffect(() => {
    if (session && !feature) setSession(null);
  }, [session, feature]);

  useEffect(() => {
    if (!session) {
      setWantTo(false);
      setWantAxis(false);
      setWantShapes(false);
    }
  }, [session]);

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
  const defaults = useCallback((sketchId: string, seed: Vec2): ExtrudeParams | RevolveParams => {
    const L = deps.current;
    const sk = L.sketches.find((s) => s.id === sketchId)!.sketch;
    const faceBody = sk.plane.kind === "face" ? sk.plane.face.body : undefined;
    const here = (id?: string) => (id && L.parts.some((p) => p.id === id) ? id : undefined);
    const target = here(faceBody) ?? here(L.selection[0]) ?? L.parts[L.parts.length - 1]?.id;
    const operation = here(faceBody) ? "join" : "new";
    // A revolve's axis is the next pick: no guess, so it never turns round a line that wasn't meant.
    if (L.kind === "revolve") return { sketch: sketchId, seeds: [seed], angle: 360, operation, target };
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
      const outlines = [...f.seeds.map((p) => seedProfile(all, p)?.points).filter((p): p is Vec2[] => !!p), ...letters];
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
        const base = defaults(h.sketch, seedIn(regionsOf.get(h.sketch) ?? [], h));
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
      const has = f.seeds.findIndex((s) => seedProfile(all, s) === h.profile);
      change({ seeds: has >= 0 ? f.seeds.filter((_, i) => i !== has) : [...f.seeds, seedIn(all, h)] });
    },
    [defaults, change, regionsOf],
  );

  /**
   * The axis under the pointer while Revolve wants one: an origin or construction axis first, then a line of the
   * step's sketch, then a straight edge of a body.
   */
  const axisAt = useCallback(
    (p: ScreenPoint): AxisHit | null => {
      const eng = engineOf();
      const f = live.current.feature;
      const m = axisMod.current;
      if (!eng || !m || f?.type !== "revolve") return null;
      return m.axisAt(eng, p, f.body.id, deps.current.sketches.find((x) => x.id === f.sketch)?.sketch ?? null, deps.current.parts);
    },
    [engineOf],
  );

  /** Sets what the revolve turns round. */
  const pickAxis = useCallback(
    (axis: AxisRef) => {
      setWantAxis(false);
      change({ axis });
    },
    [change],
  );

  /** The closed shapes an extrude has picked. */
  const pickedOf = useCallback(
    (f: ProfileFeature): Profile[] => {
      const all = regionsOf.get(f.sketch) ?? [];
      return [...new Set(f.seeds.map((s) => seedProfile(all, s)).filter((p): p is Profile => !!p))];
    },
    [regionsOf],
  );

  /** The sketch frame an extrude's shapes are on. */
  const frameOfFeature = useCallback((f: ProfileFeature): Frame => {
    const s = deps.current.sketches.find((x) => x.id === f.sketch);
    return s ? planeFrame(s.sketch.plane) : { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
  }, []);

  /** The face, edge or corner under the pointer that To object could end at: corners first, then edges, then faces. */
  const objectAt = useCallback(
    (p: ScreenPoint): Pick | null => {
      const eng = engineOf();
      const own = live.current.feature?.type === "extrude" ? live.current.feature.body.id : undefined;
      if (!eng) return null;
      for (const kind of ["vertex", "edge", "face"] as const) {
        const hit = eng.pick(p.x, p.y, kind);
        if (hit && hit.body !== own) return hit;
      }
      return null;
    },
    [engineOf],
  );

  /** Ends the extrude at a picked face, edge or corner. */
  const pickTo = useCallback(
    (hit: Pick, p: ScreenPoint) => {
      const eng = engineOf();
      const f = live.current.feature;
      const L = deps.current;
      const part = L.parts.find((x) => x.id === hit.body);
      if (!eng || !part || f?.type !== "extrude") return;
      const s = L.sketches.find((x) => x.id === f.sketch);
      const m = mod.current;
      if (!s || !m) return;
      const r = m.upToOf(eng, hit, p, part, planeFrame(s.sketch.plane), pickedOf(f));
      if (!r) return;
      if (typeof r === "string") return say(r, true);
      const { to, reach } = r;
      setWantTo(false);
      change({ extent: "to", to, direction: "one", distance: reach });
    },
    [engineOf, change, say, pickedOf],
  );

  /** Whether clicks off the shapes pick what To object ends at, rather than the bodies it changes. */
  const pickingTo = !!feature && feature.type === "extrude" && (wantTo || feature.extent === "to");

  // The pointer: the arrow first (drag to set the distance, click to flip), then the closed shapes (hovering lights
  // one, a click adds it to the step or takes it out), then what To object ends at, or the bodies it changes.
  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    const toMode = () => {
      const f = live.current.feature;
      return f?.type === "extrude" && (live.current.wantTo || f.extent === "to");
    };
    eng.setInput({
      move: (p, _m, pressed) => {
        const g = drag.current;
        const f = live.current.feature;
        if (g && pressed && arrow.current && f?.type === "extrude") {
          g.length += arrow.current.along(g.last, p, frameOfFeature(f).normal);
          g.last = p;
          if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < 4) return;
          if (!g.moved) setDragging(true);
          g.moved = true;
          const c = mod.current?.dragTo(f, g.length);
          if (c) change(c);
          return;
        }
        if (pressed) return;
        const onArrow = !!arrow.current?.hit(p);
        arrow.current?.setHot(onArrow);
        if (onArrow) {
          eng.showHover(null);
          return;
        }
        if (live.current.pickingAxis) {
          const a = axisAt(p);
          setAxisLine(a?.line ?? null);
          deps.current.onConstructHover?.(a?.shape ?? null);
          eng.showHover(a?.edge ?? null);
          if (a) {
            setHover(null);
            return;
          }
        }
        const h = hit(p);
        setHover((o) => (o?.profile === h?.profile ? o : h && { sketch: h.sketch, profile: h.profile }));
        eng.showHover(!h && toMode() ? objectAt(p) : null);
      },
      down: (p) => {
        const f = live.current.feature;
        if (f?.type === "extrude" && arrow.current?.hit(p)) {
          drag.current = { start: p, last: p, length: arrowLength.current, moved: false };
          return true;
        }
        // While Revolve wants its axis, axes and lines come before the shapes they run beside.
        if (live.current.pickingAxis) {
          const a = axisAt(p);
          if (a) {
            pickAxis(a.axis);
            setAxisLine(null);
            deps.current.onConstructHover?.(null);
            eng.showHover(null);
            return true;
          }
        }
        const h = hit(p);
        if (h) {
          pick(h);
          return true;
        }
        if (!f) return false;
        if (live.current.pickingAxis) {
          const e = eng.pick(p.x, p.y, "edge");
          if (e) say("That edge isn't straight. Pick a straight edge, a sketch line or an axis.", true);
          return !!e;
        }
        if (toMode()) {
          const o = objectAt(p);
          if (!o) return false;
          pickTo(o, p);
          return true;
        }
        // Off the shapes, a click on a body picks it as one the step changes.
        if (f.operation === "new") return false;
        const b = eng.pick(p.x, p.y, "body");
        if (!b || b.body === f.body.id) return false;
        toggleTarget(b.body);
        return true;
      },
      up: () => {
        const g = drag.current;
        drag.current = null;
        setDragging(false);
        const f = live.current.feature;
        if (!g || g.moved || f?.type !== "extrude") return;
        const c = mod.current?.flipOf(f);
        if (c) change(c);
        else say(f.extent === "to" ? "It goes up to what you picked. Drag the arrow to give it a distance instead." : "Symmetric goes both ways already.");
      },
      cancel: () => {
        drag.current = null;
        setDragging(false);
      },
      leave: () => {
        setHover(null);
        setAxisLine(null);
        deps.current.onConstructHover?.(null);
        arrow.current?.setHot(false);
        eng.showHover(null);
      },
    });
    return () => {
      eng.setInput(null);
      eng.showHover(null);
      setHover(null);
      setAxisLine(null);
      deps.current.onConstructHover?.(null);
    };
  }, [d.active, engineOf, hit, pick, toggleTarget, objectAt, pickTo, pickedOf, frameOfFeature, change, say, axisAt, pickAxis]);

  // The shapes in the step, shaded; the one under the pointer lit.
  const picked = useMemo(() => {
    if (!feature) return [];
    const all = regionsOf.get(feature.sketch) ?? [];
    const sk = d.sketches.find((x) => x.id === feature.sketch)?.sketch;
    const letters = sk ? (feature.texts ?? []).flatMap((t) => textProfiles(sk, t, all)) : [];
    return [...new Set([...feature.seeds.map((s) => seedProfile(all, s)).filter((p): p is Profile => !!p), ...letters])];
  }, [feature, regionsOf, d.sketches]);

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    const bySketch = new Map<string, OverlayFill[]>();
    const add = (id: string, f: OverlayFill) => bySketch.set(id, [...(bySketch.get(id) ?? []), f]);
    // While the shapes are picked again, the sketch's other shapes show faintly, ready to click.
    if (feature && wantShapes) for (const p of regionsOf.get(feature.sketch) ?? []) if (!picked.includes(p)) add(feature.sketch, outlineFill(p, "guide"));
    if (feature) picked.forEach((p) => add(feature.sketch, outlineFill(p, "picked")));
    if (hover && !picked.includes(hover.profile)) {
      // A text lights up whole, as it is picked whole.
      const tid = textOf(hover.profile);
      const sk = tid && deps.current.sketches.find((x) => x.id === hover.sketch)?.sketch;
      const lit = sk ? textProfiles(sk, tid, regionsOf.get(hover.sketch)) : [hover.profile];
      for (const p of lit) add(hover.sketch, outlineFill(p, "hover"));
    }
    // Revolve's axis when it is a sketch line, and the line under the pointer while it wants one.
    const curves = new Map<string, OverlayCurve[]>();
    const sk = feature?.type === "revolve" ? deps.current.sketches.find((x) => x.id === feature.sketch)?.sketch : null;
    const lit = sk && axisMod.current?.lineCurves(sk, feature?.type === "revolve" && feature.axis?.kind === "line" ? feature.axis.id : null, axisLine);
    if (feature && lit?.length) {
      curves.set(feature.sketch, lit);
      if (!bySketch.has(feature.sketch)) bySketch.set(feature.sketch, []);
    }
    const list = [...bySketch].map(([id, fills]) => {
      const s = deps.current.sketches.find((x) => x.id === id);
      const o = new SketchOverlay(eng);
      if (s) o.update({ frame: planeFrame(s.sketch.plane), curves: curves.get(id) ?? [], points: [], fills });
      return o;
    });
    return () => list.forEach((o) => o.dispose());
  }, [d.active, engineOf, feature, picked, hover, d.theme, regionsOf, axisLine, wantShapes]);

  // The arrow and To object (extrude only), loaded with the first step so they cost the first paint nothing.
  const [Arrow, setArrow] = useState<typeof ExtrudeArrow | null>(null);
  const wantArrow = d.active && d.kind === "extrude" && !!feature;
  useEffect(() => {
    if (!wantArrow || Arrow) return;
    let gone = false;
    void import("./arrow").then((m) => {
      mod.current = m;
      if (!gone) setArrow(() => m.ExtrudeArrow);
    });
    return () => {
      gone = true;
    };
  }, [wantArrow, Arrow]);
  const arrowFeature = feature?.type === "extrude" && wantArrow ? feature : null;
  useEffect(() => {
    const eng = engineOf();
    if (!eng || !Arrow || !arrowFeature) return;
    const a = new Arrow(eng);
    arrow.current = a;
    return () => {
      a.dispose();
      if (arrow.current === a) arrow.current = null;
    };
    // A new arrow per step and theme; the effect below moves it.
  }, [engineOf, Arrow, !!arrowFeature, d.theme]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const eng = engineOf();
    const a = arrow.current;
    if (!eng || !a || !arrowFeature) return;
    const shapes = pickedOf(arrowFeature);
    if (!shapes.length) return a.hide();
    const frame = frameOfFeature(arrowFeature);
    let reach = 0;
    const g = mod.current!.arrowOf(arrowFeature, frame, shapes, (base) => (reach = eng.pixelSize(base) * 90));
    arrowLength.current = g.length;
    a.update(g.base, g.end, g.dir);
    // While the arrow is dragged, a ghost of the shapes follows it at once; the body catches up when the kernel has
    // rebuilt it, and the ghost goes when the drag ends.
    a.setGhost(dragging ? { frame, shapes, ...mod.current!.ghostSpan(arrowFeature, reach), cut: arrowFeature.operation === "cut" } : null);
  }, [engineOf, Arrow, arrowFeature, pickedOf, frameOfFeature, d.theme, d.doc, dragging]);

  const done = useCallback(() => {
    const L = live.current;
    // The document, not the last render: Enter in the distance field commits it just before this.
    const f = L.session && store.get().features.find((x): x is ProfileFeature => x.id === L.session!.id && (x.type === "extrude" || x.type === "revolve"));
    if (f?.type === "revolve" && !f.axis) return say("Pick an axis to turn it round first: an axis, a sketch line or a straight edge.", true);
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
      // Shapes the sketch no longer has are dropped when the step is opened, so it builds again; click to pick more.
      const f = store.get().features.find((x): x is ProfileFeature => x.id === id && (x.type === "extrude" || x.type === "revolve"));
      const s = f && deps.current.sketches.find((x) => x.id === f.sketch);
      if (!f || !s) return;
      const all = regions(s.sketch);
      const kept = f.seeds.filter((p) => seedProfile(all, p));
      if (kept.length === f.seeds.length || (!kept.length && !f.texts?.length)) return;
      const label = `Edit ${f.name}`;
      store.edit((doc) => (f.type === "revolve" ? updateRevolve(doc, id, { seeds: kept }) : updateExtrude(doc, id, { seeds: kept })), label, KEY(id));
      const n = f.seeds.length - kept.length;
      say(`Took out ${n === 1 ? "a shape" : `${n} shapes`} the sketch no longer has. Click a shape to add it.`);
    },
    [store, say],
  );

  // Esc backs out of the step before the tool's own Esc puts the tool down; first out of picking a new axis.
  useEscape(!!session, cancel, ESC.tool + 1);
  useEscape(wantAxis && !!feature && feature.type === "revolve" && !!feature.axis, () => setWantAxis(false), ESC.tool + 2);
  useEscape(wantShapes && !!feature, () => setWantShapes(false), ESC.tool + 2);

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
  const keep = ` Enter keeps the ${d.kind}, Esc cancels it.`;
  const dragText = d.kind === "extrude" ? " Drag the arrow to set how far, or click it to flip." : "";
  const help = !d.active
    ? null
    : !sketchCount
      ? "Draw a closed shape in a sketch first. Press K to start one."
      : session
        ? wantShapes
          ? `Click shapes to add them or take them out. Esc when you're done picking.`
          : pickingAxis
            ? "Click an axis, a sketch line or a straight edge to turn it round. Click shapes to add or take them out."
            : pickingTo
              ? `Click a face, edge or point for it to go up to. Drag the arrow to give it a distance instead.${keep}`
              : targeting && feature?.operation !== "join"
                ? `Click shapes to add or take them out, and bodies to choose what it ${feature?.operation === "cut" ? "cuts" : "keeps"}.${dragText}${keep}`
                : `Click more shapes to add them, or a picked one to take it out.${dragText}${keep}`
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
    /** Picks how far it goes. To object waits for a click on a face, edge or point before it changes the step. */
    setExtent: (e: ExtrudeExtent) => {
      const f = live.current.feature;
      if (e !== "to") {
        setWantTo(false);
        return change({ extent: e });
      }
      if (f?.type === "extrude" && f.to) return change({ extent: "to", direction: "one" });
      setWantTo(true);
    },
    /** Whether the next click off the shapes sets what To object goes up to. */
    pickingTo,
    /** Revolve: whether the next click on an axis, a sketch line or a straight edge sets what it turns round. */
    pickingAxis,
    /** Revolve: pick the axis again in the view. */
    repickAxis: () => {
      setWantShapes(false);
      setWantAxis(true);
    },
    /** Whether the shapes are being picked again, with every shape of the sketch showing. */
    pickingShapes: wantShapes,
    /** Pick the shapes again in the view; `clear` takes out the ones picked first. */
    repickShapes: (clear = false) => {
      setWantAxis(false);
      setWantShapes(true);
      if (clear) change({ seeds: [], texts: [] });
    },
    /** Stop picking shapes. */
    stopShapes: () => setWantShapes(false),
    pickAxis,
    /** Construction steps as built, for the axis menu. */
    construct: d.construct ?? [],
    /** Revolve: the construction or origin axis it turns round (`origin:X`), lit in the view. */
    axisShape:
      feature?.type === "revolve" && feature.axis?.kind === "ref"
        ? "origin" in feature.axis.ref
          ? `origin:${feature.axis.ref.origin}`
          : "step" in feature.axis.ref
            ? feature.axis.ref.step
            : null
        : null,
    wantTo,
    flip: () => {
      const f = live.current.feature;
      const c = f?.type === "extrude" ? mod.current?.flipOf(f) : null;
      if (c) change(c);
    },
    setFieldExpr,
    done,
    cancel,
    edit,
    commands,
    help,
  };
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

/**
 * Where a picked shape is kept: its middle, so it stays inside when the sketch changes, unless the middle can't be
 * found inside it (a thin or hooked shape), then the point clicked, which is inside it for sure.
 */
export function seedIn(all: Profile[], h: { profile: Profile; xy: Vec2 }): Vec2 {
  const s = seedOf(h.profile);
  return profileAt(all, s) === h.profile ? s : h.xy;
}

export type ExtrudeSession = ReturnType<typeof useExtrude>;

/** The text a region belongs to, when it is one of a text's letters (or the hole in one). */
export function textOf(p: Profile): string | null {
  const e = p.edges.length === 1 ? p.edges[0]! : null;
  return e && e.loop !== undefined ? e.id : null;
}
