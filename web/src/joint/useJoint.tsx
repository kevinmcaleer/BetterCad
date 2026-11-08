import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import {
  JOINT_KINDS,
  JOINT_LIMITS,
  addJoint,
  jointFrame,
  jointLinkProblem,
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
 * The Joint tool (#172): click a body in the link that moves, then one in the link it hangs from (Enter for Base), then
 * a round edge, a round face or a flat face for the axis. The joint goes on the timeline as a Hinge to start; its kind,
 * limits and name are on the bar. Esc backs out one pick at a time.
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

/** Where the tool is: picking the moving link, the link it hangs from, the axis, or editing a made joint. */
export type JointStage = "child" | "parent" | "axis" | "edit";

export function useJoint(d: JointDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [child, setChild] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null | undefined>(undefined);
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const feature = (d.doc.features.find((f) => f.id === session?.id && f.type === "joint") as JointFeature | undefined) ?? null;
  const stage: JointStage = session ? "edit" : child === null ? "child" : parent === undefined ? "parent" : "axis";
  const live = useRef({ child, parent, session, feature, stage });
  live.current = { child, parent, session, feature, stage };
  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);
  const nameOf = useCallback((l: string | null) => (l === null ? "Base" : (deps.current.links.find((x) => x.id === l)?.name ?? "that link")), []);

  const reset = useCallback(() => {
    setChild(null);
    setParent(undefined);
    setSession(null);
  }, []);

  useEffect(() => {
    if (session && !feature) setSession(null);
  }, [session, feature]);

  useEffect(() => {
    if (!d.active) {
      if (live.current.session) store.seal();
      reset();
    }
  }, [d.active, store, reset]);

  /** The link of a body, or null for Base. */
  const linkOf = (body: string) => deps.current.parts.find((p) => p.id === body)?.link ?? null;

  const pickChild = useCallback(
    (body: string) => {
      const l = linkOf(body);
      if (l === null) return deps.current.say("That body is in Base. Make it a link first: right-click it, then Make link.", true);
      const others = deps.current.joints.filter((j) => j.id !== live.current.session?.id);
      if (others.some((j) => j.child === l)) return deps.current.say(`${nameOf(l)} already hangs from a joint`, true);
      setChild(l);
    },
    [nameOf],
  );

  const pickParent = useCallback((l: string | null) => {
    const c = live.current.child;
    if (c === null) return;
    const why = jointLinkProblem(deps.current.joints, c, l);
    if (why) return deps.current.say(why, true);
    setParent(l);
  }, []);

  const pickAxis = useCallback((ref: TopoRef) => {
    const c = live.current.child;
    const p = live.current.parent;
    if (c === null || p === undefined) return;
    void deps.current.measure([ref]).then(
      (r) => {
        const s = r?.items[0];
        const frame = s && jointFrame(s);
        if (!frame) return deps.current.say("Pick a round edge, a round face or a flat face for the axis", true);
        if (live.current.child !== c || live.current.parent !== p) return;
        const id = newId("f");
        const params: JointParams = { kind: "revolute", child: c, parent: p, ...frame, ...JOINT_LIMITS.revolute };
        deps.current.record((dd, at) => addJoint(dd, params, id, at), "Joint", KEY(id));
        setSession({ id, isNew: true });
      },
      (e: unknown) => deps.current.say((e as { message?: string })?.message ?? "That axis could not be read", true),
    );
  }, []);

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    eng.setInput({
      move: (p, _m, pressed) => {
        const st = live.current.stage;
        if (pressed || st === "edit") return;
        eng.showHover(st === "axis" ? (eng.pick(p.x, p.y, "edge") ?? eng.pick(p.x, p.y, "face")) : eng.pick(p.x, p.y, "body"));
      },
      down: (p) => {
        const st = live.current.stage;
        if (st === "edit") return false;
        if (st === "axis") {
          const hit = eng.pick(p.x, p.y, "edge") ?? eng.pick(p.x, p.y, "face");
          if (!hit) return false;
          pickAxis({ body: hit.body, kind: hit.kind as TopoRef["kind"], index: hit.index });
          return true;
        }
        const hit = eng.pick(p.x, p.y, "body");
        if (!hit) return false;
        if (st === "child") pickChild(hit.body);
        else pickParent(linkOf(hit.body));
        return true;
      },
      leave: () => eng.showHover(null),
    });
    return () => {
      eng.setInput(null);
      eng.showHover(null);
    };
  }, [d.active, engineOf, pickChild, pickParent, pickAxis]);

  const change = useCallback(
    (c: Partial<JointParams> & { name?: string }) => {
      const s = live.current.session;
      if (!s) return;
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

  const done = useCallback(() => {
    const s = live.current.session;
    const f = s && (store.get().features.find((x) => x.id === s.id) as JointFeature | undefined);
    if (s && f) {
      store.seal();
      const k = JOINT_KINDS.find((x) => x.id === f.kind)!;
      deps.current.say(`${s.isNew ? "Made" : "Changed"} ${f.name}: ${k.label.toLowerCase()}, ${nameOf(f.child)} on ${nameOf(f.parent)}`);
    }
    reset();
    deps.current.onClose();
  }, [store, reset, nameOf]);

  const cancel = useCallback(() => {
    const s = live.current.session;
    if (s) store.discard(KEY(s.id));
    reset();
    deps.current.onClose();
  }, [store, reset]);

  /** Esc backs out one pick: the axis, then the parent, then the child, then the tool. */
  const back = useCallback(() => {
    const st = live.current.stage;
    if (st === "edit") return cancel();
    if (st === "axis") return setParent(undefined);
    if (st === "parent") return setChild(null);
    deps.current.onClose();
  }, [cancel]);

  /** Opens a joint to change it, from the timeline. */
  const edit = useCallback(
    (id: string) => {
      store.seal();
      setSession({ id, isNew: false });
    },
    [store],
  );

  useEscape(d.active && stage !== "child", back, ESC.tool + 1);

  const help = !d.active
    ? null
    : stage === "child"
      ? "Click a body in the link that moves."
      : stage === "parent"
        ? `Click a body in the link ${nameOf(child)} hangs from, or press Enter for Base.`
        : stage === "axis"
          ? "Click a round edge, a round face or a flat face for the axis."
          : "Set the kind and limits. Enter keeps it, Esc takes it back.";

  return { stage, child, parent, feature, session, change, setFieldExpr, done, cancel, back, edit, help, pickParent, nameOf };
}

export type JointSession = ReturnType<typeof useJoint>;
