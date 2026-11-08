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
  projectCurves,
  trimAt,
  trimPiece,
  dist,
  faceFrame,
  formatDimension,
  planeFrame,
  profiles,
  removeEntities,
  sampleArc,
  slideAcross,
  sub,
  toSketch,
  type Dimension,
  type DimensionKind,
  type Frame,
  type Id,
  type ModelCurve,
  type PlaneRef,
  type SolveResult,
  type Sketch,
  type Vec2,
} from "@bettercad/sketch";
import { addSketch, newId, paramScope, redefineSketchPlane, updateSketch, type ModelDoc, type SketchFeature } from "../state/document";
import { loadSolver } from "./solver";
import type { Command } from "../state/commands";
import { caught } from "../report/errors";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine, ScreenPoint, WorldPlaneName } from "../viewport/engine";
import type { Pick } from "../viewport/ids";
import { SketchOverlay, type OverlayCurve, type OverlayFill, type OverlayPoint, type OverlayView, type Shade } from "./overlay";
import { loadOptions, saveOptions, sketchGrid, type SketchOption, type SketchOptions } from "./options";
import { placeAt } from "./dimensions";
import { ORIGIN, entityAt, middleLine, pickAt, pointPickAt, snap, snapStep, type Snap } from "./snap";
import {
  CLICKS,
  CONSTRAINT_TOOLS,
  SKETCH_TOOLS,
  addConstraints,
  commit,
  constraintToolById,
  newlyRedundant,
  isDrawTool,
  picksReady,
  preview,
  resolveOrigin,
  toolById,
  type ConstraintToolId,
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

/**
 * A size being placed with the Dimension tool, as in Fusion: its label follows the pointer until a click puts it down.
 * Between two points, or on a line, where the pointer is also picks which way it measures (see `directionAt`).
 */
export interface Placing {
  /** The sketch it goes on, with the origin made a real point if the size uses it. */
  sketch: Sketch;
  /** The size as it would go down now, measured from the geometry, with its label where the pointer is. */
  dim: Dimension;
}

export function useSketch(d: SketchDeps) {
  const { store, say } = d;
  // Callbacks read the latest deps through a ref, so the pointer handlers are not rebuilt on every render.
  const deps = useRef(d);
  deps.current = d;
  const [editingId, setEditingId] = useState<string | null>(null);
  /** A sketch being moved onto another plane or face (the timeline's Redefine sketch plane), and how to end it. */
  const [redefining, setRedefining] = useState<{ id: string; name: string; end: () => void } | null>(null);
  const [stool, setStoolState] = useState<SketchToolId>("select");
  /** The armed constraint tool: it stays on the pointer, picking line after line, until Esc. */
  const [ctool, setCtool] = useState<ConstraintToolId | null>(null);
  /** Where the pointer is on the view while a constraint tool is armed, for the tag that follows it. */
  const [pointer, setPointer] = useState<ScreenPoint | null>(null);
  const [clicks, setClicks] = useState<Snap[]>([]);
  const [cursor, setCursor] = useState<Snap | null>(null);
  const [typed, setTyped] = useState<(number | undefined)[]>([]);
  const [sel, setSel] = useState<Id[]>([]);
  const [hover, setHover] = useState<Id | null>(null);
  const [sides, setSides] = useState(6);
  const [options, setOptions] = useState<SketchOptions>(loadOptions);
  const setOption = useCallback((k: SketchOption, v: boolean) => {
    setOptions((o) => {
      const n = { ...o, [k]: v };
      saveOptions(n);
      return n;
    });
  }, []);
  const gridSnap = options.snap;
  const showConstraints = options.constraints;
  const [dimEdit, setDimEdit] = useState<Id | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [finishWarn, setFinishWarn] = useState(false);
  const [camTick, setCamTick] = useState(0);
  const [solver, setSolver] = useState<Solver | null>(null);
  /** Parameter values (#75), for the sketch's size fields. */
  const scope = useMemo(() => paramScope(d.doc), [d.doc]);
  const [filletR, setFilletR] = useState(2);
  const [offsetD, setOffsetD] = useState(2);
  const [projectGuide, setProjectGuide] = useState(true);
  /** What an editing tool would do under the pointer: the piece Trim removes (danger) or the copy Offset adds. */
  const [editPreview, setEditPreview] = useState<{ lines: Vec2[][]; danger: boolean } | null>(null);

  const feature = d.doc.features.find((f): f is SketchFeature => f.id === editingId && f.type === "sketch") ?? null;
  const sketch = feature?.sketch ?? null;
  const frame = useMemo<Frame | null>(() => (sketch ? planeFrame(sketch.plane) : null), [sketch]);
  const result = useMemo<SolveResult | null>(() => {
    if (!sketch || !solver) return null;
    try {
      return solver.solve(sketch);
    } catch (e) {
      caught(`Sketch solver: ${(e as Error).message}`, { stack: (e as Error).stack });
      return null;
    }
  }, [sketch, solver]);
  /** The sketch as a model edge brought in for a size left it: the size being placed was measured on it, so it stays. */
  const keepPlacing = useRef<Sketch | null>(null);
  // Any other change to the sketch (an undo, say) drops a size being placed, which was measured on the sketch before it.
  useEffect(() => {
    if (sketch && sketch === keepPlacing.current) return;
    setPlacing(null);
  }, [sketch]);
  /** The model's origin in sketch mm, which Select, Dimension and the constraint tools can pick. */
  const origin = useMemo<Vec2 | null>(() => (frame ? toSketch(frame, [0, 0, 0]) : null), [frame]);

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
    setCtool(null);
    setPointer(null);
    setCursor(null);
    setEditPreview(null);
    setClicks([]);
    setTyped([]);
    setPlacing(null);
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
        let r: SolveResult;
        try {
          r = solver.solve(next);
        } catch (e) {
          // The solver refusing a sketch it can't read is a no, not a crash; it still goes in a report's details.
          caught(`Sketch solver: ${(e as Error).message}`, { stack: (e as Error).stack });
          if (!opts.quiet) say("The sketch can't take that shape.", true);
          return false;
        }
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

  const addSize = useCallback(
    (kind: DimensionKind, refs: Id[], base?: Sketch, labelOffset?: Vec2) => {
      const s = base ?? current();
      if (!s) return;
      const dr = new Draft(s);
      const id = dr.dimension(kind, refs, undefined, labelOffset ? { labelOffset } : {});
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
    (chosen: Id[]): boolean => {
      const now = current();
      if (!now) return false;
      // The origin sizes like a point; it becomes a fixed point on the origin only when a size uses it.
      if (chosen.length < 2 && chosen.includes(ORIGIN)) return false;
      const { sketch: s, picked } = resolveOrigin(now, chosen, live.current.origin ?? undefined);
      // The size follows the pointer until a click places it.
      const addDimension = (kind: DimensionKind, refs: Id[]) => {
        setPlacing({ sketch: s, dim: placeAt(s, kind, refs, null) });
        setSel(refs.filter((r) => s.entities.some((e) => e.id === r)));
      };
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
    [current],
  );

  /** Puts down the size being placed, where its label is now, and opens it for typing. */
  const place = useCallback(() => {
    const pl = live.current.placing;
    if (!pl) return;
    setPlacing(null);
    addSize(pl.dim.kind, pl.dim.refs, pl.sketch, pl.dim.labelOffset);
  }, [addSize]);

  /** Moves a size's label (dragged by its pill), live; `last` ends the drag as one undo step. */
  const moveLabel = useCallback(
    (id: Id, labelOffset: Vec2, last = false) => {
      const sk = live.current.editingId;
      if (!sk) return;
      store.edit(
        (doc) => updateSketch(doc, sk, (s) => ({ ...s, dimensions: s.dimensions.map((x) => (x.id === id ? { ...x, labelOffset } : x)) })),
        "Move a size",
        `dimlabel:${sk}:${id}`,
      );
      if (last) store.seal();
    },
    [store],
  );

  const setDimension = useCallback(
    (id: Id, text: string) => {
      const s = current();
      const dm = s?.dimensions.find((x) => x.id === id);
      if (!s || !dm) return;
      let v: number;
      try {
        v = evaluate(text, paramScope(deps.current.doc));
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

  /** Adds a constraint tool's output for some picks. Returns whether they fitted (true even if the solver said no). */
  const applyConstraint = useCallback(
    (type: ConstraintToolId, picked: Id[], quietHint = false): boolean => {
      const s = current();
      if (!s) return false;
      const out = addConstraints(type, s, picked, live.current.origin ?? undefined);
      if (typeof out === "string") {
        if (!quietHint) say(out);
        return false;
      }
      apply(out, `Add ${constraintToolById(type).label.toLowerCase()} constraint`, { strict: true });
      return true;
    },
    [current, apply, say],
  );

  /**
   * Arms a constraint tool. Geometry picked beforehand gets it at once; either way the tool stays on the pointer for
   * more picks until Esc.
   */
  const constrain = useCallback(
    (type: ConstraintToolId) => {
      const s = current();
      if (!s) return;
      const picked = live.current.sel.filter((id) => isPickable(s, id));
      if (picked.length) applyConstraint(type, picked, true);
      setStool("select");
      setSel([]);
      setCtool(type);
      say(`${constraintToolById(type).hint}. Esc puts the tool down.`);
    },
    [current, applyConstraint, setStool, say],
  );

  const removeSelected = useCallback(() => {
    const s = current();
    const ids = live.current.sel.filter((id) => id !== ORIGIN);
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

  /** Turns the view to look straight at the sketch's plane, as Fusion's Look At does. */
  const lookAtSketch = useCallback(() => {
    const f = live.current.frame;
    if (f) engineOf()?.lookAt(f.origin, f.normal);
  }, [engineOf]);

  // ---------------------------------------------------------------- start and finish

  const startOn = useCallback(
    (plane: PlaneRef, what: string) => {
      const id = newId();
      // Auto project, as in Fusion: a sketch on a face starts with the face's edges in it, held in place.
      const eng = engineOf();
      const curves = plane.kind === "face" && options.autoProject && eng ? faceCurves(eng, plane.face.body, plane.face.face) : [];
      deps.current.record((doc, at) => {
        const next = addSketch(doc, plane, id, at);
        return curves.length ? updateSketch(next, id, (s) => projectCurves(s, planeFrame(plane), curves).sketch) : next;
      }, "Start a sketch");
      store.seal();
      deps.current.onStarted();
      setEditingId(id);
      setStool("line");
      setSel([]);
      const f = planeFrame(plane);
      engineOf()?.lookAt(f.origin, f.normal);
      say(`Sketching on ${what}${curves.length ? ", with its edges brought in" : ""}. Enter finishes.`);
    },
    [store, engineOf, setStool, say, options.autoProject],
  );

  /** Starts a sketch on an origin plane, as picking it in the view does (the browser's Sketch on). */
  const startOnPlane = useCallback((plane: "XY" | "XZ" | "YZ") => startOn({ kind: "world", plane, offset: 0 }, `the ${plane} plane`), [startOn]);

  /**
   * Redefine sketch plane, as in Fusion: pick a new plane or flat face for a sketch. The geometry keeps its place on
   * the sketch's own grid. `end` runs when it is done or cancelled (the editor rolls the marker back where it was).
   */
  const redefine = useCallback(
    (id: string, end: () => void) => {
      const f = store.get().features.find((x) => x.id === id);
      if (f?.type !== "sketch") return;
      store.seal();
      setRedefining({ id, name: f.name, end });
      say(`Pick a plane or a flat face for ${f.name}. Esc keeps it where it is.`);
    },
    [store, say],
  );
  const cancelRedefine = useCallback(() => {
    setRedefining((r) => {
      r?.end();
      return null;
    });
  }, []);
  const redefineOn = useCallback(
    (plane: PlaneRef, what: string) => {
      const r = live.current.redefining;
      if (!r) return;
      store.edit((doc) => redefineSketchPlane(doc, r.id, plane), `Redefine ${r.name}'s plane`);
      store.seal();
      setRedefining(null);
      r.end();
      say(`Moved ${r.name} onto ${what}.`);
    },
    [store, say],
  );
  useEscape(!!redefining, cancelRedefine, ESC.tool + 1);

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

  /**
   * Auto project: brings a model edge or vertex picked by a size or constraint tool into the sketch, held in place,
   * and gives back the sketch entity it became (the one already there if it was brought in before).
   */
  const projectModel = useCallback(
    (pick: Pick): Id | null => {
      const eng = engineOf();
      const s = current();
      const f = live.current.frame;
      if (!eng || !s || !f) return null;
      const vertex = pick.kind === "vertex" ? eng.vertexPoint(pick.body, pick.index) : null;
      const points = vertex ? [vertex] : pick.kind === "edge" ? eng.edgePoints(pick.body, pick.index) : null;
      if (!points?.length) return null;
      const from = pick.kind === "vertex" ? { body: pick.body, vertex: pick.index } : { body: pick.body, edge: pick.index };
      const { sketch: next, ids } = projectCurves(s, f, [{ points, from }]);
      const id = ids[0];
      if (!id) return null;
      if (next.entities.length === s.entities.length) return id;
      if (!apply(next, vertex ? "Project a point" : "Project an edge")) return null;
      keepPlacing.current = current();
      return id;
    },
    [engineOf, current, apply],
  );

  // ---------------------------------------------------------------- the pointer

  const live = useRef({
    autoProject: options.autoProject,
    projectModel,
    current,
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
    ctool,
    applyConstraint,
    origin,
    redefining,
    placing,
    place,
  });
  live.current = {
    autoProject: options.autoProject,
    projectModel,
    current,
    redefining,
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
    ctool,
    applyConstraint,
    origin,
    placing,
    place,
  };

  // Picking a plane: the origin planes show, flat faces light up under the pointer.
  useEffect(() => {
    const eng = engineOf();
    if (!(d.picking || redefining) || editingId || !eng) return;
    const pickOn = redefining ? redefineOn : startOn;
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
        if (t.kind === "plane") pickOn({ kind: "world", plane: t.plane, offset: 0 }, `the ${t.plane} plane`);
        else
          pickOn(
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
  }, [d.picking, redefining, editingId, engineOf, startOn, redefineOn]);

  // Editing: the pointer draws, picks and drags on the sketch plane.
  useEffect(() => {
    const eng = engineOf();
    if (!editingId || !eng) return;
    /** A point dragged to the pointer, or a line slid square across from where it was grabbed. */
    let drag: { id: Id; moved: boolean; line?: { a: Id; b: Id; from: [Vec2, Vec2]; grab: Vec2 } } | null = null;
    /** How near, in screen pixels, a pick reaches: a finger needs more room than a cursor. */
    let reach = 8;
    /**
     * A finger is down with a drawing tool: the point follows it and goes in where it lifts. A finger that slides away
     * first puts a point where it came down, so one drag draws a line, rectangle, circle or polygon.
     */
    let tap: { at: ScreenPoint; start: Snap; base: Snap[]; dragged: boolean } | null = null;
    /** A finger is down placing a size: it goes down where the finger lifts. */
    let tapPlace = false;
    /** How far a finger slides, in screen pixels, before it is a drag rather than a tap. */
    const SLIDE = 12;
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
        radius: mods.touch ? 18 : 8,
        origin: L.origin,
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
      const tol = reach * hit.px;
      if (L.stool === "project") {
        const pick = eng.pick(p.x, p.y, "face");
        const curves = pick ? faceCurves(eng, pick.body, pick.index) : [];
        if (!pick || !curves.length) return false;
        const out = projectCurves(s, L.frame!, curves, L.projectGuide).sketch;
        done(out.entities.length > s.entities.length ? out : "That face is already in the sketch", "Project a face");
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
      const id = entityAt(hit.xy, s, reach * hit.px, curvesOnly);
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

    /** What a constraint tool picks at a spot: Coincident snaps to points, the origin and midpoints first. */
    const constraintPick = (tool: ConstraintToolId, xy: Vec2, px: number): { id: Id; xy?: Vec2; kind?: Snap["kind"]; label?: string } | null => {
      const L = live.current;
      if (!L.sketch) return null;
      if (tool === "coincident") {
        const snapped = pointPickAt(xy, L.sketch, reach * px, L.origin);
        if (snapped) return snapped;
      }
      // Horizontal/Vertical snaps to points and the origin too (not midpoints, which stand for their line).
      if (tool === "horizontalVertical") {
        const snapped = pointPickAt(xy, L.sketch, reach * px, L.origin);
        if (snapped && snapped.kind !== "middle") return snapped;
      }
      const id = pickAt(xy, L.sketch, reach * px, L.origin);
      return id ? { id } : null;
    };

    /** With auto project on, the model edge or corner under the pointer, for a size or constraint to use. */
    const modelPick = (p: ScreenPoint): Pick | null => {
      if (!live.current.autoProject) return null;
      return eng.pick(p.x, p.y, "vertex", true) ?? eng.pick(p.x, p.y, "edge", true);
    };

    /** Adds a drawing tool's click, and draws the shape once it has them all. */
    const addClick = (s: Snap) => {
      const L = live.current;
      const all = [...L.clicks, s];
      const need = CLICKS[L.stool as keyof typeof CLICKS];
      if (all.length >= need) finishShape(all);
      else setClicks(all);
    };

    eng.setInput({
      down: (p, mods) => {
        const L = live.current;
        reach = mods.touch ? 18 : 8;
        const hit = at(p);
        if (!hit || !L.sketch) return false;
        if (L.placing) {
          if (mods.touch) {
            // The size jumps to the finger, follows it, and goes down where it lifts.
            const pl = L.placing;
            setPlacing({ ...pl, dim: placeAt(pl.sketch, pl.dim.kind, pl.dim.refs, hit.xy) });
            tapPlace = true;
            return true;
          }
          L.place();
          return true;
        }
        if (L.ctool) {
          // Each pick adds to the tool's picks; once there are enough, the constraint goes on and the tool stays armed.
          let id = constraintPick(L.ctool, hit.xy, hit.px)?.id ?? null;
          // Nothing in the sketch there: a model edge or corner comes in to be picked.
          const mp = id ? null : modelPick(p);
          if (mp) {
            id = L.projectModel(mp);
            eng.showHover(null);
          }
          if (!id) return true;
          const sk = (mp && L.current()) || L.sketch;
          // Only geometry carries over from the selection: a constraint or size picked by its mark is not a pick.
          const picked = [...L.sel.filter((x) => x !== id && isPickable(sk, x)), id];
          if (!picksReady(L.ctool, sk, picked)) {
            setSel(picked);
            return true;
          }
          if (L.applyConstraint(L.ctool, picked)) setSel([]);
          // A pick that fits on its own (a line after a lone point, for Horizontal/Vertical) goes on by itself.
          else if (picked.length > 1 && picksReady(L.ctool, sk, [id]) && L.applyConstraint(L.ctool, [id], true)) setSel([]);
          else setSel(picked.length > 1 ? [id] : []);
          return true;
        }
        if (L.stool === "fillet" || L.stool === "trim" || L.stool === "offset" || L.stool === "project") return editDown(p, hit);
        if (L.stool === "select" || L.stool === "dimension") {
          let id = pickAt(hit.xy, L.sketch, reach * hit.px, L.origin);
          if (L.stool === "dimension") {
            // Nothing in the sketch there: a model edge or corner comes in to be sized to.
            const mp = id ? null : modelPick(p);
            if (mp) {
              id = L.projectModel(mp);
              eng.showHover(null);
            }
            if (!id) return false;
            const sk = (mp && L.current()) || L.sketch;
            const picked = [...L.sel.filter((x) => x !== id), id];
            const e = sk.entities.find((x) => x.id === id);
            // A line, circle or arc sizes at once unless a point waits for it; a point waits for a second pick.
            const waiting = L.sel.some((x) => x === ORIGIN || sk.entities.find((y) => y.id === x)?.kind === "point");
            if (e && e.kind !== "point" && !waiting && L.dimensionFor([id])) return true;
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
          else if (e?.kind === "line") {
            const idx = new SketchIndex(L.sketch);
            drag = { id, moved: false, line: { a: e.a, b: e.b, from: [idx.xy(e.a), idx.xy(e.b)], grab: hit.xy } };
          }
          return true;
        }
        const s = snapAt(hit.xy, hit.px, mods);
        if (mods.touch) {
          // No hover with a finger: show the point now, let it slide to a snap, and place it on lift.
          tap = { at: p, start: s, base: L.clicks, dragged: false };
          setCursor(s);
          return true;
        }
        addClick(s);
        return true;
      },
      move: (p, mods, pressed) => {
        const L = live.current;
        if (!pressed) reach = mods.touch ? 18 : 8;
        const hit = at(p);
        if (!hit || !L.sketch) return;
        if (L.placing) {
          const pl = L.placing;
          const dim = placeAt(pl.sketch, pl.dim.kind, pl.dim.refs, hit.xy);
          setPlacing({ ...pl, dim });
          setHover(null);
          return;
        }
        if (pressed && drag) {
          if (!L.solver) return;
          const ln = drag.line;
          let r: SolveResult;
          if (ln) {
            const [a, b] = slideAcross(ln.from[0], ln.from[1], ln.grab, hit.xy);
            r = L.solver.dragPoints(L.sketch, [
              [ln.a, a],
              [ln.b, b],
            ]);
          } else r = L.solver.drag(L.sketch, drag.id, hit.xy);
          if (r.status === "ok" || r.status === "redundant") {
            drag.moved = true;
            const id = L.editingId!;
            store.edit((doc) => updateSketch(doc, id, () => r.sketch), ln ? "Move a line" : "Move a point", `drag:${id}:${drag!.id}`);
          }
          return;
        }
        if (L.stool === "fillet" || L.stool === "trim" || L.stool === "offset" || L.stool === "project") return editMove(p, hit);
        if (L.ctool) {
          // The Coincident tool snaps to the point, origin or midpoint under the pointer, and lets go further away.
          setPointer({ x: p.x, y: p.y });
          const pick = constraintPick(L.ctool, hit.xy, hit.px);
          eng.showHover(pick ? null : modelPick(p));
          setHover(pick?.id ?? null);
          setCursor(pick?.xy ? { xy: pick.xy, kind: pick.kind!, label: pick.label! } : null);
          return;
        }
        if (L.stool === "select" || L.stool === "dimension") {
          const id = pickAt(hit.xy, L.sketch, reach * hit.px, L.origin);
          setHover(id);
          setCursor(null);
          if (L.stool === "dimension") eng.showHover(id ? null : modelPick(p));
          return;
        }
        setHover(null);
        if (pressed && tap && !tap.dragged && Math.hypot(p.x - tap.at.x, p.y - tap.at.y) > SLIDE) {
          // A drag: where the finger came down is a click, and the shape follows the finger from it.
          const need = CLICKS[L.stool as keyof typeof CLICKS];
          if (tap.base.length + 2 <= need) {
            tap.dragged = true;
            setClicks([...tap.base, tap.start]);
          }
        }
        setCursor(snapAt(hit.xy, hit.px, mods));
      },
      up: (p, mods) => {
        if (drag?.moved) store.seal();
        drag = null;
        const L = live.current;
        if (tapPlace) {
          tapPlace = false;
          L.place();
          return;
        }
        const t = tap;
        tap = null;
        const hit = at(p);
        if (!t || !hit || !L.sketch) return;
        const all = [...t.base, ...(t.dragged ? [t.start] : []), snapAt(hit.xy, hit.px, mods)];
        if (all.length >= CLICKS[L.stool as keyof typeof CLICKS]) finishShape(all);
        else setClicks(all);
      },
      cancel: () => {
        // A second finger came down to pinch or pan: nothing goes in.
        if (drag?.moved) store.seal();
        drag = null;
        if (tap?.dragged) setClicks(tap.base);
        tap = null;
        tapPlace = false;
        setCursor(null);
      },
      leave: () => {
        setHover(null);
        setPointer(null);
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
    const eng = engineOf();
    // A midpoint pick shows as its line.
    const shown = sel.map((id) => middleLine(id) ?? id);
    const view = sketchView(
      sketch,
      frame,
      result,
      shown,
      hover && (middleLine(hover) ?? hover),
      previewNow?.lines ?? [],
      cursor,
      clicks[clicks.length - 1]?.xy,
      undefined,
      editPreview,
      {
        ...options,
        ends: stool !== "select",
      },
    );
    const px = eng?.pixelSize(frame.origin);
    let grid: OverlayView["grid"] = null;
    if (eng && px && options.grid) {
      // Around the point of the plane in the middle of the view, far enough to reach every corner.
      const { width, height } = eng.size;
      const w = eng.rayPlane(width / 2, height / 2, frame.origin, frame.normal);
      if (w) grid = sketchGrid(toSketch(frame, w), px * Math.hypot(width, height) * 0.6, px);
    }
    const mark: Shade = sel.includes(ORIGIN) ? "picked" : hover === ORIGIN ? "hover" : "fixed";
    o.update(px && origin ? { ...withOrigin(view, origin, px, mark), grid } : view);
  }, [sketch, frame, origin, result, sel, hover, previewNow, cursor, clicks, camTick, d.theme, editPreview, engineOf, options, stool]);

  // The sketch's own grid takes the floor grid's place while it is on.
  useEffect(() => {
    const eng = engineOf();
    if (!eng || !editingId || !options.grid) return;
    eng.setFloorGrid(false);
    return () => eng.setFloorGrid(true);
  }, [editingId, options.grid, engineOf]);

  // Finished sketches stay on show, faintly, while the timeline includes them: their curves only, as Fusion draws a
  // sketch outside sketch mode, with no construction geometry and no points.
  useEffect(() => {
    const eng = engineOf();
    if (!eng) return;
    const shown = d.built.filter((b) => b.id !== editingId);
    const list = shown.map((b) => {
      const o = new SketchOverlay(eng);
      o.update(sketchView(b.sketch, planeFrame(b.sketch.plane), null, [], null, [], null, undefined, "guide", null, FINISHED));
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
  useEscape(editing && placing !== null, () => setPlacing(null), ESC.tool + 3);
  useEscape(
    editing && clicks.length > 0,
    () => {
      setClicks([]);
      setTyped([]);
    },
    ESC.tool + 3,
  );
  useEscape(
    editing && (stool !== "select" || ctool !== null),
    () => {
      setStool("select");
      setSel([]);
    },
    ESC.tool + 2,
  );
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

  const h = useRef({ pickTool, removeSelected, toggleConstruction, finish, constrain, lookAtSketch });
  h.current = { pickTool, removeSelected, toggleConstruction, finish, constrain, lookAtSketch };
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
      {
        id: "sketch.lookAt",
        scope: "sketch",
        label: "Look at the sketch",
        group: "Sketch",
        icon: "eye",
        run: () => h.current.lookAtSketch(),
        keywords: "view plane face on straight",
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

  const toolHelp = ctool ? `${constraintToolById(ctool).hint}. Esc puts the tool down.` : toolById(stool).help;
  const help = redefining
    ? `Click a face or a plane to move ${redefining.name} onto it. Esc keeps it where it is.`
    : d.picking && !editing
      ? "Click a face or a plane to sketch on it."
      : editing
        ? `${toolHelp} ${status ?? ""}.`.replace(/\.\.$/, ".")
        : null;

  return {
    editing,
    editingId,
    feature,
    sketch,
    frame,
    result,
    status,
    stool,
    ctool,
    pointer,
    origin,
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
    showConstraints,
    options,
    setOption,
    lookAtSketch,
    dimEdit,
    setDimEdit,
    setDimension,
    placing,
    moveLabel,
    scope,
    finishWarn,
    setFinishWarn,
    finish,
    edit,
    startOnPlane,
    redefine,
    redefining: redefining?.name ?? null,
    cancelRedefine,
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
  show?: ShowOptions,
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
  // Hidden kinds still count for the solver and profiles; only the drawing leaves them out. Picked ones stay.
  const hidden = (e: Sketch["entities"][number]) =>
    !!show && !sel.includes(e.id) && ((e.projectedFrom ? !show.projected : false) || (e.construction && !e.projectedFrom ? !show.construction : false));
  for (const e of s.entities) {
    if (hidden(e)) continue;
    if (e.kind === "line") curves.push({ pts: [idx.xy(e.a), idx.xy(e.b)], shade: shade(e.id), dashed: e.construction });
    else if (e.kind === "circle") curves.push({ pts: sampleArc(idx.xy(e.c), e.r, 0, 2 * Math.PI, 72), shade: shade(e.id), dashed: e.construction });
    else if (e.kind === "arc") {
      const c = idx.xy(e.c);
      curves.push({ pts: sampleArc(c, e.r, angleOf(sub(idx.xy(e.a), c)), angleOf(sub(idx.xy(e.b), c))), shade: shade(e.id), dashed: e.construction });
    }
  }
  // The ends of lines and arcs are for finding a point to draw from or pick, so the Select tool shows only the one
  // under the pointer or picked. Centres and lone points always show.
  const ends = new Set<Id>();
  if (show && show.ends === false) for (const e of s.entities) if (e.kind === "line" || e.kind === "arc") ends.add(e.a).add(e.b);
  const points: OverlayPoint[] = s.entities.flatMap((e) =>
    e.kind === "point" && (sel.includes(e.id) || hover === e.id || ((!show || show.points) && !ends.has(e.id)))
      ? [{ xy: [e.x, e.y] as Vec2, shade: shade(e.id), big: sel.includes(e.id) || hover === e.id }]
      : [],
  );
  for (const l of previewLines) curves.push({ pts: l, shade: "preview" });
  for (const l of extra?.lines ?? []) curves.push({ pts: l, shade: extra!.danger ? "conflict" : "preview" });
  if (cursor && from && (cursor.kind === "horizontal" || cursor.kind === "vertical") && dist(cursor.xy, from) > 1e-9) {
    curves.push({ pts: [from, cursor.xy], shade: "guide", dashed: true });
  }
  if (cursor) points.push({ xy: cursor.xy, shade: cursor.kind === "free" ? "preview" : "hover", big: cursor.kind !== "free" });
  // The closed shapes Extrude can use, shaded faintly, as Fusion's profiles are.
  const fills: OverlayFill[] = show?.profile
    ? profiles(s).profiles.map((p) => ({ outer: p.points, holes: p.holes.map((h) => h.points), shade: "free" as const }))
    : [];
  return { frame, curves, points, fills, fillOpacity: 0.14 };
}

/** What the overlay leaves out or adds, from the palette's options. */
type ShowOptions = { [K in "points" | "profile" | "projected" | "construction"]: SketchOptions[K] } & {
  /** Whether the ends of lines and arcs show; off for the Select tool. Shown when left out. */
  ends?: boolean;
};

/** How a sketch shows when it is not being edited: profile curves and projected edges, nothing else. */
export const FINISHED: ShowOptions = { points: false, profile: false, projected: true, construction: false };

/** The model's origin drawn under the sketch: a fixed point with a small cross, 8 px each way, to snap to and pick. */
export function withOrigin(view: OverlayView, origin: Vec2, px: number, shade: Shade = "fixed"): OverlayView {
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
        shade,
      },
      {
        pts: [
          [x, y - r],
          [x, y + r],
        ],
        shade,
      },
      ...view.curves,
    ],
    points: [{ xy: origin, shade, big: shade !== "fixed" }, ...view.points],
  };
}

/** Offset toward the pointer: whichever side's copy lands nearer it. */
/** Whether an id can be a constraint tool's pick: geometry, the origin or a line's midpoint, not a constraint or size. */
function isPickable(s: Sketch, id: Id): boolean {
  if (id === ORIGIN) return true;
  const line = middleLine(id);
  return s.entities.some((e) => e.id === (line ?? id));
}

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

/** A face's edges as model curves to project: whole edges where the mesh has them, outline pieces where it does not. */
function faceCurves(eng: Engine, body: string, face: number): ModelCurve[] {
  return (eng.faceEdges(body, face) ?? []).map((e) => ({ points: e.points, from: e.edge >= 0 ? { body, face, edge: e.edge } : { body, face } }));
}
