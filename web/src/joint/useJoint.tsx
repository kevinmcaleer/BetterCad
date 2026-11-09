import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import {
  JOINT_KINDS,
  JOINT_LIMITS,
  addJoint,
  jointFrame,
  jointLinkProblem,
  jointMove,
  mat4Apply,
  mat4ApplyDir,
  mat4InvertRigid,
  newId,
  setExpr,
  updateJoint,
  type BuiltLink,
  type JointFeature,
  type JointParams,
  type ModelDoc,
  type Part,
} from "../state/document";
import type { MeasureResult, TopoRef } from "@bettercad/kernel";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine } from "../viewport/engine";

/**
 * The Joint tool (#172), one panel like the Projects scene editor's: the component that moves and its snap, the one it
 * hangs from (or Base) and its snap, how it lines up and how it moves. Clicking a snap in the view picks its component
 * too. The moving part's snap lands on the other's, face to face; with no snap of its own it stays where it was
 * modelled. The joint goes on the timeline once both components and the parent's snap are in. Esc backs out one pick
 * at a time, and takes a made joint back.
 */
export interface JointDeps {
  store: {
    get(): ModelDoc;
    edit(fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string): void;
    seal(): void;
    discard(key: string): void;
  };
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => void;
  doc: ModelDoc;
  parts: Part[];
  links: BuiltLink[];
  joints: JointFeature[];
  view: RefObject<View3DHandle>;
  active: boolean;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
  /** The kernel's description of a pick, for its axis. */
  measure: (refs: TopoRef[]) => Promise<MeasureResult | null>;
}

export const KEY = (id: string) => `joint:${id}`;
const AXES: ReadonlySet<"axis"> = new Set(["axis"]);

/** The snaps: the moving component's, and the one it hangs from (which is the joint's axis). */
export type JointPick = "child" | "parent";
/** What the next click in the view picks, or "edit" when it picks nothing. */
export type JointStage = JointPick | "edit";
type Frame = { origin: [number, number, number]; axis: [number, number, number] };
type Snap = NonNullable<JointParams["from"]>;
/** The joint's settings besides its picks: on the joint once it's made, here until then. */
export type JointSettings = Pick<JointParams, "kind" | "lower" | "upper" | "angle" | "gap" | "offset" | "flip">;
const START: JointSettings = { kind: "revolute", ...JOINT_LIMITS.revolute };

export function useJoint(d: JointDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [child, setChild] = useState<string | null>(null);
  const [from, setFrom] = useState<Snap | null>(null);
  const [parent, setParent] = useState<string | null | undefined>(undefined);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [target, setTarget] = useState<JointPick | null>("child");
  const [draft, setDraft] = useState<JointSettings>(START);
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const feature = (d.doc.features.find((f) => f.id === session?.id && f.type === "joint") as JointFeature | undefined) ?? null;
  const stage: JointStage = target ?? "edit";
  const settings: JointSettings = feature ?? draft;
  const live = useRef({ child, from, parent, frame, session, feature, target, draft });
  live.current = { child, from, parent, frame, session, feature, target, draft };
  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);
  const nameOf = useCallback((l: string | null) => (l === null ? "Base" : (deps.current.links.find((x) => x.id === l)?.name ?? "that link")), []);

  const reset = useCallback(() => {
    setChild(null);
    setFrom(null);
    setParent(undefined);
    setFrame(null);
    setTarget("child");
    setDraft(START);
    setSession(null);
  }, []);

  useEffect(() => {
    if (session && !feature) reset();
  }, [session, feature, reset]);

  useEffect(() => {
    if (!d.active) {
      if (live.current.session) store.seal();
      reset();
    }
  }, [d.active, store, reset]);
  // The panel closing with a joint open keeps it, as switching tools does.
  useEffect(
    () => () => {
      if (live.current.session) store.seal();
    },
    [store],
  );

  /** The other joints: a made joint's own doesn't stop its links being picked again. */
  const others = () => deps.current.joints.filter((j) => j.id !== live.current.session?.id);

  const change = useCallback(
    (c: Partial<JointParams> & { name?: string }) => {
      const s = live.current.session;
      if (!s) {
        const { kind } = c;
        return setDraft((x) => ({ ...x, ...(kind && kind !== x.kind && c.lower === undefined ? JOINT_LIMITS[kind] : {}), ...c }));
      }
      const { name, ...rest } = c;
      store.edit(
        (doc) => {
          const next = updateJoint(doc, s.id, rest);
          return name ? { ...next, features: next.features.map((f) => (f.id === s.id ? { ...f, name } : f)) } : next;
        },
        s.isNew ? "Joint" : "Edit joint",
        KEY(s.id),
      );
    },
    [store],
  );

  /**
   * Puts picks in: on the joint once it's made; until then, the joint is made once both components and the parent's
   * snap are in. `from: null` takes the moving part's snap off.
   */
  const put = useCallback(
    (p: { child?: string; from?: Snap | null; parent?: string | null; frame?: Frame }) => {
      const x = live.current;
      const c = p.child ?? x.child;
      const up = "parent" in p ? p.parent : x.parent;
      const f = p.frame ?? x.frame;
      const snap = "from" in p ? p.from : p.child !== undefined && p.child !== x.child ? null : x.from;
      if (c !== null && up !== undefined) {
        const why = jointLinkProblem(others(), c, up);
        if (why) return deps.current.say(why, true);
      }
      setChild(c);
      setFrom(snap ?? null);
      setParent(up);
      setFrame(f);
      setTarget(c === null ? "child" : up === undefined || !f ? "parent" : null);
      if (x.session) {
        if (c === null || up === undefined || !f) return;
        return change({ child: c, parent: up, origin: f.origin, axis: f.axis, from: snap ?? undefined });
      }
      if (c === null || up === undefined || !f) return;
      const id = newId("f");
      const params: JointParams = { child: c, parent: up, ...f, ...(snap ? { from: snap } : {}), ...x.draft };
      deps.current.record((dd, at) => addJoint(dd, params, id, at), "Joint", KEY(id));
      setSession({ id, isNew: true });
    },
    [change],
  );

  /** The component a body is in, or null for Base. */
  const linkOf = (body: string) => deps.current.parts.find((p) => p.id === body)?.link ?? null;

  /** Picks a snap on a body: a round edge or face gives its centre and axis, a flat face its middle and normal. */
  const pickSnap = useCallback(
    (which: JointPick, ref: TopoRef) => {
      const l = linkOf(ref.body);
      if (which === "child") {
        if (l === null) return deps.current.say("That body is in Base. Make it a component first: right-click it, then New component.", true);
        if (others().some((j) => j.child === l)) return deps.current.say(`${nameOf(l)} already hangs from a joint`, true);
      }
      void deps.current.measure([ref]).then(
        (r) => {
          const s = r?.items[0];
          const f = s && jointFrame(s);
          if (!f) return deps.current.say("Pick a face, a round edge or a straight edge for the snap", true);
          if (live.current.target !== which) return;
          // A snap on the moving component itself gives the axis where it stands, and it hangs from what was chosen.
          if (which === "parent") return put(l !== null && l === live.current.child ? { frame: f } : { parent: l, frame: f });
          // The joint has moved its part already: the snap goes in where the part stood before.
          const j = live.current.feature;
          const m = j && j.child === l ? jointMove(j) : null;
          const back = m && mat4InvertRigid(m);
          const point = back ? mat4Apply(back, f.origin) : f.origin;
          const normal = back ? mat4ApplyDir(back, f.axis) : f.axis;
          put({ child: l!, from: { point, normal } });
        },
        (e: unknown) => deps.current.say((e as { message?: string })?.message ?? "That snap could not be read", true),
      );
    },
    [nameOf, put],
  );

  /** Picks the component from the panel's list, without a snap. */
  const pickChild = useCallback((l: string) => put({ child: l }), [put]);
  const pickParent = useCallback((l: string | null) => put({ parent: l }), [put]);

  /** Clears a snap and picks it again with the next click. A made joint keeps its old axis until then. */
  const clear = useCallback(
    (which: JointPick) => {
      if (which === "child") {
        if (live.current.session) put({ from: null });
        else setFrom(null);
      } else setFrame(null);
      setTarget(which);
    },
    [put],
  );

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    const snapAt = (x: number, y: number) => eng.pick(x, y, "edge") ?? eng.pick(x, y, "face");
    eng.setInput({
      move: (p, _m, pressed) => {
        const t = live.current.target;
        if (pressed || !t) return;
        if (t === "parent" && eng.constructAt(p.x, p.y, AXES)) return eng.showHover(null);
        eng.showHover(snapAt(p.x, p.y));
      },
      down: (p) => {
        const t = live.current.target;
        if (!t) return false;
        if (t === "parent") {
          // An origin or construction axis in the view gives the axis as it is.
          const shape = eng.constructAt(p.x, p.y, AXES);
          const ax = shape ? eng.constructShape(shape) : null;
          if (ax?.dir) {
            put({ frame: { origin: ax.origin, axis: ax.dir } });
            return true;
          }
        }
        const hit = snapAt(p.x, p.y);
        if (!hit) return false;
        pickSnap(t, { body: hit.body, kind: hit.kind as TopoRef["kind"], index: hit.index });
        return true;
      },
      leave: () => eng.showHover(null),
    });
    return () => {
      eng.setInput(null);
      eng.showHover(null);
    };
  }, [d.active, engineOf, pickSnap, put]);

  /** Keeps (or drops) a limit's expression (#75), in the same undo step as its value. */
  const setFieldExpr = useCallback(
    (path: "lower" | "upper", expression: string | undefined) => {
      const s = live.current.session;
      const f = live.current.feature;
      if (!s || (!expression && !f?.exprs?.[path])) return;
      store.edit((doc) => setExpr(doc, s.id, path, expression), s.isNew ? "Joint" : "Edit joint", KEY(s.id));
    },
    [store],
  );

  /** What OK waits for, if anything. */
  const missing = child === null ? "the component that moves" : parent === undefined ? "what it hangs from" : frame === null ? "a snap on it" : null;

  const done = useCallback(() => {
    const s = live.current.session;
    const f = s && (store.get().features.find((x) => x.id === s.id) as JointFeature | undefined);
    if (!s || !f) return;
    store.seal();
    const k = JOINT_KINDS.find((x) => x.id === f.kind)!;
    deps.current.say(`${s.isNew ? "Made" : "Changed"} ${f.name}: ${k.label.toLowerCase()}, ${nameOf(f.child)} on ${nameOf(f.parent)}`);
    reset();
    deps.current.onClose();
  }, [store, reset, nameOf]);

  const cancel = useCallback(() => {
    const s = live.current.session;
    if (s) store.discard(KEY(s.id));
    reset();
    deps.current.onClose();
  }, [store, reset]);

  /** Esc: a made joint goes back; before that, the last pick. */
  const back = useCallback(() => {
    const x = live.current;
    if (x.session) return cancel();
    if (x.frame) return clear("parent");
    if (x.parent !== undefined) {
      setParent(undefined);
      return setTarget("parent");
    }
    if (x.child !== null || x.from) {
      setChild(null);
      setFrom(null);
      return setTarget("child");
    }
    deps.current.onClose();
  }, [cancel, clear]);

  /** Opens a joint to change it, from the timeline. */
  const edit = useCallback(
    (id: string) => {
      store.seal();
      const f = store.get().features.find((x): x is JointFeature => x.id === id && x.type === "joint");
      if (!f) return;
      setChild(f.child);
      setFrom(f.from ?? null);
      setParent(f.parent);
      setFrame({ origin: f.origin, axis: f.axis });
      setTarget(null);
      setSession({ id, isNew: false });
    },
    [store],
  );

  useEscape(d.active && (!!session || child !== null || parent !== undefined || !!frame), back, ESC.tool + 1);

  const help = !d.active
    ? null
    : target === "child"
      ? "Click a face or a round edge on the component that moves, where it joins."
      : target === "parent"
        ? "Click a face, a round edge or an axis on the part it joins, or press Enter for Base."
        : "Change any field. Enter keeps it, Esc puts it back.";

  return {
    stage,
    target,
    setTarget,
    child,
    from,
    parent,
    frame,
    feature,
    settings,
    session,
    missing,
    change,
    setFieldExpr,
    clear,
    done,
    cancel,
    back,
    edit,
    help,
    pickChild,
    pickParent,
    nameOf,
    links: d.links,
  };
}

export type JointSession = ReturnType<typeof useJoint>;
