import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { planeFrame, regions, toSketch, type Frame, type Profile, type Sketch, type Vec2 } from "@bettercad/sketch";
import {
  addLoft,
  moveFrame,
  newId,
  profileAt,
  seedProfile,
  targetsOf,
  updateLoft,
  type ExtrudeOperation,
  type LoftFeature,
  type LoftParams,
  type LoftPick,
  type Mat4,
  type ModelDoc,
  type Part,
} from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine, ScreenPoint } from "../viewport/engine";
import { SketchOverlay, type OverlayFill } from "../sketch/overlay";
import { seedIn } from "../extrude/useExtrude";

/**
 * The Loft tool (#399): click a closed shape in one sketch, then shapes on other planes in the order the solid runs
 * through them. The step is on the timeline from the first click and the model follows each change; Enter keeps it
 * as one undo step, Esc takes it back. One shape per sketch: clicking another shape in a sketch already used swaps it.
 */
export interface LoftDeps {
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

const KEY = (id: string) => `loft:${id}`;

const fill = (p: Profile, shade: OverlayFill["shade"]): OverlayFill => ({ outer: p.points, holes: p.holes.map((h) => h.points), shade });

function shownFrame(s: { id: string; sketch: Sketch }, posed?: Map<string, Mat4>): Frame {
  const f = planeFrame(s.sketch.plane);
  const m = posed?.get(s.id);
  return m ? moveFrame(m, f) : f;
}

/**
 * Where a click on a shape goes in the list: a picked one comes out, a shape in a sketch already used takes its place,
 * and a shape on a new plane goes on the end.
 */
export function pickInto(sections: LoftPick[], pick: LoftPick, same: (a: LoftPick) => boolean): LoftPick[] {
  const i = sections.findIndex((s) => s.sketch === pick.sketch);
  if (i < 0) return [...sections, pick];
  if (same(sections[i]!)) return sections.filter((_, j) => j !== i);
  return sections.map((s, j) => (j === i ? pick : s));
}

export function useLoft(d: LoftDeps) {
  const { store, say } = d;
  const deps = useRef(d);
  deps.current = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const [hover, setHover] = useState<{ sketch: string; profile: Profile } | null>(null);
  const feature = d.doc.features.find((f): f is LoftFeature => f.id === session?.id && f.type === "loft") ?? null;
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

  /** The closed shape under the pointer, in the latest sketch that has one there. */
  const hit = useCallback(
    (p: ScreenPoint): { sketch: string; profile: Profile; xy: Vec2 } | null => {
      const eng = engineOf();
      if (!eng) return null;
      const L = deps.current;
      for (const s of [...L.sketches].reverse()) {
        const f = shownFrame(s, L.posed);
        const w = eng.rayPlane(p.x, p.y, f.origin, f.normal);
        if (!w) continue;
        const xy = toSketch(f, w);
        const pr = profileAt(regionsOf(s.id), xy);
        if (pr) return { sketch: s.id, profile: pr, xy };
      }
      return null;
    },
    [engineOf, regionsOf],
  );

  const change = useCallback(
    (c: Partial<LoftParams>) => {
      const s = live.current.session;
      if (!s) return;
      const f = live.current.feature;
      // Join changes one body: keep the first when coming from a cut of several.
      if (c.operation === "join" && c.targets === undefined && (f?.targets?.length ?? 0) > 1) c = { ...c, targets: f!.targets!.slice(0, 1) };
      store.edit((doc) => updateLoft(doc, s.id, c), s.isNew ? "Loft" : `Edit ${f?.name ?? "loft"}`, KEY(s.id));
    },
    [store],
  );

  const pick = useCallback(
    (h: { sketch: string; profile: Profile; xy: Vec2 }) => {
      const all = regionsOf(h.sketch);
      const at: LoftPick = { sketch: h.sketch, seed: seedIn(all, h) };
      const L = live.current;
      if (!L.session) {
        const id = newId("f");
        const L2 = deps.current;
        const target = L2.parts[L2.parts.length - 1]?.id;
        const params: LoftParams = { sections: [at], operation: "new", ...(target ? { target } : {}) };
        L2.record((doc, i) => addLoft(doc, params, id, newId(), i), "Loft", KEY(id));
        setSession({ id, isNew: true });
        return;
      }
      const f = L.feature;
      if (!f) return;
      change({ sections: pickInto(f.sections, at, (s) => seedProfile(regionsOf(s.sketch), s.seed) === h.profile) });
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
        setHover((o) => (o?.profile === h?.profile ? o : h && { sketch: h.sketch, profile: h.profile }));
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

  // The picked shapes shaded on their sketches, the one under the pointer lit.
  const picked = useMemo(
    () => (feature?.sections ?? []).map((s) => ({ sketch: s.sketch, profile: seedProfile(regionsOf(s.sketch), s.seed) ?? null })),
    [feature, regionsOf],
  );
  useEffect(() => {
    const eng = engineOf();
    if (!eng) return;
    const bySketch = new Map<string, OverlayFill[]>();
    const add = (id: string, f: OverlayFill) => bySketch.set(id, [...(bySketch.get(id) ?? []), f]);
    for (const p of picked) if (p.profile) add(p.sketch, fill(p.profile, "picked"));
    if (hover && !picked.some((p) => p.profile === hover.profile)) add(hover.sketch, fill(hover.profile, "hover"));
    const list = [...bySketch].map(([id, fills]) => {
      const s = deps.current.sketches.find((x) => x.id === id);
      const o = new SketchOverlay(eng);
      if (s) o.update({ frame: shownFrame(s, deps.current.posed), curves: [], points: [], fills });
      return o;
    });
    return () => list.forEach((o) => o.dispose());
  }, [engineOf, picked, hover, d.theme]);

  const done = useCallback(() => {
    const L = live.current;
    const f = L.session && store.get().features.find((x): x is LoftFeature => x.id === L.session!.id && x.type === "loft");
    if (f && f.sections.length < 2) return say("Pick a shape on another plane to loft to first.", true);
    if (L.session && f) {
      store.seal();
      say(`${L.session.isNew ? "Lofted" : "Changed the loft through"} ${f.sections.length} shapes`);
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

  /** Opens an existing step to change it (the timeline's Edit loft). */
  const edit = useCallback(
    (id: string) => {
      store.seal();
      setSession({ id, isNew: false });
    },
    [store],
  );

  useEscape(!!session, cancel, ESC.tool + 1);

  const n = feature?.sections.length ?? 0;
  const help = !d.sketches.some((s) => regionsOf(s.id).length)
    ? "Draw closed shapes in two sketches on different planes first. Press K to start one."
    : !feature
      ? "Click a closed sketch shape to start the loft."
      : n < 2
        ? "Click a closed shape on another plane to loft to."
        : "Click shapes on more planes to run through them in order, or a picked one to take it out. Enter keeps the loft, Esc cancels it.";

  return {
    session,
    feature,
    sections: picked,
    help,
    targets: feature ? targetsOf(feature) : [],
    setTargets,
    toggleTarget,
    setOperation: (operation: ExtrudeOperation) => change({ operation }),
    setRuled: (ruled: boolean) => change({ ruled }),
    remove: (i: number) => feature && change({ sections: feature.sections.filter((_, j) => j !== i) }),
    clear: () => change({ sections: [] }),
    done,
    cancel,
    edit,
  };
}

export type LoftSession = ReturnType<typeof useLoft>;
