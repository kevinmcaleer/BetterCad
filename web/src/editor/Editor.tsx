import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Banner,
  Button,
  ContextMenu,
  ESC,
  cx,
  TooltipLayer,
  useEscape,
  type ContextMenuState,
  type MenuEntry,
  type RailItem,
  type RowToggle,
} from "@bettercad/ui";
import { createStore } from "../state/store";
import { earlierWarning, laterText, moveText, type MoveNote } from "./DeleteStepDialog";
import {
  addCombine,
  addPart,
  build,
  groupOf,
  groupParams,
  cutTool,
  cutPocket,
  addMatingGear,
  addRack,
  fitBelt,
  meshGears,
  ratioText,
  type GearFeature,
  partFrame,
  staleFits,
  updateFits,
  fixMate,
  printed,
  gapFitOf,
  type FitId,
  applyProfile,
  profileFromSettings,
  PRIMITIVES,
  addLink,
  stampComponent,
  moveInto,
  changeParts,
  duplicateParts,
  featureParts,
  featureSummary,
  newDoc,
  newId,
  removeFeature,
  removeParts,
  fixSketchLinks,
  sketchBrokenLinks,
  reorderFeature,
  addParam,
  paramScope,
  relinkSketches,
  removeParam,
  setExpr,
  updateParam,
  dependents,
  moveProblem,
  moveWarning,
  lostText,
  removeWithDependents,
  reorderPart,
  setLook,
  updateFeature,
  KIND_LABEL,
  overhangs,
  type CheckArea,
  ORIENT_WEIGHTS,
  apply as applyTurn,
  turnPlacement,
  type Orientation,
  type OrientWeights,
  centreMove,
  holeOffsetOf,
  updateHole,
  type HoleFeature,
  estimateWeight,
  fitCheck,
  fitMessage,
  materialOf,
  outside,
  placePart,
  printerOf,
  unionBox,
  DEFAULT_INFILL,
  type Box3,
  type PrintSettings,
  type CombineParams,
  type Feature,
  type ModelDoc,
  type PartKind,
  type PatternKind,
  type Vec3,
  homePose,
  namedPoseValues,
  nextPoseName,
  removePose,
  savePose,
  patternCopyIds,
  addDrive,
  updateDrive,
  driveTo,
  resolvePose,
  type DriveFeature,
  type DriveParams,
  linkTransforms,
  posedFrames,
  setPose,
  jointValue,
  movable,
  combine as combineMass,
  mat4Apply,
  type MassProps,
  type Pose,
  CONSTRUCT_KINDS,
  constructKind as kindInfo,
  type ConstructKind,
} from "../state/document";
import type { ThemeSetting } from "../state/theme";
import { useTheme } from "../state/useTheme";
import { createRegistry, formatCombo, type Command, type CommandContext } from "../state/commands";
import { TOOLS, type ToolId } from "./tools";
import { AppShell } from "./AppShell";
import { TopBar } from "./TopBar";
import { LeftPanel, PANEL_TITLES, type PanelId } from "./LeftPanel";
import { StageBars } from "./Stage";
import { useViewport } from "./useViewport";
import { View3D } from "../viewport/View3D";
import { Properties } from "./Properties";
import { useStatus } from "./useStatus";
import { useKernel } from "../kernel/useKernel";
import { PREVIEW_ID, usePreview, type PreviewRequest } from "../kernel/usePreview";
import { useFiles } from "../files/useFiles";
import { useDrop } from "../files/useDrop";
import { Timeline, partIcon } from "./Timeline";
import { useSketch } from "../sketch/useSketch";
import { loadSolver } from "../sketch/solver";
import type { Solver } from "@bettercad/sketch";
import { useExtrude } from "../extrude/useExtrude";
import { bedLabel, newProfileId, usePrinterProfiles } from "../print/profiles";
import { NO_FIT, type FitChoice } from "../fit/FitMenu";
import type { CombineOp } from "./CombineBar";
import { useFinish } from "../finish/useFinish";
import { usePushPull } from "../finish/usePushPull";
import { useHole } from "../hole/useHole";
import { usePlacePart } from "../catalogue/usePlacePart";
import { useMount } from "../mount/useMount";
import { KEY as gearKey, useGear } from "../gear/useGear";
import type { JointSession } from "../joint/useJoint";
import type { JointUi } from "../joint/JointPanel";
import { originShapes, useConstruct } from "../construct/useConstruct";
import { usePattern } from "../pattern/usePattern";
import { install, useInstallable, useLaunchFiles } from "../pwa/install";
import type { FileHandle } from "../files/fileStore";
import { useMeasure } from "../measure/useMeasure";
import { useAccount } from "../cloud/account";
import { go } from "../cloud/route";
import { useTour } from "../tour/Tour";
import { COURSE_URL } from "../help/about";
import { actionLog, editSummary } from "../report/actionLog";
import { browserName } from "../report/browser";
import { lastError, onCaught, watchWindow, type Caught } from "../report/errors";
import { APP_VERSION } from "../version";
import { useWhatsNew } from "../whatsnew/useWhatsNew";
import { useTips } from "../tips/useTips";
import { saveBcad } from "@bettercad/kernel/bcad";
import type { BodyMass, Clash, ExportFormat, Mate } from "@bettercad/kernel";
import { Matrix4 } from "three";
import { renderSession, type RenderSession, type RenderStyle, type SaveSize } from "../render/session";
import type { RenderBody } from "../render/pathRender";
import { DEFAULT_CAMERA, type CameraState } from "../viewport/camera";
import type { PrintCheck, Suggestion } from "../print/PrintPanel";
import { Page } from "../pages/Page";
import { AXES, ROW, axisOf, planeOf, type OriginItem } from "./Browser";
import type { BodyDrag, WorldPlaneName } from "../viewport/engine";
import type { IkDragHooks } from "../joint/ikDrag";
import type { IkProblem } from "../state/ik";

/** The gear bar loads when the Gear tool is first armed, keeping it out of the first paint. */
const PatternBar = lazy(() => import("../pattern/PatternBar").then((m) => ({ default: m.PatternBar })));
const DeleteStepDialog = lazy(() => import("./DeleteStep").then((m) => ({ default: m.DeleteStepDialog })));
const EmptyState = lazy(() => import("./EmptyState").then((m) => ({ default: m.EmptyState })));
const MountBar = lazy(() => import("../mount/MountBar").then((m) => ({ default: m.MountBar })));
// The Extrude bar loads after first paint (the shell's budget), and is fetched as soon as the editor is up, so it is
// there before the first E and the distance field can take focus.
const loadExtrudeBar = () => import("../extrude/ExtrudeUI");
/** The sketch toolbars and size labels: fetched just after first paint, so sketching never waits on them. */
const loadSketchUI = () => import("../sketch/SketchUI");
const SketchBars = lazy(() => loadSketchUI().then((m) => ({ default: m.SketchBars })));
const SketchLabels = lazy(() => loadSketchUI().then((m) => ({ default: m.SketchLabels })));
const SketchPickBar = lazy(() => loadSketchUI().then((m) => ({ default: m.SketchPickBar })));
const ExtrudeBar = lazy(() => loadExtrudeBar().then((m) => ({ default: m.ExtrudeBar })));
const MeasureBar = lazy(() => import("../measure/MeasureBar").then((m) => ({ default: m.MeasureBar })));
// The command palette loads the first time it opens, to keep it out of first paint.
const CommandPalette = lazy(() => import("./CommandPalette").then((m) => ({ default: m.CommandPalette })));
const CombineBar = lazy(() => import("./CombineBar").then((m) => ({ default: m.CombineBar })));
const PlaceBar = lazy(() => import("../catalogue/PlaceBar").then((m) => ({ default: m.PlaceBar })));
// The sketch palette only shows while a sketch is open, so it loads then.
const SketchPanel = lazy(() => import("../sketch/SketchPanel").then((m) => ({ default: m.SketchPanel })));
const HoleBar = lazy(() => import("../hole/HoleBar").then((m) => ({ default: m.HoleBar })));
const FinishBar = lazy(() => import("../finish/FinishBar").then((m) => ({ default: m.FinishBar })));
const PushPullBar = lazy(() => import("../finish/PushPullBar").then((m) => ({ default: m.PushPullBar })));
const Versions = lazy(() => import("../cloud/Versions").then((m) => ({ default: m.Versions })));
const ShareDialog = lazy(() => import("../cloud/ShareDialog").then((m) => ({ default: m.ShareDialog })));
const AboutDialog = lazy(() => import("../help/AboutDialog").then((m) => ({ default: m.AboutDialog })));
// Release notes (What's new) load in their own chunk, after first paint.
const WhatsNewDialog = lazy(() => import("../whatsnew/WhatsNew").then((m) => ({ default: m.WhatsNewDialog })));
const WhatsNewCard = lazy(() => import("../whatsnew/WhatsNew").then((m) => ({ default: m.WhatsNewCard })));
// The tips card (Help → Tips) loads only when it shows.
const TipsCard = lazy(() => import("../tips/Tips").then((m) => ({ default: m.TipsCard })));
const ReportDialog = lazy(() => import("../report/ReportDialog").then((m) => ({ default: m.ReportDialog })));
const ParamsDialog = lazy(() => import("./ParamsPanel").then((m) => ({ default: m.ParamsDialog })));
const CataloguePanel = lazy(() => import("../catalogue/CataloguePanel").then((m) => ({ default: m.CataloguePanel })));
const ConstructBar = lazy(() => import("../construct/ConstructBar").then((m) => ({ default: m.ConstructBar })));
const JointTool = lazy(() => import("../joint/JointPanel").then((m) => ({ default: m.JointTool })));
const GearBar = lazy(() => import("../gear/GearBar").then((m) => ({ default: m.GearBar })));
const DriveDialog = lazy(() => import("../joint/DriveDialog").then((m) => ({ default: m.DriveDialog })));

const PANELS: RailItem<PanelId>[] = [
  { id: "parts", icon: "layers", label: "Browser" },
  { id: "library", icon: "shapes", label: "Library" },
  { id: "robot", icon: "screw", label: "Catalogue" },
  { id: "history", icon: "history", label: "History" },
  { id: "print", icon: "printer", label: "Print" },
  { id: "settings", icon: "settings", label: "Settings" },
];

const THEME_LABEL: Record<ThemeSetting, string> = { system: "Match the system", light: "Light", dark: "Dark", holoroom: "Holoroom" };

const NO_PICK = () => {};
const NARROW = "(max-width: 899px)";
const TIMELINE_KEY = "bettercad.timeline";
const PROPS_HIDDEN_KEY = "bettercad.props.hidden";

const ORIENT_KEY = "bettercad.orientWeights";

/** The Export and Keyboard shortcuts dialogs load on first use, keeping the first-paint bundle in budget. */
const ExportDialog = lazy(() => import("../export/ExportDialog").then((m) => ({ default: m.ExportDialog })));
/** The Render view and its path tracer load on first Render (#197). */
const RenderPicture = lazy(() => import("../render/RenderView").then((m) => ({ default: m.RenderPicture })));
const RenderBar = lazy(() => import("../render/RenderView").then((m) => ({ default: m.RenderBar })));
/** The Print panel loads when it first opens. */
const PrintPanel = lazy(() => import("../print/PrintPanel").then((m) => ({ default: m.PrintPanel })));
/** Importing a mesh or STEP file loads its code when you first do it (#320). */
const importFiles: typeof import("../files/importFiles").importFiles = (...a) => import("../files/importFiles").then((m) => m.importFiles(...a));
const ShortcutsDialog = lazy(() => import("./ShortcutsDialog").then((m) => ({ default: m.ShortcutsDialog })));

/** The orientation score's weights (#103), kept per browser from Settings, Advanced. */
function readOrientWeights(): OrientWeights {
  try {
    const w = JSON.parse(localStorage.getItem(ORIENT_KEY) ?? "null") as Partial<OrientWeights> | null;
    if (w && (["contact", "overhang", "height"] as const).every((k) => typeof w[k] === "number" && w[k]! >= 0)) return w as OrientWeights;
  } catch {
    // Unreadable or blocked: the defaults.
  }
  return ORIENT_WEIGHTS;
}

/** A view setting kept between visits. Private windows can refuse storage: it then lasts for this visit. */
function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keep(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* lasts for this visit */
  }
}

/** A combine step: the first body keeps, the rest join, cut (grown by the fit's gap) or intersect it. */
function combineParams(target: string, tools: string[], op: CombineOp, keep: boolean, fit: FitChoice, print?: PrintSettings): CombineParams {
  const list = tools.map((t) => (op === "cut" ? cutTool(t, fit.fit, fit.gap, print) : { id: t, op }));
  return { mode: "combine", target, tools: list, keepTools: keep };
}

function useMedia(query: string) {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const change = () => setOn(mq.matches);
    mq.addEventListener?.("change", change);
    return () => mq.removeEventListener?.("change", change);
  }, [query]);
  return on;
}

/** The editor: composes the shell's slots and owns the document, the selection, the armed tool and the commands. */
export interface EditorProps {
  /** False while a page (library, account) covers the editor: its shortcuts stop. */
  active?: boolean;
  /** A model saved to the account to open ("#/edit/<id>"). */
  model?: string;
  /** A share link's token ("#/view/<token>"): the model read-only (#92). */
  share?: string;
  /** A sample model to open as a new one ("#/sample/<id>", #99). */
  sample?: string;
}

export function Editor({ active = true, model, share, sample }: EditorProps = {}) {
  const [store] = useState(() => createStore<ModelDoc>(newDoc()));
  const history = useSyncExternalStore(store.subscribe, store.history);
  const doc = history.present;

  // The timeline marker is view state: how many features are built. null means at the end, following new features.
  const [marker, setMarker] = useState<number | null>(null);
  const featureCount = doc.features.length;
  const at = marker === null ? featureCount : Math.min(marker, featureCount);
  const built = useMemo(() => build(doc, at), [doc, at]);
  const parts = built.parts;
  const kernel = useKernel(doc, at, parts);
  const failed = useMemo(() => new Map([...built.failed, ...kernel.failed]), [built.failed, kernel.failed]);
  const failedRef = useRef(failed);
  failedRef.current = failed;
  const [activeFeature, setActiveFeature] = useState<string | null>(null);
  const [featureMenuAt, setFeatureMenuAt] = useState<{ id: string; at: ContextMenuState } | null>(null);
  /** The view's menu (a long press, or a right click): the parts it acts on, or none for the view's own. */
  const [viewMenuAt, setViewMenuAt] = useState<{ ids: string[]; at: ContextMenuState } | null>(null);
  const [featureRenameId, setFeatureRenameId] = useState<string | null>(null);
  const [timelineShown, setTimelineShownState] = useState(() => recall(TIMELINE_KEY) !== "off");
  const setTimelineShown = useCallback((on: boolean) => {
    setTimelineShownState(on);
    keep(TIMELINE_KEY, on ? "on" : "off");
  }, []);

  const narrow = useMedia(NARROW);
  const [selection, setSelection] = useState<string[]>([]);
  // The browser's origin planes on show, and its sketch or plane pick: view state, like the marker.
  const [originShown, setOriginShown] = useState<OriginItem[]>([]);
  const [browserPicked, setBrowserPicked] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId | null>(() => (window.matchMedia?.(NARROW).matches ? null : "parts"));
  /** The Parameters dialog floats over the view, leaving the browser where it is. */
  const [paramsOpen, setParamsOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  // From 900px up the props panel shows unless put away; the choice lasts between visits.
  const [propsHidden, setPropsHiddenNow] = useState(() => recall(PROPS_HIDDEN_KEY) === "1");
  const setPropsHidden = useCallback((hidden: boolean) => {
    setPropsHiddenNow(hidden);
    keep(PROPS_HIDDEN_KEY, hidden ? "1" : "");
  }, []);
  const [tool, setTool] = useState<ToolId>("select");
  const [combineOp, setCombineOp] = useState<CombineOp>("join");
  const [keepTools, setKeepTools] = useState(false);
  const [combineFit, setCombineFit] = useState<FitChoice>(NO_FIT);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const whatsNew = useWhatsNew();
  const showWhatsNew = whatsNew.show;
  const [exportOpen, setExportOpen] = useState(false);
  /** The format the Export dialog opens on, when something other than your last choice asks (Render's glTF offer). */
  const [exportFormat, setExportFormat] = useState<ExportFormat | undefined>();
  // Render (#197): the session while the Render view is open, and where its camera got to.
  const [render, setRender] = useState<RenderSession | null>(null);
  const renderCam = useRef<CameraState | null>(null);
  // Report a problem (#109): open, and the error that offered it, if one did.
  const [report, setReport] = useState<{ prefill?: string } | null>(null);
  const [crash, setCrash] = useState<Caught | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [inactive, setInactive] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const { theme, setTheme, resolved } = useTheme();
  const [status, say, toast] = useStatus();

  const activeRef = useRef(active);
  activeRef.current = active;
  // The registry reads the latest state through a ref, so commands are registered once.
  const measuresRef = useRef(new Map<string, { area: number; bbox: Box3 }>());
  const live = useRef({ doc, parts, marker, at, selection, tool, dialogOpen: false, sketching: false, placing: false });
  live.current = {
    doc,
    parts,
    marker,
    at,
    selection,
    tool,
    dialogOpen: paletteOpen || shortcutsOpen || aboutOpen || whatsNew.open || exportOpen || report !== null,
    sketching: live.current.sketching,
    placing: live.current.placing,
  };
  const [registry] = useState(() =>
    createRegistry((): CommandContext => ({
      hasSelection: live.current.selection.length > 0,
      inSketch: live.current.sketching,
      toolActive: live.current.tool !== "select",
      canUndo: store.canUndo(),
      canRedo: store.canRedo(),
      dialogOpen: live.current.dialogOpen,
    })),
  );
  // Re-render when commands are added or run, so enabled states stay fresh.
  useSyncExternalStore(registry.subscribe, registry.version);

  // The action log for problem reports (#109): commands as they run, and timeline edits by feature id and type.
  useEffect(() => registry.onRun((id) => actionLog.record({ id })), [registry]);
  useEffect(() => {
    let before = store.get();
    return store.subscribe(() => {
      const now = store.get();
      if (now === before) return;
      const detail = editSummary(before, now);
      before = now;
      if (detail) actionLog.record({ id: "edit", detail });
    });
  }, [store]);
  useEffect(() => {
    const off = onCaught((c) => setCrash(c));
    const unwatch = watchWindow();
    return () => {
      off();
      unwatch();
    };
  }, []);

  // Drop selected ids that no longer exist (after undo, delete, open).
  useEffect(() => {
    setSelection((s) => {
      const kept = s.filter((id) => parts.some((p) => p.id === id));
      return kept.length === s.length ? s : kept;
    });
  }, [parts]);

  // After an undo the marker can sit past the end; it then follows the end again.
  useEffect(() => {
    if (marker !== null && marker >= featureCount) setMarker(null);
  }, [marker, featureCount]);

  /**
   * Records a modelling change. New features go in at the marker when the model is rolled back, and the marker moves
   * past them, the way Fusion inserts into the timeline.
   */
  const record = useCallback(
    (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => {
      const before = store.get().features.length;
      const m = live.current.marker;
      store.edit((d) => fn(d, m ?? undefined), label, coalesceKey);
      const grew = store.get().features.length - before;
      if (grew > 0 && m !== null) setMarker(Math.min(m, before) + grew);
    },
    [store],
  );

  const moveMarker = useCallback(
    (to: number) => {
      const n = store.get().features.length;
      const clamped = Math.max(0, Math.min(n, to));
      setMarker(clamped >= n ? null : clamped);
    },
    [store],
  );

  const vp = useViewport({
    doc,
    parts,
    selection,
    setSelection,
    tool,
    theme: resolved,
    record,
    editDoc: store.edit,
    say,
  });
  live.current.dialogOpen ||= vp.namingOpen;

  // Render (#197): a path-traced picture over the view. It starts from the modelling camera, and the modelling view
  // follows wherever you orbited it when you come back.
  const openRender = (style?: RenderStyle) => {
    renderCam.current = vp.ref.current?.camera() ?? null;
    setRender(renderSession(style));
  };
  const closeRender = () => {
    const c = renderCam.current;
    setRender(null);
    if (c) vp.ref.current?.setCamera(c, false);
  };
  const onRenderCamera = useCallback((c: CameraState) => {
    renderCam.current = c;
  }, []);
  // Called straight from the click, before the picture is ready, so the browser still lets it ask where to save.
  const saveRender = async (png: Promise<Blob>, size: SaveSize) => {
    const name = `${live.current.doc.name}${size === "view" ? "" : size === "double" ? " 2x" : " 4K"}.png`;
    const saved = await files.store.saveFiles([{ name, data: png.then((b) => b.arrayBuffer()), mime: "image/png" }]);
    if (saved) say(`Saved ${saved.names[0]}`);
  };
  const renderBodies = useMemo<RenderBody[]>(
    () =>
      render
        ? parts
            .filter((p) => !p.hidden && !p.hole)
            .flatMap((p) => {
              const b = kernel.bodies.get(p.id);
              return b ? [{ id: p.id, mesh: b.mesh, matrix: new Matrix4(), colour: p.colour, finish: p.finish, catalogue: p.catalogue }] : [];
            })
        : [],
    [render, parts, kernel.bodies],
  );
  useEffect(() => registry.register(vp.commands), [registry, vp.commands]);

  const shownSketches = useMemo(() => built.sketches.filter((s) => !doc.looks[s.id]?.hidden), [built.sketches, doc.looks]);
  const browserConstruct = useMemo(
    () =>
      doc.features.slice(0, at).flatMap((f) =>
        f.type === "construct" && !f.suppressed
          ? [
              {
                id: f.id,
                name: f.name,
                what: kindInfo(f.kind).what,
                hidden: !!doc.looks[f.id]?.hidden,
                warning: failed.get(f.id),
                component: (doc.owners && f.id in doc.owners ? doc.owners[f.id] : f.component) ?? undefined,
              },
            ]
          : [],
      ),
    [doc.features, doc.looks, doc.owners, at, failed],
  );
  const browserSketches = useMemo(
    () => built.sketches.map((s) => ({ id: s.id, name: s.name, hidden: !!doc.looks[s.id]?.hidden, warning: failed.get(s.id), component: s.component })),
    [built.sketches, doc.looks, failed],
  );
  const sketch = useSketch({
    store,
    record,
    doc,
    built: shownSketches,
    view: vp.ref,
    picking: tool === "sketch",
    onStarted: () => setTool("select"),
    say,
    theme: resolved,
    construct: built.construct,
    onConstructHover: (id) => setConstructHover(id),
  });
  live.current.sketching = sketch.editing;
  useEffect(() => registry.register(sketch.commands), [registry, sketch.commands]);

  /** The built bodies' boxes, for the bodies an extrude cut touches. */
  const bounds = useMemo(() => new Map([...kernel.bodies].map(([id, b]) => [id, b.measure.bbox])), [kernel.bodies]);
  const extrude = useExtrude({
    kind: "extrude",
    store,
    record,
    doc,
    sketches: built.sketches,
    parts,
    bounds,
    selection,
    view: vp.ref,
    active: tool === "extrude" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
    theme: resolved,
  });
  useEffect(() => registry.register(extrude.commands), [registry, extrude.commands]);

  const revolve = useExtrude({
    kind: "revolve",
    store,
    record,
    doc,
    sketches: built.sketches,
    parts,
    bounds,
    selection,
    view: vp.ref,
    active: tool === "revolve" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
    theme: resolved,
    construct: built.construct,
    // Declared further down; called only on pointer moves, after the first render.
    onConstructHover: (id) => setConstructHover(id),
  });
  useEffect(() => registry.register(revolve.commands), [registry, revolve.commands]);

  // While an extrude or revolve changes bodies, the bodies it changes are the selection, so they light up in the view
  // and the browser; a click on a body in the browser picks it for the step instead of selecting it.
  const profileStep = extrude.targeting ? extrude : revolve.targeting ? revolve : null;
  const stepTargets = profileStep?.targets.join(" ");
  useEffect(() => {
    if (stepTargets) setSelection(stepTargets.split(" "));
  }, [stepTargets]);
  useEffect(() => {
    void loadExtrudeBar();
    void loadSketchUI();
  }, []);
  const selectFromBrowser = useCallback(
    (ids: string[]) => {
      if (!profileStep) return setSelection(ids);
      if (ids.length === 1) profileStep.toggleTarget(ids[0]!);
      else if (ids.length) profileStep.setTargets(ids);
    },
    [profileStep],
  );

  const pushpull = usePushPull({
    store,
    record,
    doc,
    parts,
    view: vp.ref,
    active: tool === "pushpull" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
  });

  const measure = useMeasure({ doc, parts, view: vp.ref, active: tool === "measure" && !sketch.editing, measure: kernel.measure });

  const hole = useHole({
    store,
    record,
    doc,
    parts,
    view: vp.ref,
    active: tool === "hole" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
  });

  const mount = useMount({
    store,
    record,
    doc,
    parts,
    view: vp.ref,
    active: tool === "mount" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
  });

  const gear = useGear({
    store,
    record,
    doc,
    view: vp.ref,
    active: tool === "gear" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
  });

  // The Joint tool (#172) loads with its panel; the editor keeps what Enter, the help line and the timeline need.
  const jointApi = useRef<JointSession | null>(null);
  const [jointUi, setJointUi] = useState<JointUi | null>(null);
  const [jointEdit, setJointEdit] = useState<string | null>(null);
  const jointEdited = useCallback(() => setJointEdit(null), []);
  const jointHelp = tool === "joint" ? (jointUi?.help ?? null) : null;

  // Construction geometry (#265): the Construct menu arms the tool for one kind.
  const [constructKind, setConstructKind] = useState<ConstructKind | null>(null);
  const [constructHover, setConstructHover] = useState<string | null>(null);
  const construct = useConstruct({
    store,
    record,
    doc,
    parts,
    construct: built.construct,
    view: vp.ref,
    armed: tool === "construct" && !sketch.editing,
    kind: tool === "construct" ? constructKind : null,
    onClose: () => setTool("select"),
    say,
    onHover: setConstructHover,
    measure: kernel.measure,
  });
  const startConstruct = useCallback((k: ConstructKind) => {
    setConstructKind(k);
    setTool("construct");
  }, []);

  // Posing (#173): a live pose while a slider moves, kept in the model when it stops. Shown with the Select tool only, so
  // tools that pick and move bodies work on them where they really are.
  const [livePose, setLivePose] = useState<Pose | null>(null);
  const pose = livePose ?? doc.pose;
  const livePoseRef = useRef(livePose);
  livePoseRef.current = livePose;
  const posing = tool === "select" && !sketch.editing;
  // Drive links (#194): the pose keeps the driving joints' values; the driven ones follow.
  const shownPose = useMemo(() => resolvePose(built.drives, pose), [built.drives, pose]);
  const linkMoves = useMemo(() => linkTransforms(built.joints, shownPose, built.components), [built.joints, shownPose, built.components]);
  const drivesRef = useRef({ joints: built.joints, drives: built.drives });
  drivesRef.current = { joints: built.joints, drives: built.drives };
  const changePose = useCallback(
    (id: string, value: number) =>
      setLivePose((p) => {
        const now = { ...(p ?? live.current.doc.pose) };
        const { joints, drives } = drivesRef.current;
        const to = driveTo(joints, drives, now, id, value);
        if (to.id !== id) delete now[id];
        return { ...now, [to.id]: to.value };
      }),
    [],
  );
  const commitPose = useCallback(
    (id: string, value: number) => {
      // A shared or old version can still be posed; the pose just isn't kept.
      if (store.isLocked()) return changePose(id, value);
      const name = live.current.doc.features.find((f) => f.id === id)?.name ?? "the joint";
      store.edit((d) => setPose(d, id, value), `Move ${name}`, `pose-${id}`);
      store.seal();
      setLivePose(null);
    },
    [store, changePose],
  );
  const homeJoints = useCallback(() => {
    setLivePose(null);
    if (!store.isLocked() && live.current.doc.pose) store.edit(homePose, "Move the joints home");
    say("The joints are home");
  }, [store, say]);
  // Named poses (#177): going to one moves the joints there over 300 ms (at once with reduced motion), as one undo step.
  const poseAnim = useRef(0);
  useEffect(() => () => cancelAnimationFrame(poseAnim.current), []);
  const goToPose = useCallback(
    (id: string | null) => {
      const d = live.current.doc;
      const found = id ? namedPoseValues(d, id) : { values: {}, dropped: [] };
      if (!found) return;
      const name = id ? (d.poses?.find((x) => x.id === id)?.name ?? "the pose") : "Home";
      const target = found.values;
      const from: Pose = { ...(livePoseRef.current ?? d.pose) };
      const finish = () => {
        if (store.isLocked()) return setLivePose(target);
        store.edit((x) => ({ ...x, pose: Object.keys(target).length ? target : undefined }), `Go to ${name}`);
        store.seal();
        setLivePose(null);
      };
      const n = found.dropped.length;
      say(n ? `Went to ${name}. ${n === 1 ? "1 joint it had is" : `${n} joints it had are`} gone, so left out.` : `Went to ${name}`);
      cancelAnimationFrame(poseAnim.current);
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return finish();
      const keys = [...new Set([...Object.keys(from), ...Object.keys(target)])];
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 300);
        const e = t * t * (3 - 2 * t);
        if (t >= 1) return finish();
        setLivePose(Object.fromEntries(keys.map((k) => [k, (from[k] ?? 0) + ((target[k] ?? 0) - (from[k] ?? 0)) * e])));
        poseAnim.current = requestAnimationFrame(step);
      };
      poseAnim.current = requestAnimationFrame(step);
    },
    [store, say],
  );
  const samePose = (a: Pose | undefined, b: Pose | undefined) => {
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) if (Math.abs((a?.[k] ?? 0) - (b?.[k] ?? 0)) > 1e-6) return false;
    return true;
  };
  const atPose = livePose ? null : samePose(doc.pose, {}) ? "home" : (doc.poses?.find((x) => samePose(doc.pose, x.values))?.id ?? null);
  const posesProps = {
    poses: doc.poses?.map((x) => ({ id: x.id, name: x.name })),
    atPose,
    onPose: goToPose,
    onSavePose: () => handlers.current.savePose(),
    onUpdatePose: (id: string) => {
      const x = live.current.doc.poses?.find((q) => q.id === id);
      if (!x) return;
      store.edit((d) => savePose(d, { ...x, values: d.pose ?? {} }), `Update ${x.name}`);
      say(`Updated ${x.name} to the joints now`);
    },
    onRenamePose: (id: string, name: string) => {
      const x = live.current.doc.poses?.find((q) => q.id === id);
      if (x && name.trim() && name !== x.name) store.edit((d) => savePose(d, { ...x, name: name.trim() }), `Rename ${x.name}`);
    },
    onDeletePose: (id: string) => {
      const x = live.current.doc.poses?.find((q) => q.id === id);
      if (!x) return;
      store.edit((d) => removePose(d, id), `Delete ${x.name}`);
      say(`Deleted ${x.name}`);
    },
  };
  // Dragging a link in the view (#173): a body in a link that hangs on a joint that moves turns or slides it. Esc puts
  // it back where the drag started.
  const [poseDrag, setPoseDrag] = useState<{ cancel: () => void } | null>(null);
  // The drag maths loads once the model has a joint, keeping it out of the first paint.
  const dragMaths = useRef<typeof import("../joint/poseDrag") | null>(null);
  const hasJoints = built.joints.length > 0;
  useEffect(() => {
    if (hasJoints && !dragMaths.current) void import("../joint/poseDrag").then((m) => (dragMaths.current = m));
  }, [hasJoints]);
  useEscape(poseDrag !== null, () => poseDrag?.cancel(), ESC.drag);
  const poseState = useRef({ joints: built.joints, parts, moves: linkMoves, pose: shownPose, livePose, raw: pose, tools: doc.tools });
  poseState.current = { joints: built.joints, parts, moves: linkMoves, pose: shownPose, livePose, raw: pose, tools: doc.tools };
  // Tool points (#176): click a point on a link to drag the arm by; the solver loads once one is wanted.
  const [toolPick, setToolPick] = useState(false);
  const ikMaths = useRef<typeof import("../joint/ikDrag") | null>(null);
  const [hasIk, setHasIk] = useState(false);
  const hasTools = !!doc.tools?.length;
  useEffect(() => {
    if ((hasTools || toolPick) && !ikMaths.current)
      void import("../joint/ikDrag").then((m) => {
        ikMaths.current = m;
        setHasIk(true);
      });
  }, [hasTools, toolPick]);
  useEscape(
    toolPick,
    () => {
      setToolPick(false);
      say("Put the tool point down");
    },
    ESC.tool,
  );
  const takePoint = useCallback(
    (hit: { body: string; point: [number, number, number] } | null) => {
      setToolPick(false);
      const { joints, parts: all, moves } = poseState.current;
      const link = hit ? all.find((p) => p.id === hit.body)?.link : undefined;
      if (!hit || !link || !joints.some((j) => j.child === link)) {
        say("Pick a point on a link that hangs on a joint", true);
        return true;
      }
      const m = moves.get(link);
      void import("../joint/ikDrag").then((ik) => {
        const home = m ? ik.homeOf(m, hit.point) : hit.point;
        const name = live.current.doc.features.find((f) => f.id === link)?.name ?? "the link";
        store.edit((d) => ik.setToolPoint(d, link, home), "Set the tool point");
        store.seal();
        say(`Set the tool point on ${name}. Drag ${name} to move the arm.`);
      });
      return true;
    },
    [store, say],
  );
  /** Starts an arm drag by a link's tool point (#176): by the pointer on the link, or by the gizmo's arrows. */
  const ikDrag = useCallback(
    <D extends { cancel(): void }>(
      link: string,
      make: (ik: typeof import("../joint/ikDrag"), problem: IkProblem, start: Pose, hooks: IkDragHooks) => D,
    ): D | null => {
      const { joints, raw, livePose: before, tools } = poseState.current;
      const tool = tools?.find((t) => t.link === link);
      const ik = ikMaths.current;
      if (!tool || !ik) return null;
      const problem = { joints, drives: drivesRef.current.drives, link, point: tool.point, locked: tool.locked };
      const finish = () => setPoseDrag(null);
      const drag = make(ik, problem, raw ?? {}, {
        show: setLivePose,
        commit: (kept, miss) => {
          finish();
          if (store.isLocked()) setLivePose(kept);
          else {
            store.edit((d) => ({ ...d, pose: Object.keys(kept).length ? kept : undefined }), "Move the arm", "pose-ik");
            store.seal();
            setLivePose(null);
          }
          if (miss >= 1) say(`Out of reach by ${Math.round(miss)} mm`);
        },
        revert: (cancelled) => {
          finish();
          setLivePose(before);
          if (cancelled) say("Put the arm back");
        },
      });
      setPoseDrag({ cancel: () => drag.cancel() });
      return drag;
    },
    [store, say],
  );
  const bodyDrag = useCallback(
    (pick: { body: string }, at: { x: number; y: number }): BodyDrag | null => {
      const { joints, parts: all, moves, pose: now, livePose: before, tools } = poseState.current;
      const link = all.find((p) => p.id === pick.body)?.link;
      if (link && tools?.some((t) => t.link === link)) {
        const view = vp.ref.current?.engine();
        return view ? ikDrag(link, (ik, problem, start, hooks) => ik.ikDrag(problem, start, view, at, hooks)) : null;
      }
      const j = link ? joints.find((x) => x.child === link && movable(x)) : undefined;
      const engine = vp.ref.current?.engine();
      const maths = dragMaths.current;
      if (!j || !engine || !maths) return null;
      const frame = posedFrames([j], moves).get(j.id) ?? j;
      const start = jointValue(j, now);
      const drag = maths.startDrag(
        { ...j, ...frame },
        { project: (p) => engine.project(p), towards: engine.towards(), ray: (p) => engine.ray(p.x, p.y) },
        at,
        start,
      );
      let value = start;
      let done = false;
      const finish = () => {
        done = true;
        setPoseDrag(null);
      };
      const cancel = () => {
        if (done) return;
        finish();
        setLivePose(before);
        say(`Put ${j.name} back`);
      };
      setPoseDrag({ cancel });
      return {
        move: (p, mods) => {
          if (done) return;
          value = drag.at(p, mods.alt);
          changePose(j.id, value);
        },
        end: () => {
          if (done) return;
          finish();
          if (value !== start) commitPose(j.id, value);
          else setLivePose(before);
        },
        cancel,
      };
    },
    [vp.ref, changePose, commitPose, say, ikDrag],
  );
  useEffect(() => {
    const eng = vp.ref.current?.engine();
    const tools = doc.tools ?? [];
    if (!posing || !tools.length) return eng?.setTools(null);
    eng?.setTools(
      tools.map((t) => {
        const m = linkMoves.get(t.link);
        return m ? mat4Apply(m, t.point) : t.point;
      }),
    );
  }, [doc.tools, linkMoves, posing, vp.ref]);
  // The move gizmo sits on the tool point of the selected link, or on the only one (#176): its arrows hold the drag to an
  // axis, its squares to a plane.
  const gizmoTool = useMemo(() => {
    const tools = doc.tools ?? [];
    const picked = parts.find((p) => selection.includes(p.id) && tools.some((t) => t.link === p.link))?.link;
    return tools.find((t) => t.link === picked) ?? (tools.length === 1 ? tools[0] : undefined);
  }, [doc.tools, parts, selection]);
  useEffect(() => {
    const eng = vp.ref.current?.engine();
    if (!eng) return;
    if (!posing || !gizmoTool || !hasIk) return eng.setPointGizmo(null);
    const m = linkMoves.get(gizmoTool.link);
    let drag: ReturnType<typeof import("../joint/ikDrag").ikGizmoDrag> | null = null;
    eng.setPointGizmo(m ? mat4Apply(m, gizmoTool.point) : gizmoTool.point, {
      start: () => (drag = ikDrag(gizmoTool.link, (ik, problem, start, hooks) => ik.ikGizmoDrag(problem, start, hooks))),
      move: (p) => drag?.move(p),
      end: () => drag?.end(),
    });
  }, [gizmoTool, linkMoves, posing, hasIk, ikDrag, vp.ref]);
  useEffect(() => {
    const moves = new Map<string, Matrix4>();
    if (posing)
      for (const l of built.links) {
        const m = linkMoves.get(l.id);
        if (m) for (const id of l.parts) moves.set(id, new Matrix4().fromArray(m));
      }
    vp.ref.current?.engine()?.setPose(moves);
  }, [posing, linkMoves, built.links, vp.ref]);

  // Joint glyphs in the view (#172), each with its own eye in the browser (saved in looks, as a sketch's is). They ride on
  // the pose; hiding one hides its arrow, not the parts it moves.
  const browserJoints = useMemo(() => built.joints.map((j) => ({ ...j, hidden: !!doc.looks[j.id]?.hidden })), [built.joints, doc.looks]);
  useEffect(() => {
    const frames = posing ? posedFrames(built.joints, linkMoves) : null;
    vp.ref.current?.engine()?.setJoints(browserJoints.filter((j) => !j.hidden).map((j) => frames?.get(j.id) ?? j));
  }, [built.joints, browserJoints, vp.ref, posing, linkMoves]);

  // Play (#194): turn a driving joint through its range, out and back (a wheel a whole turn), to watch the drive. It
  // poses live only, and Esc or Stop puts the pose back.
  const [playing, setPlaying] = useState<string | null>(null);
  useEscape(playing !== null, () => setPlaying(null), ESC.drag);
  useEffect(() => {
    if (!playing) return;
    const j = drivesRef.current.joints.find((x) => x.id === playing);
    if (!j) return setPlaying(null);
    const before = livePoseRef.current;
    const lo = Math.min(j.lower, j.upper);
    const hi = Math.max(j.lower, j.upper);
    const wheel = j.kind === "continuous";
    const ms = 4000;
    const t0 = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      // Home, out to one end, across to the other, and home again; a wheel turns once.
      const s = Math.sin(k * 2 * Math.PI);
      const v = wheel ? k * 360 : s >= 0 ? s * hi : -s * lo;
      changePose(j.id, k >= 1 ? 0 : v);
      if (k < 1) frame = requestAnimationFrame(tick);
      else setPlaying(null);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setLivePose(before);
    };
  }, [playing, changePose]);
  const play = useCallback(
    (id: string | null) => {
      setPlaying(id);
      if (id) say(`Playing ${drivesRef.current.joints.find((j) => j.id === id)?.name ?? "the joint"}. Esc stops.`);
    },
    [say],
  );
  const [driveDialog, setDriveDialog] = useState<{ editing?: DriveFeature } | null>(null);
  const saveDrive = useCallback(
    (p: DriveParams) => {
      const editing = driveDialog?.editing;
      setDriveDialog(null);
      if (editing) {
        store.edit((d) => updateDrive(d, editing.id, p), `Change ${editing.name}`);
        return say(`Changed ${editing.name}`);
      }
      const id = newId("f");
      const name = addDrive(live.current.doc, p, id).features.find((f) => f.id === id)!.name;
      record((d, at) => addDrive(d, p, id, at), `Add ${name}`);
      say(`Added ${name}. Move either joint and the other follows.`);
    },
    [driveDialog, store, record, say],
  );

  const [patternStart, setPatternStart] = useState<PatternKind | null>(null);
  /** The step picked on the timeline (set below, once it is worked out): Pattern and Mirror start on that feature. */
  const pickedStepRef = useRef<string | null>(null);
  const pattern = usePattern({
    store,
    record,
    doc,
    selection,
    setSelection,
    parts,
    links: built.links,
    construct: built.construct,
    upTo: at,
    pickedStep: () => pickedStepRef.current,
    view: vp.ref,
    active: tool === "pattern" && !sketch.editing,
    startKind: patternStart,
    onClose: () => setTool("select"),
    say,
  });
  /** Mirror (#69): the Pattern tool, starting as a mirror. */
  const mirror = useCallback(() => {
    setPatternStart("mirror");
    setTool((t) => (t === "pattern" ? t : "pattern"));
  }, []);
  useEffect(() => {
    if (tool !== "pattern") setPatternStart(null);
  }, [tool]);
  const mirrorOn = tool === "pattern" && pattern.kind === "mirror";
  // Planes, axes and points in the view: those not hidden from the browser, the origin's axes and point while the tool
  // wants one or the browser shows them, lit under the pointer or when picked in the browser.
  const shownConstruct = useMemo(() => built.construct.filter((c) => !doc.looks[c.id]?.hidden), [built.construct, doc.looks]);
  const patternAxis =
    tool === "pattern" && pattern.feature?.kind === "circle" && !pattern.feature.axisStep ? `origin:${pattern.feature.axis.toUpperCase()}` : null;
  const jointAxis = tool === "joint" && jointUi?.stage === "parent";
  useEffect(() => {
    const eng = vp.ref.current?.engine();
    if (!eng) return;
    const shapes = shownConstruct.map((c) =>
      c.geo.what === "plane"
        ? { id: c.id, what: c.geo.what, origin: c.geo.frame.origin, x: c.geo.frame.x, normal: c.geo.frame.normal }
        : c.geo.what === "axis"
          ? { id: c.id, what: c.geo.what, origin: c.geo.origin, dir: c.geo.dir }
          : { id: c.id, what: c.geo.what, origin: c.geo.at },
    );
    // An origin axis picked in the browser lights as `origin:X`.
    const pickedAxis = axisOf(browserPicked ?? "");
    const picked = pickedAxis ? `origin:${pickedAxis}` : browserPicked;
    const lit = [constructHover, picked, construct.session?.id, revolve.axisShape, patternAxis].filter((x): x is string => !!x);
    // The sketch's Dimension tool, Revolve, a round Pattern and Joint can use an axis too, so the origin's show while
    // they want one; Revolve and Pattern keep the one they turn round. The browser's eyes keep the rest on show.
    const want = construct.active
      ? construct.slot
      : (sketch.editing && sketch.stool === "dimension") || revolve.pickingAxis || pattern.pickingAxis || jointAxis
        ? "line"
        : null;
    const keep = new Set([revolve.axisShape, patternAxis, picked, ...originShown.filter((x) => (AXES as string[]).includes(x)).map((a) => `origin:${a}`)]);
    const all = [...(want ? originShapes(want) : []), ...originShapes("line").filter((o) => keep.has(o.id))];
    const origin = [...new Map(all.map((o) => [o.id, o])).values()];
    eng.setConstruct([...shapes, ...origin], lit);
  }, [
    shownConstruct,
    constructHover,
    browserPicked,
    construct.active,
    construct.slot,
    construct.session,
    revolve.pickingAxis,
    revolve.axisShape,
    pattern.pickingAxis,
    patternAxis,
    jointAxis,
    originShown,
    vp.ref,
    kernel.bodies,
    sketch.editing,
    sketch.stool,
  ]);
  /** The top bar's Mirror and Pattern: each switches an open one to its kind, and closes its own. */
  const toolbarPattern = (mirroring: boolean) => {
    if (tool === "pattern" && mirrorOn === mirroring) return setTool("select");
    if (tool === "pattern" && pattern.feature) return pattern.change({ kind: mirroring ? "mirror" : "rect" });
    setPatternStart(mirroring ? "mirror" : null);
    setTool("pattern");
  };

  const place = usePlacePart({ record, view: vp.ref, select: setSelection, say });
  live.current.placing = !!place.part;

  const finish = useFinish({
    record,
    update: (fn, label) => store.edit(fn, label),
    parts,
    meshes: kernel.bodies,
    doc,
    at,
    view: vp.ref,
    tool: sketch.editing ? null : tool === "fillet" || tool === "shell" ? tool : null,
    onClose: () => setTool("select"),
    say,
  });
  const finishPreview = usePreview(kernel.call, finish.preview);
  // Combine shows its result as the bodies are picked and the settings change.
  const combineRequest = useMemo<PreviewRequest | null>(() => {
    const [target, ...tools] = selection;
    if (tool !== "combine" || sketch.editing || !target || !tools.length) return null;
    const params = combineParams(target, tools, combineOp, keepTools, combineFit, doc.print);
    return { doc: addCombine(doc, params, PREVIEW_ID, at), upTo: at + 1, step: PREVIEW_ID, show: [target], dim: keepTools ? [] : tools };
  }, [tool, sketch.editing, selection, combineOp, keepTools, combineFit, doc, at]);
  const combinePreview = usePreview(kernel.call, combineRequest);
  const preview = finish.preview ? finishPreview.bodies : combineRequest ? combinePreview.bodies : null;
  // While sketching the model goes faint, so the sketch reads on top of it. Project needs the faces solid to pick them.
  const ghostParts = sketch.editing && sketch.stool !== "project";
  // Picking a Mirror's plane passes over the mirror's own copies, so a face under one can be picked.
  const planeGhosts = useMemo(
    () => new Set(pattern.pickingPlane && pattern.feature ? patternCopyIds(pattern.feature) : []),
    [pattern.pickingPlane, pattern.feature],
  );
  const viewParts = useMemo(
    () => parts.map((p) => (ghostParts || p.hole || planeGhosts.has(p.id) ? { ...p, ghost: true } : p)),
    [parts, ghostParts, planeGhosts],
  );
  const onCamera = vp.onCamera;
  const sketchCamera = sketch.onCamera;
  const tourCamera = useRef<() => void>(() => undefined);
  const composedCamera = useCallback(
    (c: Parameters<typeof onCamera>[0]) => {
      onCamera(c);
      sketchCamera();
      tourCamera.current();
    },
    [onCamera, sketchCamera],
  );

  const renameModel = useCallback(
    (name: string) => {
      const n = name.trim();
      if (n && n !== store.get().name) store.edit((d) => ({ ...d, name: n }), "Rename model");
    },
    [store],
  );

  const showPanel = useCallback((id: PanelId | null) => {
    setPanel(id);
    if (id && window.matchMedia?.(NARROW).matches) setPropsOpen(false);
  }, []);

  const doUndo = useCallback(() => {
    if (!store.canUndo()) return;
    say(`Undid ${store.undoLabel().toLowerCase()}`);
    store.undo();
  }, [store, say]);
  const doRedo = useCallback(() => {
    if (!store.canRedo()) return;
    say(`Redid ${store.redoLabel().toLowerCase()}`);
    store.redo();
  }, [store, say]);

  const add = useCallback(
    (kind: PartKind) => {
      const id = newId();
      record((d, at) => addPart(d, kind, id, at), `Add ${KIND_LABEL[kind].toLowerCase()}`);
      setSelection([id]);
      if (!window.matchMedia?.(NARROW).matches) setPanel("parts");
      say(`Added a ${KIND_LABEL[kind].toLowerCase()}`);
    },
    [record, say],
  );

  const remove = useCallback(
    (ids: string[]) => {
      const gone = live.current.parts.filter((p) => ids.includes(p.id));
      if (!gone.length) return;
      const what = gone.length === 1 ? gone[0]!.name : `${gone.length} parts`;
      record((d, at) => removeParts(d, ids, at), `Delete ${what}`);
      setSelection((s) => s.filter((id) => !ids.includes(id)));
      say(`Deleted ${what}. ${formatCombo("mod+z")} brings it back.`);
    },
    [record, say],
  );

  // Components (#171, Fusion's): the active one gets the bodies, sketches and construction made while it's active.
  // It's view state, as the marker is; a component that's gone or rolled past leaves the model active.
  const [activeComp, setActiveComp] = useState<string | null>(null);
  const workIn = activeComp && built.components.some((c) => c.id === activeComp) ? activeComp : null;
  useEffect(() => {
    store.setStamp(workIn ? (before, after) => stampComponent(before, after, workIn) : null);
    return () => store.setStamp(null);
  }, [store, workIn]);
  const activate = useCallback(
    (id: string | null) => {
      setActiveComp(id);
      const c = live.current.doc.features.find((f) => f.id === id);
      say(c ? `${c.name} is active. What you make now goes into it.` : "The model is active.");
    },
    [say],
  );
  // Drag into a component (#334): bodies, sketches, construction and components, by id. One undo step.
  const moveIn = useCallback(
    (ids: string[], to: string | null) => {
      if (!ids.length) return;
      const d = live.current.doc;
      const name = (id: string | null) =>
        id === null ? d.name : (live.current.parts.find((x) => x.id === id)?.name ?? d.features.find((f) => f.id === id)?.name ?? "it");
      const what = ids.length === 1 ? name(ids[0]!) : `${ids.length} items`;
      store.edit((x) => moveInto(x, ids, to), `Move ${what} ${to === null ? "to" : "into"} ${name(to)}`);
    },
    [store],
  );
  // New component: of the selected bodies, kept as separate bodies, or an empty one to work in, which becomes active.
  // Either sits inside the active component.
  const makeLink = useCallback(
    (ids: string[]) => {
      const id = newId("f");
      const parent = workIn ?? undefined;
      const name = addLink(live.current.doc, ids, id, undefined, parent).features.find((f) => f.id === id)!.name;
      // The bodies leave wherever they were dragged to (#334): the new component takes them.
      const unmove = (d: ModelDoc) =>
        d.owners && ids.some((x) => x in d.owners!) ? { ...d, owners: Object.fromEntries(Object.entries(d.owners).filter(([k]) => !ids.includes(k))) } : d;
      record((d, at) => addLink(unmove(d), ids, id, at, parent), `Make ${name}`);
      if (!ids.length) return activate(id);
      say(`Made ${name} of ${ids.length === 1 ? "1 body" : `${ids.length} bodies`}. They stay separate bodies.`);
    },
    [record, say, workIn, activate],
  );
  const selectLink = useCallback(
    (ids: string[]) => {
      const part = live.current.parts.find((p) => ids.includes(p.id) && p.link);
      if (!part) return say("That body isn't in a component", true);
      setSelection(live.current.parts.filter((p) => p.link === part.link).map((p) => p.id));
    },
    [say],
  );

  const duplicate = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const copies = ids.map(() => newId());
      record((d, at) => duplicateParts(d, ids, copies, at), ids.length === 1 ? "Duplicate" : `Duplicate ${ids.length} parts`);
      setSelection(copies);
    },
    [record],
  );

  const toggle = useCallback(
    (ids: string[], what: Exclude<RowToggle, "active">) => {
      const chosen = live.current.parts.filter((p) => ids.includes(p.id));
      if (!chosen.length) return;
      const on = !chosen.every((p) => !!p[what]);
      const verb = { hidden: on ? "Hide" : "Show", ghost: on ? "Ghost" : "Unghost", highlight: on ? "Highlight" : "Clear highlight on" }[what];
      store.edit((d) => setLook(d, ids, () => ({ [what]: on })), `${verb} ${chosen.length === 1 ? chosen[0]!.name : `${chosen.length} parts`}`);
    },
    [store],
  );

  /** The browser's folder eyes and sketch eyes: hide or show many at once, as one undo step. */
  const setHidden = useCallback(
    (ids: string[], hidden: boolean, what: "parts" | "sketches", name?: string) => {
      if (!ids.length) return;
      const one =
        name ?? (ids.length === 1 ? (live.current.parts.find((p) => p.id === ids[0])?.name ?? store.get().features.find((f) => f.id === ids[0])?.name) : null);
      store.edit((d) => setLook(d, ids, () => ({ hidden })), `${hidden ? "Hide" : "Show"} ${one ?? `${ids.length} ${what}`}`);
    },
    [store],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      const p = live.current.parts.find((x) => x.id === id);
      const clean = name.trim();
      if (!p || !clean || clean === p.name) return;
      store.edit((d) => setLook(d, [id], () => ({ name: clean })), `Rename ${p.name}`);
    },
    [store],
  );

  /** Group (Tinkercad): the selected solids joined and the holes cut, as one step. */
  const group = useCallback(
    (ids: string[]) => {
      const params = groupParams(live.current.parts, ids, live.current.doc.print);
      if (typeof params === "string") return say(params, true);
      const id = newId("f");
      record((d, at) => addCombine(d, params, id, at), "Group");
      setSelection([params.target]);
      say(`Grouped ${ids.length} bodies. ${formatCombo("shift+mod+g")} ungroups them.`);
    },
    [record, say],
  );

  const ungroup = useCallback(
    (ids: string[]) => {
      const d = store.get();
      const f = ids.map((id) => groupOf(d, id, live.current.at)).find(Boolean);
      if (!f) return say("Select a group to ungroup it", true);
      const i = d.features.indexOf(f);
      store.edit((x) => removeFeature(x, f.id), `Ungroup ${f.name}`);
      const m = live.current.marker;
      if (m !== null && i < m) setMarker(m - 1);
      setSelection([f.target, ...f.tools.map((t) => t.id)]);
      say(`Ungrouped ${f.name}`);
    },
    [store, say],
  );

  /** Combine (Fusion): the first picked body keeps, the others join, cut or intersect it. */
  const combine = useCallback(
    (ids: string[], op: CombineOp, keep: boolean, fit: FitChoice = NO_FIT) => {
      const [target, ...tools] = ids;
      if (!target || !tools.length) return say("Select the body to keep, then the bodies to combine with it", true);
      const params = combineParams(target, tools, op, keep, fit, live.current.doc.print);
      record((d, at) => addCombine(d, params, newId("f"), at), "Combine");
      setSelection([target]);
      setTool("select");
      say(`Combined ${tools.length === 1 ? "1 body" : `${tools.length} bodies`}`);
    },
    [record, say],
  );

  const toggleHole = useCallback(
    (ids: string[]) => {
      const chosen = live.current.parts.filter((p) => ids.includes(p.id));
      if (!chosen.length) return;
      const on = !chosen.every((p) => p.hole);
      store.edit((d) => setLook(d, ids, () => ({ hole: on })), on ? "Make a hole" : "Make solid");
      say(on ? `${chosen.length === 1 ? chosen[0]!.name : `${chosen.length} parts`} will cut when grouped` : "Made solid");
    },
    [store, say],
  );

  const referenceInput = useRef<HTMLInputElement>(null);
  /** Reference bodies (#185): shown to design around, never printed or exported. */
  const toggleReference = useCallback(
    (ids: string[]) => {
      const chosen = live.current.parts.filter((p) => ids.includes(p.id));
      if (!chosen.length) return;
      const on = !chosen.every((p) => p.reference);
      store.edit((d) => setLook(d, ids, () => ({ reference: on })), on ? "Make a reference" : "Make printable");
      const who = chosen.length === 1 ? chosen[0]!.name : `${chosen.length} parts`;
      say(on ? `${who} won't print or export` : `${who} will print`);
    },
    [store, say],
  );

  /** The Gear step that made a body, if one did. */
  const gearOf = (id: string) => live.current.doc.features.find((f): f is GearFeature => f.type === "gear" && f.body.id === id);

  const isSpur = (id: string) => (gearOf(id)?.form ?? "spur") === "spur" && !!gearOf(id);

  /** Add mating gear (#192): a gear beside the picked one, meshed, with the bar open to set its teeth. */
  const mateGear = useCallback(
    (id: string) => {
      const a = gearOf(id);
      if (!a || (a.form ?? "spur") !== "spur") return say("Pick a spur gear", true);
      const fid = newId("f");
      record((d, at) => addMatingGear(d, a.id, a.gear.teeth, 0, fid, newId(), at), "Add mating gear", gearKey(fid));
      setTool("gear");
      gear.edit(fid, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, say, gear.edit],
  );

  /** Add rack (#193): a rack meshed under the picked gear, with the bar open on it. */
  const addRackTo = useCallback(
    (id: string) => {
      const a = gearOf(id);
      if (!a || (a.form ?? "spur") !== "spur") return say("Pick a spur gear", true);
      const fid = newId("f");
      record((d, at) => addRack(d, a.id, -90, fid, newId(), at), "Add rack", gearKey(fid));
      setTool("gear");
      gear.edit(fid, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, say, gear.edit],
  );

  /** Fit a belt (#193): the nearest stock GT2 belt round two picked pulleys, the later one moved to suit. */
  const beltPicked = useCallback(
    (ids: string[]) => {
      const [a, b] = ids.map(gearOf);
      if (a?.form !== "gt2" || b?.form !== "gt2") return say("Pick two GT2 pulleys", true);
      const r = fitBelt(live.current.doc, a.id, b.id);
      if (r.error) return say(r.error, true);
      record((d) => fitBelt(d, a.id, b.id).doc, "Fit a belt");
      const need = r.needed ? ` (they needed ${Math.round(r.needed * 10) / 10} mm where they were)` : "";
      say(`Fitted a ${r.length} mm GT2 belt, ${r.length! / 2} teeth${need}. Edit the pulley to pick another.`);
    },
    [record, say],
  );

  /** Mesh gears (#192): the later of two picked gears moves beside the earlier one. */
  const meshPicked = useCallback(
    (ids: string[]) => {
      const [a, b] = ids.map(gearOf);
      if (!a || !b) return say("Pick two gears", true);
      const r = meshGears(live.current.doc, a.id, b.id);
      if (r.error) return say(r.error, true);
      record((d) => meshGears(d, a.id, b.id).doc, "Mesh gears");
      const [small, big] = a.gear.teeth <= b.gear.teeth ? [a, b] : [b, a];
      say(`Meshed ${small.name} with ${big.name}: ${ratioText(big.gear.teeth, small.gear.teeth)}`);
    },
    [record, say],
  );

  /** Cut pocket (#188): the catalogue part's pocket and holes, cut into the body just under it. */
  const pocket = useCallback(
    (id: string) => {
      const part = live.current.parts.find((p) => p.id === id);
      const step = live.current.doc.features.find((f) => f.type === "insert" && f.part.id === id);
      if (!part?.catalogue || !step || step.type !== "insert") return say("Pick a part from the catalogue", true);
      const f = partFrame(step.position, step.rotation);
      const under = f.origin.map((v, i) => v - f.normal[i]! * 0.5);
      const inBox = (b: { min: number[]; max: number[] }) => under.every((v, i) => v >= b.min[i]! - 1e-6 && v <= b.max[i]! + 1e-6);
      const target = live.current.parts.find(
        (p) => p.id !== id && !p.hidden && !p.hole && !p.reference && inBox(measuresRef.current.get(p.id)?.bbox ?? { min: [1, 1, 1], max: [0, 0, 0] }),
      );
      if (!target) return say(`Put the ${part.catalogue.name} on a body first`, true);
      const r = cutPocket(live.current.doc, id, { target: target.id });
      if (r.error) return say(r.error, true);
      record((d, at) => cutPocket(d, id, { target: target.id }, at).doc, "Cut pocket");
      say(`Cut the ${part.catalogue.name}'s pocket into ${target.name}. Edit its steps on the timeline.`);
    },
    [record, say],
  );

  const armTool = useCallback((id: ToolId) => setTool((t) => (t === id && id !== "select" ? "select" : id)), []);

  // What a rendered thumbnail draws: the shown bodies, read when a save finishes.
  const thumbBodies = useRef<() => RenderBody[]>(() => []);
  thumbBodies.current = () =>
    parts
      .filter((p) => !p.hidden && !p.hole)
      .flatMap((p) => {
        const b = kernel.bodies.get(p.id);
        return b ? [{ id: p.id, mesh: b.mesh, matrix: new Matrix4(), colour: p.colour, finish: p.finish, catalogue: p.catalogue }] : [];
      });
  const files = useFiles({
    store,
    doc,
    view: vp.ref,
    say,
    onImport: (list, at) => importFiles(list, at, { call: kernel.call, record, say, select: setSelection }),
    renderBodies: () => thumbBodies.current(),
    onSwitched: () => {
      setMarker(null);
      setSelection([]);
      setActiveFeature(null);
    },
  });
  const { save, saveAs, open, newModel } = files;
  // Build steps: a picture per step and a Markdown guide, in a .zip. Loads on first use.
  const exportBuildSteps = () =>
    void import("../steps/exportSteps").then((m) => m.saveSteps({ doc: live.current.doc, upTo: live.current.at, call: kernel.call, files: files.store, say }));

  // Accounts (#88, #90): open "#/edit/<id>" once we know who is signed in.
  const { api, account, ready: accountReady, available: accountsOn, setAccount } = useAccount();
  const openCloud = useRef(files.openCloud);
  openCloud.current = files.openCloud;
  useEffect(() => {
    if (!model || !accountReady) return;
    if (!account) {
      if (accountsOn) go(`#/signin?next=${encodeURIComponent(`#/edit/${model}`)}`);
      else say("Accounts can't be reached here, so that model can't open", true);
      return;
    }
    openCloud.current(model);
  }, [model, accountReady, account, accountsOn, say]);
  // A share link opens read-only; leaving it goes back to a fresh model.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => {
    if (!share) {
      setInactive(false);
      if (filesRef.current.shared) filesRef.current.leaveShared();
      return;
    }
    filesRef.current.openShared(share).then(
      () => setInactive(false),
      () => setInactive(true),
    );
  }, [share]);
  // The first-run tour (#98).
  const tour = useTour({
    doc,
    store,
    view: vp.ref,
    sketching: sketch.editing,
    enabled: active && !share,
    armTool,
    openExport: () => setExportOpen(true),
    openSample: (id) => filesRef.current.openSample(id),
  });
  tourCamera.current = tour.onCamera;
  // Tips wait for the tour and the What's new card.
  const tips = useTips(active && !share && tour.card === null && !whatsNew.card);
  const showTips = tips.show;
  // "#/sample/<id>": the library's and the tour's sample links.
  useEffect(() => {
    if (sample) filesRef.current.openSample(sample);
  }, [sample]);
  const signOut = useCallback(() => {
    const run = async () => {
      await api.signOut().catch(() => undefined);
      setAccount(null);
      say("Signed out");
    };
    if (files.cloud) files.confirmThen(run);
    else void run();
  }, [api, setAccount, say, files]);
  // Installing the app, and .bcad files it is asked to open (#95).
  const installable = useInstallable();
  const installApp = useCallback(() => {
    void install().then((done) => done && say("Installed BetterCad. Open it from your apps."));
  }, [say]);
  const openLaunched = useCallback(
    (handle: FileHandle) =>
      void handle.getFile().then(
        (file) => filesRef.current.show({ name: handle.name, file, handle }),
        () => say("That file didn't open.", true),
      ),
    [say],
  );
  useLaunchFiles(openLaunched);
  // The empty editor's welcome (#99): only on a model with no steps, never on a share link or while picking a plane.
  const emptyState = doc.features.length === 0 && !share && !files.shared && !files.viewing && tool !== "sketch" && tool !== "gear" && !sketch.editing;
  const dropZone = useDrop({ view: vp.ref, openFiles: files.openFiles });

  // ---- timeline
  const selectFeature = useCallback((f: Feature) => {
    setActiveFeature(f.id);
    const here = new Set(live.current.parts.map((p) => p.id));
    const sel = featureParts(f).filter((id) => here.has(id));
    setSelection(sel);
    return sel;
  }, []);
  /**
   * The step picked on the timeline, with the selection it made. It stays picked until anything else changes the
   * selection, so Delete then deletes the step itself instead of recording a new "delete" step for its parts.
   */
  const [picked, setPicked] = useState<{ id: string; sel: string[] } | null>(null);
  const pickStep = useCallback(
    (f: Feature) => {
      setPicked({ id: f.id, sel: selectFeature(f) });
    },
    [selectFeature],
  );
  const pickedStep = picked && picked.sel === selection && doc.features.some((f) => f.id === picked.id) ? picked.id : null;
  pickedStepRef.current = pickedStep;
  /** A step being changed: its tool is open for it. Sketches use sketch.editingId instead. */
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const renameFeature = useCallback(
    (id: string, name: string) => {
      const f = store.get().features.find((x) => x.id === id);
      const clean = name.trim();
      if (!f || !clean || clean === f.name) return;
      store.edit((d) => updateFeature(d, id, { name: clean }), `Rename ${f.name}`);
    },
    [store],
  );
  const suppressFeature = useCallback(
    (id: string) => {
      const f = store.get().features.find((x) => x.id === id);
      if (!f) return;
      store.edit((d) => updateFeature(d, id, { suppressed: !f.suppressed }), `${f.suppressed ? "Unsuppress" : "Suppress"} ${f.name}`);
      say(f.suppressed ? `${f.name} is built again` : `${f.name} is suppressed: it stays on the timeline but is not built`);
    },
    [store, say],
  );
  /** A delete that would leave other steps without what they need: asks first, non-modally. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const deleteNow = useCallback(
    (id: string, withDependents: boolean) => {
      const d0 = store.get();
      const f = d0.features.find((x) => x.id === id);
      if (!f) return;
      const gone = withDependents ? [id, ...dependents(d0, id).map((x) => x.id)] : [id];
      const m = live.current.marker;
      const before = m === null ? 0 : d0.features.slice(0, m).filter((x) => gone.includes(x.id)).length;
      store.edit((d) => (withDependents ? removeWithDependents(d, id) : removeFeature(d, id)), `Delete ${f.name}`);
      if (m !== null && before) setMarker(m - before);
      setPendingDelete(null);
      say(`Deleted ${gone.length === 1 ? f.name : `${f.name} and ${gone.length - 1} more`}. ${formatCombo("mod+z")} brings it back.`);
    },
    [store, say],
  );
  /** Deleting the last step just deletes it. Anything earlier asks first, since the steps after it rebuild. */
  const deleteFeature = useCallback(
    (id: string) => {
      const d = store.get();
      const i = d.features.findIndex((f) => f.id === id);
      if (i < 0) return;
      if (i < d.features.length - 1) setPendingDelete(id);
      else deleteNow(id, false);
    },
    [store, deleteNow],
  );
  /** After a reorder that may break later steps: what to say on the timeline, until the model changes again. */
  const [moveNote, setMoveNote] = useState<MoveNote | null>(null);
  const kernelReorder = kernel.call;
  /**
   * Moves a step on the timeline (or in History). The kernel finds moved fillets' and shells' edges and faces again on
   * the shape now in front of them, by place; only steps whose picks it can't find get a warning.
   */
  const moveFeature = useCallback(
    (id: string, beforeId: string | null) => {
      const d = store.get();
      const f = d.features.find((x) => x.id === id);
      if (!f) return;
      const why = moveProblem(d, id, beforeId);
      if (why) return say(`${why}, so it can't go there`, true);
      const apply = (next: ModelDoc, warn: string | null) => {
        if (store.get() !== d) return say(`The model changed before ${f.name} could move. Try again.`, true);
        if (next === d) return;
        store.edit(() => next, `Move ${f.name} on the timeline`);
        setMoveNote({ doc: store.get(), text: warn ?? "", failedBefore: new Set(failedRef.current.keys()) });
        say(`Moved ${f.name}. ${formatCombo("mod+z")} puts it back.`);
      };
      const plain = () => apply(reorderFeature(d, id, beforeId), moveWarning(d, id, beforeId));
      const call = kernelReorder("reorder", { doc: d, id, beforeId });
      if (!call) return plain();
      call.then((r) => apply(r.doc, lostText(r.lost)), plain);
    },
    [store, say, kernelReorder],
  );

  // Esc backs out one layer at a time: the narrow sheets, then the tool, then the selection. Menus and dialogs sit above.
  useEscape(tool !== "select", () => setTool("select"), ESC.tool);
  useEscape(render !== null, () => closeRender(), ESC.tool);
  useEscape(narrow && (panel !== null || propsOpen), () => (propsOpen ? setPropsOpen(false) : setPanel(null)), ESC.panel);
  // On a wide screen the Library, Parameters, Print, History and Settings give way to the browser again.
  useEscape(!narrow && panel !== null && panel !== "parts", () => setPanel("parts"), ESC.panel);
  useEscape(
    selection.length > 0 || vp.elements.length > 0 || pickedStep !== null,
    () => {
      setSelection([]);
      setPicked(null);
      vp.clearElements();
    },
    ESC.selection,
  );

  const handlers = useRef({
    homeJoints: () => {},
    armToolPoint: () => {},
    clearToolPoints: () => {},
    checkClashes: () => {},
    sweepJoints: () => {},
    savePose: () => {},
    openExport: () => {},
    exportSteps: () => {},
    openRender: () => {},
    startTour: () => {},
    printCheck: (_c: PrintCheck) => {},
    toggleProps: () => {},
    saveCloud: () => {},
    newModel,
    open,
    save,
    saveAs,
    doUndo,
    doRedo,
    duplicate,
    toggle,
    remove,
    armTool,
    startConstruct: (_k: ConstructKind) => {},
    mirror: () => {},
    add,
    showPanel,
    setParamsOpen,
    setTheme,
    say,
    moveMarker,
    setTimelineShown,
    timelineShown,
    group,
    ungroup,
    toggleHole,
    toggleReference,
    importReference: () => {},
    pocket: (_id: string) => {},
    mateGear: (_id: string) => {},
    addRack: (_id: string) => {},
    fitBelt: (_ids: string[]) => {},
    meshGears: (_ids: string[]) => {},
    makeLink: (_ids: string[]) => {},
    selectLink: (_ids: string[]) => {},
    turnPlacing: () => {},
    confirm: () => {},
    suppressActive: () => {},
    activeFeature: (): string | null => null,
    pickedStep: (): string | null => null,
    deleteStep: (_id: string) => {},
  });
  handlers.current = {
    homeJoints,
    armToolPoint: () => {
      setTool("select");
      setToolPick(true);
      say("Click a point on a link to drag the arm by. Esc cancels.");
    },
    clearToolPoints: () => {
      store.edit((d) => ({ ...d, tools: undefined }), "Remove the tool points");
      say("Removed the tool points");
    },
    savePose: () => {
      const d = live.current.doc;
      const id = newId("p");
      const name = nextPoseName(d);
      store.edit((x) => savePose(x, { id, name, values: x.pose ?? {} }), `Save ${name}`);
      showPanel("parts");
      setRenameId(id);
      say(`Saved ${name}. Type a name, or press Enter to keep it.`);
    },
    checkClashes: () => {
      setSelection([]);
      setPropsOpen(true);
      setClashOn(true);
    },
    sweepJoints: () => {
      setSelection([]);
      setPropsOpen(true);
      setSweepStart((n) => n + 1);
    },
    openExport: () => setExportOpen(true),
    exportSteps: () => exportBuildSteps(),
    openRender: () => openRender(),
    startTour: tour.start,
    printCheck: (c: PrintCheck) => {
      setCheck((now) => (now === c ? "none" : c));
      showPanel("print");
    },
    toggleProps: () => {
      if (!narrow) return setPropsHidden(!propsHidden);
      setPropsOpen((o) => !o);
      setPanel(null);
    },
    saveCloud: () => void files.saveCloud(),
    newModel,
    open,
    save,
    saveAs,
    doUndo,
    doRedo,
    duplicate,
    toggle,
    remove,
    armTool,
    startConstruct,
    mirror,
    add,
    showPanel,
    setParamsOpen,
    setTheme,
    say,
    moveMarker,
    setTimelineShown,
    timelineShown,
    group,
    ungroup,
    toggleHole,
    toggleReference,
    pocket,
    mateGear,
    addRack: addRackTo,
    fitBelt: beltPicked,
    meshGears: meshPicked,
    makeLink,
    selectLink,
    turnPlacing: place.turn,
    importReference: () => referenceInput.current?.click(),
    confirm: () =>
      extrude.session
        ? extrude.done()
        : revolve.session
          ? revolve.done()
          : pushpull.session
            ? pushpull.done()
            : hole.session
              ? hole.done()
              : mount.session
                ? mount.done()
                : gear.session
                  ? gear.done()
                  : construct.session
                    ? construct.done()
                    : tool === "joint"
                      ? jointApi.current?.stage === "parent" && jointApi.current.parent === undefined
                        ? jointApi.current.pickParent(null)
                        : jointApi.current?.done()
                      : pattern.session
                        ? pattern.done()
                        : tool === "combine"
                          ? combine(selection, combineOp, keepTools, combineFit)
                          : finish.tool
                            ? finish.done()
                            : undefined,
    suppressActive: () => {
      if (activeFeatureId) suppressFeature(activeFeatureId);
    },
    activeFeature: () => activeFeatureId,
    pickedStep: () => pickedStep,
    deleteStep: deleteFeature,
  };

  useEffect(() => {
    const h = () => handlers.current;
    const sel = () => live.current.selection;
    const hasSel = (c: CommandContext) => c.hasSelection;
    const list: Command[] = [
      { id: "file.new", label: "New model", group: "File", icon: "plus", keys: ["mod+n"], run: () => h().newModel() },
      { id: "file.open", label: "Open…", group: "File", icon: "folder", keys: ["mod+o"], run: () => void h().open(), keywords: "load file disk" },
      { id: "file.save", label: "Save", group: "File", icon: "save", keys: ["mod+s"], run: () => void h().save(), keywords: "disk download file" },
      {
        id: "file.saveAs",
        label: "Save as…",
        group: "File",
        icon: "save",
        keys: ["shift+mod+s"],
        run: () => void h().saveAs(),
        keywords: "disk download copy file",
      },
      {
        id: "file.saveCloud",
        label: "Save to your account",
        group: "File",
        icon: "cloud",
        run: () => h().saveCloud(),
        keywords: "cloud online upload version",
      },
      { id: "go.library", label: "My models", group: "File", icon: "folder", run: () => go("#/library"), keywords: "library cloud account open" },
      { id: "go.account", label: "Account", group: "Help", icon: "user", run: () => go("#/account"), keywords: "sign in profile password" },
      {
        id: "file.import",
        label: "Import STL, STEP or 3MF…",
        group: "File",
        icon: "upload",
        run: () => void h().open(),
        keywords: "open add mesh stl step stp 3mf",
      },
      {
        id: "file.importReference",
        label: "Import as a reference…",
        group: "File",
        icon: "ghost",
        run: () => h().importReference(),
        keywords: "design around mount servo stl step 3mf not printed",
      },
      {
        id: "file.export",
        label: "Export…",
        group: "File",
        icon: "download",
        keys: ["mod+e"],
        run: () => h().openExport(),
        keywords: "stl 3mf step print slicer",
      },
      {
        id: "file.exportSteps",
        label: "Export build steps (.zip)…",
        group: "File",
        icon: "image",
        run: () => h().exportSteps(),
        keywords: "instructions pictures markdown",
      },
      { id: "edit.undo", label: "Undo", group: "Edit", icon: "undo", keys: ["mod+z"], run: () => h().doUndo(), when: (c) => c.canUndo },
      { id: "edit.redo", label: "Redo", group: "Edit", icon: "redo", keys: ["shift+mod+z", "mod+y"], run: () => h().doRedo(), when: (c) => c.canRedo },
      {
        id: "edit.selectAll",
        scope: "model",
        label: "Select all parts",
        group: "Edit",
        icon: "arrow",
        keys: ["mod+a"],
        run: () => setSelection(live.current.parts.map((p) => p.id)),
        when: () => live.current.parts.length > 0,
      },
      {
        id: "edit.rename",
        scope: "model",
        label: "Rename part",
        group: "Edit",
        icon: "pencil",
        keys: ["f2"],
        run: () => {
          h().showPanel("parts");
          setRenameId(sel()[0] ?? null);
        },
        when: (c) => c.hasSelection && sel().length === 1,
      },
      { id: "edit.duplicate", scope: "model", label: "Duplicate", group: "Edit", icon: "copy", keys: ["mod+d"], run: () => h().duplicate(sel()), when: hasSel },
      {
        id: "edit.hide",
        scope: "model",
        label: "Hide or show",
        group: "Edit",
        icon: "eye",
        keys: ["shift+h"],
        run: () => h().toggle(sel(), "hidden"),
        when: hasSel,
      },
      {
        id: "edit.delete",
        scope: "model",
        label: "Delete",
        group: "Edit",
        icon: "trash",
        keys: ["delete", "backspace"],
        // A step picked on the timeline is deleted from it; parts picked anywhere else get a delete step.
        run: () => {
          const step = h().pickedStep();
          if (step) h().deleteStep(step);
          else h().remove(sel());
        },
        when: (c) => c.hasSelection || !!h().pickedStep(),
      },
      ...TOOLS.map<Command>((t) => ({
        id: `tool.${t.id}`,
        scope: "model",
        label: t.label,
        group: "Tools",
        icon: t.icon,
        keys: t.key ? [t.key] : undefined,
        run: () => (t.id === "construct" ? h().startConstruct("offset") : h().armTool(t.id)),
        keywords: t.title,
      })),
      ...CONSTRUCT_KINDS.map<Command>((k) => ({
        id: `construct.${k.id}`,
        scope: "model",
        label: k.label,
        group: "Tools",
        icon: k.what === "plane" ? "plane" : k.what === "axis" ? "axis" : "point",
        run: () => h().startConstruct(k.id),
        keywords: `construction ${k.what} ${k.title}`,
      })),
      {
        id: "tool.mirror",
        scope: "model",
        label: "Mirror",
        group: "Tools",
        icon: "flipH",
        run: () => h().mirror(),
        keywords: "mirror image flip symmetric copy across a plane",
      },
      {
        id: "timeline.suppress",
        scope: "model",
        label: "Suppress or unsuppress the step",
        group: "Timeline",
        icon: "eyeOff",
        keys: ["mod+/"],
        run: () => h().suppressActive(),
        when: () => !!h().activeFeature(),
        keywords: "skip disable timeline",
      },
      {
        id: "edit.group",
        scope: "model",
        label: "Group",
        group: "Edit",
        icon: "combine",
        keys: ["mod+g"],
        run: () => h().group(sel()),
        when: () => sel().length > 1,
        keywords: "join holes combine union",
      },
      {
        id: "edit.ungroup",
        scope: "model",
        label: "Ungroup",
        group: "Edit",
        icon: "unlink",
        keys: ["shift+mod+g"],
        run: () => h().ungroup(sel()),
        when: hasSel,
      },
      {
        id: "edit.hole",
        scope: "model",
        label: "Hole or solid",
        group: "Edit",
        icon: "hole",
        run: () => h().toggleHole(sel()),
        when: hasSel,
        keywords: "cut subtract tinkercad",
      },
      {
        id: "edit.reference",
        scope: "model",
        label: "Reference or printed",
        group: "Edit",
        icon: "ghost",
        run: () => h().toggleReference(sel()),
        when: hasSel,
        keywords: "design around mount stl not printed",
      },
      {
        id: "edit.pocket",
        scope: "model",
        label: "Cut pocket",
        group: "Edit",
        icon: "extrude",
        run: () => h().pocket(sel()[0]!),
        when: () => sel().length === 1 && !!live.current.parts.find((p) => p.id === sel()[0])?.catalogue,
        keywords: "robot part catalogue cutout mount servo screw holes",
      },
      {
        id: "gear.mate",
        scope: "model",
        label: "Add mating gear",
        group: "Edit",
        icon: "gear",
        run: () => h().mateGear(sel()[0]!),
        when: () => sel().length === 1 && live.current.doc.features.some((f) => f.type === "gear" && (f.form ?? "spur") === "spur" && f.body.id === sel()[0]),
        keywords: "gear mesh pair drive ratio",
      },
      {
        id: "gear.rack",
        scope: "model",
        label: "Add rack",
        group: "Edit",
        icon: "gear",
        run: () => h().addRack(sel()[0]!),
        when: () => sel().length === 1 && live.current.doc.features.some((f) => f.type === "gear" && (f.form ?? "spur") === "spur" && f.body.id === sel()[0]),
        keywords: "gear rack linear drive",
      },
      {
        id: "gear.belt",
        scope: "model",
        label: "Fit a belt",
        group: "Edit",
        icon: "gear",
        run: () => h().fitBelt(sel()),
        when: () => sel().length === 2 && sel().every((id) => live.current.doc.features.some((f) => f.type === "gear" && f.form === "gt2" && f.body.id === id)),
        keywords: "gt2 timing belt pulley length centre distance",
      },
      {
        id: "gear.mesh",
        scope: "model",
        label: "Mesh gears",
        group: "Edit",
        icon: "gear",
        run: () => h().meshGears(sel()),
        when: () => sel().length === 2 && sel().every((id) => live.current.doc.features.some((f) => f.type === "gear" && f.body.id === id)),
        keywords: "gear pair centre distance drive ratio",
      },
      {
        id: "pose.home",
        scope: "model",
        label: "Move the joints home",
        group: "View",
        icon: "home",
        run: () => h().homeJoints(),
        when: () => !!livePoseRef.current || !!live.current.doc.pose,
        keywords: "pose reset joints zero",
      },
      {
        id: "view.centres",
        scope: "model",
        label: "Show or hide centres of mass",
        group: "View",
        icon: "joint",
        run: () => setCentresShown((on) => !on),
        keywords: "mass weight balance com links robot",
      },
      {
        id: "pose.tool",
        scope: "model",
        label: "Set tool point",
        group: "Edit",
        icon: "point",
        run: () => h().armToolPoint(),
        when: () => build(live.current.doc).joints.some(movable),
        keywords: "ik inverse kinematics gripper tip end effector arm drag robot",
      },
      {
        id: "pose.save",
        scope: "model",
        label: "Save pose",
        group: "Edit",
        icon: "joint",
        run: () => h().savePose(),
        when: () => build(live.current.doc).joints.some(movable),
        keywords: "named pose robot arm joints remember position",
      },
      {
        id: "check.clashes",
        scope: "model",
        label: "Check for clashes",
        group: "Edit",
        icon: "warning",
        run: () => h().checkClashes(),
        when: () => live.current.parts.length > 1,
        keywords: "collision interference overlap touch intersect robot pose",
      },
      {
        id: "check.sweep",
        scope: "model",
        label: "Sweep the joints for clashes",
        group: "Edit",
        icon: "joint",
        run: () => h().sweepJoints(),
        when: () => live.current.parts.length > 1 && build(live.current.doc).joints.some(movable),
        keywords: "collision range limits robot arm joints self hit",
      },
      {
        id: "pose.tool.clear",
        scope: "model",
        label: "Remove the tool points",
        group: "Edit",
        icon: "point",
        run: () => h().clearToolPoints(),
        when: () => !!live.current.doc.tools?.length,
        keywords: "ik inverse kinematics gripper tip end effector",
      },
      {
        id: "drive.add",
        scope: "model",
        label: "Drive link",
        group: "Edit",
        icon: "gear",
        run: () => setDriveDialog({}),
        when: () => build(live.current.doc).joints.filter(movable).length >= 2,
        keywords: "drive gear belt rack ratio mimic joint robot link",
      },
      {
        id: "view.props",
        label: "Show or hide properties",
        group: "View",
        icon: "info",
        run: () => h().toggleProps(),
        keywords: "panel this part details collapse",
      },
      {
        id: "view.joints",
        scope: "model",
        label: "Show or hide joints",
        group: "View",
        icon: "joint",
        run: () => {
          const ids = live.current.doc.features.filter((f) => f.type === "joint").map((f) => f.id);
          setHidden(
            ids,
            ids.some((id) => !live.current.doc.looks[id]?.hidden),
            "sketches",
            "joints",
          );
        },
        when: () => live.current.doc.features.some((f) => f.type === "joint"),
        keywords: "robot joint axis arrow glyph",
      },
      {
        id: "link.make",
        scope: "model",
        label: "New component",
        group: "Edit",
        icon: "component",
        run: () => h().makeLink(sel()),
        keywords: "robot rigid link body group joint urdf assembly part",
      },
      {
        id: "link.select",
        scope: "model",
        label: "Select component",
        group: "Edit",
        icon: "component",
        run: () => h().selectLink(sel()),
        when: () => live.current.parts.some((p) => sel().includes(p.id) && !!p.link),
        keywords: "robot rigid link bodies",
      },
      {
        id: "place.turn",
        scope: "model",
        label: "Turn the part 90°",
        group: "Tools",
        icon: "revolve",
        keys: ["t"],
        run: () => h().turnPlacing(),
        when: () => live.current.placing,
        keywords: "robot part catalogue rotate",
      },
      {
        id: "tool.confirm",
        scope: "model",
        label: "Finish the tool",
        group: "Tools",
        icon: "check",
        keys: ["enter"],
        run: () => h().confirm(),
        when: () =>
          ["extrude", "revolve", "pushpull", "hole", "mount", "gear", "joint", "pattern", "combine", "fillet", "shell", "construct"].includes(
            live.current.tool,
          ),
      },
      ...([...PRIMITIVES] as PartKind[]).map<Command>((k) => ({
        id: `add.${k}`,
        label: `Add a ${KIND_LABEL[k].toLowerCase()}`,
        group: "Tools",
        icon: partIcon(k),
        run: () => h().add(k),
        keywords: "part primitive shape",
      })),
      {
        id: "timeline.start",
        label: "Roll back to the start",
        group: "Timeline",
        icon: "skipStart",
        keys: ["alt+home"],
        run: () => h().moveMarker(0),
        when: () => live.current.at > 0,
      },
      {
        id: "timeline.back",
        label: "Step back on the timeline",
        group: "Timeline",
        icon: "stepBack",
        keys: ["alt+arrowleft"],
        run: () => h().moveMarker(live.current.at - 1),
        when: () => live.current.at > 0,
        keywords: "roll back history",
      },
      {
        id: "timeline.forward",
        label: "Step forward on the timeline",
        group: "Timeline",
        icon: "stepForward",
        keys: ["alt+arrowright"],
        run: () => h().moveMarker(live.current.at + 1),
        when: () => live.current.at < live.current.doc.features.length,
      },
      {
        id: "timeline.end",
        label: "Go to the end of the timeline",
        group: "Timeline",
        icon: "skipEnd",
        keys: ["alt+end"],
        run: () => h().moveMarker(Infinity),
        when: () => live.current.at < live.current.doc.features.length,
      },
      {
        id: "timeline.toggle",
        label: "Show or hide the timeline",
        group: "View",
        icon: "history",
        run: () => h().setTimelineShown(!h().timelineShown),
        keywords: "steps features history",
      },
      ...PANELS.map<Command>((p) => ({ id: `panel.${p.id}`, label: `Show ${p.label}`, group: "Panels", icon: p.icon, run: () => h().showPanel(p.id) })),
      {
        id: "panel.params",
        label: "Show Parameters",
        group: "Panels",
        icon: "sliders",
        run: () => h().setParamsOpen(true),
        keywords: "user model sizes expressions",
      },
      ...(Object.keys(THEME_LABEL) as ThemeSetting[]).map<Command>((t) => ({
        id: `theme.${t}`,
        label: `Theme: ${THEME_LABEL[t]}`,
        group: "Theme",
        icon: t === "light" ? "sun" : t === "system" ? "settings" : "moon",
        run: () => h().setTheme(t),
      })),
      {
        id: "view.render",
        label: "Render",
        group: "View",
        icon: "sun",
        keys: ["shift+r"],
        run: () => h().openRender(),
        keywords: "photo picture image path trace blender",
      },
      {
        id: "view.fullscreen",
        label: "Full screen",
        group: "View",
        icon: "expand",
        run: () => void import("./fullscreen").then((m) => m.switchFullscreen(h().say)),
        keywords: "fullscreen phone tablet",
      },
      { id: "help.palette", label: "Find a command", group: "Help", icon: "search", keys: ["mod+k"], run: () => setPaletteOpen(true) },
      { id: "print.overhangs", label: "Check overhangs", group: "View", icon: "printer", run: () => h().printCheck("overhang"), keywords: "support print 45" },
      {
        id: "print.thin",
        label: "Check thin walls",
        group: "View",
        icon: "printer",
        run: () => h().printCheck("thin"),
        keywords: "wall thickness print nozzle",
      },
      { id: "help.report", label: "Report a problem", group: "Help", icon: "warning", run: () => setReport({}), keywords: "bug crash error feedback" },
      { id: "help.tour", label: "Take the tour", group: "Help", icon: "info", run: () => h().startTour(), keywords: "help start learn guide" },
      { id: "help.shortcuts", label: "Keyboard shortcuts", group: "Help", icon: "keyboard", keys: ["?"], run: () => setShortcutsOpen(true) },
      {
        id: "help.learn",
        label: "Learn BetterCad",
        group: "Help",
        icon: "link",
        run: () => window.open(COURSE_URL, "_blank", "noopener"),
        keywords: "course lessons tutorial kevsrobots",
      },
      { id: "help.tips", label: "Tips", group: "Help", icon: "bulb", run: showTips, keywords: "hints help getting started" },
      { id: "help.whatsNew", label: "What's new", group: "Help", icon: "star", run: showWhatsNew, keywords: "release notes changes update changelog" },
      { id: "help.about", label: "About BetterCad", group: "Help", icon: "info", run: () => setAboutOpen(true), keywords: "version licence licenses" },
    ];
    if (import.meta.env.DEV || import.meta.env.VITE_GALLERY) {
      list.push({ id: "help.gallery", label: "Component gallery", group: "Help", icon: "template", run: () => (window.location.hash = "#/gallery") });
    }
    return registry.register(list);
  }, [registry, showWhatsNew, showTips, setHidden]);

  // One keyboard handler for the whole editor. Escape goes through the layered stack instead.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key === "Escape" || live.current.dialogOpen || !activeRef.current) return;
      registry.dispatch(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry]);

  const commands = registry.list();
  const isEnabled = useCallback((id: string) => registry.enabled(id), [registry]);
  const activeTool = TOOLS.find((t) => t.id === tool)!;
  const selectedParts = useMemo(() => parts.filter((p) => selection.includes(p.id)), [parts, selection]);

  // The active tile: the one last clicked while its parts stay selected, else the last built step that touches them.
  const activeFeatureId = useMemo(() => {
    if (!selection.length) return null;
    const touches = (f: Feature) => featureParts(f).some((id) => selection.includes(id));
    const clicked = doc.features.find((f) => f.id === activeFeature);
    if (clicked && touches(clicked)) return clicked.id;
    return [...doc.features.slice(0, at)].reverse().find(touches)?.id ?? null;
  }, [selection, activeFeature, doc.features, at]);

  const summary = useCallback((f: Feature) => featureSummary(doc, f), [doc]);
  // A step's tool closing ends the change to it.
  useEffect(() => {
    if (tool === "select" && editingStep) setEditingStep(null);
  }, [tool, editingStep]);
  const timelineWarning = earlierWarning(doc, at, sketch.editingId ?? editingStep) ?? moveText(doc, moveNote, failed);
  const volumes = useMemo(() => new Map([...kernel.bodies].map(([id, b]) => [id, b.measure.volume])), [kernel.bodies]);
  const sizes = useMemo(
    () =>
      new Map(
        [...kernel.bodies].map(([id, b]) => {
          const { min, max } = b.measure.bbox;
          return [id, { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] }];
        }),
      ),
    [kernel.bodies],
  );

  // ---- print readiness (#100, #105)
  const measures = useMemo(() => new Map([...kernel.bodies].map(([id, b]) => [id, { area: b.measure.area, bbox: b.measure.bbox as Box3 }])), [kernel.bodies]);
  measuresRef.current = measures;
  const printer = printerOf(doc.print);
  const [showBed, setShowBedState] = useState(() => recall("bettercad.showBed") !== "0");
  const setShowBed = useCallback((on: boolean) => {
    setShowBedState(on);
    keep("bettercad.showBed", on ? "1" : "0");
  }, []);
  const cubeMenu: MenuEntry[] = [
    ...vp.cubeMenu,
    { kind: "separator", id: "s-bed" },
    { id: "bed", label: "Show build volume", checked: showBed, multiple: true, onSelect: () => setShowBed(!showBed) },
  ];
  /** The bodies that print: shown, not holes, and measured by the kernel. */
  const printBoxes = useMemo(() => {
    const out = new Map<string, Box3>();
    for (const p of parts) if (printed(p) && measures.has(p.id)) out.set(p.id, measures.get(p.id)!.bbox);
    return out;
  }, [parts, measures]);
  const printBox = useMemo(() => unionBox([...printBoxes.values()]), [printBoxes]);
  const fitProblem = fitMessage(fitCheck(printBox, printer), printer);
  const offBed = useMemo(() => (showBed ? new Set(outside(printBoxes, printer)) : undefined), [showBed, printBoxes, printer]);
  const modelWeight = useMemo(() => {
    const shown = parts.filter(printed);
    if (!shown.length || shown.some((p) => !measures.has(p.id) || p.imported?.mesh)) return null;
    const volume = shown.reduce((a, p) => a + (volumes.get(p.id) ?? 0), 0);
    const area = shown.reduce((a, p) => a + measures.get(p.id)!.area, 0);
    return estimateWeight({ volume, area, density: materialOf(doc.print?.material).density, infill: doc.print?.infill ?? DEFAULT_INFILL });
  }, [parts, measures, volumes, doc.print]);
  const changePrint = useCallback(
    (change: Partial<PrintSettings>) =>
      store.edit((d) => ({ ...d, print: { ...d.print, ...change } }), change.printer ? "Choose a printer" : "Change print settings"),
    [store],
  );
  const centreOnBed = useCallback(() => {
    if (!printBox) return;
    const delta = centreMove(printBox);
    if (Math.abs(delta.x) + Math.abs(delta.y) + Math.abs(delta.z) < 1e-6) return say("The model is already centred on the bed");
    const ids = parts.filter((p) => !p.hidden).map((p) => p.id);
    store.edit((d) => {
      let x = d;
      let pos = marker === null ? undefined : at;
      for (const id of ids) {
        const part = parts.find((p) => p.id === id)!;
        x = placePart(
          x,
          id,
          { x: part.position.x + delta.x, y: part.position.y + delta.y, z: part.position.z + delta.z },
          part.rotation ?? { x: 0, y: 0, z: 0 },
          pos,
        );
        if (pos !== undefined) pos++;
      }
      return x;
    }, "Centre on bed");
    say("Centred the model on the bed");
  }, [printBox, parts, store, say, at, marker]);
  // Print checks (#101, #102): one at a time, tinting the bodies that print.
  const [check, setCheck] = useState<PrintCheck>("none");
  const [overhangAngle, setOverhangAngle] = useState(45);
  const [thinWall, setThinWall] = useState<number | null>(null);
  const thinLimit = thinWall ?? printer.nozzle * 2;
  const printBodies = useMemo(
    () => parts.filter((p) => printed(p) && kernel.bodies.has(p.id)).map((p) => ({ id: p.id, mesh: kernel.bodies.get(p.id)!.mesh })),
    [parts, kernel.bodies],
  );
  const overhangResult = useMemo(() => {
    if (check !== "overhang") return null;
    const values = new Map<string, Float32Array>();
    const areas: CheckArea[] = [];
    for (const b of printBodies) {
      const r = overhangs(b.mesh, overhangAngle, 0);
      values.set(b.id, r.values);
      areas.push(...r.areas);
    }
    return { values, areas: areas.sort((a, b) => b.area - a.area) };
  }, [check, printBodies, overhangAngle]);
  const [thinResult, setThinResult] = useState<{ values: Map<string, Float32Array>; areas: CheckArea[] } | null>(null);
  const kernelCall = kernel.call;
  useEffect(() => {
    setThinResult(null);
    if (check !== "thin" || !printBodies.length) return;
    let pending: { cancel(): void } | null = null;
    const t = setTimeout(() => {
      const call = kernelCall("thickness", {
        bodies: printBodies.map((b) => ({ id: b.id, positions: b.mesh.positions, indices: b.mesh.indices })),
        threshold: thinLimit,
      });
      call?.then(
        (r) => {
          const areas = r.flatMap((x) => x.areas).sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
          setThinResult({ values: new Map(r.map((x) => [x.id, x.values])), areas });
        },
        () => undefined,
      );
      pending = call;
    }, 300);
    return () => {
      clearTimeout(t);
      pending?.cancel();
    };
  }, [check, printBodies, thinLimit, kernelCall]);
  const checkResult = check === "overhang" ? overhangResult : check === "thin" ? thinResult : null;

  // Orientation suggestions (#103): worked out in the kernel while the Print panel is open, once per build.
  const [orientWeights, setOrientWeightsState] = useState<OrientWeights>(readOrientWeights);
  const setOrientWeights = useCallback((w: OrientWeights) => {
    setOrientWeightsState(w);
    keep(ORIENT_KEY, JSON.stringify(w));
  }, []);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const printOpen = panel === "print";
  useEffect(() => {
    setSuggestions(null);
    if (!printOpen || !printBodies.length) return;
    let pending: { cancel(): void } | null = null;
    const t = setTimeout(() => {
      const call = kernelCall("orient", {
        bodies: printBodies.map((b) => ({ positions: b.mesh.positions, indices: b.mesh.indices, faceTris: b.mesh.faceTris })),
        limit: overhangAngle,
        weights: orientWeights,
      });
      call?.then(
        (list) => {
          const engine = vp.ref.current?.engine();
          setSuggestions(list.map((o) => ({ ...o, picture: engine?.posed(o.turn, 96, 64) ?? null })));
        },
        () => undefined,
      );
      pending = call;
    }, 300);
    return () => {
      clearTimeout(t);
      pending?.cancel();
    };
  }, [printOpen, printBodies, overhangAngle, orientWeights, kernelCall, vp.ref]);
  const layDown = useCallback(
    (o: Orientation) => {
      if (o.current) return say("It already lies this way");
      // Where the printing bodies end up once turned, to sit them on the middle of the bed.
      const min: [number, number, number] = [Infinity, Infinity, Infinity];
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (const b of printBodies) {
        const P = b.mesh.positions;
        for (let i = 0; i < P.length; i += 3) {
          const q = applyTurn(o.turn, [P[i]!, P[i + 1]!, P[i + 2]!]);
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k]!, q[k]!);
            max[k] = Math.max(max[k]!, q[k]!);
          }
        }
      }
      const delta = centreMove({ min, max });
      const ids = parts.filter((p) => !p.hidden).map((p) => p.id);
      store.edit((d) => {
        let x = d;
        let pos = marker === null ? undefined : at;
        for (const id of ids) {
          const part = parts.find((p) => p.id === id)!;
          const turned = turnPlacement(part, o.turn);
          const position = { x: turned.position.x + delta.x, y: turned.position.y + delta.y, z: turned.position.z + delta.z };
          x = placePart(x, id, position, turned.rotation, pos);
          if (pos !== undefined) pos++;
        }
        return x;
      }, "Lay it on the bed");
      say("Turned the model and laid it on the middle of the bed");
    },
    [printBodies, parts, store, say, at, marker],
  );
  const showArea = useCallback((a: CheckArea) => vp.ref.current?.engine()?.fitBox(a.box.min, a.box.max), [vp.ref]);

  // Printed holes (#104): steps made at another offset, which Update brings to the one set now.
  const holeOffset = holeOffsetOf(doc.print);
  const staleHoles = useMemo(
    () =>
      doc.features.filter(
        (f): f is HoleFeature => f.type === "hole" && f.fit === "printed" && f.size !== "custom" && Math.abs((f.offset ?? 0.4) - holeOffset) > 1e-9,
      ),
    [doc.features, holeOffset],
  );
  const updateHoles = useCallback(() => {
    const n = staleHoles.length;
    store.edit((d) => staleHoles.reduce((x, f) => updateHole(x, f.id, { offset: holeOffset }), d), n === 1 ? "Update 1 hole" : `Update ${n} holes`);
    say(`${n === 1 ? "1 printed hole now adds" : `${n} printed holes now add`} ${holeOffset} mm`);
  }, [staleHoles, holeOffset, store, say]);

  // Printer profiles (#180) and fitted cuts made at other gaps (#183).
  const printers = usePrinterProfiles(api, account);
  const fitsStale = useMemo(() => staleFits(doc, doc.print), [doc]);
  const pickProfile = useCallback(
    (id: string | null) => {
      const p = printers.profiles.find((x) => x.id === id);
      if (!p) return store.edit((d) => ({ ...d, print: { ...d.print, profile: undefined } }), "Use this model's own printer settings");
      store.edit((d) => ({ ...d, print: applyProfile(d.print ?? {}, p) }), `Use ${p.name}`);
      say(`Using ${p.name}`);
    },
    [printers.profiles, store, say],
  );
  const saveProfile = useCallback(
    (name: string) => {
      const p = profileFromSettings(newProfileId(), name, doc.print ?? {});
      printers.save(p);
      store.edit((d) => ({ ...d, print: { ...d.print, profile: p.id } }), `Save ${name}`);
      say(`Saved ${name} to your printers`);
    },
    [doc.print, printers, store, say],
  );
  const updateProfile = useCallback(() => {
    const cur = printers.profiles.find((x) => x.id === doc.print?.profile);
    if (!cur) return;
    printers.save(profileFromSettings(cur.id, cur.name, doc.print ?? {}));
    say(`Saved the changes to ${cur.name}`);
  }, [doc.print, printers, say]);
  const deleteProfile = useCallback(() => {
    const cur = printers.profiles.find((x) => x.id === doc.print?.profile);
    if (!cur) return;
    printers.remove(cur.id);
    store.edit((d) => ({ ...d, print: { ...d.print, profile: undefined } }), `Delete ${cur.name}`);
    say(`Deleted ${cur.name}. This model keeps its settings.`);
  }, [doc.print, printers, store, say]);
  const updateFitCuts = useCallback(() => {
    const n = fitsStale.length;
    store.edit((d) => updateFits(d, d.print), n === 1 ? "Update 1 fitted cut" : `Update ${n} fitted cuts`);
    say(n === 1 ? "1 fitted cut now uses the gaps set now" : `${n} fitted cuts now use the gaps set now`);
  }, [fitsStale, store, say]);

  // Mass (#174): worked out in the kernel once the model has links, again after each change to its bodies or print
  // settings. The pose doesn't change it, so it isn't part of the key.
  const [masses, setMasses] = useState<Map<string, BodyMass>>(new Map());
  const hasLinks = built.links.length > 0;
  const massDoc = useMemo(() => ({ ...doc, pose: undefined }), [doc.features, doc.looks, doc.print, doc.blobs, doc.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hasLinks) return setMasses(new Map());
    let pending: { cancel(): void } | null = null;
    const t = setTimeout(() => {
      const call = kernelCall("mass", { doc: massDoc, upTo: at });
      call?.then(
        (list) => setMasses(new Map(list.map((b) => [b.id, b]))),
        () => setMasses(new Map()),
      );
      pending = call;
    }, 400);
    return () => {
      clearTimeout(t);
      pending?.cancel();
    };
  }, [hasLinks, massDoc, at, kernelCall]);
  /** Each link's total, and Base's (bodies in no link), by link id ("" for Base). */
  const linkMass = useMemo(() => {
    const out = new Map<string, { name: string; props: MassProps }>();
    if (!hasLinks) return out;
    const of = (ids: string[]) => combineMass(ids.flatMap((id) => (masses.has(id) ? [masses.get(id)!] : [])));
    for (const l of built.links) out.set(l.id, { name: l.name, props: of(l.parts) });
    out.set("", { name: "Base", props: of(parts.filter((p) => !p.link).map((p) => p.id)) });
    return out;
  }, [hasLinks, masses, built.links, parts]);
  const [centresShown, setCentresShown] = useState(false);
  useEffect(() => {
    const list: [number, number, number][] = [];
    if (centresShown)
      for (const [id, l] of linkMass) {
        if (!(l.props.mass > 0)) continue;
        const m = posing && id ? linkMoves.get(id) : undefined;
        list.push(m ? mat4Apply(m, l.props.com) : l.props.com);
      }
    vp.ref.current?.engine()?.setCentres(list.length ? list : null);
  }, [centresShown, linkMass, posing, linkMoves, vp.ref]);
  const massInfo = useMemo(() => {
    if (!hasLinks || !selectedParts.length) return undefined;
    const linkIds = new Set(selectedParts.map((p) => p.link ?? ""));
    const one = selectedParts.length === 1 ? selectedParts[0]! : null;
    const body = one ? masses.get(one.id) : undefined;
    return {
      link: linkIds.size === 1 ? linkMass.get([...linkIds][0]!) : undefined,
      body,
      datasheet: one?.mass,
      onDatasheet:
        one && !one.hole
          ? (g: number | undefined) => store.edit((d) => setLook(d, [one.id], () => ({ mass: g })), g ? `Set ${one.name}'s mass` : `Clear ${one.name}'s mass`)
          : undefined,
    };
  }, [hasLinks, selectedParts, masses, linkMass, store]);

  // Clash check (#178): worked out in the kernel at the saved pose while it's on, again after each change.
  const [clashOn, setClashOn] = useState(false);
  const [clashOpts, setClashOpts] = useState<{ sameLink?: boolean; references?: boolean }>({});
  /** Which pose to check (#177): the one now (null), Home, or a named pose's id. */
  const [clashAt, setClashAt] = useState<string | null>(null);
  const [clashes, setClashes] = useState<Clash[] | null>(null);
  const [clashProgress, setClashProgress] = useState<number | null>(null);
  const clashCall = useRef<{ cancel(): void } | null>(null);
  useEffect(() => {
    setClashes(null);
    setClashProgress(null);
    if (!clashOn) return;
    let gone = false;
    const t = setTimeout(() => {
      setClashProgress(0);
      const named = clashAt === "home" ? { values: {} } : clashAt ? namedPoseValues(doc, clashAt) : null;
      const posed = named ? { ...doc, pose: named.values } : doc;
      const call = kernelCall("clashes", { doc: posed, upTo: at, ...clashOpts }, (f) => !gone && setClashProgress(f));
      clashCall.current = call;
      call?.then(
        (r) => !gone && setClashes(r),
        () => undefined,
      );
      void call?.finally(() => !gone && setClashProgress(null));
    }, 300);
    return () => {
      gone = true;
      clearTimeout(t);
      clashCall.current?.cancel();
      clashCall.current = null;
    };
  }, [clashOn, clashOpts, clashAt, doc, at, kernelCall]);
  const stopClashes = useCallback(() => {
    clashCall.current?.cancel();
    setClashOn(false);
    say("Stopped checking for clashes");
  }, [say]);
  useEscape(clashProgress !== null, stopClashes, ESC.tool);
  const clashBodies = useMemo(() => (clashes?.length ? new Set(clashes.filter((c) => c.kind === "overlap").flatMap((c) => [c.a, c.b])) : null), [clashes]);
  const viewWarn = useMemo(() => (clashBodies ? new Set([...(offBed ?? []), ...clashBodies]) : offBed), [clashBodies, offBed]);
  useEffect(() => vp.ref.current?.engine()?.setClashBoxes(clashes?.length ? clashes.map((c) => c.box) : null), [clashes, vp.ref]);
  const showClash = useCallback((c: Clash) => vp.ref.current?.engine()?.fitBox(c.box.min, c.box.max), [vp.ref]);

  // Clash sweep (#179): the panel keeps its own state; the palette's command bumps `sweepStart` to run it.
  const [sweepStart, setSweepStart] = useState(0);

  // Mating faces (#184): worked out in the kernel while the fits check is on, again after each change.
  const [fitsCheck, setFitsCheck] = useState(false);
  const [mates, setMates] = useState<Mate[] | null>(null);
  useEffect(() => {
    setMates(null);
    if (!fitsCheck || !printOpen) return;
    let pending: { cancel(): void } | null = null;
    const t = setTimeout(() => {
      const call = kernelCall("mates", { doc, upTo: at });
      call?.then(setMates, () => setMates([]));
      pending = call;
    }, 300);
    return () => {
      clearTimeout(t);
      pending?.cancel();
    };
  }, [fitsCheck, printOpen, doc, at, kernelCall]);
  const fixFit = useCallback(
    (m: Mate, fit: FitId) => {
      const r = fixMate(live.current.doc, m, fit);
      if (typeof r === "string") return say(r, true);
      store.edit(() => r, `Make a ${gapFitOf(fit).name.toLowerCase()}`);
      say(`Made it a ${gapFitOf(fit).name.toLowerCase()}`);
    },
    [store, say],
  );

  const printPanel = (
    <Suspense fallback={null}>
      <PrintPanel
        settings={doc.print ?? {}}
        printer={printer}
        onChange={changePrint}
        showBed={showBed}
        onShowBed={setShowBed}
        fitProblem={fitProblem}
        hasModel={printBox !== null}
        onCentre={centreOnBed}
        weight={modelWeight}
        check={check}
        onCheck={setCheck}
        overhangAngle={overhangAngle}
        onOverhangAngle={setOverhangAngle}
        thinWall={thinLimit}
        onThinWall={setThinWall}
        areas={check === "none" ? [] : (checkResult?.areas ?? (check === "thin" && !printBodies.length ? [] : null))}
        onShowArea={showArea}
        suggestions={suggestions}
        onSuggestion={layDown}
        holeOffset={holeOffset}
        staleHoles={staleHoles.length}
        onUpdateHoles={updateHoles}
        onCalibrate={() => files.openSample("hole-calibration")}
        onCalibrateFits={() => files.openSample("fit-calibration")}
        profiles={printers.profiles}
        onPickProfile={pickProfile}
        onSaveProfile={saveProfile}
        onUpdateProfile={updateProfile}
        onDeleteProfile={deleteProfile}
        staleFits={fitsStale.length}
        fitsCheck={fitsCheck}
        onFitsCheck={setFitsCheck}
        mates={mates}
        partName={(id) => parts.find((x) => x.id === id)?.name ?? "A body"}
        onShowMate={(m) => vp.ref.current?.engine()?.fitBox(m.box.min, m.box.max)}
        onFixMate={fixFit}
        onUpdateFits={updateFitCuts}
      />
    </Suspense>
  );

  const featureMenu = (id: string): MenuEntry[] => {
    const i = doc.features.findIndex((f) => f.id === id);
    const f = doc.features[i];
    if (!f) return [];
    return [
      ...(f.type === "sketch" ? [{ id: "edit", label: "Edit sketch", icon: "sketch" as const, onSelect: () => sketch.edit(id) }] : []),
      ...(f.type === "sketch"
        ? [
            {
              id: "replane",
              label: "Redefine sketch plane",
              icon: "move" as const,
              onSelect: () => {
                // Pick against the model as it was before the sketch, so a face from a later step can't be chosen.
                const back = live.current.marker;
                setTool("select");
                moveMarker(i);
                sketch.redefine(id, () => setMarker(back));
              },
            },
          ]
        : []),
      ...(f.type === "sketch" && sketchBrokenLinks(doc, id).length
        ? [
            {
              id: "unlink",
              label: "Keep lost projections as lines",
              icon: "unlink" as const,
              onSelect: () => store.edit((d) => fixSketchLinks(d, id, "keep"), `Fix ${f.name}'s links`),
            },
            {
              id: "droplinks",
              label: "Delete lost projections",
              icon: "trash" as const,
              onSelect: () => store.edit((d) => fixSketchLinks(d, id, "delete"), `Fix ${f.name}'s links`),
            },
          ]
        : []),
      ...(f.type === "extrude"
        ? [
            {
              id: "edit",
              label: "Edit extrude",
              icon: "extrude" as const,
              disabled: i >= at,
              onSelect: () => {
                setEditingStep(id);
                setTool("extrude");
                extrude.edit(id);
              },
            },
          ]
        : []),
      ...(f.type === "hole"
        ? [
            {
              id: "edit",
              label: "Edit hole",
              icon: "hole" as const,
              disabled: i >= at,
              onSelect: () => {
                setEditingStep(id);
                setTool("hole");
                hole.edit(id);
              },
            },
          ]
        : []),
      ...(f.type === "pattern"
        ? [
            {
              id: "edit",
              label: `Edit ${f.kind === "mirror" ? "mirror" : "pattern"}`,
              icon: "distributeH" as const,
              disabled: i >= at,
              onSelect: () => {
                setEditingStep(id);
                setTool("pattern");
                pattern.edit(id);
              },
            },
          ]
        : []),
      ...(f.type === "mount"
        ? [
            {
              id: "edit",
              label: "Edit mount",
              icon: "screw" as const,
              disabled: i >= at,
              onSelect: () => {
                setEditingStep(id);
                setTool("mount");
                mount.edit(id);
              },
            },
          ]
        : []),
      ...(f.type === "gear"
        ? [
            {
              id: "edit",
              label: "Edit gear",
              icon: "gear" as const,
              disabled: i >= at,
              onSelect: () => {
                setTool("gear");
                gear.edit(id);
              },
            },
          ]
        : []),
      ...(f.type === "construct"
        ? [
            {
              id: "edit",
              label: `Edit ${f.name}`,
              icon: "plane" as const,
              disabled: i >= at,
              onSelect: () => {
                setEditingStep(id);
                setTool("construct");
                construct.edit(id);
              },
            },
          ]
        : []),
      ...(f.type === "joint"
        ? [
            {
              id: "edit",
              label: "Edit joint",
              icon: "joint" as const,
              disabled: i >= at,
              onSelect: () => {
                setTool("joint");
                setJointEdit(id);
              },
            },
          ]
        : []),
      ...(f.type === "drive"
        ? [
            {
              id: "edit",
              label: "Edit drive",
              icon: "gear" as const,
              disabled: i >= at,
              onSelect: () => setDriveDialog({ editing: f }),
            },
          ]
        : []),
      ...(f.type === "revolve"
        ? [
            {
              id: "edit",
              label: "Edit revolve",
              icon: "revolve" as const,
              disabled: i >= at,
              onSelect: () => {
                setEditingStep(id);
                setTool("revolve");
                revolve.edit(id);
              },
            },
          ]
        : []),
      {
        id: "earlier",
        label: "Move earlier",
        icon: "stepBack",
        disabled: i === 0 || !!moveProblem(doc, id, doc.features[i - 1]!.id),
        onSelect: () => moveFeature(id, doc.features[i - 1]!.id),
      },
      {
        id: "later",
        label: "Move later",
        icon: "stepForward",
        disabled: i === doc.features.length - 1 || !!moveProblem(doc, id, doc.features[i + 2]?.id ?? null),
        onSelect: () => moveFeature(id, doc.features[i + 2]?.id ?? null),
      },
      { id: "roll", label: "Roll to here", icon: "history", disabled: i + 1 === at, onSelect: () => moveMarker(i + 1) },
      {
        id: "rename",
        label: "Rename",
        icon: "pencil",
        onSelect: () => {
          showPanel("history");
          setFeatureRenameId(id);
        },
      },
      { id: "suppress", label: f.suppressed ? "Unsuppress" : "Suppress", icon: f.suppressed ? "eye" : "eyeOff", onSelect: () => suppressFeature(id) },
      { kind: "separator", id: "s1" },
      { id: "delete", label: "Delete", icon: "trash", danger: true, onSelect: () => deleteFeature(id) },
    ];
  };

  const partMenu = (ids: string[]): MenuEntry[] => {
    const chosen = parts.filter((p) => ids.includes(p.id));
    const allHidden = chosen.length > 0 && chosen.every((p) => p.hidden);
    return [
      { id: "rename", label: "Rename", icon: "pencil", keys: "F2", disabled: ids.length !== 1, onSelect: () => setRenameId(ids[0] ?? null) },
      { id: "duplicate", label: "Duplicate", icon: "copy", keys: formatCombo("mod+d"), onSelect: () => duplicate(ids) },
      {
        id: "mirror",
        label: "Mirror…",
        icon: "flipH",
        onSelect: () => {
          setSelection(ids);
          mirror();
        },
      },
      {
        id: "pattern",
        label: "Pattern…",
        icon: "distributeH",
        onSelect: () => {
          setSelection(ids);
          setTool("pattern");
        },
      },
      ...(ids.length > 1
        ? [
            { id: "group", label: "Group", icon: "combine" as const, keys: formatCombo("mod+g"), onSelect: () => group(ids) },
            {
              id: "combine",
              label: "Combine…",
              icon: "combine" as const,
              onSelect: () => {
                setSelection(ids);
                setTool("combine");
              },
            },
          ]
        : []),
      ...(ids.some((id) => groupOf(doc, id, at))
        ? [{ id: "ungroup", label: "Ungroup", icon: "unlink" as const, keys: formatCombo("shift+mod+g"), onSelect: () => ungroup(ids) }]
        : []),
      {
        id: "hole",
        label: chosen.length && chosen.every((p) => p.hole) ? "Make solid" : "Make a hole",
        icon: "hole",
        onSelect: () => toggleHole(ids),
      },
      ...(chosen.length === 1 && chosen[0]!.catalogue
        ? [{ id: "pocket", label: "Cut pocket", icon: "extrude" as const, onSelect: () => pocket(chosen[0]!.id) }]
        : []),
      ...(chosen.length === 1 && isSpur(chosen[0]!.id)
        ? [
            { id: "mate-gear", label: "Add mating gear", icon: "gear" as const, onSelect: () => mateGear(chosen[0]!.id) },
            { id: "add-rack", label: "Add rack", icon: "gear" as const, onSelect: () => addRackTo(chosen[0]!.id) },
          ]
        : []),
      ...(chosen.length === 2 && chosen.every((p) => gearOf(p.id)?.form === "gt2")
        ? [{ id: "fit-belt", label: "Fit a belt", icon: "gear" as const, onSelect: () => beltPicked(chosen.map((p) => p.id)) }]
        : []),
      ...(chosen.length === 2 && chosen.every((p) => isSpur(p.id))
        ? [{ id: "mesh-gears", label: "Mesh gears", icon: "gear" as const, onSelect: () => meshPicked(chosen.map((p) => p.id)) }]
        : []),
      { id: "make-link", label: "New component", icon: "component", onSelect: () => makeLink(ids) },
      ...(chosen.some((p) => p.link) ? [{ id: "select-link", label: "Select component", icon: "component" as const, onSelect: () => selectLink(ids) }] : []),
      {
        id: "reference",
        label: chosen.length && chosen.every((p) => p.reference) ? "Make printable" : "Make a reference",
        icon: "ghost",
        onSelect: () => toggleReference(ids),
      },
      {
        id: "hide",
        label: allHidden ? "Show" : "Hide",
        icon: allHidden ? "eye" : "eyeOff",
        keys: formatCombo("shift+h"),
        onSelect: () => toggle(ids, "hidden"),
      },
      { kind: "separator", id: "s1" },
      { id: "delete", label: "Delete", icon: "trash", keys: "Del", danger: true, onSelect: () => remove(ids) },
    ];
  };

  // Help (#110): the same commands as the palette's Help group.
  const helpEntries: MenuEntry[] = [
    { id: "shortcuts", label: "Keyboard shortcuts", icon: "keyboard", keys: "?", onSelect: () => registry.run("help.shortcuts") },
    { id: "tour", label: "Take the tour", icon: "info", onSelect: () => registry.run("help.tour") },
    { id: "tips", label: "Tips", icon: "bulb", onSelect: () => registry.run("help.tips") },
    { id: "learn", label: "Learn BetterCad", icon: "link", onSelect: () => registry.run("help.learn") },
    { kind: "separator", id: "s1" },
    { id: "report", label: "Report a problem…", icon: "warning", onSelect: () => registry.run("help.report") },
    { id: "whatsNew", label: "What's new", icon: "star", onSelect: () => registry.run("help.whatsNew") },
    { id: "about", label: "About BetterCad", icon: "info", onSelect: () => registry.run("help.about") },
  ];
  const saveTip = files.cloud && account ? "Save to your account" : files.inPlace ? "Save" : "Save (downloads a file)";
  const saveEntries: MenuEntry[] = [
    { id: "saveAs", label: "Save as…", icon: "save", keys: formatCombo("shift+mod+s"), onSelect: () => void saveAs() },
    { id: "open", label: "Open…", icon: "folder", keys: formatCombo("mod+o"), onSelect: () => void open() },
    { id: "new", label: "New model", icon: "plus", keys: formatCombo("mod+n"), onSelect: newModel },
    { id: "import", label: "Import STL, STEP or 3MF…", icon: "upload", onSelect: () => void open() },
    { id: "import-reference", label: "Import as a reference…", icon: "ghost", onSelect: () => referenceInput.current?.click() },
    ...files.recentEntries,
    { kind: "separator", id: "s1" },
    account
      ? files.cloud
        ? { id: "disk", label: "Save a copy to disk", icon: "save", onSelect: () => void files.saveToDisk() }
        : { id: "cloud", label: "Save to your account…", icon: "cloud", onSelect: () => void files.saveCloud() }
      : accountsOn
        ? { id: "cloud", label: "Sign in to save to your account", icon: "cloud", onSelect: () => go("#/signin?next=%23%2F") }
        : { id: "cloud", label: "Accounts can't be reached here", icon: "cloudOff", disabled: true, onSelect: () => {} },
  ];

  const selectionText =
    selectedParts.length === 0
      ? "Nothing selected."
      : selectedParts.length === 1
        ? `${selectedParts[0]!.name} selected.`
        : `${selectedParts.length} parts selected.`;
  /** A failed step's way out (#77): fix it where it can be fixed, or set it aside. */
  const problemId = activeFeatureId && failed.has(activeFeatureId) ? activeFeatureId : null;
  const problem = problemId ? doc.features.find((f) => f.id === problemId) : undefined;
  const repick = (id: string) => {
    const i = store.get().features.findIndex((f) => f.id === id);
    const f = store.get().features[i];
    if (!f || (f.type !== "fillet" && f.type !== "chamfer" && f.type !== "shell")) return;
    const back = live.current.marker;
    // A step that built keeps its picks: they number the edges of the body just before it, which has not changed.
    const keep = !failed.has(f.id) && f.refs.length > 0;
    moveMarker(i);
    setTool(f.type === "shell" ? "shell" : "fillet");
    finish.repick(f, () => setMarker(back), keep);
    const name = parts.find((p) => p.id === f.part)?.name ?? "the body";
    const what = f.type === "shell" ? "faces to leave open" : "edges";
    say(keep ? `Change the ${what} or the size on ${name}, then press Enter` : `Pick the ${what} again on ${name}, then press Enter`);
  };
  /**
   * A double-click or double-tap on a timeline tile (#73): a sketch opens in sketch mode, a step with settings opens
   * its tool on the step, fillet, chamfer and shell open to pick again, and the rest select their parts for Properties.
   * A step past the marker is rolled forward to first, so it is built while you change it.
   */
  const editStep = (f: Feature) => {
    const i = store.get().features.findIndex((x) => x.id === f.id);
    if (i < 0) return;
    if (f.type === "fillet" || f.type === "chamfer" || f.type === "shell") return repick(f.id);
    if (i >= at) moveMarker(i + 1);
    switch (f.type) {
      case "sketch":
        return sketch.edit(f.id);
      case "extrude":
      case "hole":
      case "mount":
      case "revolve":
      case "pushpull": {
        setEditingStep(f.id);
        setTool(f.type);
        ({ extrude, hole, mount, revolve, pushpull })[f.type].edit(f.id);
        return;
      }
      case "construct":
        setEditingStep(f.id);
        setTool("construct");
        return construct.edit(f.id);
      case "pattern":
        // Opens with its saved kind, counts, angle, axis and picks, to change them.
        setEditingStep(f.id);
        setTool("pattern");
        return pattern.edit(f.id);
      case "drive":
        return setDriveDialog({ editing: f });
      case "joint":
        // Opens the joint's panel with every field: both components and their snaps, how it moves and lines up.
        setEditingStep(f.id);
        setTool("joint");
        return setJointEdit(f.id);
      case "add":
      case "move":
      case "resize": {
        pickStep(f);
        const later = store.get().features.length - i - 1;
        return say(
          later ? `Change ${f.name} in Properties. ${laterText(later, ["rebuilds", "rebuild"])} after it and may break.` : `Change ${f.name} in Properties.`,
        );
      }
      default:
        pickStep(f);
        return say(`${f.name} has no settings to change. Right-click it for more.`);
    }
  };
  const editEntry = problem ? featureMenu(problem.id).find((e) => e.id === "edit") : undefined;
  const problemBanner = problem && (
    <div className="bc-problem">
      <Banner
        tone="warn"
        action={
          <span className="bc-actions">
            {(problem.type === "fillet" || problem.type === "chamfer" || problem.type === "shell") && (
              <Button size="dense" label="Re-pick" title="Pick the edges or faces again" onClick={() => repick(problem.id)} />
            )}
            {editEntry && "onSelect" in editEntry && <Button size="dense" label="Edit" onClick={editEntry.onSelect} />}
            <Button size="dense" label={problem.suppressed ? "Unsuppress" : "Suppress"} onClick={() => suppressFeature(problem.id)} />
            <Button size="dense" variant="danger" label="Delete" onClick={() => deleteFeature(problem.id)} />
          </span>
        }
      >
        {problem.name}: {failed.get(problem.id)}
      </Banner>
    </div>
  );
  const problemCount = failed.size;
  const problemsButton =
    problemCount > 0 && !sketch.editing && tool === "select" ? (
      <Button
        size="dense"
        icon="warning"
        label={`Rebuilt with ${problemCount === 1 ? "1 problem" : `${problemCount} problems`}`}
        title="Select the first step with a problem"
        onClick={() => {
          const first = doc.features.find((f) => failed.has(f.id));
          if (first) {
            setActiveFeature(first.id);
            setPropsOpen(true);
            setPropsHidden(false);
          }
        }}
      />
    ) : null;

  const helpText = render
    ? "Drag to turn the picture, right-drag to pan, scroll to zoom. Esc goes back to modelling."
    : sketch.help
      ? sketch.help
      : place.help
        ? place.help
        : extrude.help || revolve.help || pushpull.help || hole.help || mount.help || gear.help || jointHelp || pattern.help || measure.help || construct.help
          ? extrude.help || revolve.help || pushpull.help || hole.help || mount.help || gear.help || jointHelp || pattern.help || measure.help || construct.help
          : finish.help
            ? finish.help
            : vp.elementText
              ? `${vp.elementText} Esc clears it.`
              : tool === "select" && selectedParts.length
                ? `${selectionText} Esc clears the selection.`
                : activeTool.help;

  const onPropChange = (key: "position" | "size" | "rotation", axis: keyof Vec3, value: number) => {
    const ids = selection;
    const verb = key === "size" ? "Resize" : key === "rotation" ? "Turn" : "Move";
    record(
      (d, at) => changeParts(d, ids, key, { [axis]: value }, at),
      `${verb} ${selectedParts.length === 1 ? selectedParts[0]!.name : `${ids.length} parts`}`,
      `props:${ids.join(",")}:${key}.${axis}`,
    );
  };

  /** A size field's edit is done: keep the expression typed (#75) on the step that took the change, then seal it. */
  const onPropCommit = (key: "position" | "size" | "rotation", axis: keyof Vec3, _value: number, expression?: string) => {
    const ids = selection;
    const d = store.get();
    const type = key === "size" ? "resize" : "move";
    const f = [...d.features.slice(0, live.current.marker ?? d.features.length)]
      .reverse()
      .find((x) => x.type === type && x.parts.length === ids.length && ids.every((id) => x.parts.includes(id)));
    const path = `${key}.${axis}`;
    if (f && (expression || f.exprs?.[path])) {
      store.edit((x) => setExpr(x, f.id, path, expression), f.name, `props:${ids.join(",")}:${key}.${axis}`);
    }
    store.seal();
  };
  const scope = useMemo(() => paramScope(doc), [doc]);
  // Sketch sizes that use parameters re-solve when a parameter changes (#75), so the solver loads once there are any.
  const solverRef = useRef<Solver | null>(null);
  const hasParams = (doc.params?.length ?? 0) > 0;
  useEffect(() => {
    if (hasParams && !solverRef.current) void loadSolver().then((s) => (solverRef.current = s));
  }, [hasParams]);
  const relink = (d: ModelDoc, solver: Solver) =>
    relinkSketches(d, (sk) => {
      const r = solver.solve(sk);
      return r.status === "ok" || r.status === "redundant" ? r.sketch : null;
    });
  const changeParams = (fn: (d: ModelDoc) => ModelDoc, label: string) => {
    const solver = solverRef.current;
    if (solver) return store.edit((d) => relink(fn(d), solver), label);
    store.edit(fn, label);
    void loadSolver().then((sv) => {
      solverRef.current = sv;
      const d = store.get();
      if (relink(d, sv) !== d) store.edit((x) => relink(x, sv), label);
    });
  };
  const paramsDialog = paramsOpen && (
    <Suspense fallback={null}>
      <ParamsDialog
        onClose={() => setParamsOpen(false)}
        onEdit={(label, fn) => store.edit(fn, label)}
        doc={doc}
        onAdd={() => store.edit((d) => addParam(d), "Add a parameter")}
        onChange={(id, change) => changeParams((d) => updateParam(d, id, change), "Change a parameter")}
        onRemove={(id) => store.edit((d) => removeParam(d, id), "Delete a parameter")}
        onShowUses={(fids) => {
          if (fids[0]) setActiveFeature(fids[0]);
          const names = doc.features.filter((f) => fids.includes(f.id)).map((f) => f.name);
          if (names.length) say(`Used by ${names.join(", ")}`);
        }}
        say={say}
      />
    </Suspense>
  );

  if (share && inactive) {
    return (
      <Page title="Shared model">
        <p>This link isn&rsquo;t active any more. Ask whoever sent it for a new one.</p>
        <p>
          <a href="#/">Open the editor</a>
        </p>
      </Page>
    );
  }

  return (
    <>
      <input
        ref={referenceInput}
        type="file"
        hidden
        multiple
        accept=".stl,.step,.stp,.3mf"
        aria-label="Import as a reference"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          if (list.length) void importFiles(list, undefined, { call: kernel.call, record, say, select: setSelection, reference: true });
        }}
      />
      <AppShell
        topBar={
          <TopBar
            paramsOpen={paramsOpen}
            onParams={() => setParamsOpen(!paramsOpen)}
            tool={tool}
            onArmTool={(id) => (id === "pattern" ? toolbarPattern(false) : armTool(id))}
            onConstruct={startConstruct}
            mirrorOn={mirrorOn}
            onMirror={() => toolbarPattern(true)}
            onNewComponent={() => makeLink([])}
            panel={panel}
            onPanel={showPanel}
            canUndo={store.canUndo()}
            canRedo={store.canRedo()}
            undoLabel={store.undoLabel()}
            redoLabel={store.redoLabel()}
            onUndo={doUndo}
            onRedo={doRedo}
            saveEntries={saveEntries}
            saveTip={saveTip}
            onSave={() => void save()}
            helpEntries={helpEntries}
            account={account ? { name: account.name } : null}
            accountsOn={accountReady && accountsOn}
            cloud={files.cloud?.state ?? null}
            onHistory={() => setVersionsOpen(true)}
            onShare={files.cloud && !files.viewing ? () => setShareOpen(true) : undefined}
            shared={files.shared ? { owner: files.shared.owner } : null}
            onOpenCopy={files.openCopy}
            onDownloadBcad={files.saveToDisk}
            onExport={() => setExportOpen(true)}
            onExportSteps={doc.features.length ? exportBuildSteps : undefined}
            onSignOut={signOut}
            onInstall={installable && !share ? installApp : undefined}
            onPalette={() => setPaletteOpen(true)}
            theme={theme}
            onTheme={setTheme}
            onProps={() => registry.run("view.props")}
            propsOpen={narrow ? propsOpen : !propsHidden}
          />
        }
        status={
          <span className={cx("bc-status", status.bad && "bc-bad")} role={status.bad ? "alert" : "status"} aria-live={status.bad ? "assertive" : "polite"}>
            {status.text}
          </span>
        }
        toast={
          <>
            <div className="bc-toast-slot" role="status" aria-live="polite">
              {toast && (
                <div key={toast.id} className="bc-toast">
                  {toast.text}
                </div>
              )}
            </div>
            {paramsDialog}
            {whatsNew.card && (
              <Suspense fallback={null}>
                <WhatsNewCard fresh={whatsNew.fresh} onOpen={whatsNew.show} onDismiss={whatsNew.dismiss} />
              </Suspense>
            )}
            {tips.open && (
              <Suspense fallback={null}>
                <TipsCard from={tips.from} onDismiss={tips.dismiss} />
              </Suspense>
            )}
          </>
        }
        leftLabel={panel ? PANEL_TITLES[panel] : undefined}
        leftPanel={
          panel && (
            <LeftPanel
              printPanel={printPanel}
              robotPanel={
                <Suspense fallback={null}>
                  <CataloguePanel
                    placing={place.part?.id ?? null}
                    onPick={(p) => {
                      setTool("select");
                      place.start(p);
                    }}
                  />
                </Suspense>
              }
              orientWeights={orientWeights}
              onOrientWeights={setOrientWeights}
              panel={panel}
              doc={doc}
              parts={parts}
              selection={selection}
              onSelect={selectFromBrowser}
              onAdd={add}
              onToggle={(id, what) => toggle(selection.includes(id) ? selection : [id], what)}
              onRename={rename}
              onRenameModel={renameModel}
              readOnly={!!files.shared}
              onBack={() => showPanel("parts")}
              onReorder={(id, before) => store.edit((d) => reorderPart(d, id, before), "Reorder parts")}
              partMenu={partMenu}
              renameId={renameId}
              onRenameIdChange={setRenameId}
              sketches={browserSketches}
              links={built.components}
              activeComponent={workIn}
              onActivate={activate}
              onMoveInto={moveIn}
              joints={browserJoints}
              poses={posesProps}
              origin={originShown}
              onOrigin={setOriginShown}
              onBodiesHidden={(ids, hidden, name) => setHidden(ids, hidden, "parts", name)}
              onSketchesHidden={(ids, hidden, name) => setHidden(ids, hidden, "sketches", name)}
              onBrowserPicked={setBrowserPicked}
              onSketchOn={sketch.startOnPlane}
              construct={browserConstruct}
              onSketchOnStep={sketch.startOnStep}
              features={doc.features}
              at={at}
              failed={failed}
              summary={summary}
              activeFeatureId={activeFeatureId}
              onSelectFeature={selectFeature}
              onRenameFeature={renameFeature}
              onReorderFeature={moveFeature}
              featureMenu={featureMenu}
              featureRenameId={featureRenameId}
              onFeatureRenameIdChange={setFeatureRenameId}
              timelineShown={timelineShown}
              onTimelineShown={setTimelineShown}
              bedShown={showBed}
              onBedShown={setShowBed}
              theme={theme}
              onTheme={setTheme}
            />
          )
        }
        stageToolbar={
          sketch.editing ? (
            <Suspense fallback={null}>
              <SketchBars s={sketch} />
            </Suspense>
          ) : (
            <>
              {files.banners}
              {render ? (
                <Suspense
                  fallback={
                    <div role="group" aria-label="Render options" className="bc-tools bc-armed">
                      <span className="bc-armed-note" role="status">
                        Loading the renderer…
                      </span>
                    </div>
                  }
                >
                  <RenderBar
                    session={render}
                    onClose={closeRender}
                    onNote={(text) => say(text, false, true)}
                    onExportGltf={() => {
                      closeRender();
                      setExportFormat("glb");
                      setExportOpen(true);
                    }}
                  />
                </Suspense>
              ) : (
                <StageBars
                  tool={activeTool}
                  onArmTool={armTool}
                  vp={vp}
                  onePart={selection.length === 1}
                  onRender={openRender}
                  say={window.matchMedia?.("(pointer: coarse)").matches ? say : undefined}
                />
              )}
              {place.part && (
                <Suspense fallback={null}>
                  <PlaceBar x={place} />
                </Suspense>
              )}
              {tool === "sketch" && (
                <Suspense fallback={null}>
                  <SketchPickBar onCancel={() => setTool("select")} />
                </Suspense>
              )}
              {(tool === "extrude" || tool === "revolve") && (
                <Suspense fallback={null}>
                  {tool === "extrude" ? (
                    <ExtrudeBar x={extrude} parts={parts} scope={scope} error={extrude.feature ? failed.get(extrude.feature.id) : undefined} />
                  ) : (
                    <ExtrudeBar x={revolve} parts={parts} scope={scope} error={revolve.feature ? failed.get(revolve.feature.id) : undefined} />
                  )}
                </Suspense>
              )}
              {tool === "measure" && (
                <Suspense fallback={null}>
                  <MeasureBar m={measure} onDone={() => setTool("select")} />
                </Suspense>
              )}
              {tool === "construct" && construct.info && (
                <Suspense fallback={null}>
                  <ConstructBar
                    x={construct}
                    scope={scope}
                    error={construct.session ? failed.get(construct.session.id) : undefined}
                    onCancel={() => setTool("select")}
                  />
                </Suspense>
              )}
              {tool === "joint" && (
                <Suspense fallback={null}>
                  <JointTool
                    deps={{
                      store,
                      record,
                      doc,
                      parts,
                      links: built.links,
                      joints: built.joints,
                      view: vp.ref,
                      active: !sketch.editing,
                      onClose: () => setTool("select"),
                      say,
                      measure: kernel.measure,
                    }}
                    edit={jointEdit}
                    onEdited={jointEdited}
                    onState={setJointUi}
                    api={jointApi}
                    failed={failed}
                    scope={scope}
                    onCancel={() => setTool("select")}
                  />
                </Suspense>
              )}
              {tool === "gear" && (
                <Suspense fallback={null}>
                  <GearBar x={gear} error={gear.session ? failed.get(gear.session.id) : undefined} onCancel={() => setTool("select")} />
                </Suspense>
              )}
              {(tool === "mount" || tool === "pattern") && (
                <Suspense fallback={null}>
                  {tool === "mount" ? (
                    <MountBar x={mount} error={mount.session ? failed.get(mount.session.id) : undefined} onCancel={() => setTool("select")} />
                  ) : (
                    <PatternBar x={pattern} error={pattern.session ? failed.get(pattern.session.id) : undefined} onCancel={() => setTool("select")} />
                  )}
                </Suspense>
              )}
              {tool === "hole" && (
                <Suspense fallback={null}>
                  <HoleBar x={hole} error={hole.session ? failed.get(hole.session.id) : undefined} onCancel={() => setTool("select")} />
                </Suspense>
              )}
              {tool === "pushpull" && (
                <Suspense fallback={null}>
                  <PushPullBar x={pushpull} error={pushpull.session ? failed.get(pushpull.session.id) : undefined} onCancel={() => setTool("select")} />
                </Suspense>
              )}
              {(tool === "fillet" || tool === "shell") && (
                <Suspense fallback={null}>
                  <FinishBar f={finish} preview={finishPreview} onCancel={() => setTool("select")} />
                </Suspense>
              )}
              {tool === "combine" && (
                <Suspense fallback={null}>
                  <CombineBar
                    picked={selection.map((id) => parts.find((p) => p.id === id)).filter((p): p is (typeof parts)[number] => !!p)}
                    op={combineOp}
                    onOp={setCombineOp}
                    keepTools={keepTools}
                    onKeepTools={setKeepTools}
                    fit={combineFit}
                    onFit={setCombineFit}
                    tuned={doc.print?.fits}
                    onApply={() => combine(selection, combineOp, keepTools, combineFit)}
                    error={combineRequest ? combinePreview.error : null}
                    onCancel={() => setTool("select")}
                  />
                </Suspense>
              )}
            </>
          )
        }
        stage={
          <View3D
            ref={vp.ref}
            parts={viewParts}
            meshes={kernel.bodies}
            engine={kernel.state}
            picks={finish.tool ? finish.picks : tool === "measure" ? measure.picks : vp.picks}
            preview={preview}
            filter={vp.filter}
            mode={vp.mode}
            style={vp.style}
            ortho={vp.ortho}
            view={vp.view}
            section={sketch.slice ?? vp.section}
            stats={vp.stats}
            description={`${parts.length} parts. ${vp.elementText || selectionText}`}
            onPick={sketch.editing ? NO_PICK : vp.onPick}
            onTransform={vp.onTransform}
            onTransforming={vp.onTransforming}
            onSection={vp.onSection}
            onBodyDrag={posing ? bodyDrag : undefined}
            onPoint={toolPick ? takePoint : undefined}
            onCamera={composedCamera}
            onMenu={(pick, at) => {
              if (sketch.editing) return;
              const body = pick && parts.some((p) => p.id === pick.body) ? pick.body : null;
              const ids = body ? (selection.includes(body) ? selection : [body]) : [];
              if (body) setSelection(ids);
              setViewMenuAt({ ids, at });
            }}
            onHome={vp.goHome}
            cubeMenu={cubeMenu}
            bed={showBed && !share ? { ...printer, label: bedLabel(printer) } : null}
            warn={viewWarn}
            check={checkResult?.values ?? null}
            originPlanes={{
              shown: sketch.editing ? [] : originShown.filter((x): x is WorldPlaneName => x.length === 2),
              chosen: sketch.editing ? null : planeOf(browserPicked ?? ""),
              point: !sketch.editing && (originShown.includes("point") || browserPicked === ROW.point),
            }}
            emptyHint={!emptyState && !sketch.editing && tool !== "sketch" && built.sketches.length === 0}
          >
            {sketch.sketch && (
              <Suspense fallback={null}>
                <SketchLabels s={sketch} />
              </Suspense>
            )}
            {render && (
              <Suspense fallback={null}>
                <RenderPicture
                  session={render}
                  bodies={renderBodies}
                  section={vp.section}
                  camera={renderCam.current ?? DEFAULT_CAMERA}
                  onCamera={onRenderCamera}
                  onSave={saveRender}
                  home={doc.home ?? null}
                  onSetHome={vp.setHomeTo}
                  onResetHome={vp.resetHome}
                />
              </Suspense>
            )}
            {emptyState && (
              <Suspense fallback={null}>
                <EmptyState
                  onShape={() => setPanel("library")}
                  onSketch={() => armTool("sketch")}
                  onOpen={() => void open()}
                  onSample={(id) => files.openSample(id)}
                />
              </Suspense>
            )}
          </View3D>
        }
        timeline={
          timelineShown && (
            <Timeline
              features={doc.features}
              at={at}
              onMarker={moveMarker}
              failed={failed}
              activeId={pickedStep ?? activeFeatureId}
              summary={summary}
              onSelect={pickStep}
              warning={timelineWarning}
              onReorder={moveFeature}
              moveProblem={(id, beforeId) => moveProblem(doc, id, beforeId)}
              onMenu={(f, p) => setFeatureMenuAt({ id: f.id, at: p })}
              onEdit={editStep}
              onHistory={() => showPanel(panel === "history" ? "parts" : "history")}
              historyOpen={panel === "history"}
              picking={
                tool === "pattern" && pattern.of === "features" && !pattern.pickingPlane && !pattern.pickingAxis
                  ? {
                      can: (id) => pattern.mirrorable.some((m) => m.id === id),
                      picked: pattern.feature?.features ?? [],
                      onPick: (f) => pattern.toggleFeature(f.id),
                    }
                  : null
              }
            />
          )
        }
        helpLine={
          problemsButton ? (
            <span className="bc-help-row">
              {problemsButton}
              <span>{helpText}</span>
            </span>
          ) : (
            helpText
          )
        }
        rightPanel={
          sketch.editing ? (
            <Suspense fallback={null}>
              <SketchPanel s={sketch} />
            </Suspense>
          ) : (
            <>
              {problemBanner}
              <Properties
                parts={selectedParts}
                totalParts={parts.length}
                onChange={onPropChange}
                onCommit={onPropCommit}
                scope={scope}
                volumes={volumes}
                sizes={sizes}
                measures={measures}
                print={doc.print}
                allParts={parts}
                onHole={() => toggleHole(selection)}
                onReference={() => toggleReference(selection)}
                onColour={(colour) => store.edit((d) => setLook(d, selection, () => ({ colour })), colour ? "Set the colour" : "Clear the colour")}
                onFinish={(finish) => store.edit((d) => setLook(d, selection, () => ({ finish })), "Set the finish")}
                onFit={(c) =>
                  store.edit((d) => setLook(d, selection, () => ({ fit: c.fit ?? undefined, gap: c.fit ? undefined : c.gap || undefined })), "Set the fit")
                }
                mass={massInfo}
                clashes={
                  parts.length > 1
                    ? {
                        on: clashOn,
                        onToggle: setClashOn,
                        sameLink: !!clashOpts.sameLink,
                        references: !!clashOpts.references,
                        onOptions: (change) => setClashOpts((o) => ({ ...o, ...change })),
                        poses: built.joints.length ? [{ id: "home", name: "Home" }, ...(doc.poses ?? []).map((x) => ({ id: x.id, name: x.name }))] : undefined,
                        at: doc.poses?.some((x) => x.id === clashAt) || clashAt === "home" ? clashAt : null,
                        onAt: setClashAt,
                        progress: clashProgress,
                        clashes,
                        nameOf: (id: string) => parts.find((p) => p.id === id)?.name ?? "A body",
                        onShow: showClash,
                        onStop: stopClashes,
                        sweep: built.joints.some(movable)
                          ? {
                              joints: built.joints
                                .filter((j) => movable(j) && !built.drives.some((d) => d.driven === j.id))
                                .map((j) => ({ id: j.id, name: j.name, kind: j.kind })),
                              run: (ask, progress) =>
                                kernelCall("sweep", { doc: live.current.doc, upTo: at, references: clashOpts.references, ...ask }, progress),
                              model: doc.features,
                              start: sweepStart,
                              store,
                              onShow: (pose) => {
                                setClashAt(null);
                                setClashOn(true);
                                setLivePose(store.isLocked() ? pose : null);
                              },
                              say,
                            }
                          : undefined,
                      }
                    : undefined
                }
                pose={
                  built.joints.length
                    ? {
                        joints: built.joints,
                        selected: built.joints.filter((j) => selectedParts.some((p) => p.link === j.child)),
                        pose: shownPose,
                        onChange: changePose,
                        onCommit: commitPose,
                        onHome: homeJoints,
                        drives: built.drives,
                        playing,
                        onPlay: play,
                        nameOf: (id: string) => built.joints.find((j) => j.id === id)?.name ?? "another joint",
                        locked: doc.tools?.length ? [...new Set(doc.tools.flatMap((t) => t.locked ?? []))] : undefined,
                        onLock: doc.tools?.length
                          ? (id: string, on: boolean) => {
                              const ik = ikMaths.current;
                              if (ik) store.edit((d) => ik.lockJoint(d, id, on), on ? "Lock the joint" : "Unlock the joint");
                            }
                          : undefined,
                      }
                    : undefined
                }
              />
            </>
          )
        }
        rightOpen={propsOpen}
        rightHidden={!narrow && propsHidden}
        onHideRight={() => (narrow ? setPropsOpen(false) : setPropsHidden(true))}
      />
      <span className="bc-sr-only" role="status" aria-live="polite">
        {selectionText} {tool === "select" ? "" : `${activeTool.label} tool armed.`}
      </span>
      {driveDialog && (
        <Suspense fallback={null}>
          <DriveDialog doc={doc} editing={driveDialog.editing} onDone={saveDrive} onCancel={() => setDriveDialog(null)} />
        </Suspense>
      )}
      {pendingDelete && (
        <Suspense fallback={null}>
          <DeleteStepDialog doc={doc} id={pendingDelete} onCancel={() => setPendingDelete(null)} onDelete={(all) => deleteNow(pendingDelete, all)} />
        </Suspense>
      )}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette open onClose={() => setPaletteOpen(false)} commands={commands} isEnabled={isEnabled} run={(id) => registry.run(id)} />
        </Suspense>
      )}
      <ContextMenu
        at={featureMenuAt?.at ?? null}
        onClose={() => setFeatureMenuAt(null)}
        label="Step actions"
        title={doc.features.find((f) => f.id === featureMenuAt?.id)?.name}
        entries={featureMenuAt ? featureMenu(featureMenuAt.id) : []}
      />
      <ContextMenu
        at={viewMenuAt?.at ?? null}
        onClose={() => setViewMenuAt(null)}
        label={viewMenuAt?.ids.length ? "Part actions" : "View actions"}
        title={
          !viewMenuAt?.ids.length ? "View" : viewMenuAt.ids.length > 1 ? `${viewMenuAt.ids.length} parts` : parts.find((p) => p.id === viewMenuAt.ids[0])?.name
        }
        entries={!viewMenuAt ? [] : viewMenuAt.ids.length ? partMenu(viewMenuAt.ids) : cubeMenu}
      />
      {vp.namingDialog}
      {files.dialog}
      {dropZone}
      {tour.card}
      {crash && !report && (
        <div className="bc-crash">
          <Banner
            tone="danger"
            action={
              <span className="bc-actions">
                <Button
                  size="dense"
                  label="Report this"
                  onClick={() => {
                    setReport({ prefill: lastError() ?? crash.message });
                    setCrash(null);
                  }}
                />
                <Button size="dense" label="Dismiss" onClick={() => setCrash(null)} />
              </span>
            }
          >
            Something went wrong: {crash.message}
          </Banner>
        </div>
      )}
      {report !== null && (
        <Suspense fallback={null}>
          <ReportDialog
            open
            prefill={report.prefill}
            onClose={() => setReport(null)}
            model={() => (store.get().features.length ? saveBcad(store.get()) : null)}
            info={() => ({ app: APP_VERSION, browser: browserName(), error: lastError(), actions: actionLog.list() })}
            say={say}
          />
        </Suspense>
      )}
      {exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog
            open={exportOpen}
            format={exportFormat}
            onClose={() => {
              setExportOpen(false);
              setExportFormat(undefined);
            }}
            onExported={tour.onExported}
            printer={printer.id === "custom" ? "your printer" : `a ${printer.name}`}
            fitProblem={fitProblem}
            doc={doc}
            upTo={at}
            parts={parts}
            selection={selection}
            call={kernel.call}
            files={files.store}
            say={say}
            onGroup={(ids) => group(ids)}
          />
        </Suspense>
      )}
      {versionsOpen && files.cloud && (
        <Suspense fallback={null}>
          <Versions
            api={api}
            modelId={files.cloud.modelId}
            name={doc.name}
            viewing={files.viewing?.number ?? null}
            onPreview={(n) => void files.previewVersion(n)}
            onClose={() => setVersionsOpen(false)}
            say={say}
          />
        </Suspense>
      )}
      {shareOpen && files.cloud && (
        <Suspense fallback={null}>
          <ShareDialog api={api} modelId={files.cloud.modelId} name={doc.name} onClose={() => setShareOpen(false)} say={say} />
        </Suspense>
      )}
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsDialog open onClose={() => setShortcutsOpen(false)} commands={commands} />
        </Suspense>
      )}
      {aboutOpen && (
        <Suspense fallback={null}>
          <AboutDialog open onClose={() => setAboutOpen(false)} />
        </Suspense>
      )}
      {whatsNew.open && (
        <Suspense fallback={null}>
          <WhatsNewDialog fresh={whatsNew.fresh} onClose={whatsNew.close} />
        </Suspense>
      )}
      <TooltipLayer />
    </>
  );
}
