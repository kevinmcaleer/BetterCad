import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Matrix4 } from "three";
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
  mat4Mul,
  linkTransforms,
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
import type { Engine, Mods, ScreenPoint } from "../viewport/engine";
import { readPalette } from "../viewport/colours";
import { isTyping } from "../state/commands";
import { loupeAuto } from "../state/loupePref";
import { CROWD_DWELL, LOUPE_REACH, LOUPE_SIZE, crowding, lensed, loupeZoom, type Loupe } from "../sketch/loupe";
import { SnapMarks } from "./snapMarks";
import { between, facing, faceSnaps, nearSnaps, wiggle, type SnapPoint, type V3 } from "./snapPoints";
import { sharpCorners } from "./sharpCorners";

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
/** How near the pointer, in CSS px, a snap point has to be to take the click. */
const SNAP_REACH = 12;
/** How long a joint's wiggle takes, in ms (#394). */
const WIGGLE_MS = 1400;

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

  const changeRef = useRef(change);
  changeRef.current = change;

  /** Puts a snap's frame in: the moving part's, or the axis it hangs from. */
  const takeFrame = useCallback(
    (which: JointPick, l: string | null, f: Frame) => {
      if (which === "child") {
        if (l === null) return deps.current.say("That body is in Base. Make it a component first: right-click it, then New component.", true);
        if (others().some((j) => j.child === l)) return deps.current.say(`${nameOf(l)} already hangs from a joint`, true);
      }
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
    [nameOf, put],
  );

  /** Picks a snap on a body: a round edge or face gives its centre and axis, a flat face its middle and normal. */
  const pickSnap = useCallback(
    (which: JointPick, ref: TopoRef) => {
      const l = linkOf(ref.body);
      if (which === "child" && l === null) return takeFrame(which, l, { origin: [0, 0, 0], axis: [0, 0, 1] });
      void deps.current.measure([ref]).then(
        (r) => {
          const s = r?.items[0];
          const f = s && jointFrame(s);
          if (!f) return deps.current.say("Pick a face, a round edge or a straight edge for the snap", true);
          takeFrame(which, l, f);
        },
        (e: unknown) => deps.current.say((e as { message?: string })?.message ?? "That snap could not be read", true),
      );
    },
    [takeFrame],
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

  /** The magnifier loupe over crowded snap points (#385), while it is open, and the canvas it draws into. */
  const [loupe, setLoupe] = useState<Loupe | null>(null);
  const closeLoupe = useRef<() => void>(() => {});
  const loupeCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const eng = engineOf();
    if (!d.active || !eng) return;
    // The face under the pointer goes pale and shows its snap points (#383, #384); the nearest one within reach is hot.
    const marks = new SnapMarks(eng);
    eng.setHoverFill("snap-face");
    let face: { body: string; index: number; snaps: SnapPoint[]; ghosts: [V3, V3][] } | null = null;
    /** The first of two Shift-clicks (#388): a snap point, or a flat face as its plane. */
    let half: { body: string; point: V3; normal: V3; plane: boolean } | null = null;
    /** Each face's edge numbers on the body last pointed at, for finding cut-away corners (#389). */
    let topo: { body: string; faceEdges: number[][] | null } | null = null;
    let hot = -1;
    // The loupe: while it is open the pointer moves at its own speed inside it, so in the view it moves `zoom` times
    // slower, and picks reach only as far as the zoom allows.
    let lens: Loupe | null = null;
    let dwell: number | undefined;
    let last: { p: ScreenPoint; mods: Mods } | null = null;
    /** Esc closed the loupe: it stays shut until the pointer leaves the crowd. */
    let quiet = false;
    const show = (l: Loupe | null) => {
      lens = l;
      setLoupe(l);
    };
    closeLoupe.current = () => {
      if (lens?.why === "crowd") quiet = true;
      show(null);
    };
    /** The moving part's edges, carried to where a snap on `body` would put it: null when it would not move it. */
    const ghostAt = (body: string, s: SnapPoint): [V3, V3][] | null => {
      const x = live.current;
      const l = linkOf(body);
      if (!x.child || !x.from || l === x.child) return null;
      const set = x.feature ?? x.draft;
      const next = jointMove({ ...set, origin: s.point, axis: s.normal, from: x.from });
      if (!next) return null;
      const now = x.feature && x.feature.child === x.child ? jointMove(x.feature) : null;
      const m = now ? mat4Mul(next, mat4InvertRigid(now)) : next;
      const out: [V3, V3][] = [];
      const ids = new Set(deps.current.links.find((k) => k.id === x.child)?.parts ?? []);
      for (const b of eng.bodyCounts()) {
        if (!ids.has(b.id)) continue;
        for (let e = 0; e < b.edges; e++) {
          const pts = eng.edgePoints(b.id, e) ?? [];
          for (let i = 1; i < pts.length; i++) out.push([mat4Apply(m, pts[i - 1]!), mat4Apply(m, pts[i]!)]);
        }
      }
      return out.length ? out : null;
    };
    const turnBy = (deg: number) => {
      const set = live.current.feature ?? live.current.draft;
      const a = (((((set.angle ?? 0) + deg + 180) % 360) + 360) % 360) - 180;
      changeRef.current({ angle: a || undefined });
    };
    const flipOver = () => changeRef.current({ flip: !(live.current.feature ?? live.current.draft).flip || undefined });
    const onScreen = () => (face ? face.snaps.map((s) => eng.project(s.point)) : []);
    const openAt = (p: ScreenPoint, why: Loupe["why"], gap?: number | null) =>
      show({ anchor: p, pointer: p, zoom: loupeZoom(gap === undefined ? (crowding(onScreen(), p)?.gap ?? null) : gap), why });
    /** Opens, follows or closes the loupe as the pointer moves. */
    const watch = (p: ScreenPoint, mods: Mods) => {
      window.clearTimeout(dwell);
      if (lens) {
        if (lens.why === "alt" && !mods.alt) return show(null);
        // Moving off the loupe's edge closes it, or with Alt held, moves it to the pointer.
        if (Math.hypot(p.x - lens.anchor.x, p.y - lens.anchor.y) > LOUPE_REACH) return lens.why === "alt" ? openAt(p, "alt") : show(null);
        return show({ ...lens, pointer: p });
      }
      if (mods.touch) return;
      if (mods.alt && !mods.shift) return openAt(p, "alt");
      const crowd = loupeAuto() ? crowding(onScreen(), p) : null;
      if (!crowd) quiet = false;
      if (!crowd || quiet) return;
      dwell = window.setTimeout(() => {
        if (lens || !last || last.mods.alt) return;
        const now = crowding(onScreen(), last.p);
        if (now) openAt(last.p, "crowd", now.gap);
      }, CROWD_DWELL);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey) return;
      if (e.type === "keydown" && e.key === "Tab" && last && face && live.current.target) {
        // Tab: the next snap in reach under the pointer.
        e.preventDefault();
        turn = { n: turn.n + 1, at: lensed(lens, last.p) };
        return refresh();
      }
      if (e.type === "keydown" && !e.altKey && (e.key === "q" || e.key === "Q" || e.key === "w" || e.key === "W")) {
        // Q turns the part 90° about the joint (Shift+Q back), W flips it over (#392).
        e.preventDefault();
        return e.key.toLowerCase() === "q" ? turnBy(e.shiftKey ? -90 : 90) : flipOver();
      }
      if (e.key !== "Alt") return;
      if (e.type === "keydown") {
        // Alt alone would focus the browser's menu bar on Windows.
        e.preventDefault();
        if (!lens && last && !last.mods.touch && live.current.target) openAt(last.p, "alt");
      } else if (lens?.why === "alt") show(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    /** Tab steps through the snaps in reach, nearest first (#391), until the pointer moves on. */
    let turn = { n: 0, at: null as ScreenPoint | null };
    const cycled = (p: ScreenPoint, reach: number) => {
      if (turn.at && Math.hypot(p.x - turn.at.x, p.y - turn.at.y) > 3) turn = { n: 0, at: null };
      const near = nearSnaps(onScreen(), p, reach);
      return near.length ? near[turn.n % near.length]! : -1;
    };
    /** The face and snap under a point (already lensed), and the edge there when no snap is in reach. */
    const look = (p: ScreenPoint) => {
      const f = eng.pick(p.x, p.y, "face");
      const reach = lens ? Math.max(2, SNAP_REACH / lens.zoom) : SNAP_REACH;
      // A snap of the face already shown keeps it, even over the next face (a cut-away corner sits past a round).
      hot = face ? cycled(p, reach) : -1;
      if (f && hot < 0 && (f.body !== face?.body || f.index !== face.index)) {
        const info = eng.faceInfo(f.body, f.index);
        const edges = (eng.faceEdges(f.body, f.index) ?? []).map((e) => e.points);
        const toward = eng.ray(p.x, p.y).dir.map((v) => -v) as V3;
        const snaps = info ? faceSnaps(info, edges, toward) : [];
        if (topo?.body !== f.body) topo = { body: f.body, faceEdges: eng.faceEdgeIds(f.body) };
        const sharp =
          info?.flat && topo.faceEdges && snaps[0]
            ? sharpCorners(
                { faceEdges: topo.faceEdges, face: (i) => eng.faceInfo(f.body, i), edge: (i) => eng.edgePoints(f.body, i) },
                f.index,
                snaps[0].normal,
                snaps[0].x,
              )
            : { snaps: [], ghosts: [] };
        face = { body: f.body, index: f.index, snaps: [...snaps, ...sharp.snaps], ghosts: sharp.ghosts };
      }
      if (hot < 0) hot = face ? cycled(p, reach) : -1;
      // Off the face (on its rim, or past a corner), it stays while a snap is in reach.
      if (!f && hot < 0) face = null;
      const edge = hot < 0 ? eng.pick(p.x, p.y, "edge") : null;
      return { edge, face: face && { body: face.body, kind: "face" as const, index: face.index } };
    };
    const clearMarks = () => {
      face = null;
      hot = -1;
      marks.part(null);
      marks.hide();
      eng.showHover(null);
      if (lens) show(null);
    };
    /** Lights the face and snap under the pointer, with the moving part's ghost where it would land (#390). */
    const hoverAt = (p: ScreenPoint, mods: Mods) => {
      const t = live.current.target;
      if (!t) return clearMarks();
      const q = lensed(lens, p);
      if (t === "parent" && eng.constructAt(q.x, q.y, AXES)) return clearMarks();
      const at = look(q);
      eng.showHover(at.edge ?? at.face);
      if (face) marks.show(face.snaps, hot, face.ghosts);
      else marks.hide();
      const s = face && hot >= 0 ? face.snaps[hot] : null;
      marks.part(s && t === "parent" ? ghostAt(face!.body, s) : null);
      watch(p, mods);
    };
    const refresh = () => last && hoverAt(last.p, last.mods);
    eng.setInput({
      move: (p, mods, pressed) => {
        last = { p, mods };
        if (pressed) return;
        hoverAt(p, mods);
      },
      down: (p0, mods) => {
        const t = live.current.target;
        if (!t) return false;
        const p = lensed(lens, p0);
        if (t === "parent") {
          // An origin or construction axis in the view gives the axis as it is.
          const shape = eng.constructAt(p.x, p.y, AXES);
          const ax = shape ? eng.constructShape(shape) : null;
          if (ax?.dir) {
            put({ frame: { origin: ax.origin, axis: ax.dir } });
            return true;
          }
        }
        const at = look(p);
        const s = face && hot >= 0 ? face.snaps[hot] : null;
        if (lens) show(null);
        if (mods.shift && face) {
          // Shift-click two snaps or flat faces: the snap goes in halfway between them (#388).
          const flat = !s && !at.edge ? eng.faceInfo(face.body, face.index) : null;
          const toward = eng.ray(p.x, p.y).dir.map((v) => -v) as V3;
          const pick = s
            ? { body: face.body, point: s.point, normal: s.normal, plane: false }
            : flat?.flat
              ? { body: face.body, point: flat.centroid, normal: facing(flat.normal, toward), plane: true }
              : null;
          if (!pick) return true;
          if (!half) {
            half = pick;
            marks.pin(pick.point);
            deps.current.say("Shift-click a second snap point or face for the middle between them");
            return true;
          }
          const mid = between(half, pick);
          const first = half;
          half = null;
          marks.pin(null);
          if (mid) takeFrame(t, linkOf(first.body), { origin: mid, axis: first.normal });
          else deps.current.say("Pick two parallel faces, or a snap point and a face", true);
          return true;
        }
        half = null;
        marks.pin(null);
        if (face && s) {
          takeFrame(t, linkOf(face.body), { origin: s.point, axis: s.normal });
          return true;
        }
        const hit = at.edge ?? at.face;
        if (!hit) return false;
        pickSnap(t, { body: hit.body, kind: hit.kind as TopoRef["kind"], index: hit.index });
        return true;
      },
      leave: () => {
        window.clearTimeout(dwell);
        last = null;
        clearMarks();
      },
    });
    return () => {
      window.clearTimeout(dwell);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      closeLoupe.current = () => {};
      setLoupe(null);
      eng.setInput(null);
      eng.showHover(null);
      eng.setHoverFill(null);
      marks.dispose();
    };
  }, [d.active, engineOf, pickSnap, takeFrame, put]);

  /**
   * Swings the joint once through its range and back (#394), so a wrong axis or direction shows straight away. The
   * parts move as they are, without a rebuild.
   */
  const playing = useRef(0);
  const play = useCallback(() => {
    const eng = engineOf();
    const j = live.current.feature;
    if (!eng || !j || wiggle(j.kind, j.lower, j.upper, 0.25) === null) return;
    const run = ++playing.current;
    const start = performance.now();
    const step = () => {
      if (run !== playing.current) return;
      const t = Math.min(1, (performance.now() - start) / WIGGLE_MS);
      const moves = new Map<string, Matrix4>();
      const at = linkTransforms(deps.current.joints, { [j.id]: wiggle(j.kind, j.lower, j.upper, t) ?? 0 }, deps.current.links);
      for (const l of deps.current.links) {
        const m = at.get(l.id);
        if (m) for (const id of l.parts) moves.set(id, new Matrix4().fromArray(m));
      }
      eng.setPose(t < 1 ? moves : null);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [engineOf]);
  // A new joint, or a new kind or range, plays once by itself, unless you'd rather things kept still.
  const wiggleKey = feature ? `${feature.id}:${feature.kind}:${feature.lower}:${feature.upper}` : null;
  useEffect(() => {
    if (!wiggleKey || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(play, 400);
    return () => window.clearTimeout(t);
  }, [wiggleKey, play]);
  useEffect(
    () => () => {
      if (!playing.current) return;
      playing.current++;
      engineOf()?.setPose(null);
    },
    [engineOf, d.active],
  );

  // The loupe redraws as the pointer moves in it: the view itself, magnified round where it opened.
  useEffect(() => {
    const cv = loupeCanvas.current;
    const eng = engineOf();
    if (!loupe || !cv || !eng) return;
    let gone = false;
    void import("../sketch/loupeDraw").then((m) => {
      const ctx = cv.getContext("2d");
      if (gone || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const side = Math.round(LOUPE_SIZE * dpr);
      if (cv.width !== side) cv.width = cv.height = side;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pal = readPalette();
      const css = (k: keyof typeof pal) => `#${pal[k].getHexString()}`;
      const colours = { snap: css("snap"), ink: css("ink"), accent: css("accent"), danger: css("danger"), muted: css("muted"), viewport: css("viewport") };
      const empty = { frame: null, curves: [], points: [] } as unknown as Parameters<typeof m.drawLoupe>[1];
      m.drawLoupe(ctx, empty, loupe, (xy) => ({ x: xy[0], y: xy[1] }), colours, LOUPE_SIZE, m.magnify(eng, loupe.anchor.x, loupe.anchor.y, loupe.zoom));
    });
    return () => {
      gone = true;
    };
  }, [loupe, engineOf]);
  useEscape(d.active && loupe !== null, () => closeLoupe.current(), ESC.tool + 5);

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
      ? "Click a snap point, face or round edge on the component that moves. Shift-click two for the middle between them."
      : target === "parent"
        ? "Click a snap point, face, round edge or axis on the part it joins, or press Enter for Base. Shift-click two for the middle."
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
    loupe,
    loupeCanvas,
    play,
  };
}

export type JointSession = ReturnType<typeof useJoint>;
