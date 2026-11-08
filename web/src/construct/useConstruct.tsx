import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import {
  ACCEPT_TEXT,
  accepts,
  addConstruct,
  bodyRef,
  constructKind,
  geoOf,
  originGeo,
  newId,
  refText,
  setExpr,
  updateConstruct,
  type Accept,
  type BuiltConstruct,
  type ConstructFeature,
  type ConstructKind,
  type ConstructRef,
  type Geo,
  type ModelDoc,
  type OriginRef,
  type Part,
} from "../state/document";
import type { MeasureResult, Single, TopoRef } from "@bettercad/kernel";
import type { View3DHandle } from "../viewport/View3D";
import type { ConstructShape, Engine } from "../viewport/engine";

/**
 * The Construct tool (#265), as Fusion's Construct menu: pick a kind, then its inputs one at a time (faces, edges,
 * vertices, the origin, or other construction geometry), and the plane, axis or point goes on the timeline. A kind
 * with a distance, angle or "along" value then shows it on the bar to change. Esc backs out one pick at a time.
 */
export interface ConstructDeps {
  store: {
    get(): ModelDoc;
    edit(fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string): void;
    seal(): void;
    discard(key: string): void;
  };
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => void;
  doc: ModelDoc;
  parts: Part[];
  /** Construction geometry built up to the marker. */
  construct: BuiltConstruct[];
  view: RefObject<View3DHandle>;
  /** Whether the Construct tool is armed. */
  armed: boolean;
  /** The kind picked from the Construct menu; null while a step is opened from the timeline. */
  kind: ConstructKind | null;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
  /** The construction geometry under the pointer, to draw it lit. */
  onHover: (id: string | null) => void;
  /** The kernel's description of a pick. */
  measure: (refs: TopoRef[]) => Promise<MeasureResult | null>;
}

export const KEY = (id: string) => `construct:${id}`;

/** The origin's axes and point, drawn while the tool wants an axis or a point, so they can be picked. */
const ORIGIN_SHAPES: ConstructShape[] = (["X", "Y", "Z", "O"] as OriginRef[]).map((o) => {
  const g = originGeo(o);
  return g.t === "line" ? { id: `origin:${o}`, what: "axis", origin: g.origin, dir: g.dir } : { id: `origin:${o}`, what: "point", origin: [0, 0, 0] };
});
export const originShapes = (accept: Accept | null): ConstructShape[] =>
  accept === "line" || accept === "path"
    ? ORIGIN_SHAPES.filter((s) => s.what === "axis")
    : accept === "point"
      ? ORIGIN_SHAPES.filter((s) => s.what === "point")
      : [];

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 | null => {
  const l = Math.hypot(...a);
  return l > 1e-9 ? scale(a, 1 / l) : null;
};

/**
 * What a pick on a body is, as construction input. A flat face is its plane (through the click for an axis square to
 * it, else through its middle); a round face its axis, with the point clicked on it; an edge its line or its circle.
 */
export function geoFromPick(s: Single, opts: { hit?: V3 | null; ray?: { origin: V3; dir: V3 }; x?: V3 } = {}): Geo | null {
  if (s.kind === "vertex") return { t: "point", at: s.point };
  if (s.kind === "edge") {
    if (s.line) {
      const dir = unit(s.line);
      return dir && { t: "line", origin: s.ends[0], dir, length: s.length };
    }
    if (s.circle) {
      const radial = sub(s.ends[0], s.circle.centre);
      const axis = (s.circle.axis && unit(s.circle.axis)) ?? null;
      if (!axis) return null;
      const closed = Math.hypot(...sub(s.ends[0], s.ends[1])) < 1e-6;
      const sweep = closed ? 360 : Math.min(360, (s.length / s.circle.radius) * (180 / Math.PI));
      return { t: "circle", centre: s.circle.centre, axis, radius: s.circle.radius, start: add(s.circle.centre, radial), sweep };
    }
    return null;
  }
  if (s.kind === "face") {
    if (s.circle) {
      const axis = unit(s.circle.axis);
      if (!axis) return null;
      // Where the click's ray passes nearest the axis, pushed out onto the face.
      let start: V3 | undefined;
      if (opts.ray) {
        const w = sub(opts.ray.origin, s.circle.centre);
        const b = dot(opts.ray.dir, axis);
        const den = 1 - b * b;
        const t = den > 1e-9 ? (b * dot(w, axis) - dot(w, opts.ray.dir)) / den : 0;
        const q = add(opts.ray.origin, scale(opts.ray.dir, t));
        const h = dot(sub(q, s.circle.centre), axis);
        const out = unit(sub(sub(q, s.circle.centre), scale(axis, h)));
        if (out) start = add(add(s.circle.centre, scale(axis, h)), scale(out, s.circle.radius));
      }
      return { t: "circle", centre: s.circle.centre, axis, radius: s.circle.radius, round: true, ...(start && { start }) };
    }
    if (s.normal) {
      const normal = unit(s.normal);
      return normal && { t: "plane", origin: opts.hit ?? s.centre, normal, ...(opts.x && { x: opts.x }) };
    }
  }
  return null;
}

/** Which kind of body element to look for under the pointer for a slot. */
const FILTERS: Record<Accept, ("face" | "edge" | "vertex")[]> = {
  plane: ["face"],
  line: ["edge"],
  path: ["edge"],
  round: ["face", "edge"],
  point: ["vertex", "edge"],
};
const WHAT: Record<Accept, ConstructShape["what"]> = { plane: "plane", line: "axis", path: "axis", round: "axis", point: "point" };

export function useConstruct(d: ConstructDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [picks, setPicks] = useState<{ ref: ConstructRef; text: string }[]>([]);
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const feature = (d.doc.features.find((f) => f.id === session?.id && f.type === "construct") as ConstructFeature | undefined) ?? null;
  const kind = feature?.kind ?? d.kind;
  const info = kind ? constructKind(kind) : null;
  const slot = info && !session ? (info.inputs[picks.length] ?? null) : null;
  const live = useRef({ picks, session, feature, slot, kind });
  live.current = { picks, session, feature, slot, kind };
  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);
  const active = d.armed && d.kind !== null;

  const nameOf = useCallback((id: string) => {
    const L = deps.current;
    return L.parts.find((p) => p.id === id)?.name ?? L.doc.features.find((f) => f.id === id)?.name;
  }, []);

  const reset = useCallback(() => {
    setPicks([]);
    setSession(null);
  }, []);

  // A new kind from the menu starts again; putting the tool down keeps what was made.
  useEffect(() => {
    if (d.armed && !d.kind) return;
    if (live.current.session) store.seal();
    reset();
  }, [d.kind, d.armed, store, reset]);

  useEffect(() => {
    if (session && !feature) setSession(null);
  }, [session, feature]);

  const finish = useCallback(
    (id: string, isNew: boolean) => {
      const f = store.get().features.find((x) => x.id === id) as ConstructFeature | undefined;
      store.seal();
      if (f) deps.current.say(`${isNew ? "Made" : "Changed"} ${f.name}`);
      reset();
      deps.current.onClose();
    },
    [store, reset],
  );

  /** Adds a pick; the last one makes the step. */
  const take = useCallback(
    (ref: ConstructRef, geo: Geo) => {
      const { slot: s, picks: had, kind: k } = live.current;
      if (!s || !k) return;
      if (!accepts(s, geo)) return deps.current.say(`That isn't ${ACCEPT_TEXT[s]}. Pick ${ACCEPT_TEXT[s]}.`, true);
      const next = [...had, { ref, text: refText(ref, nameOf) }];
      const kinfo = constructKind(k);
      if (next.length < kinfo.inputs.length) return setPicks(next);
      const id = newId("f");
      const value = kinfo.value?.start ?? 0;
      deps.current.record((doc, at) => addConstruct(doc, { kind: k, refs: next.map((p) => p.ref), value }, id, at), kinfo.label, KEY(id));
      setPicks(next);
      if (kinfo.value) setSession({ id, isNew: true });
      else finish(id, true);
    },
    [nameOf, finish],
  );

  const pickBody = useCallback(
    (hit: { body: string; kind: "face" | "edge" | "vertex"; index: number }, at: { x: number; y: number }) => {
      const eng = engineOf();
      const part = deps.current.parts.find((p) => p.id === hit.body);
      if (!eng || !part) return;
      const k = live.current.kind;
      const info = hit.kind === "face" ? eng.faceInfo(hit.body, hit.index) : null;
      const ray = eng.ray(at.x, at.y);
      const hitPoint = info?.flat && k === "normal" ? eng.rayPlane(at.x, at.y, info.centroid, info.normal) : null;
      void deps.current.measure([{ body: hit.body, kind: hit.kind, index: hit.index }]).then(
        (r) => {
          const s = r?.items[0];
          const geo = s && geoFromPick(s, { hit: hitPoint, ray, x: info?.edge });
          if (!geo) return deps.current.say(`That can't be used. Pick ${ACCEPT_TEXT[live.current.slot ?? "plane"]}.`, true);
          take(bodyRef(part, hit.kind, hit.index, geo), geo);
        },
        (e: unknown) => deps.current.say((e as { message?: string })?.message ?? "That pick could not be read", true),
      );
    },
    [engineOf, take],
  );

  /** A pick of construction geometry drawn in the view: another step, or the origin's axes and point. */
  const pickShape = useCallback(
    (id: string) => {
      if (id.startsWith("origin:")) {
        const o = id.slice(7) as OriginRef;
        return take({ origin: o }, originGeo(o));
      }
      const c = deps.current.construct.find((x) => x.id === id);
      if (c) take({ step: id }, geoOf(c.geo));
    },
    [take],
  );

  // The view: origin planes for a plane slot, construction geometry, then faces, edges or vertices of bodies.
  useEffect(() => {
    const eng = engineOf();
    if (!active || !slot || !eng) return;
    const what = new Set([WHAT[slot]]);
    if (slot === "plane") eng.showPlanes(true);
    type Hit = { shape: string } | { plane: "XY" | "XZ" | "YZ" } | { body: { body: string; kind: "face" | "edge" | "vertex"; index: number } };
    // Points and axes are small, so they come first; then the bodies; then planes, which are big and see-through.
    const under = (x: number, y: number): Hit | null => {
      const shape = slot === "plane" ? null : eng.constructAt(x, y, what);
      if (shape) return { shape };
      for (const f of FILTERS[slot]) {
        const h = eng.pick(x, y, f);
        if (h) return { body: { body: h.body, kind: f, index: h.index } };
      }
      const sheet = slot === "plane" ? eng.constructAt(x, y, what) : null;
      if (sheet) return { shape: sheet };
      const plane = slot === "plane" ? eng.planeAt(x, y) : null;
      return plane ? { plane } : null;
    };
    eng.setInput({
      move: (p, _m, pressed) => {
        if (pressed) return;
        const h = under(p.x, p.y);
        deps.current.onHover(h && "shape" in h ? h.shape : null);
        eng.showHover(h && "body" in h ? h.body : null);
        eng.hoverPlane(h && "plane" in h ? h.plane : null);
      },
      down: (p) => {
        const h = under(p.x, p.y);
        if (!h) return false;
        if ("shape" in h) pickShape(h.shape);
        else if ("plane" in h) take({ origin: h.plane }, originGeo(h.plane));
        else pickBody(h.body, p);
        return true;
      },
      leave: () => {
        deps.current.onHover(null);
        eng.showHover(null);
        eng.hoverPlane(null);
      },
    });
    return () => {
      eng.setInput(null);
      eng.showHover(null);
      eng.hoverPlane(null);
      if (slot === "plane") eng.showPlanes(false);
      deps.current.onHover(null);
    };
  }, [active, slot, engineOf, pickShape, pickBody, take]);

  const setValue = useCallback(
    (v: number, expression?: string) => {
      const s = live.current.session;
      const f = live.current.feature;
      if (!s || !f) return;
      const label = s.isNew ? constructKind(f.kind).label : `Edit ${f.name}`;
      store.edit((doc) => updateConstruct(doc, s.id, { value: v }), label, KEY(s.id));
      if (expression || f.exprs?.value) store.edit((doc) => setExpr(doc, s.id, "value", expression), label, KEY(s.id));
    },
    [store],
  );

  const done = useCallback(() => {
    const s = live.current.session;
    if (s) return finish(s.id, s.isNew);
    reset();
    deps.current.onClose();
  }, [finish, reset]);

  const cancel = useCallback(() => {
    const s = live.current.session;
    if (s) store.discard(KEY(s.id));
    reset();
    deps.current.onClose();
  }, [store, reset]);

  /** Esc backs out one pick, then puts the tool down. */
  const back = useCallback(() => {
    const { session: s, picks: p } = live.current;
    if (s) return cancel();
    if (p.length) return setPicks(p.slice(0, -1));
    deps.current.onClose();
  }, [cancel]);

  /** Opens a construction step to change its value, from the timeline. */
  const edit = useCallback(
    (id: string) => {
      store.seal();
      const f = store.get().features.find((x) => x.id === id) as ConstructFeature | undefined;
      setPicks(f ? f.refs.map((ref) => ({ ref, text: refText(ref, nameOf) })) : []);
      setSession({ id, isNew: false });
    },
    [store, nameOf],
  );

  useEscape(active && (picks.length > 0 || !!session), back, ESC.tool + 1);

  const help =
    !active && !session ? null : slot ? `Pick ${ACCEPT_TEXT[slot]}.` : info?.value ? `Set the ${info.value.label.toLowerCase()}. Enter keeps it.` : null;

  return { kind, info, picks, slot, session, feature, setValue, done, cancel, back, edit, help, active: active || !!session };
}

export type ConstructSession = ReturnType<typeof useConstruct>;
