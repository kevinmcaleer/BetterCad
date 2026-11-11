import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import {
  SketchIndex,
  angleOf,
  planeFrame,
  regions,
  sampleArc,
  sampleEllipse,
  ellipseGeo,
  sub,
  toSketch,
  toWorld,
  type Frame,
  type Profile,
  type Sketch,
  type Vec2,
} from "@bettercad/sketch";
import {
  addSweep,
  moveFrame,
  newId,
  profileAt,
  seedProfile,
  targetsOf,
  updateSweep,
  type ExtrudeOperation,
  type Mat4,
  type ModelDoc,
  type Part,
  type SweepFeature,
  type SweepParams,
} from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine, ScreenPoint } from "../viewport/engine";
import { SketchOverlay, type OverlayCurve, type OverlayFill } from "../sketch/overlay";
import { seedIn } from "../extrude/useExtrude";

/**
 * The Sweep tool (#400): click closed shapes in one sketch, then the lines and arcs of a path drawn in another sketch.
 * The step is on the timeline from the first click and the model follows each change; Enter keeps it as one undo
 * step, Esc takes it back.
 */
export interface SweepDeps {
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
  /** Moves from home by sketch id while the model is posed: shapes are picked where the sketch is shown. */
  posed?: Map<string, Mat4>;
  parts: Part[];
  view: RefObject<View3DHandle>;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
  theme: string;
}

const KEY = (id: string) => `sweep:${id}`;

const fill = (p: Profile, shade: OverlayFill["shade"]): OverlayFill => ({ outer: p.points, holes: p.holes.map((h) => h.points), shade });

function shownFrame(s: { id: string; sketch: Sketch }, posed?: Map<string, Mat4>): Frame {
  const f = planeFrame(s.sketch.plane);
  const m = posed?.get(s.id);
  return m ? moveFrame(m, f) : f;
}

/** The points along a sketch's line, arc or circle, for drawing it and finding it under the pointer. */
export function curvePoints(sk: Sketch, id: string): Vec2[] | null {
  const idx = new SketchIndex(sk);
  const e = idx.get(id);
  if (e?.kind === "line") return [idx.xy(e.a), idx.xy(e.b)];
  if (e?.kind === "circle") return sampleArc(idx.xy(e.c), e.r, 0, 2 * Math.PI, 72);
  if (e?.kind === "ellipse") return sampleEllipse(ellipseGeo(idx, e));
  if (e?.kind === "arc") {
    const c = idx.xy(e.c);
    return sampleArc(c, e.r, angleOf(sub(idx.xy(e.a), c)), angleOf(sub(idx.xy(e.b), c)));
  }
  return null;
}

/**
 * The path after a click on one of its curves: a curve already in it comes out, one in another sketch starts a new
 * path, and a circle is a path on its own.
 */
export function pathInto(path: SweepFeature["path"], pick: { sketch: string; curve: string; circle: boolean }): SweepFeature["path"] {
  if (!path || path.sketch !== pick.sketch) return { sketch: pick.sketch, curves: [pick.curve] };
  if (path.curves.includes(pick.curve)) {
    const curves = path.curves.filter((c) => c !== pick.curve);
    return curves.length ? { ...path, curves } : undefined;
  }
  return { ...path, curves: pick.circle ? [pick.curve] : [...path.curves, pick.curve] };
}

/** How far a screen point is from a screen polyline, px. */
function toPolyline(p: ScreenPoint, pts: ScreenPoint[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i]!, pts[i + 1]!];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
  }
  return best;
}

type ShapeHit = { kind: "shape"; sketch: string; profile: Profile; xy: Vec2 };
type CurveHit = { kind: "curve"; sketch: string; curve: string; circle: boolean };

export function useSweep(d: SweepDeps) {
  const { store, say } = d;
  const deps = useRef(d);
  deps.current = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const [hover, setHover] = useState<ShapeHit | CurveHit | null>(null);
  const feature = d.doc.features.find((f): f is SweepFeature => f.id === session?.id && f.type === "sweep") ?? null;
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

  const regionsOf = useMemo(() => {
    const cache = new Map<string, Profile[]>();
    const byId = new Map(d.sketches.map((s) => [s.id, s.sketch]));
    return (id: string): Profile[] => {
      let r = cache.get(id);
      if (!r) {
        const sk = byId.get(id);
        r = sk ? regions(sk, { split: true }) : [];
        cache.set(id, r);
      }
      return r;
    };
  }, [d.sketches]);

  /**
   * What the pointer is over: once there are shapes, a line, arc or circle of another sketch for the path; else a
   * closed shape, in the latest sketch that has one there.
   */
  const hit = useCallback(
    (p: ScreenPoint): ShapeHit | CurveHit | null => {
      const eng = engineOf();
      if (!eng) return null;
      const L = deps.current;
      const f = live.current.feature;
      if (f?.seeds.length) {
        let best: (CurveHit & { d: number }) | null = null;
        for (const s of L.sketches) {
          if (s.id === f.sketch) continue;
          const fr = shownFrame(s, L.posed);
          for (const e of s.sketch.entities) {
            if (e.kind === "point") continue;
            const pts = curvePoints(s.sketch, e.id);
            if (!pts) continue;
            const dist = toPolyline(
              p,
              pts.map((q) => eng.project(toWorld(fr, q) as [number, number, number])),
            );
            if (dist <= 6 && (!best || dist < best.d))
              best = { kind: "curve", sketch: s.id, curve: e.id, circle: e.kind === "circle" || e.kind === "ellipse", d: dist };
          }
        }
        if (best) return { kind: "curve", sketch: best.sketch, curve: best.curve, circle: best.circle };
      }
      for (const s of [...L.sketches].reverse()) {
        const fr = shownFrame(s, L.posed);
        const w = eng.rayPlane(p.x, p.y, fr.origin, fr.normal);
        if (!w) continue;
        const xy = toSketch(fr, w);
        const pr = profileAt(regionsOf(s.id), xy);
        if (pr) return { kind: "shape", sketch: s.id, profile: pr, xy };
      }
      return null;
    },
    [engineOf, regionsOf],
  );

  const change = useCallback(
    (c: Partial<SweepParams>) => {
      const s = live.current.session;
      if (!s) return;
      const f = live.current.feature;
      // Join changes one body: keep the first when coming from a cut of several.
      if (c.operation === "join" && c.targets === undefined && (f?.targets?.length ?? 0) > 1) c = { ...c, targets: f!.targets!.slice(0, 1) };
      store.edit((doc) => updateSweep(doc, s.id, c), s.isNew ? "Sweep" : `Edit ${f?.name ?? "sweep"}`, KEY(s.id));
    },
    [store],
  );

  const pick = useCallback(
    (h: ShapeHit | CurveHit) => {
      const f = live.current.feature;
      if (h.kind === "curve") {
        if (f) change({ path: pathInto(f.path, h) });
        return;
      }
      const seed = seedIn(regionsOf(h.sketch), h);
      if (!live.current.session) {
        const id = newId("f");
        const L2 = deps.current;
        const target = L2.parts[L2.parts.length - 1]?.id;
        const params: SweepParams = { sketch: h.sketch, seeds: [seed], split: true, operation: "new", ...(target ? { target } : {}) };
        L2.record((doc, i) => addSweep(doc, params, id, newId(), i), "Sweep", KEY(id));
        setSession({ id, isNew: true });
        return;
      }
      if (!f) return;
      // A shape in another sketch starts the shapes again there; the path can't be in the shapes' own sketch.
      if (h.sketch !== f.sketch) return change({ sketch: h.sketch, seeds: [seed], texts: [], ...(f.path?.sketch === h.sketch ? { path: undefined } : {}) });
      const all = regionsOf(f.sketch);
      const i = f.seeds.findIndex((s) => seedProfile(all, s) === h.profile);
      change({ seeds: i >= 0 ? f.seeds.filter((_, j) => j !== i) : [...f.seeds, seed] });
    },
    [regionsOf, change],
  );

  const setTargets = useCallback(
    (ids: string[]) => {
      const f = live.current.feature;
      if (!f || f.operation === "new") return;
      let list = [...new Set(ids.filter((id) => id !== f.body.id && deps.current.parts.some((p) => p.id === id)))];
      if (f.operation === "join") list = list.slice(-1);
      if (list.length) change({ targets: list, target: list[0] });
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

  useEffect(() => {
    const eng = engineOf();
    if (!eng) return;
    eng.setInput({
      move: (p, _m, pressed) => {
        if (pressed) return;
        const h = hit(p);
        setHover((o) => {
          if (!h || !o || o.kind !== h.kind) return h;
          if (o.kind === "shape" && h.kind === "shape") return o.profile === h.profile ? o : h;
          return o.kind === "curve" && h.kind === "curve" && o.curve === h.curve && o.sketch === h.sketch ? o : h;
        });
      },
      down: (p) => {
        const h = hit(p);
        if (h) {
          pick(h);
          return true;
        }
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
  }, [engineOf, hit, pick, toggleTarget]);

  // The picked shapes shaded, the path drawn over its sketch, and what's under the pointer lit.
  const picked = useMemo(() => {
    if (!feature) return [];
    const all = regionsOf(feature.sketch);
    return feature.seeds.map((s) => seedProfile(all, s)).filter((p): p is Profile => !!p);
  }, [feature, regionsOf]);
  useEffect(() => {
    const eng = engineOf();
    if (!eng) return;
    const fills = new Map<string, OverlayFill[]>();
    const curves = new Map<string, OverlayCurve[]>();
    const add = <T,>(m: Map<string, T[]>, id: string, x: T) => m.set(id, [...(m.get(id) ?? []), x]);
    const byId = new Map(deps.current.sketches.map((s) => [s.id, s]));
    if (feature) for (const p of picked) add(fills, feature.sketch, fill(p, "picked"));
    const path = feature?.path;
    const sk = path && byId.get(path.sketch);
    if (path && sk)
      for (const c of path.curves) {
        const pts = curvePoints(sk.sketch, c);
        if (pts) add(curves, path.sketch, { pts, shade: "picked" });
      }
    if (hover?.kind === "shape" && !picked.includes(hover.profile)) add(fills, hover.sketch, fill(hover.profile, "hover"));
    if (hover?.kind === "curve") {
      const s = byId.get(hover.sketch);
      const pts = s && curvePoints(s.sketch, hover.curve);
      if (pts) add(curves, hover.sketch, { pts, shade: "hover" });
    }
    const list = [...new Set([...fills.keys(), ...curves.keys()])].map((id) => {
      const s = byId.get(id);
      const o = new SketchOverlay(eng);
      if (s) o.update({ frame: shownFrame(s, deps.current.posed), curves: curves.get(id) ?? [], points: [], fills: fills.get(id) ?? [] });
      return o;
    });
    return () => list.forEach((o) => o.dispose());
  }, [engineOf, feature, picked, hover, d.theme]);

  const done = useCallback(() => {
    const L = live.current;
    const f = L.session && store.get().features.find((x): x is SweepFeature => x.id === L.session!.id && x.type === "sweep");
    if (f && !f.seeds.length) return say("Pick a closed shape to sweep first.", true);
    if (f && !f.path?.curves.length) return say("Pick a path to sweep along first.", true);
    if (L.session && f) {
      store.seal();
      const n = f.seeds.length;
      say(`${L.session.isNew ? "Swept" : "Changed the sweep of"} ${n === 1 ? "1 shape" : `${n} shapes`}`);
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

  /** Opens an existing step to change it (the timeline's Edit sweep). */
  const edit = useCallback(
    (id: string) => {
      store.seal();
      setSession({ id, isNew: false });
    },
    [store],
  );

  useEscape(!!session, cancel, ESC.tool + 1);

  const help = !d.sketches.some((s) => regionsOf(s.id).length)
    ? "Draw a closed shape, and a path in a sketch on another plane, first. Press K to start one."
    : !feature?.seeds.length
      ? "Click a closed sketch shape to sweep. Draw it where the path starts."
      : !feature.path?.curves.length
        ? "Click the lines and arcs of a path in another sketch, or a circle."
        : "Click more of the path end to end, or a picked curve to take it out. Enter keeps the sweep, Esc cancels it.";

  return {
    session,
    feature,
    help,
    targets: feature ? targetsOf(feature) : [],
    setTargets,
    toggleTarget,
    setOperation: (operation: ExtrudeOperation) => change({ operation }),
    clearShapes: () => change({ seeds: [], texts: [] }),
    clearPath: () => change({ path: undefined }),
    done,
    cancel,
    edit,
  };
}

export type SweepSession = ReturnType<typeof useSweep>;
