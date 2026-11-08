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
import { DeleteStepDialog, earlierWarning, laterText } from "./DeleteStepDialog";
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
  type Feature,
  type ModelDoc,
  type PartKind,
  type PatternKind,
  type Vec3,
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
import { ParamsPanel } from "./ParamsPanel";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { useStatus } from "./useStatus";
import { useKernel } from "../kernel/useKernel";
import { useFiles } from "../files/useFiles";
import { importFiles } from "../files/importFiles";
import { useDrop } from "../files/useDrop";
import { Timeline, partIcon } from "./Timeline";
import { useSketch } from "../sketch/useSketch";
import { loadSolver } from "../sketch/solver";
import type { Solver } from "@bettercad/sketch";
import { SketchBars, SketchLabels, SketchPanel, SketchPickBar } from "../sketch/SketchUI";
import { useExtrude } from "../extrude/useExtrude";
import { ExtrudeBar } from "../extrude/ExtrudeUI";
import { bedLabel, newProfileId, usePrinterProfiles } from "../print/profiles";
import { NO_FIT, type FitChoice } from "../fit/FitMenu";
import { CombineBar, type CombineOp } from "./CombineBar";
import { useFinish } from "../finish/useFinish";
import { FinishBar } from "../finish/FinishBar";
import { usePushPull } from "../finish/usePushPull";
import { PushPullBar } from "../finish/PushPullBar";
import { useHole } from "../hole/useHole";
import { usePlacePart } from "../catalogue/usePlacePart";
import { CataloguePanel } from "../catalogue/CataloguePanel";
import { PlaceBar } from "../catalogue/PlaceBar";
import { HoleBar } from "../hole/HoleBar";
import { useMount } from "../mount/useMount";
import { KEY as gearKey, useGear } from "../gear/useGear";
import { usePattern } from "../pattern/usePattern";
import { install, useInstallable, useLaunchFiles } from "../pwa/install";
import type { FileHandle } from "../files/fileStore";
import { useMeasure } from "../measure/useMeasure";
import { MeasureBar } from "../measure/MeasureBar";
import { useAccount } from "../cloud/account";
import { go } from "../cloud/route";
import { Versions } from "../cloud/Versions";
import { ShareDialog } from "../cloud/ShareDialog";
import { EmptyState } from "./EmptyState";
import { useTour } from "../tour/Tour";
import { AboutDialog } from "../help/AboutDialog";
import { COURSE_URL } from "../help/about";
import { ReportDialog } from "../report/ReportDialog";
import { actionLog, editSummary } from "../report/actionLog";
import { browserName } from "../report/report";
import { lastError, onCaught, watchWindow, type Caught } from "../report/errors";
import { APP_VERSION } from "../version";
import { saveBcad } from "@bettercad/kernel/bcad";
import type { Mate } from "@bettercad/kernel";
import { PrintPanel, type PrintCheck, type Suggestion } from "../print/PrintPanel";
import { Page } from "../pages/Page";
import { ROW, planeOf, type OriginItem } from "./Browser";
import type { WorldPlaneName } from "../viewport/engine";

/** The gear bar loads when the Gear tool is first armed, keeping it out of the first paint. */
const PatternBar = lazy(() => import("../pattern/PatternBar").then((m) => ({ default: m.PatternBar })));
const MountBar = lazy(() => import("../mount/MountBar").then((m) => ({ default: m.MountBar })));
const GearBar = lazy(() => import("../gear/GearBar").then((m) => ({ default: m.GearBar })));

const PANELS: RailItem<PanelId>[] = [
  { id: "parts", icon: "layers", label: "Browser" },
  { id: "library", icon: "shapes", label: "Library" },
  { id: "robot", icon: "screw", label: "Catalogue" },
  { id: "history", icon: "history", label: "History" },
  { id: "params", icon: "sliders", label: "Parameters" },
  { id: "print", icon: "printer", label: "Print" },
  { id: "settings", icon: "settings", label: "Settings" },
];

const THEME_LABEL: Record<ThemeSetting, string> = { system: "Match the system", light: "Light", dark: "Dark", holodeck: "Holodeck" };

const NO_PICK = () => {};
const NARROW = "(max-width: 899px)";
const TIMELINE_KEY = "bettercad.timeline";

const ORIENT_KEY = "bettercad.orientWeights";

/** The Export dialog loads on first use, keeping the first-paint bundle in budget. */
const ExportDialog = lazy(() => import("../export/ExportDialog").then((m) => ({ default: m.ExportDialog })));

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

function readTimelineShown() {
  try {
    return localStorage.getItem(TIMELINE_KEY) !== "off";
  } catch {
    return true;
  }
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
  const [activeFeature, setActiveFeature] = useState<string | null>(null);
  const [featureMenuAt, setFeatureMenuAt] = useState<{ id: string; at: ContextMenuState } | null>(null);
  const [featureRenameId, setFeatureRenameId] = useState<string | null>(null);
  const [timelineShown, setTimelineShownState] = useState(readTimelineShown);
  const setTimelineShown = useCallback((on: boolean) => {
    setTimelineShownState(on);
    try {
      localStorage.setItem(TIMELINE_KEY, on ? "on" : "off");
    } catch {
      // Private windows can refuse storage; the setting then lasts for this visit.
    }
  }, []);

  const narrow = useMedia(NARROW);
  const [selection, setSelection] = useState<string[]>([]);
  // The browser's origin planes on show, and its sketch or plane pick: view state, like the marker.
  const [originShown, setOriginShown] = useState<OriginItem[]>([]);
  const [browserPicked, setBrowserPicked] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId | null>(() => (window.matchMedia?.(NARROW).matches ? null : "parts"));
  const [propsOpen, setPropsOpen] = useState(false);
  const [tool, setTool] = useState<ToolId>("select");
  const [combineOp, setCombineOp] = useState<CombineOp>("join");
  const [keepTools, setKeepTools] = useState(false);
  const [combineFit, setCombineFit] = useState<FitChoice>(NO_FIT);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Report a problem (#109): open, and the error that offered it, if one did.
  const [report, setReport] = useState<{ prefill?: string } | null>(null);
  const [crash, setCrash] = useState<Caught | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [inactive, setInactive] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const { theme, setTheme, resolved } = useTheme();
  const [status, say] = useStatus();

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
    dialogOpen: paletteOpen || shortcutsOpen || aboutOpen || exportOpen || report !== null,
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
  useEffect(() => registry.register(vp.commands), [registry, vp.commands]);

  const shownSketches = useMemo(() => built.sketches.filter((s) => !doc.looks[s.id]?.hidden), [built.sketches, doc.looks]);
  const browserSketches = useMemo(
    () => built.sketches.map((s) => ({ id: s.id, name: s.name, hidden: !!doc.looks[s.id]?.hidden, warning: failed.get(s.id) })),
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
  });
  live.current.sketching = sketch.editing;
  useEffect(() => registry.register(sketch.commands), [registry, sketch.commands]);

  const extrude = useExtrude({
    kind: "extrude",
    store,
    record,
    doc,
    sketches: built.sketches,
    parts,
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
    selection,
    view: vp.ref,
    active: tool === "revolve" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
    theme: resolved,
  });
  useEffect(() => registry.register(revolve.commands), [registry, revolve.commands]);

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

  const [patternStart, setPatternStart] = useState<PatternKind | null>(null);
  const pattern = usePattern({
    store,
    record,
    doc,
    selection,
    setSelection,
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

  const place = usePlacePart({ record, view: vp.ref, select: setSelection, say });
  live.current.placing = !!place.part;

  const finish = useFinish({
    record,
    update: (fn, label) => store.edit(fn, label),
    parts,
    view: vp.ref,
    tool: sketch.editing ? null : tool === "fillet" || tool === "shell" ? tool : null,
    onClose: () => setTool("select"),
    say,
  });
  // While sketching the model goes faint, so the sketch reads on top of it. Project needs the faces solid to pick them.
  const ghostParts = sketch.editing && sketch.stool !== "project";
  const viewParts = useMemo(() => parts.map((p) => (ghostParts || p.hole ? { ...p, ghost: true } : p)), [parts, ghostParts]);
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

  // Links (#171): bodies named as one rigid part of a robot, kept as separate bodies.
  const makeLink = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const id = newId("f");
      const name = addLink(live.current.doc, ids, id).features.find((f) => f.id === id)!.name;
      record((d, at) => addLink(d, ids, id, at), `Make ${name}`);
      say(`Made ${name} of ${ids.length === 1 ? "1 body" : `${ids.length} bodies`}. They stay separate bodies.`);
    },
    [record, say],
  );
  const selectLink = useCallback(
    (ids: string[]) => {
      const part = live.current.parts.find((p) => ids.includes(p.id) && p.link);
      if (!part) return say("That body isn't in a link", true);
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
    (ids: string[], what: RowToggle) => {
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
    (ids: string[], hidden: boolean, what: "parts" | "sketches") => {
      if (!ids.length) return;
      const one = ids.length === 1 ? (live.current.parts.find((p) => p.id === ids[0])?.name ?? store.get().features.find((f) => f.id === ids[0])?.name) : null;
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
      const print = live.current.doc.print;
      const list = tools.map((t) => (op === "cut" ? cutTool(t, fit.fit, fit.gap, print) : { id: t, op }));
      record((d, at) => addCombine(d, { mode: "combine", target, tools: list, keepTools: keep }, newId("f"), at), "Combine");
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

  const files = useFiles({
    store,
    doc,
    view: vp.ref,
    say,
    onImport: (list, at) => importFiles(list, at, { call: kernel.call, record, say, select: setSelection }),
    onSwitched: () => {
      setMarker(null);
      setSelection([]);
      setActiveFeature(null);
    },
  });
  const { save, saveAs, open, newModel } = files;

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
  const moveFeature = useCallback(
    (id: string, beforeId: string | null) => {
      const d = store.get();
      const f = d.features.find((x) => x.id === id);
      if (!f) return;
      const why = moveProblem(d, id, beforeId);
      if (why) return say(`${why}, so it can't go there`, true);
      store.edit((x) => reorderFeature(x, id, beforeId), `Move ${f.name} on the timeline`);
    },
    [store, say],
  );

  // Esc backs out one layer at a time: the narrow sheets, then the tool, then the selection. Menus and dialogs sit above.
  useEscape(tool !== "select", () => setTool("select"), ESC.tool);
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
    openExport: () => {},
    startTour: () => {},
    printCheck: (_c: PrintCheck) => {},
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
    mirror: () => {},
    add,
    showPanel,
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
    openExport: () => setExportOpen(true),
    startTour: tour.start,
    printCheck: (c: PrintCheck) => {
      setCheck((now) => (now === c ? "none" : c));
      showPanel("print");
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
    mirror,
    add,
    showPanel,
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
        run: () => h().armTool(t.id),
        keywords: t.title,
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
        id: "link.make",
        scope: "model",
        label: "Make link",
        group: "Edit",
        icon: "link",
        run: () => h().makeLink(sel()),
        when: hasSel,
        keywords: "robot rigid link body group joint urdf",
      },
      {
        id: "link.select",
        scope: "model",
        label: "Select link",
        group: "Edit",
        icon: "link",
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
        when: () => ["extrude", "revolve", "pushpull", "hole", "mount", "gear", "pattern", "combine", "fillet", "shell"].includes(live.current.tool),
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
      ...(Object.keys(THEME_LABEL) as ThemeSetting[]).map<Command>((t) => ({
        id: `theme.${t}`,
        label: `Theme: ${THEME_LABEL[t]}`,
        group: "Theme",
        icon: t === "light" ? "sun" : t === "system" ? "settings" : "moon",
        run: () => h().setTheme(t),
      })),
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
      { id: "help.about", label: "About BetterCad", group: "Help", icon: "info", run: () => setAboutOpen(true), keywords: "version licence licenses" },
    ];
    if (import.meta.env.DEV || import.meta.env.VITE_GALLERY) {
      list.push({ id: "help.gallery", label: "Component gallery", group: "Help", icon: "template", run: () => (window.location.hash = "#/gallery") });
    }
    return registry.register(list);
  }, [registry]);

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
  const timelineWarning = earlierWarning(doc, at, sketch.editingId ?? editingStep);
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
  const [showBed, setShowBedState] = useState(() => {
    try {
      return localStorage.getItem("bettercad.showBed") !== "0";
    } catch {
      return true;
    }
  });
  const setShowBed = useCallback((on: boolean) => {
    setShowBedState(on);
    try {
      localStorage.setItem("bettercad.showBed", on ? "1" : "0");
    } catch {
      // A private window: it lasts this visit.
    }
  }, []);
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
    try {
      localStorage.setItem(ORIENT_KEY, JSON.stringify(w));
    } catch {
      // A private window: it lasts this visit.
    }
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
      { id: "make-link", label: "Make link", icon: "link", onSelect: () => makeLink(ids) },
      ...(chosen.some((p) => p.link) ? [{ id: "select-link", label: "Select link", icon: "link" as const, onSelect: () => selectLink(ids) }] : []),
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
    { id: "learn", label: "Learn BetterCad", icon: "link", onSelect: () => registry.run("help.learn") },
    { kind: "separator", id: "s1" },
    { id: "report", label: "Report a problem…", icon: "warning", onSelect: () => registry.run("help.report") },
    { id: "about", label: "About BetterCad", icon: "info", onSelect: () => registry.run("help.about") },
  ];
  const saveEntries: MenuEntry[] = [
    {
      id: "save",
      label: files.cloud && account ? "Save to your account" : files.inPlace ? "Save" : "Save (downloads a file)",
      icon: files.cloud && account ? "cloud" : "save",
      keys: formatCombo("mod+s"),
      onSelect: () => void save(),
    },
    { id: "saveAs", label: "Save as…", icon: "save", keys: formatCombo("shift+mod+s"), onSelect: () => void saveAs() },
    { id: "open", label: "Open…", icon: "folder", keys: formatCombo("mod+o"), onSelect: () => void open() },
    { id: "new", label: "New model", icon: "plus", keys: formatCombo("mod+n"), onSelect: newModel },
    { id: "import", label: "Import STL, STEP or 3MF…", icon: "upload", onSelect: () => void open() },
    { id: "import-reference", label: "Import as a reference…", icon: "ghost", onSelect: () => referenceInput.current?.click() },
    { id: "export", label: "Export STL, 3MF, STEP or glTF…", icon: "download", keys: formatCombo("mod+e"), onSelect: () => setExportOpen(true) },
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
    moveMarker(i);
    setTool(f.type === "shell" ? "shell" : "fillet");
    finish.repick(f, () => setMarker(back));
    say(
      `Pick the ${f.type === "shell" ? "faces to leave open" : "edges"} again on ${parts.find((p) => p.id === f.part)?.name ?? "the body"}, then press Enter`,
    );
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
          }
        }}
      />
    ) : null;

  const helpText = sketch.help
    ? sketch.help
    : place.help
      ? place.help
      : extrude.help || revolve.help || pushpull.help || hole.help || mount.help || gear.help || pattern.help || measure.help
        ? extrude.help || revolve.help || pushpull.help || hole.help || mount.help || gear.help || pattern.help || measure.help
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
  const paramsPanel = (
    <ParamsPanel
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
            tool={tool}
            onArmTool={armTool}
            panel={panel}
            onPanel={showPanel}
            canUndo={store.canUndo()}
            canRedo={store.canRedo()}
            undoLabel={store.undoLabel()}
            redoLabel={store.redoLabel()}
            onUndo={doUndo}
            onRedo={doRedo}
            saveEntries={saveEntries}
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
            onSignOut={signOut}
            onInstall={installable && !share ? installApp : undefined}
            onPalette={() => setPaletteOpen(true)}
            theme={theme}
            onTheme={setTheme}
            onProps={() => {
              setPropsOpen((o) => !o);
              if (narrow) setPanel(null);
            }}
            propsOpen={propsOpen}
          />
        }
        status={
          <span className={cx("bc-status", status.bad && "bc-bad")} role={status.bad ? "alert" : "status"} aria-live={status.bad ? "assertive" : "polite"}>
            {status.text}
          </span>
        }
        leftLabel={panel ? PANEL_TITLES[panel] : undefined}
        leftPanel={
          panel && (
            <LeftPanel
              paramsPanel={paramsPanel}
              printPanel={printPanel}
              robotPanel={
                <CataloguePanel
                  placing={place.part?.id ?? null}
                  onPick={(p) => {
                    setTool("select");
                    place.start(p);
                  }}
                />
              }
              orientWeights={orientWeights}
              onOrientWeights={setOrientWeights}
              panel={panel}
              doc={doc}
              parts={parts}
              selection={selection}
              onSelect={setSelection}
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
              links={built.links}
              origin={originShown}
              onOrigin={setOriginShown}
              onBodiesHidden={(ids, hidden) => setHidden(ids, hidden, "parts")}
              onSketchesHidden={(ids, hidden) => setHidden(ids, hidden, "sketches")}
              onBrowserPicked={setBrowserPicked}
              onSketchOn={sketch.startOnPlane}
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
            <SketchBars s={sketch} />
          ) : (
            <>
              {files.banners}
              <StageBars tool={activeTool} onArmTool={armTool} vp={vp} onePart={selection.length === 1} />
              {place.part && <PlaceBar x={place} />}
              {tool === "sketch" && <SketchPickBar onCancel={() => setTool("select")} />}
              {tool === "extrude" && (
                <ExtrudeBar x={extrude} parts={parts} scope={scope} error={extrude.feature ? failed.get(extrude.feature.id) : undefined} />
              )}
              {tool === "revolve" && (
                <ExtrudeBar x={revolve} parts={parts} scope={scope} error={revolve.feature ? failed.get(revolve.feature.id) : undefined} />
              )}
              {tool === "measure" && <MeasureBar m={measure} onDone={() => setTool("select")} />}
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
              {tool === "hole" && <HoleBar x={hole} error={hole.session ? failed.get(hole.session.id) : undefined} onCancel={() => setTool("select")} />}
              {tool === "pushpull" && (
                <PushPullBar x={pushpull} error={pushpull.session ? failed.get(pushpull.session.id) : undefined} onCancel={() => setTool("select")} />
              )}
              {(tool === "fillet" || tool === "shell") && <FinishBar f={finish} onCancel={() => setTool("select")} />}
              {tool === "combine" && (
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
                  onCancel={() => setTool("select")}
                />
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
            filter={vp.filter}
            mode={vp.mode}
            style={vp.style}
            ortho={vp.ortho}
            section={vp.section}
            stats={vp.stats}
            description={`${parts.length} parts. ${vp.elementText || selectionText}`}
            onPick={sketch.editing ? NO_PICK : vp.onPick}
            onTransform={vp.onTransform}
            onTransforming={vp.onTransforming}
            onSection={vp.onSection}
            onCamera={composedCamera}
            onHome={vp.goHome}
            cubeMenu={vp.cubeMenu}
            bed={showBed && !share ? { ...printer, label: bedLabel(printer) } : null}
            warn={offBed}
            check={checkResult?.values ?? null}
            originPlanes={{
              shown: sketch.editing ? [] : originShown.filter((x): x is WorldPlaneName => x !== "point"),
              chosen: sketch.editing ? null : planeOf(browserPicked ?? ""),
              point: !sketch.editing && (originShown.includes("point") || browserPicked === ROW.point),
            }}
            emptyHint={!emptyState && !sketch.editing && tool !== "sketch" && built.sketches.length === 0}
          >
            <SketchLabels s={sketch} />
            {emptyState && (
              <EmptyState
                onShape={() => setPanel("library")}
                onSketch={() => armTool("sketch")}
                onOpen={() => void open()}
                onSample={(id) => files.openSample(id)}
              />
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
              onMenu={(f, p) => setFeatureMenuAt({ id: f.id, at: p })}
              onEdit={editStep}
              onHistory={() => showPanel(panel === "history" ? "parts" : "history")}
              historyOpen={panel === "history"}
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
            <SketchPanel s={sketch} />
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
              />
            </>
          )
        }
        rightOpen={propsOpen}
      />
      <span className="bc-sr-only" role="status" aria-live="polite">
        {selectionText} {tool === "select" ? "" : `${activeTool.label} tool armed.`}
      </span>
      {pendingDelete && (
        <DeleteStepDialog doc={doc} id={pendingDelete} onCancel={() => setPendingDelete(null)} onDelete={(all) => deleteNow(pendingDelete, all)} />
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} isEnabled={isEnabled} run={(id) => registry.run(id)} />
      <ContextMenu
        at={featureMenuAt?.at ?? null}
        onClose={() => setFeatureMenuAt(null)}
        label="Step actions"
        title={doc.features.find((f) => f.id === featureMenuAt?.id)?.name}
        entries={featureMenuAt ? featureMenu(featureMenuAt.id) : []}
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
      <ReportDialog
        open={report !== null}
        prefill={report?.prefill}
        onClose={() => setReport(null)}
        model={() => (store.get().features.length ? saveBcad(store.get()) : null)}
        info={() => ({ app: APP_VERSION, browser: browserName(), error: lastError(), actions: actionLog.list() })}
        say={say}
      />
      {exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog
            open={exportOpen}
            onClose={() => setExportOpen(false)}
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
        <Versions
          api={api}
          modelId={files.cloud.modelId}
          name={doc.name}
          viewing={files.viewing?.number ?? null}
          onPreview={(n) => void files.previewVersion(n)}
          onClose={() => setVersionsOpen(false)}
          say={say}
        />
      )}
      {shareOpen && files.cloud && <ShareDialog api={api} modelId={files.cloud.modelId} name={doc.name} onClose={() => setShareOpen(false)} say={say} />}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} commands={commands} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <TooltipLayer />
    </>
  );
}
