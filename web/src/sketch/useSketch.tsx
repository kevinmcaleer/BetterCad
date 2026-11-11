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
  formatDimension,
  planeFrame,
  squareFrame,
  profiles,
  removeEntities,
  sampleArc,
  sampleEllipse,
  ellipseGeo,
  directionAt,
  slideAcross,
  sub,
  toSketch,
  toWorld,
  placedLoops,
  textAt,
  textsOf,
  TEXT_DEFAULTS,
  type TextStyle,
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
import {
  addSketch,
  mat4InvertRigid,
  moveFrame,
  newId,
  paramScope,
  redefineSketchPlane,
  updateSketch,
  type BuiltConstruct,
  type Mat4,
  type ModelDoc,
  type SketchFeature,
} from "../state/document";
import { loadSolver } from "./solver";
import { DEFAULT_FONT, layOut } from "./text/fonts";
import type { Command } from "../state/commands";
import { caught } from "../report/errors";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine, Mods, ScreenPoint, WorldPlaneName } from "../viewport/engine";
import { readPalette } from "../viewport/colours";
import { isTyping } from "../state/commands";
import { loupeAuto } from "../state/loupePref";
import { CROWD_DWELL, LOUPE_REACH, LOUPE_SIZE, crowding, lensed, loupeZoom, type Loupe } from "./loupe";
import type { Pick } from "../viewport/ids";
import { SketchOverlay, type OverlayCurve, type OverlayFill, type OverlayPoint, type OverlayView, type Shade } from "./overlay";
import { loadOptions, saveOptions, sketchGrid, sliceSection, sliceSide, type SketchOption, type SketchOptions } from "./options";
import { viewDir } from "../viewport/camera";
import { placeAt } from "./dimensions";
import type { ModelTarget } from "./modelSnap";
import { ORIGIN, entityAt, middleLine, pickAt, pointPickAt, snap, snapStep, type PointPick, type Snap } from "./snap";
import {
  CLICKS,
  CONSTRAINT_TOOLS,
  SKETCH_TOOLS,
  addConstraints,
  axisLine,
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
  /** Every sketch as built, hidden ones too: a joint may have moved its plane with its component. */
  placed?: { id: string; sketch: Sketch }[];
  /** Moves from home by sketch id while the model is posed, so finished sketches ride on their components. */
  posed?: Map<string, Mat4>;
  /** Moves from home by body id while the model is posed: a face picked on a posed body is taken home to keep. */
  bodyMoves?: Map<string, Mat4>;
  view: RefObject<View3DHandle>;
  /** Whether the Sketch tool is armed (pick a plane). */
  picking: boolean;
  /** A sketch started: the editor puts its Sketch tool down. */
  onStarted: () => void;
  say: (text: string, error?: boolean) => void;
  theme: string;
  /** Construction geometry built up to the marker (#265): its planes can be sketched on. */
  construct?: BuiltConstruct[];
  /** The construction plane under the pointer while picking, to draw it lit. */
  onConstructHover?: (id: string | null) => void;
}

/** A sketch's frame where it is shown: `placedFrame`, carried by its component's pose while the model is posed. */
export function posedFrame(
  id: string,
  plane: PlaneRef,
  construct: BuiltConstruct[] = [],
  placed: { id: string; sketch: Sketch }[] = [],
  posed?: Map<string, Mat4>,
): Frame {
  const f = placedFrame(id, plane, construct, placed);
  const m = posed?.get(id);
  return m ? moveFrame(m, f) : f;
}

/** A face plane picked on a posed body, taken back to where the body is at home (`m` is the body's move from home). */
export function homePlane(plane: PlaneRef, m: Mat4 | undefined): PlaneRef {
  if (!m || plane.kind !== "face") return plane;
  return { ...plane, frame: moveFrame(mat4InvertRigid(m), plane.frame) };
}

/** A sketch plane where it is now: a construction plane's frame comes from the step as built. */
export function liveFrame(plane: PlaneRef, construct: BuiltConstruct[] = []): Frame {
  if (plane.kind === "construct") {
    const c = construct.find((x) => x.id === plane.step);
    if (c?.geo.what === "plane") return planeFrame({ ...plane, frame: c.geo.frame });
  }
  return planeFrame(plane);
}

/** A sketch's frame where the model has put it: on its component once a joint has moved that, else `liveFrame`. */
export function placedFrame(id: string, plane: PlaneRef, construct: BuiltConstruct[] = [], placed: { id: string; sketch: Sketch }[] = []): Frame {
  const at = placed.find((b) => b.id === id)?.sketch.plane.frame;
  return at ? planeFrame({ ...plane, frame: at } as PlaneRef) : liveFrame(plane, construct);
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

const PLANES_ONLY = new Set(["plane"] as const);
const AXES = new Set(["axis"] as const);

/**
 * A text being set with the Text tool: where it goes, how it is set, and its outline laid out from the font for the
 * preview. `id` is the text being changed, or null for a new one.
 */
export interface TextEdit {
  id: Id | null;
  at: Vec2;
  /** An existing point the new text sits on, snapped to when it was placed. */
  anchor?: Id;
  style: TextStyle;
  loops: Vec2[][];
  loading: boolean;
}

/** Code the sketch loads on first use, to keep it out of first paint: drawing the loupe, and snapping to the model. */
const lazy: { loupe?: typeof import("./loupeDraw"); modelSnap?: typeof import("./modelSnap") } = {};

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
  /** The magnifier loupe, while it is open. */
  const [loupe, setLoupe] = useState<Loupe | null>(null);
  const closeLoupe = useRef<() => void>(() => {});
  /** The loupe's canvas, and the last picture of the sketch it magnifies. */
  const loupeCanvas = useRef<HTMLCanvasElement | null>(null);
  const lastView = useRef<OverlayView | null>(null);
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
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  /** How the last text was set, so the next starts the same way. */
  const lastText = useRef<TextStyle>({ text: "Text", font: DEFAULT_FONT, ...TEXT_DEFAULTS });

  const feature = d.doc.features.find((f): f is SketchFeature => f.id === editingId && f.type === "sketch") ?? null;
  const sketch = feature?.sketch ?? null;
  const frame = useMemo<Frame | null>(
    () => (sketch && editingId ? posedFrame(editingId, sketch.plane, d.construct, d.placed, d.posed) : null),
    [sketch, editingId, d.construct, d.placed, d.posed],
  );
  // Slice lasts for one sketch: each sketch starts with the whole model on show.
  useEffect(() => setOptions((o) => (o.slice ? { ...o, slice: false } : o)), [editingId]);
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
  // A sketch looks straight at its plane, orthographic; finishing it puts back the projection you had before.
  const keptOrtho = useRef<boolean | null>(null);
  useEffect(() => {
    if (editingId || keptOrtho.current === null) return;
    if (!keptOrtho.current) engineOf()?.setOrtho(false);
    keptOrtho.current = null;
  }, [editingId, engineOf]);

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
    setTextEdit(null);
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
            // A conflict pulls two ways; a repeat only says again what is already held, so it is named as that.
            if (r.status === "conflicting") say(`That fights ${names}. Delete one of them first.`, true);
            else say(`That's already held in place, so it would repeat ${names}.`, true);
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
    (kind: DimensionKind, refs: Id[], base?: Sketch, extra: Partial<Dimension> = {}) => {
      const s = base ?? current();
      if (!s) return;
      const dr = new Draft(s);
      const id = dr.dimension(kind, refs, undefined, extra);
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
    addSize(pl.dim.kind, pl.dim.refs, pl.sketch, { labelOffset: pl.dim.labelOffset, ...(pl.dim.arms && { arms: pl.dim.arms }) });
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
      ids.filter((id) => s.entities.some((e) => e.id === id) || s.texts?.some((t) => t.id === id)),
    );
    apply(next, ids.length === 1 ? "Delete from the sketch" : `Delete ${ids.length} items from the sketch`);
    setSel([]);
  }, [current, apply]);

  const toggleConstruction = useCallback(() => {
    const s = current();
    if (!s) return;
    const ids = new Set(live.current.sel);
    const curves = s.entities.filter((e) => ids.has(e.id) && e.kind !== "point");
    const texts = (s.texts ?? []).filter((t) => ids.has(t.id));
    if (!curves.length && !texts.length) {
      say("Pick lines, circles, arcs or text first");
      return;
    }
    const on = ![...curves, ...texts].every((e) => e.construction);
    apply(
      {
        ...s,
        entities: s.entities.map((e) => (ids.has(e.id) && e.kind !== "point" ? { ...e, construction: on } : e)),
        ...(s.texts ? { texts: s.texts.map((t) => (ids.has(t.id) ? { ...t, construction: on } : t)) } : {}),
      },
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
      const f = posedFrame(id, plane, deps.current.construct, deps.current.placed, deps.current.posed);
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
      // Picked on a posed body, the face is where the body is shown; the sketch keeps it where the body is at home.
      const kept = homePlane(plane, plane.kind === "face" ? deps.current.bodyMoves?.get(plane.face.body) : undefined);
      deps.current.record((doc, at) => {
        const next = addSketch(doc, kept, id, at);
        return curves.length ? updateSketch(next, id, (s) => projectCurves(s, planeFrame(plane), curves).sketch) : next;
      }, "Start a sketch");
      store.seal();
      deps.current.onStarted();
      setEditingId(id);
      setStool("line");
      setSel([]);
      const f = planeFrame(plane);
      keptOrtho.current ??= eng?.camera.ortho ?? null;
      eng?.lookAt(f.origin, f.normal);
      say(`Sketching on ${what}${curves.length ? ", with its edges brought in" : ""}. Enter finishes.`);
    },
    [store, engineOf, setStool, say, options.autoProject],
  );

  /** Starts a sketch on a construction plane (#265), from the browser. */
  const startOnStep = useCallback(
    (id: string) => {
      const c = deps.current.construct?.find((x) => x.id === id);
      if (c?.geo.what === "plane") startOn({ kind: "construct", step: id, offset: 0, frame: c.geo.frame }, c.name);
    },
    [startOn],
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
      const kept = homePlane(plane, deps.current.posed?.get(r.id));
      store.edit((doc) => redefineSketchPlane(doc, r.id, kept), `Redefine ${r.name}'s plane`);
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
      const fr = posedFrame(id, f.sketch.plane, deps.current.construct, deps.current.placed, deps.current.posed);
      const eng = engineOf();
      keptOrtho.current ??= eng?.camera.ortho ?? null;
      eng?.lookAt(fr.origin, fr.normal);
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
    setTextEdit(null);
    if (name) say(`Finished ${name}`);
  }, [store, setStool, say]);

  const finish = useCallback(
    (force = false) => {
      const s = current();
      if (!s) return end();
      const drawn = s.entities.some((e) => e.kind !== "point" && !e.construction) || !!s.texts?.some((t) => !t.construction);
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

  /**
   * The Dimension tool on an axis (a construction axis, or the origin's while the tool is on): brought into the sketch
   * as a fixed construction line, so sizes and angles can measure from it. Null when none is under the pointer, or it
   * runs square through the sketch.
   */
  const projectAxis = useCallback(
    (p: ScreenPoint, near: Vec2): Id | null => {
      const eng = engineOf();
      const s = current();
      const f = live.current.frame;
      const hit = eng?.constructAt(p.x, p.y, AXES);
      const ax = hit ? eng!.constructShape(hit) : null;
      if (!s || !f || !ax?.dir) return null;
      const a = toSketch(f, ax.origin);
      const b = toSketch(f, [ax.origin[0] + ax.dir[0], ax.origin[1] + ax.dir[1], ax.origin[2] + ax.dir[2]]);
      if (dist(a, b) < 1e-3) return null;
      const { sketch: next, id } = axisLine(s, a, b, near);
      if (next !== s && !apply(next, "Project an axis")) return null;
      keepPlacing.current = current();
      return id;
    },
    [engineOf, current, apply],
  );

  // ---------------------------------------------------------------- text

  /** Starts a new text at a point, set as the last one was; the Text card opens for its words. */
  const openText = useCallback((at: Vec2, anchor?: Id) => {
    setTextEdit({ id: null, at, anchor, style: { ...lastText.current }, loops: [], loading: true });
    setSel([]);
  }, []);

  /** Opens a text already in the sketch to change it. */
  const editText = useCallback(
    (id: Id) => {
      const s = current();
      const t = s?.texts?.find((x) => x.id === id);
      const p = t && s?.entities.find((e) => e.id === t.p);
      if (!t || p?.kind !== "point") return;
      const { text, font, height, angle, letterSpacing, lineSpacing } = t;
      setTextEdit({ id, at: [p.x, p.y], style: { text, font, height, angle, letterSpacing, lineSpacing }, loops: t.loops, loading: false });
      setSel([id]);
    },
    [current],
  );

  const setTextStyle = useCallback((change: Partial<TextStyle>) => {
    setTextEdit((t) => (t ? { ...t, style: { ...t.style, ...change }, loading: true } : t));
  }, []);

  const cancelText = useCallback(() => setTextEdit(null), []);

  // The preview follows the settings: the font loads the first time it is used, then lays the text out.
  const textStyleKey = textEdit && JSON.stringify(textEdit.style);
  useEffect(() => {
    if (!textEdit) return;
    const style = textEdit.style;
    let alive = true;
    layOut(style).then(
      (loops) => {
        if (alive) setTextEdit((t) => (t && t.style === style ? { ...t, loops, loading: false } : t));
      },
      () => {
        if (!alive) return;
        say("The font did not load. Check the connection and try again.", true);
        setTextEdit((t) => (t && t.style === style ? { ...t, loading: false } : t));
      },
    );
    return () => {
      alive = false;
    };
    // Only a change of settings lays the text out again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textStyleKey]);

  /** Puts the text into the sketch (or changes the one being edited), laid out afresh from its font. */
  const commitText = useCallback(async () => {
    const t = live.current.textEdit;
    if (!t) return;
    if (!t.style.text.trim()) {
      say("Type some text first", true);
      return;
    }
    // The preview is laid out for these settings already, unless they have just changed: then wait for the font.
    let loops = t.loops;
    if (t.loading) {
      try {
        loops = await layOut(t.style);
      } catch {
        say("The font did not load. Check the connection and try again.", true);
        return;
      }
    }
    const s = current();
    if (!s) return;
    lastText.current = { ...t.style };
    if (t.id) {
      const next = { ...s, texts: (s.texts ?? []).map((x) => (x.id === t.id ? { ...x, ...t.style, loops } : x)) };
      apply(next, "Change text");
    } else {
      const usable = t.anchor && s.entities.some((e) => e.id === t.anchor && e.kind === "point");
      const p = usable ? t.anchor! : newId("p");
      const entities = usable ? s.entities : [...s.entities, { id: p, kind: "point" as const, x: t.at[0], y: t.at[1] }];
      apply({ ...s, entities, texts: [...(s.texts ?? []), { id: newId("x"), p, ...t.style, loops }] }, "Add text");
    }
    setTextEdit(null);
  }, [current, apply, say]);

  // ---------------------------------------------------------------- the pointer

  const live = useRef({
    autoProject: options.autoProject,
    projectModel,
    projectAxis,
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
    textEdit,
    openText,
    editText,
  });
  live.current = {
    autoProject: options.autoProject,
    projectModel,
    projectAxis,
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
    textEdit,
    openText,
    editText,
  };

  // Picking a plane: the origin planes show, flat faces light up under the pointer.
  useEffect(() => {
    const eng = engineOf();
    if (!(d.picking || redefining) || editingId || !eng) return;
    const pickOn = redefining ? redefineOn : startOn;
    eng.showPlanes(true);
    let lastKey = "";
    let info = null as ReturnType<Engine["faceInfo"]>;
    type Target =
      | { kind: "face"; pick: Pick; info: NonNullable<typeof info> }
      | { kind: "plane"; plane: WorldPlaneName }
      | { kind: "construct"; id: string; frame: Frame; name: string };
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
      // A construction plane (#265) where no face is: they are big and see-through, so faces come first.
      const id = eng.constructAt(p.x, p.y, PLANES_ONLY);
      const c = id ? deps.current.construct?.find((x) => x.id === id) : undefined;
      if (c?.geo.what === "plane") return { kind: "construct", id: c.id, frame: c.geo.frame, name: c.name };
      const plane = eng.planeAt(p.x, p.y);
      return plane ? { kind: "plane", plane } : null;
    };
    eng.setInput({
      move: (p, _m, pressed) => {
        if (pressed) return;
        const t = target(p);
        eng.showHover(t?.kind === "face" ? t.pick : null);
        eng.hoverPlane(t?.kind === "plane" ? t.plane : null);
        deps.current.onConstructHover?.(t?.kind === "construct" ? t.id : null);
      },
      down: (p) => {
        const t = target(p);
        if (!t) return false;
        deps.current.onConstructHover?.(null);
        if (t.kind === "plane") pickOn({ kind: "world", plane: t.plane, offset: 0 }, `the ${t.plane} plane`);
        else if (t.kind === "construct") pickOn({ kind: "construct", step: t.id, offset: 0, frame: t.frame }, t.name);
        else pickOn({ kind: "face", face: { body: t.pick.body, face: t.pick.index }, offset: 0, frame: squareFrame(t.info.centroid, t.info.normal) }, "a face");
        return true;
      },
      leave: () => {
        eng.showHover(null);
        eng.hoverPlane(null);
        deps.current.onConstructHover?.(null);
      },
    });
    return () => {
      eng.setInput(null);
      deps.current.onConstructHover?.(null);
      eng.showPlanes(false);
      eng.showHover(null);
    };
  }, [d.picking, redefining, editingId, engineOf, startOn, redefineOn]);

  // Editing: the pointer draws, picks and drags on the sketch plane.
  useEffect(() => {
    const eng = engineOf();
    if (!editingId || !eng) return;
    /**
     * A point dragged to the pointer, or a line slid square across from where it was grabbed. A point held over another
     * point or a curve snaps to it (`onto`), and is made coincident with it where it is let go.
     */
    let drag: {
      id: Id;
      /** The undo step the whole drag goes into, kept when an unsnap gives the point a new id. */
      key: string;
      moved: boolean;
      line?: { a: Id; b: Id; from: [Vec2, Vec2]; grab: Vec2 };
      offset?: Vec2;
      onto?: PointPick | null;
      /** Shift was down when the point was grabbed: it lets go of what it snapped to as it moves. */
      free?: boolean;
      /** The sketch with the point let go, solved from until the document catches up with it. */
      loose?: { from: Sketch; to: Sketch };
    } | null = null;
    let drop: typeof import("./drop") | null = null;
    void import("./drop").then((m) => (drop = m));
    /** Ends a drag: a point let go over a snap gets its coincident in the same undo step as the move. */
    const endDrag = (snapIt: boolean) => {
      const d = drag;
      drag = null;
      if (!d?.moved) return;
      const L = live.current;
      const s = L.current();
      if (snapIt && d.onto && s && L.editingId) {
        // A point already on a line it lands in the middle of swaps its on constraint for the midpoint.
        const line = middleLine(d.onto.id);
        const base = line ? { ...s, constraints: s.constraints.filter((c) => !(c.type === "pointOn" && c.p === d.id && c.e === line)) } : s;
        const out = addConstraints("coincident", base, [d.id, d.onto.id], L.origin ?? undefined);
        const label = d.onto.kind === "on" ? "Put a point on a curve" : line ? "Put a point in the middle of a line" : "Make points coincident";
        if (typeof out === "string") say(out, true);
        else L.apply(out, label, { key: d.key, strict: true });
      }
      store.seal();
      if (d.onto) {
        setCursor(null);
        setHover(null);
      }
    };
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
    const zoomNow = () => (lens && lens.why !== "touch" ? lens.zoom : 1);
    const at = (p: ScreenPoint): { xy: Vec2; px: number } | null => {
      const f = live.current.frame;
      if (!f) return null;
      const w = eng.rayPlane(p.x, p.y, f.origin, f.normal);
      // With the loupe open, picks reach only as far as its zoom allows.
      return w ? { xy: toSketch(f, w), px: eng.pixelSize(f.origin) / zoomNow() } : null;
    };
    /** The model's corners, centres and edge middles on the sketch plane, worked out again when the plane or model changes. */
    let targets: { key: string; frame: Frame; list: ModelTarget[] } | null = null;
    const modelSnaps = (): ModelTarget[] | undefined => {
      const L = live.current;
      const ms = lazy.modelSnap;
      if (!L.autoProject || !L.frame) return undefined;
      if (!ms) {
        void import("./modelSnap").then((m) => (lazy.modelSnap = m));
        return undefined;
      }
      const key = JSON.stringify(eng.bodyCounts());
      if (targets?.key !== key || targets.frame !== L.frame) targets = { key, frame: L.frame, list: ms.modelTargets(eng, L.frame) };
      return targets.list;
    };
    const snapAt = (xy: Vec2, px: number, mods: { shift: boolean; mod: boolean; touch?: boolean }, exclude?: Set<Id>): Snap => {
      const L = live.current;
      const from = L.clicks[L.clicks.length - 1]?.xy;
      return snap(xy, L.sketch!, {
        model: modelSnaps(),
        px,
        grid: L.gridSnap || mods.mod ? snapStep(px * zoomNow()) : null,
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
      if (!L.sketch || !L.frame) return;
      // Model edges and corners the clicks snapped to come in first, in the same undo step as the shape.
      // (A click can only carry a model snap once the snapping code has loaded.)
      const { sketch: s, clicks } = lazy.modelSnap?.resolveModelSnaps(L.sketch, L.frame, all) ?? { sketch: L.sketch, clicks: all };
      const c = commit(L.stool, s, clicks, L.typed, L.sides);
      if (!c) {
        if (s !== L.sketch) L.apply(s, "Project a point");
        setClicks([]);
        return;
      }
      L.apply(c.sketch, c.label);
      setTyped([]);
      eng.showHover(null);
      // The line tool chains from its last point, until it meets a point already there.
      const last = clicks[clicks.length - 1]!;
      if (
        (L.stool === "line" || L.stool === "arcTangent") &&
        c.end &&
        !(last.ref && (last.kind === "end" || last.kind === "centre" || last.kind === "origin"))
      ) {
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

    const input = {
      down: (p: ScreenPoint, mods: Mods): boolean => {
        const L = live.current;
        reach = mods.touch ? 18 : 8;
        const hit = at(p);
        if (!hit || !L.sketch) return false;
        if (L.placing) {
          // A line's size is following the pointer and another line is clicked: size the angle between them, as in
          // Fusion (or the gap, if they are parallel).
          const [first, more] = L.placing.dim.refs;
          const isLine = (id?: Id | false | null) => !!L.current()?.entities.some((e) => e.id === id && e.kind === "line");
          const other = !more && isLine(first) && L.stool === "dimension" && (pickAt(hit.xy, L.sketch, reach * hit.px, L.origin) ?? L.projectAxis(p, hit.xy));
          if (other !== first && isLine(other) && L.dimensionFor([first!, other as Id])) {
            setPlacing((pl) => pl && { ...pl, dim: placeAt(pl.sketch, pl.dim.kind, pl.dim.refs, hit.xy) });
            return true;
          }
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
        if (L.stool === "text") {
          // A click on a text opens it; anywhere else places a new one there (or moves the one being set).
          const t = L.textEdit?.id ? null : textAt(L.sketch, hit.xy, reach * hit.px);
          if (t) {
            L.editText(t.id);
            return true;
          }
          if (L.textEdit?.id) return false;
          const at = snapAt(hit.xy, hit.px, mods);
          const anchor = at.ref && L.sketch.entities.some((e) => e.id === at.ref && e.kind === "point") ? at.ref : undefined;
          if (L.textEdit) setTextEdit({ ...L.textEdit, at: at.xy, anchor });
          else L.openText(at.xy, anchor);
          return true;
        }
        if (L.stool === "select" || L.stool === "dimension") {
          let id = pickAt(hit.xy, L.sketch, reach * hit.px, L.origin);
          if (L.stool === "dimension") {
            // Nothing in the sketch there: a model edge or corner comes in to be sized to.
            const mp = id ? null : modelPick(p);
            if (mp) {
              id = L.projectModel(mp);
              eng.showHover(null);
            }
            const axis = !id && L.projectAxis(p, hit.xy);
            if (axis) id = axis;
            if (!id) return false;
            const sk = ((mp || axis) && L.current()) || L.sketch;
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
            // A text is picked by its box, and dragged by its anchor.
            const t = textAt(L.sketch, hit.xy, reach * hit.px);
            const a = t && L.sketch.entities.find((e) => e.id === t.p);
            if (t && a?.kind === "point") {
              setSel((s) => (mods.shift || mods.mod ? (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]) : [t.id]));
              drag = { id: t.p, key: `drag:${L.editingId}:${t.p}`, moved: false, offset: sub(hit.xy, [a.x, a.y]) };
              return true;
            }
            if (!mods.shift) setSel([]);
            return false;
          }
          setSel((s) => (mods.shift || mods.mod ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : s.includes(id) ? s : [id]));
          const e = L.sketch.entities.find((x) => x.id === id);
          if (e?.kind === "point") drag = { id, key: `drag:${L.editingId}:${id}`, moved: false, free: mods.shift };
          else if (e?.kind === "line") {
            const idx = new SketchIndex(L.sketch);
            drag = { id, key: `drag:${L.editingId}:${id}`, moved: false, line: { a: e.a, b: e.b, from: [idx.xy(e.a), idx.xy(e.b)], grab: hit.xy } };
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
      move: (p: ScreenPoint, mods: Mods, pressed: boolean) => {
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
          } else if (drag.offset) r = L.solver.drag(L.sketch, drag.id, sub(hit.xy, drag.offset));
          else {
            // Grabbed with Shift: the point first lets go of what it snapped to (a split corner gets a new point).
            if (drag.free && !drag.moved && !drag.loose && drop) {
              const u = drop.unsnap(L.sketch, drag.id);
              if (u) {
                drag.loose = { from: L.sketch, to: u.sketch };
                drag.id = u.point;
              }
            }
            const base = drag.loose && L.sketch === drag.loose.from ? drag.loose.to : L.sketch;
            // Over another point or a curve, the point snaps to it and shows where it will go; Shift lets it go free.
            const onto = mods.shift || !drop ? null : drop.dropTarget(hit.xy, base, drag.id, reach * hit.px, L.origin);
            drag.onto = onto;
            setHover(onto?.id ?? null);
            setCursor(onto ? { xy: onto.xy, kind: onto.kind, label: onto.label } : null);
            r = L.solver.drag(base, drag.id, onto?.xy ?? hit.xy);
          }
          if (r.status === "ok" || r.status === "redundant") {
            drag.moved = true;
            const id = L.editingId!;
            store.edit(
              (doc) => updateSketch(doc, id, () => r.sketch),
              ln ? "Move a line" : drag.offset ? "Move text" : drag.loose ? "Unsnap a point" : "Move a point",
              drag.key,
            );
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
        if (L.stool === "text") {
          const t = L.textEdit?.id ? null : textAt(L.sketch, hit.xy, reach * hit.px);
          setHover(t?.id ?? null);
          setCursor(t || L.textEdit?.id ? null : snapAt(hit.xy, hit.px, mods));
          return;
        }
        if (L.stool === "select" || L.stool === "dimension") {
          const id =
            pickAt(hit.xy, L.sketch, reach * hit.px, L.origin) ?? (L.stool === "select" ? (textAt(L.sketch, hit.xy, reach * hit.px)?.id ?? null) : null);
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
        const sn = snapAt(hit.xy, hit.px, mods);
        setCursor(sn);
        // A model edge or corner snapped to lights up, as it will come into the sketch.
        const from = sn.model?.from;
        eng.showHover(from ? { body: from.body, kind: from.vertex !== undefined ? "vertex" : "edge", index: from.vertex ?? from.edge ?? 0 } : null);
      },
      up: (p: ScreenPoint, mods: Mods) => {
        endDrag(true);
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
        endDrag(false);
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
    };

    // ------------------------------------------------ the loupe
    /** The loupe as the handlers see it; `setLoupe` shows it. */
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
    /** The sketch's points and the origin, where they are on screen. */
    const screenPoints = (): ScreenPoint[] => {
      const L = live.current;
      const f = L.frame;
      if (!f || !L.sketch) return [];
      const pts = L.sketch.entities.flatMap((e) => (e.kind === "point" ? [eng.project(toWorld(f, [e.x, e.y]))] : []));
      if (L.origin) pts.push(eng.project(toWorld(f, L.origin)));
      return pts;
    };
    const openAt = (p: ScreenPoint, why: Loupe["why"], gap?: number | null) =>
      show({ anchor: p, pointer: p, zoom: loupeZoom(gap === undefined ? (crowding(screenPoints(), p)?.gap ?? null) : gap), why });
    /** Opens, follows or closes the loupe as the pointer moves, before the move is handled. */
    const watch = (p: ScreenPoint, mods: Mods, pressed: boolean) => {
      window.clearTimeout(dwell);
      if (live.current.placing || live.current.textEdit) return lens && show(null);
      if (mods.touch) {
        if (lens?.why === "touch") show({ ...lens, anchor: p, pointer: p });
        return;
      }
      if (lens) {
        if (lens.why === "alt" && !mods.alt) return show(null);
        const away = Math.hypot(p.x - lens.anchor.x, p.y - lens.anchor.y) > LOUPE_REACH;
        // Moving off the loupe's edge closes it, or with Alt held, moves it to the pointer.
        if (away && !pressed) return lens.why === "alt" ? openAt(p, "alt") : show(null);
        return show({ ...lens, pointer: p });
      }
      if (pressed) return;
      if (mods.alt && !mods.shift) return openAt(p, "alt");
      const crowd = loupeAuto() ? crowding(screenPoints(), p) : null;
      if (!crowd) quiet = false;
      if (!crowd || quiet) return;
      dwell = window.setTimeout(() => {
        if (lens || !last || last.mods.alt) return;
        const now = crowding(screenPoints(), last.p);
        if (now) openAt(last.p, "crowd", now.gap);
      }, CROWD_DWELL);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || isTyping(e.target)) return;
      if (e.type === "keydown") {
        // Alt alone would focus the browser's menu bar on Windows.
        e.preventDefault();
        if (!lens && last && !last.mods.touch) openAt(last.p, "alt");
      } else if (lens?.why === "alt") show(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    eng.setInput({
      down: (p, mods) => {
        const handled = input.down(lensed(lens, p), mods);
        // A finger hides what it's on: the loupe shows it while the finger is down.
        if (handled && mods.touch) openAt(p, "touch");
        return handled;
      },
      move: (p, mods, pressed) => {
        last = { p, mods };
        watch(p, mods, pressed);
        input.move(lensed(lens, p), mods, pressed);
      },
      up: (p, mods) => {
        input.up(lensed(lens, p), mods);
        if (lens?.why === "touch") show(null);
      },
      cancel: () => {
        input.cancel();
        if (lens?.why === "touch") show(null);
      },
      leave: () => {
        window.clearTimeout(dwell);
        last = null;
        if (lens) show(null);
        input.leave();
      },
    });
    return () => {
      window.clearTimeout(dwell);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      closeLoupe.current = () => {};
      setLoupe(null);
      eng.setInput(null);
    };
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

  const loupeNow = useRef<Loupe | null>(null);
  loupeNow.current = loupe;
  const paintLoupe = useCallback(() => {
    const cv = loupeCanvas.current;
    const l = loupeNow.current;
    const v = lastView.current;
    const eng = engineOf();
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx || !l || !v || !eng) return;
    const draw = lazy.loupe;
    if (!draw) {
      void import("./loupeDraw").then((m) => {
        lazy.loupe = m;
        paintLoupe();
      });
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const side = Math.round(LOUPE_SIZE * dpr);
    if (cv.width !== side) cv.width = cv.height = side;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pal = readPalette();
    const css = (k: keyof typeof pal) => `#${pal[k].getHexString()}`;
    // The view itself, magnified; the sketch alone redrawn bigger where WebGL can't read back.
    const picture = draw.magnify(eng, l.anchor.x, l.anchor.y, l.zoom);
    draw.drawLoupe(
      ctx,
      v,
      l,
      (xy) => eng.project(toWorld(v.frame, xy)),
      {
        snap: css("snap"),
        ink: css("ink"),
        accent: css("accent"),
        danger: css("danger"),
        muted: css("muted"),
        viewport: css("viewport"),
      },
      LOUPE_SIZE,
      picture,
    );
  }, [engineOf]);

  const previewNow = useMemo(
    () =>
      cursor && isDrawTool(stool)
        ? preview(
            stool,
            clicks.map((c) => c.xy),
            cursor.xy,
            sides,
            stool === "arcTangent" && clicks[0]?.ref && sketch ? directionAt(sketch, clicks[0].ref) : null,
          )
        : null,
    [cursor, stool, clicks, sides, sketch],
  );

  useEffect(() => {
    const o = overlay.current;
    if (!o || !sketch || !frame) return;
    o.refreshPalette();
    const eng = engineOf();
    // A midpoint pick shows as its line.
    const shown = sel.map((id) => middleLine(id) ?? id);
    // The text being set shows as its preview, in place of how it was.
    const te = textEdit;
    const textLines = te ? placedLoops({ loops: te.loops, angle: te.style.angle }, te.at).map((l) => [...l, l[0]!]) : [];
    const base = te?.id ? { ...sketch, texts: sketch.texts?.filter((t) => t.id !== te.id) } : sketch;
    const view = sketchView(
      base,
      frame,
      result,
      shown,
      hover && (middleLine(hover) ?? hover),
      [...(previewNow?.lines ?? []), ...textLines],
      te ? { xy: te.at, kind: "free", label: "" } : cursor,
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
    const final = px && origin ? { ...withOrigin(view, origin, px, mark), grid } : view;
    o.update(final);
    lastView.current = final;
    paintLoupe();
  }, [sketch, frame, origin, result, sel, hover, previewNow, cursor, clicks, camTick, d.theme, editPreview, engineOf, options, stool, textEdit, paintLoupe]);

  // The loupe redraws as the pointer moves in it, and with the sketch above.
  useEffect(() => paintLoupe(), [loupe, paintLoupe]);

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
      // Posed, a sketch rides on its component as its bodies do.
      const m = d.posed?.get(b.id);
      const f = planeFrame(b.sketch.plane);
      o.update(sketchView(b.sketch, m ? moveFrame(m, f) : f, null, [], null, [], null, undefined, "guide", null, FINISHED));
      return o;
    });
    return () => list.forEach((o) => o.dispose());
  }, [d.built, d.posed, editingId, engineOf, d.theme]);

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
  useEscape(editing && textEdit !== null, () => setTextEdit(null), ESC.tool + 3);
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
  useEscape(editing && loupe !== null, () => closeLoupe.current(), ESC.tool + 5);
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
    if ((L.stool === "line" || L.stool === "arcTangent") && c.end) {
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
      ...SKETCH_TOOLS.filter((t) => !t.modeOf).map<Command>((t) => ({
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
        run: () => {
          const sk = live.current.sketch;
          setSel(sk ? [...sk.entities.filter((e) => e.kind !== "point").map((e) => e.id), ...(sk.texts ?? []).map((t) => t.id)] : []);
        },
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

  // Slice: a section at the sketch's plane that cuts away the camera's side. It recuts only when the camera crosses to
  // the plane's other side, not on every orbit step, and the section analysis comes back when the sketch finishes.
  void camTick;
  const cam = editing && options.slice && frame ? engineOf()?.camera : null;
  const side = cam && frame ? sliceSide(frame, viewDir(cam.azimuth, cam.elevation)) : 0;
  const slice = useMemo(() => (side && frame ? sliceSection(frame, side) : null), [side, frame]);

  return {
    editing,
    editingId,
    slice,
    feature,
    sketch,
    frame,
    result,
    status,
    stool,
    ctool,
    pointer,
    loupe,
    loupeCanvas,
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
    textEdit,
    setTextStyle,
    commitText,
    cancelText,
    editText,
    scope,
    finishWarn,
    setFinishWarn,
    finish,
    edit,
    startOnPlane,
    startOnStep,
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
    else if (e.kind === "ellipse") curves.push({ pts: sampleEllipse(ellipseGeo(idx, e)), shade: shade(e.id), dashed: e.construction });
    else if (e.kind === "arc") {
      const c = idx.xy(e.c);
      curves.push({ pts: sampleArc(c, e.r, angleOf(sub(idx.xy(e.a), c)), angleOf(sub(idx.xy(e.b), c))), shade: shade(e.id), dashed: e.construction });
    }
  }
  // Text: each outline closed, in its anchor's shade unless the text itself is picked or under the pointer.
  for (const { text, loops } of textsOf(s)) {
    if (text.construction && show && !show.construction && !sel.includes(text.id)) continue;
    const sh: Shade = base ?? (sel.includes(text.id) ? "picked" : hover === text.id ? "hover" : shade(text.p));
    for (const l of loops) curves.push({ pts: [...l, l[0]!], shade: sh, dashed: text.construction });
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
    if (e.kind === "ellipse") return [sampleEllipse(ellipseGeo(idx, e))];
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
