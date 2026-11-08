import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ESC, evaluate, useEscape } from "@bettercad/ui";
import {
  CONSTRAINT_LABEL,
  constraintRefs,
  Draft,
  SketchIndex,
  Solver,
  angleOf,
  filletAt,
  filletLines,
  offsetChain,
  projectSegments,
  trimAt,
  trimPiece,
  dist,
  faceFrame,
  formatDimension,
  planeFrame,
  profiles,
  removeEntities,
  sampleArc,
  sub,
  toSketch,
  type DimensionKind,
  type Frame,
  type Id,
  type PlaneRef,
  type SolveResult,
  type Sketch,
  type Vec2,
} from "@bettercad/sketch";
import { addSketch, newId, updateSketch, type ModelDoc, type SketchFeature } from "../state/document";
import type { Command } from "../state/commands";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine, ScreenPoint, WorldPlaneName } from "../viewport/engine";
import type { Pick } from "../viewport/ids";
import { SketchOverlay, type OverlayCurve, type OverlayPoint, type OverlayView, type Shade } from "./overlay";
import { entityAt, snap, snapStep, type Snap } from "./snap";
import {
  CLICKS,
  CONSTRAINT_TOOLS,
  SKETCH_TOOLS,
  addConstraints,
  commit,
  newlyRedundant,
  isDrawTool,
  preview,
  toolById,
  type ConstraintTool,
  type SketchToolId,
} from "./tools";

/**
 * The sketch session (#51–#58): picking a plane, then drawing, constraining and dimensioning on it until Finish. The
 * sketch lives in its timeline feature; every finished shape, constraint or size is one undo step. The solver loads
 * the first time a sketch opens.
 */
export interface SketchDeps {
  store: {
    get(): ModelDoc;
    edit(fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string): void;
    seal(): void;
  };
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string) => void;
  doc: ModelDoc;
  /** The sketches built up to the timeline marker, drawn faintly when not being edited. */
  built: { id: string; sketch: Sketch }[];
  view: RefObject<View3DHandle>;
  /** Whether the Sketch tool is armed (pick a plane). */
  picking: boolean;
  /** A sketch started: the editor puts its Sketch tool down. */
  onStarted: () => void;
  say: (text: string, error?: boolean) => void;
  theme: string;
}

let solverLoad: Promise<Solver> | null = null;
function loadSolver(): Promise<Solver> {
  solverLoad ??= import("@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url").then((m) => Solver.load(m.default));
  return solverLoad;
}

const DIM_NAME: Record<DimensionKind, string> = {
  length: "Length",
  distance: "Distance",
  distanceX: "Across",
  distanceY: "Up",
  radius: "Radius",
  diameter: "Diameter",
  angle: "Angle",
};

export type SketchSession = ReturnType<typeof useSketch>;

export function useSketch(d: SketchDeps) {
  const { store, say } = d;
  // Callbacks read the latest deps through a ref, so the pointer handlers are not rebuilt on every render.
  const deps = useRef(d);
  deps.current = d;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stool, setStoolState] = useState<SketchToolId>("select");
  const [clicks, setClicks] = useState<Snap[]>([]);
  const [cursor, setCursor] = useState<Snap | null>(null);
  const [typed, setTyped] = useState<(number | undefined)[]>([]);
  const [sel, setSel] = useState<Id[]>([]);
  const [hover, setHover] = useState<Id | null>(null);
  const [sides, setSides] = useState(6);
  const [gridSnap, setGridSnap] = useState(true);
  const [showConstraints, setShowConstraints] = useState(true);
  const [dimEdit, setDimEdit] = useState<Id | null>(null);
  const [finishWarn, setFinishWarn] = useState(false);
  const [camTick, setCamTick] = useState(0);
  const [solver, setSolver] = useState<Solver | null>(null);
  const [filletR, setFilletR] = useState(2);
  const [offsetD, setOffsetD] = useState(2);
  const [projectGuide, setProjectGuide] = useState(true);
  /** What an editing tool would do under the pointer: the piece Trim removes (danger) or the copy Offset adds. */
  const [editPreview, setEditPreview] = useState<{ lines: Vec2[][]; danger: boolean } | null>(null);

  const feature = d.doc.features.find((f): f is SketchFeature => f.id === editingId && f.type === "sketch") ?? null;
  const sketch = feature?.sketch ?? null;
  const frame = useMemo<Frame | null>(() => (sketch ? planeFrame(sketch.plane) : null), [sketch]);
  const result = useMemo<SolveResult | null>(() => (sketch && solver ? solver.solve(sketch) : null), [sketch, solver]);

  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);

  // The undo of "Start a sketch" takes the sketch away: the session ends with it.
  useEffect(() => {
    if (editingId && !feature) setEditingId(null);
  }, [editingId, feature]);

  // The solver loads the first time a sketch opens.
  useEffect(() => {
    if (!editingId || solver) return;
    let alive = true;
    loadSolver().then(
      (s) => alive && setSolver(s),
      () => alive && say("The sketch solver did not load. You can draw, and constraints apply once it loads.", true),
    );
    return () => {
      alive = false;
    };
  }, [editingId, solver, say]);

  const setStool = useCallback((t: SketchToolId) => {
    setStoolState(t);
    setEditPreview(null);
    setClicks([]);
    setTyped([]);
  }, []);

  // ---------------------------------------------------------------- changes

  const describe = useCallback((s: Sketch, id: Id) => {
    const c = s.constraints.find((x) => x.id === id);
    if (c) return `the ${CONSTRAINT_LABEL[c.type].toLowerCase()} constraint`;
    const dm = s.dimensions.find((x) => x.id === id);
    return dm ? `the ${formatDimension(dm)} size` : "another constraint";
  }, []);

  const current = useCallback((): Sketch | null => {
    const id = live.current.editingId;
    const f = store.get().features.find((x) => x.id === id);
    return f?.type === "sketch" ? f.sketch : null;
  }, [store]);

  /**
   * Solves and stores a changed sketch. A change that fights what is there is refused and named; `strict` also refuses
   * one that only repeats it (adding a constraint or a size).
   */
  const apply = useCallback(
    (next: Sketch, label: string, opts: { key?: string; strict?: boolean; quiet?: boolean } = {}): boolean => {
      const id = live.current.editingId;
      if (!id) return false;
      let solved = next;
      if (solver) {
        const r = solver.solve(next);
        const was = opts.strict && r.status === "redundant" ? current() : null;
        const bad = r.status === "conflicting" ? r.conflicting : opts.strict ? newlyRedundant(was && solver.solve(was), r) : [];
        if (bad.length) {
          if (!opts.quiet) {
            const names = [...new Set(bad.map((x) => describe(next, x)))].slice(0, 3).join(" and ");
            say(`That fights ${names}. Delete one of them first.`, true);
          }
          return false;
        }
        if (r.status === "failed") {
          if (!opts.quiet) say("The sketch can't take that shape.", true);
          return false;
        }
        solved = r.sketch;
      }
      store.edit((doc) => updateSketch(doc, id, () => solved), label, opts.key);
      return true;
    },
    [solver, store, say, describe, current],
  );

  const addDimension = useCallback(
    (kind: DimensionKind, refs: Id[]) => {
      const s = current();
      if (!s) return;
      const dr = new Draft(s);
      const id = dr.dimension(kind, refs);
      const withDim = dr.done().sketch;
      if (apply(withDim, "Add a dimension", { strict: true, quiet: true })) {
        setDimEdit(id);
      } else {
        // Already set by other constraints: it shows as a reference size instead.
        const driven = { ...withDim, dimensions: withDim.dimensions.map((x) => (x.id === id ? { ...x, driving: false } : x)) };
        if (apply(driven, "Add a reference dimension")) say("That size is already set by other constraints, so it shows as a reference.");
      }
      setSel([]);
    },
    [current, apply, say],
  );

  /** The dimension tool on a selection: one line, circle or arc, two points, a point and a line, or two lines. */
  const dimensionFor = useCallback(
    (picked: Id[]): boolean => {
      const s = current();
      if (!s) return false;
      const idx = new SketchIndex(s);
      const es = picked.map((id) => idx.get(id)).filter((e) => !!e);
      if (es.length === 1) {
        const e = es[0]!;
        if (e.kind === "line") addDimension("length", [e.id]);
        else if (e.kind === "circle") addDimension("diameter", [e.id]);
        else if (e.kind === "arc") addDimension("radius", [e.id]);
        else return false;
        return true;
      }
      if (es.length === 2) {
        const [a, b] = es as [NonNullable<(typeof es)[0]>, NonNullable<(typeof es)[0]>];
        if (a.kind === "point" && b.kind === "point") addDimension("distance", [a.id, b.id]);
        else if (a.kind === "point" && b.kind === "line") addDimension("distance", [a.id, b.id]);
        else if (a.kind === "line" && b.kind === "point") addDimension("distance", [b.id, a.id]);
        else if (a.kind === "line" && b.kind === "line") {
          const u = sub(idx.xy(a.b), idx.xy(a.a));
          const v = sub(idx.xy(b.b), idx.xy(b.a));
          const parallel = Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-6 * Math.hypot(...u) * Math.hypot(...v);
          if (parallel) addDimension("distance", [a.a, b.id]);
          else addDimension("angle", [a.id, b.id]);
        } else return false;
        return true;
      }
      return false;
    },
    [current, addDimension],
  );

  const setDimension = useCallback(
    (id: Id, text: string) => {
      const s = current();
      const dm = s?.dimensions.find((x) => x.id === id);
      if (!s || !dm) return;
      let v: number;
      try {
        v = evaluate(text);
      } catch (e) {
        say((e as Error).message, true);
        return;
      }
      if (!Number.isFinite(v) || (dm.kind !== "angle" && v <= 0)) {
        say("Type a size above 0", true);
        return;
      }
      if (dm.kind === "angle" && (v <= 0 || v >= 180)) {
        say("Type an angle between 0° and 180°", true);
        return;
      }
      if (dm.driving && Math.abs(v - dm.value) < 1e-9 && text === dm.expression) return;
      const next = { ...s, dimensions: s.dimensions.map((x) => (x.id === id ? { ...x, value: v, expression: text.trim(), driving: true } : x)) };
      apply(next, `Set ${DIM_NAME[dm.kind].toLowerCase()} to ${formatDimension({ ...dm, value: v, driving: true })}`, { strict: !dm.driving });
    },
    [current, apply, say],
  );

  const constrain = useCallback(
    (type: ConstraintTool["id"]) => {
      const s = current();
      if (!s) return;
      const picked = live.current.sel.filter((id) => s.entities.some((e) => e.id === id));
      const out = addConstraints(type, s, picked);
      if (typeof out === "string") {
        say(`${out} (Shift-click to pick more than one), then choose ${CONSTRAINT_TOOLS.find((t) => t.id === type)!.label} again.`);
        return;
      }
      if (apply(out, `Add ${CONSTRAINT_LABEL[type].toLowerCase()} constraint`, { strict: true })) setSel([]);
    },
    [current, apply, say],
  );

  const removeSelected = useCallback(() => {
    const s = current();
    const ids = live.current.sel;
    if (!s || !ids.length) return;
    const gone = new Set(ids);
    const next = removeEntities(
      { ...s, constraints: s.constraints.filter((c) => !gone.has(c.id)), dimensions: s.dimensions.filter((x) => !gone.has(x.id)) },
      ids.filter((id) => s.entities.some((e) => e.id === id)),
    );
    apply(next, ids.length === 1 ? "Delete from the sketch" : `Delete ${ids.length} items from the sketch`);
    setSel([]);
  }, [current, apply]);

  const toggleConstruction = useCallback(() => {
    const s = current();
    if (!s) return;
    const ids = new Set(live.current.sel);
    const curves = s.entities.filter((e) => ids.has(e.id) && e.kind !== "point");
    if (!curves.length) {
      say("Pick lines, circles or arcs first");
      return;
    }
    const on = !curves.every((e) => e.construction);
    apply(
      { ...s, entities: s.entities.map((e) => (ids.has(e.id) && e.kind !== "point" ? { ...e, construction: on } : e)) },
      on ? "Make construction" : "Make normal geometry",
    );
  }, [current, apply, say]);

  const setOffset = useCallback(
    (v: number) => {
      const id = live.current.editingId;
      const s = current();
      if (!id || !s) return;
      const plane = { ...s.plane, offset: v } as PlaneRef;
      store.edit((doc) => updateSketch(doc, id, (x) => ({ ...x, plane })), "Move the sketch plane", `offset:${id}`);
      const f = planeFrame(plane);
      engineOf()?.lookAt(f.origin, f.normal);
    },
    [current, store, engineOf],
  );

  // ---------------------------------------------------------------- start and finish

  const startOn = useCallback(
    (plane: PlaneRef, what: string) => {
      const id = newId();
      deps.current.record((doc, at) => addSketch(doc, plane, id, at), "Start a sketch");
      store.seal();
      deps.current.onStarted();
      setEditingId(id);
      setStool("line");
      setSel([]);
      const f = planeFrame(plane);
      engineOf()?.lookAt(f.origin, f.normal);
      say(`Sketching on ${what}. Enter finishes.`);
    },
    [store, engineOf, setStool, say],
  );

  /** Starts a sketch on an origin plane, as picking it in the view does (the browser's Sketch on). */
  const startOnPlane = useCallback((plane: "XY" | "XZ" | "YZ") => startOn({ kind: "world", plane, offset: 0 }, `the ${plane} plane`), [startOn]);

  const edit = useCallback(
    (id: string) => {
      const f = store.get().features.find((x) => x.id === id);
      if (f?.type !== "sketch") return;
      setEditingId(id);
      setStool("select");
      setSel([]);
      const fr = planeFrame(f.sketch.plane);
      engineOf()?.lookAt(fr.origin, fr.normal);
      say(`Editing ${f.name}. Enter finishes.`);
    },
    [store, engineOf, setStool, say],
  );

  const end = useCallback(() => {
    const name = live.current.feature?.name;
    store.seal();
    setEditingId(null);
    setStool("select");
    setSel([]);
    setHover(null);
    setDimEdit(null);
    setFinishWarn(false);
    setCursor(null);
    if (name) say(`Finished ${name}`);
  }, [store, setStool, say]);

  const finish = useCallback(
    (force = false) => {
      const s = current();
      if (!s) return end();
      const drawn = s.entities.some((e) => e.kind !== "point" && !e.construction);
      if (!force && drawn && profiles(s).profiles.length === 0) {
        setFinishWarn(true);
        return;
      }
      end();
    },
    [current, end],
  );

  // ---------------------------------------------------------------- the pointer

  const live = useRef({
    editingId,
    feature,
    sketch,
    frame,
    stool,
    clicks,
    cursor,
    typed,
    sel,
    sides,
    gridSnap,
    solver,
    apply,
    dimensionFor,
    filletR,
    offsetD,
    projectGuide,
  });
  live.current = {
    editingId,
    feature,
    sketch,
    frame,
    stool,
    clicks,
    cursor,
    typed,
    sel,
    sides,
    gridSnap,
    solver,
    apply,
    dimensionFor,
    filletR,
    offsetD,
    projectGuide,
  };

  // Picking a plane: the origin planes show, flat faces light up under the pointer.
  useEffect(() => {
    const eng = engineOf();
    if (!d.picking || editingId || !eng) return;
    eng.showPlanes(true);
    let lastKey = "";
    let info = null as ReturnType<Engine["faceInfo"]>;
    type Target = { kind: "face"; pick: Pick; info: NonNullable<typeof info> } | { kind: "plane"; plane: WorldPlaneName };
    const target = (p: ScreenPoint): Target | null => {
      const pick = eng.pick(p.x, p.y, "face");
      if (pick) {
        const key = `${pick.body}:${pick.index}`;
        if (key !== lastKey) {
          lastKey = key;
          info = eng.faceInfo(pick.body, pick.index);
        }
        if (info?.flat) return { kind: "face", pick, info };
      }
      const plane = eng.planeAt(p.x, p.y);
      return plane ? { kind: "plane", plane } : null;
    };
    eng.setInput({
      move: (p, _m, pressed) => {
        if (pressed) return;
        const t = target(p);
        eng.showHover(t?.kind === "face" ? t.pick : null);
        eng.hoverPlane(t?.kind === "plane" ? t.plane : null);
      },
      down: (p) => {
        const t = target(p);
        if (!t) return false;
        if (t.kind === "plane") startOn({ kind: "world", plane: t.plane, offset: 0 }, `the ${t.plane} plane`);
        else
          startOn(
            { kind: "face", face: { body: t.pick.body, face: t.pick.index }, offset: 0, frame: faceFrame(t.info.centroid, t.info.normal, t.info.edge) },
            "a face",
          );
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
    };
  }, [d.picking, editingId, engineOf, startOn]);

  // Editing: the pointer draws, picks and drags on the sketch plane.
  useEffect(() => {
    const eng = engineOf();
    if (!editingId || !eng) return;
    let drag: { id: Id; moved: boolean } | null = null;
    const at = (p: ScreenPoint): { xy: Vec2; px: number } | null => {
      const f = live.current.frame;
      if (!f) return null;
      const w = eng.rayPlane(p.x, p.y, f.origin, f.normal);
      return w ? { xy: toSketch(f, w), px: eng.pixelSize(f.origin) } : null;
    };
    const snapAt = (xy: Vec2, px: number, mods: { shift: boolean; mod: boolean; touch?: boolean }, exclude?: Set<Id>): Snap => {
      const L = live.current;
      const from = L.clicks[L.clicks.length - 1]?.xy;
      return snap(xy, L.sketch!, {
        px,
        grid: L.gridSnap || mods.mod ? snapStep(px) : null,
        from,
        exclude,
        off: mods.shift,
        gridOnly: mods.mod,
        radius: mods.touch ? 16 : 8,
        origin: L.frame ? toSketch(L.frame, [0, 0, 0]) : null,
      });
    };
    const done = (r: Sketch | string, label: string) => {
      if (typeof r === "string") say(r, true);
      else {
        live.current.apply(r, label);
        setSel([]);
        setEditPreview(null);
      }
    };
    /** The editing tools: Fillet, Trim, Offset and Project. */
    const editDown = (p: ScreenPoint, hit: { xy: Vec2; px: number }): boolean => {
      const L = live.current;
      const s = L.sketch!;
      const tol = 8 * hit.px;
      if (L.stool === "project") {
        const pick = eng.pick(p.x, p.y, "face");
        const info = pick && eng.faceInfo(pick.body, pick.index);
        if (!pick || !info) return false;
        done(projectSegments(s, L.frame!, info.boundary, { body: pick.body, face: pick.index }, L.projectGuide), "Project a face");
        return true;
      }
      if (L.stool === "fillet") {
        const id = entityAt(hit.xy, s, tol);
        const e = id ? s.entities.find((x) => x.id === id) : undefined;
        if (!id || !e) return false;
        if (e.kind === "point") done(filletAt(s, id, L.filletR), "Round a corner");
        else if (e.kind === "line") {
          const first = L.sel.find((x) => x !== id && s.entities.find((y) => y.id === x)?.kind === "line");
          if (first) done(filletLines(s, first, id, L.filletR), "Round a corner");
          else setSel([id]);
        } else say("Pick a corner, or two lines that meet", true);
        return true;
      }
      const id = entityAt(hit.xy, s, tol, true);
      if (!id) return false;
      if (L.stool === "trim") done(trimAt(s, id, hit.xy), "Trim");
      else done(offsetToward(s, id, hit.xy, L.offsetD), "Offset");
      return true;
    };
    const editMove = (p: ScreenPoint, hit: { xy: Vec2; px: number }) => {
      const L = live.current;
      const s = L.sketch!;
      if (L.stool === "project") {
        const pick = eng.pick(p.x, p.y, "face");
        eng.showHover(pick);
        return;
      }
      const curvesOnly = L.stool !== "fillet";
      const id = entityAt(hit.xy, s, 8 * hit.px, curvesOnly);
      setHover(id);
      if (!id || L.stool === "fillet") return setEditPreview(null);
      if (L.stool === "trim") {
        const piece = trimPiece(s, id, hit.xy);
        return setEditPreview(piece ? { lines: [piece.pts], danger: true } : null);
      }
      const r = offsetToward(s, id, hit.xy, L.offsetD);
      setEditPreview(typeof r === "string" ? null : { lines: addedLines(s, r), danger: false });
    };
    const finishShape = (all: Snap[]) => {
      const L = live.current;
      const s = L.sketch;
      if (!s) return;
      const c = commit(L.stool, s, all, L.typed, L.sides);
      if (!c) {
        setClicks([]);
        return;
      }
      L.apply(c.sketch, c.label);
      setTyped([]);
      // The line tool chains from its last point, until it meets a point already there.
      const last = all[all.length - 1]!;
      if (L.stool === "line" && c.end && !(last.ref && (last.kind === "end" || last.kind === "centre" || last.kind === "origin"))) {
        const p = c.sketch.entities.find((e) => e.id === c.end);
        setClicks(p?.kind === "point" ? [{ xy: [p.x, p.y], kind: "end", ref: p.id, label: "" }] : []);
      } else setClicks([]);
    };

    eng.setInput({
      down: (p, mods) => {
        const L = live.current;
        const hit = at(p);
        if (!hit || !L.sketch) return false;
        if (L.stool === "fillet" || L.stool === "trim" || L.stool === "offset" || L.stool === "project") return editDown(p, hit);
        if (L.stool === "select" || L.stool === "dimension") {
          const id = entityAt(hit.xy, L.sketch, 8 * hit.px);
          if (L.stool === "dimension") {
            if (!id) return false;
            const picked = [...L.sel.filter((x) => x !== id), id];
            const e = L.sketch.entities.find((x) => x.id === id);
            // A line, circle or arc sizes at once unless a point waits for it; a point waits for a second pick.
            const waiting = L.sel.some((x) => L.sketch!.entities.find((y) => y.id === x)?.kind === "point");
            if (e?.kind !== "point" && !waiting && L.dimensionFor([id])) return true;
            if (picked.length >= 2 && L.dimensionFor(picked.slice(-2))) return true;
            setSel([id]);
            return true;
          }
          if (!id) {
            if (!mods.shift) setSel([]);
            return false;
          }
          setSel((s) => (mods.shift || mods.mod ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : s.includes(id) ? s : [id]));
          const e = L.sketch.entities.find((x) => x.id === id);
          if (e?.kind === "point") drag = { id, moved: false };
          return true;
        }
        const s = snapAt(hit.xy, hit.px, mods);
        const all = [...L.clicks, s];
        const need = CLICKS[L.stool as keyof typeof CLICKS];
        if (all.length >= need) finishShape(all);
        else setClicks(all);
        return true;
      },
      move: (p, mods, pressed) => {
        const L = live.current;
        const hit = at(p);
        if (!hit || !L.sketch) return;
        if (pressed && drag) {
          if (!L.solver) return;
          const r = L.solver.drag(L.sketch, drag.id, hit.xy);
          if (r.status === "ok" || r.status === "redundant") {
            drag.moved = true;
            const id = L.editingId!;
            store.edit((doc) => updateSketch(doc, id, () => r.sketch), "Move a point", `drag:${id}:${drag!.id}`);
          }
          return;
        }
        if (L.stool === "fillet" || L.stool === "trim" || L.stool === "offset" || L.stool === "project") return editMove(p, hit);
        if (L.stool === "select" || L.stool === "dimension") {
          setHover(entityAt(hit.xy, L.sketch, 8 * hit.px));
          setCursor(null);
          return;
        }
        setHover(null);
        setCursor(snapAt(hit.xy, hit.px, mods));
      },
      up: () => {
        if (drag?.moved) store.seal();
        drag = null;
      },
      leave: () => {
        setHover(null);
        setCursor(null);
        setEditPreview(null);
        eng.showHover(null);
      },
    });
    return () => eng.setInput(null);
  }, [editingId, engineOf, store, say]);

  // ---------------------------------------------------------------- drawing

  const overlay = useRef<SketchOverlay | null>(null);
  useEffect(() => {
    const eng = engineOf();
    if (!editingId || !eng) return;
    const o = new SketchOverlay(eng);
    overlay.current = o;
    return () => {
      o.dispose();
      overlay.current = null;
    };
  }, [editingId, engineOf]);

  const previewNow = useMemo(
    () =>
      cursor && isDrawTool(stool)
        ? preview(
            stool,
            clicks.map((c) => c.xy),
            cursor.xy,
            sides,
          )
        : null,
    [cursor, stool, clicks, sides],
  );

  useEffect(() => {
    const o = overlay.current;
    if (!o || !sketch || !frame) return;
    o.refreshPalette();
    const view = sketchView(sketch, frame, result, sel, hover, previewNow?.lines ?? [], cursor, clicks[clicks.length - 1]?.xy, undefined, editPreview);
    const px = engineOf()?.pixelSize(frame.origin);
    o.update(px ? withOrigin(view, toSketch(frame, [0, 0, 0]), px) : view);
  }, [sketch, frame, result, sel, hover, previewNow, cursor, clicks, camTick, d.theme, editPreview, engineOf]);

  // Finished sketches stay on show, faintly, while the timeline includes them.
  useEffect(() => {
    const eng = engineOf();
    if (!eng) return;
    const shown = d.built.filter((b) => b.id !== editingId);
    const list = shown.map((b) => {
      const o = new SketchOverlay(eng);
      o.update(sketchView(b.sketch, planeFrame(b.sketch.plane), null, [], null, [], null, undefined, "guide"));
      return o;
    });
    return () => list.forEach((o) => o.dispose());
  }, [d.built, editingId, engineOf, d.theme]);

  // ---------------------------------------------------------------- keys and Esc

  // Digits while a shape is under way go to its first size field.
  useEffect(() => {
    if (!editingId || !isDrawTool(stool) || !clicks.length || !toolById(stool).fields.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (!/^[0-9.]$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      document.getElementById("bc-sk-field-0")?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editingId, stool, clicks.length]);

  const editing = !!editingId;
  useEscape(editing && (dimEdit !== null || finishWarn), () => (dimEdit ? setDimEdit(null) : setFinishWarn(false)), ESC.tool + 4);
  useEscape(
    editing && clicks.length > 0,
    () => {
      setClicks([]);
      setTyped([]);
    },
    ESC.tool + 3,
  );
  useEscape(editing && stool !== "select", () => setStool("select"), ESC.tool + 2);
  useEscape(editing && sel.length > 0, () => setSel([]), ESC.tool + 1);
  // Esc never drops the sketch by accident: the last layer only says how to finish.
  useEscape(editing, () => say("Enter or the Finish button finishes the sketch."), ESC.tool);

  /** Commits the shape under way with the typed sizes, at the cursor. */
  const commitTyped = useCallback((typedNow?: (number | undefined)[]) => {
    const L = live.current;
    if (!L.sketch || !L.clicks.length || !isDrawTool(L.stool)) return;
    const last: Snap = L.cursor ?? L.clicks[L.clicks.length - 1]!;
    const all = [...L.clicks, last];
    const c = commit(L.stool, L.sketch, all, typedNow ?? L.typed, L.sides);
    if (!c) return;
    L.apply(c.sketch, c.label);
    setTyped([]);
    // Back to the view, so the next key is a shortcut again rather than more typing.
    document.getElementById("bc-view")?.focus();
    if (L.stool === "line" && c.end) {
      const p = c.sketch.entities.find((e) => e.id === c.end);
      setClicks(p?.kind === "point" ? [{ xy: [p.x, p.y], kind: "end", ref: p.id, label: "" }] : []);
    } else setClicks([]);
  }, []);

  const pickTool = useCallback(
    (t: SketchToolId) => {
      if (t === "dimension" && live.current.sel.length && dimensionFor(live.current.sel)) return;
      setStool(live.current.stool === t && t !== "select" ? "select" : t);
    },
    [dimensionFor, setStool],
  );

  // ---------------------------------------------------------------- commands

  const h = useRef({ pickTool, removeSelected, toggleConstruction, finish, constrain });
  h.current = { pickTool, removeSelected, toggleConstruction, finish, constrain };
  const commands = useMemo<Command[]>(() => {
    const has = () => live.current.sel.length > 0;
    return [
      ...SKETCH_TOOLS.map<Command>((t) => ({
        id: `sketch.${t.id}`,
        scope: "sketch",
        label: t.label,
        group: "Sketch",
        icon: t.icon,
        keys: [t.key],
        run: () => h.current.pickTool(t.id),
      })),
      ...CONSTRAINT_TOOLS.map<Command>((t) => ({
        id: `sketch.constrain.${t.id}`,
        scope: "sketch",
        label: `Constrain: ${t.label}`,
        group: "Sketch",
        icon: "constraint",
        run: () => h.current.constrain(t.id),
        keywords: "constraint",
      })),
      {
        id: "sketch.delete",
        scope: "sketch",
        label: "Delete from the sketch",
        group: "Sketch",
        icon: "trash",
        keys: ["delete", "backspace"],
        run: () => h.current.removeSelected(),
        when: has,
      },
      {
        id: "sketch.selectAll",
        scope: "sketch",
        label: "Select all in the sketch",
        group: "Sketch",
        icon: "arrow",
        keys: ["mod+a"],
        run: () => setSel(live.current.sketch?.entities.filter((e) => e.kind !== "point").map((e) => e.id) ?? []),
      },
      {
        id: "sketch.construction",
        scope: "sketch",
        label: "Construction on or off",
        group: "Sketch",
        icon: "dash",
        keys: ["x"],
        run: () => h.current.toggleConstruction(),
        when: has,
        keywords: "reference guide dashed",
      },
      { id: "sketch.finish", scope: "sketch", label: "Finish sketch", group: "Sketch", icon: "finish", keys: ["enter"], run: () => h.current.finish() },
    ];
  }, []);

  const onCamera = useCallback(() => setCamTick((t) => t + 1), []);

  const dof = result?.dof;
  const status = !sketch
    ? null
    : !solver
      ? "Loading the solver"
      : result?.status === "conflicting"
        ? "Some constraints fight each other"
        : dof === 0
          ? "Fully constrained"
          : `${dof} degree${dof === 1 ? "" : "s"} of freedom`;

  const help =
    d.picking && !editing ? "Click a face or a plane to sketch on it." : editing ? `${toolById(stool).help} ${status ?? ""}.`.replace(/\.\.$/, ".") : null;

  return {
    editing,
    editingId,
    feature,
    sketch,
    frame,
    result,
    status,
    stool,
    pickTool,
    clicks,
    cursor,
    typed,
    setTyped,
    commitTyped,
    previewValues: previewNow?.values ?? [],
    sel,
    setSel,
    hover,
    sides,
    setSides,
    filletR,
    setFilletR,
    offsetD,
    setOffsetD,
    projectGuide,
    setProjectGuide,
    gridSnap,
    setGridSnap,
    showConstraints,
    setShowConstraints,
    dimEdit,
    setDimEdit,
    setDimension,
    finishWarn,
    setFinishWarn,
    finish,
    edit,
    startOnPlane,
    constrain,
    removeSelected,
    setOffset,
    commands,
    onCamera,
    camTick,
    help,
    engineOf,
  };
}

/** The overlay's picture of a sketch: each curve and point in its state's shade, plus the tool's preview. */
export function sketchView(
  s: Sketch,
  frame: Frame,
  result: SolveResult | null,
  sel: Id[],
  hover: Id | null,
  previewLines: Vec2[][],
  cursor: Snap | null,
  from: Vec2 | undefined,
  base?: Shade,
  extra?: { lines: Vec2[][]; danger: boolean } | null,
): OverlayView {
  const idx = new SketchIndex(s);
  const bad = new Set<Id>();
  for (const id of result?.conflicting ?? []) {
    const c = s.constraints.find((x) => x.id === id);
    const dm = s.dimensions.find((x) => x.id === id);
    for (const r of c ? constraintRefs(c) : (dm?.refs ?? [])) bad.add(r);
  }
  const shade = (id: Id): Shade =>
    base ?? (bad.has(id) ? "conflict" : sel.includes(id) ? "picked" : hover === id ? "hover" : result?.fixed.has(id) ? "fixed" : "free");
  const curves: OverlayCurve[] = [];
  for (const e of s.entities) {
    if (e.kind === "line") curves.push({ pts: [idx.xy(e.a), idx.xy(e.b)], shade: shade(e.id), dashed: e.construction });
    else if (e.kind === "circle") curves.push({ pts: sampleArc(idx.xy(e.c), e.r, 0, 2 * Math.PI, 72), shade: shade(e.id), dashed: e.construction });
    else if (e.kind === "arc") {
      const c = idx.xy(e.c);
      curves.push({ pts: sampleArc(c, e.r, angleOf(sub(idx.xy(e.a), c)), angleOf(sub(idx.xy(e.b), c))), shade: shade(e.id), dashed: e.construction });
    }
  }
  const points: OverlayPoint[] = s.entities.flatMap((e) =>
    e.kind === "point" ? [{ xy: [e.x, e.y] as Vec2, shade: shade(e.id), big: sel.includes(e.id) || hover === e.id }] : [],
  );
  for (const l of previewLines) curves.push({ pts: l, shade: "preview" });
  for (const l of extra?.lines ?? []) curves.push({ pts: l, shade: extra!.danger ? "conflict" : "preview" });
  if (cursor && from && (cursor.kind === "horizontal" || cursor.kind === "vertical") && dist(cursor.xy, from) > 1e-9) {
    curves.push({ pts: [from, cursor.xy], shade: "guide", dashed: true });
  }
  if (cursor) points.push({ xy: cursor.xy, shade: cursor.kind === "free" ? "preview" : "hover", big: cursor.kind !== "free" });
  return { frame, curves, points };
}

/** The model's origin drawn under the sketch: a fixed point with a small cross, 8 px each way, to snap to. */
export function withOrigin(view: OverlayView, origin: Vec2, px: number): OverlayView {
  const r = 8 * px;
  const [x, y] = origin;
  return {
    ...view,
    curves: [
      {
        pts: [
          [x - r, y],
          [x + r, y],
        ],
        shade: "fixed",
      },
      {
        pts: [
          [x, y - r],
          [x, y + r],
        ],
        shade: "fixed",
      },
      ...view.curves,
    ],
    points: [{ xy: origin, shade: "fixed" }, ...view.points],
  };
}

/** Offset toward the pointer: whichever side's copy lands nearer it. */
function offsetToward(s: Sketch, id: Id, at: Vec2, d: number): Sketch | string {
  const out = offsetChain(s, id, d);
  const inn = offsetChain(s, id, -d);
  if (typeof out === "string") return inn;
  if (typeof inn === "string") return out;
  const near = (r: Sketch) =>
    Math.min(
      ...addedLines(s, r)
        .flat()
        .map((p) => dist(p, at)),
    );
  return near(out) <= near(inn) ? out : inn;
}

/** The curves `after` has that `before` didn't, as polylines. */
function addedLines(before: Sketch, after: Sketch): Vec2[][] {
  const had = new Set(before.entities.map((e) => e.id));
  const idx = new SketchIndex(after);
  return after.entities.flatMap((e) => {
    if (had.has(e.id)) return [];
    if (e.kind === "line") return [[idx.xy(e.a), idx.xy(e.b)]];
    if (e.kind === "circle") return [sampleArc(idx.xy(e.c), e.r, 0, 2 * Math.PI, 72)];
    if (e.kind === "arc") {
      const c = idx.xy(e.c);
      return [sampleArc(c, e.r, angleOf(sub(idx.xy(e.a), c)), angleOf(sub(idx.xy(e.b), c)))];
    }
    return [];
  });
}
