import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ArmedBar, Button, ContextMenu, Dialog, ESC, RibbonButton, RibbonGroup, useEscape, type ContextMenuState } from "@bettercad/ui";
import {
  frameOf,
  removeView,
  type AutoRecipe,
  scaleLabel,
  SCALES,
  styleOf,
  viewScale,
  type Drawing,
  type DrawingDimension,
  type DrawingMark,
  type DrawingNote,
  type DrawingRef,
  type DrawingSheet,
  type DrawingView,
} from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { fitGap, newId, type ModelDoc } from "../state/document";
import { arrangeSheet, contextOf, crowded, sheetRows, snapRow, type Crowded } from "./arrange";
import { AUTO_START, autoDimension, RECIPES, repeatsOf, type AutoOptions, type AutoResult } from "./auto";
import { AutoCard } from "./AutoCard";
import { BaseViewCard } from "./BaseViewCard";
import { DimensionCard } from "./DimensionCard";
import { DimensionLayer } from "./DimensionLayer";
import { addPick, dimArt, dimStyle, draftOf, isIso, pickKey, sizeText, type DimPick, type Pending } from "./dimensions";
import type { DrawingFile } from "./ExportCard";
import { follow, lostName, problemCount, problems, stamp, type Problem } from "./follow";
import { LostLayer, Warning } from "./LostLayer";
import { sheetOf } from "./ops";
import { moveViewToSheet } from "./sheets";
import { SheetStrip } from "./SheetStrip";
import { isOwnField, sheetLayout, sizeName, TEXT, type TitleEdit } from "./layout";
import { MarkCard } from "./MarkCard";
import { isMarkTool, MarkLayer, type MarkTool } from "./MarkLayer";
import { autoMarks, MARK_NAMES, markKey, markStyle, markView, pitchCircle, refKey, refTo, targets, type Target } from "./marks";
import { descendants, GAP, inheritedScale, placeProjected, projectedDirection, sideAt, spotAt, spotBeside, type Side } from "./projected";
import { autoBalloons, itemOf, modelParts, partsTable, setPartsList, type ListedBody, type ListedComponent } from "./parts";
import { PartsList } from "./PartsList";
import { ProjectedViewCard } from "./ProjectedViewCard";
import { SheetArt } from "./Sheet";
import { useModelViews, type ViewCall, type ViewWanted } from "./useModelViews";
import { usePictures } from "./usePictures";
import type { PictureModel } from "./pictures";
import { CutCard, CUT_NAMES, isCutTool, type CutTool } from "./CutCard";
import { CutLayer, type CutGhost } from "./CutLayer";
import { isNoteTool, NoteCard, noteKindOf, type NoteTool } from "./NoteCard";
import { NoteLayer } from "./NoteLayer";
import { draftOfNote, firstDraft, nextDatum, noteKindName, notePicks, noteSpot, noteWords, type NoteDraft } from "./notes";
import {
  addBreak,
  cutArt,
  cutPath,
  cutThrough,
  flipSection,
  onPaper,
  picturesOf,
  pictured,
  placeDetail,
  placeSection,
  removeBreaks,
  snapPoint,
  viewPoint,
  type CutWay,
  type CutHow,
  type CutKind,
} from "./cuts";
import {
  defaultSpot,
  editView,
  emptyView,
  fitView,
  fromPage,
  moveView,
  placeView,
  toPage,
  viewArt,
  viewName,
  viewRequest,
  type ViewArt,
  type ViewChoice,
} from "./views";

export type { SheetChoice } from "./SheetCard";
export type { ViewCall } from "./useModelViews";
export type { ShowOption } from "./BaseViewCard";
export type { DrawingFile } from "./ExportCard";
export { decimalsChange, drawingChange, drawingEdit, makeDrawing, sheetChange, sheetEdit, sheetOf, startDrawing, titleChange } from "./ops";

/** Export (#569) and its PDF, SVG and DXF writers load when the card first opens. */
const ExportCard = lazy(() => import("./ExportCard").then((m) => ({ default: m.ExportCard })));
/** A size's tolerance card (#573) loads when it is first asked for. */
const ToleranceCard = lazy(() => import("./ToleranceCard").then((m) => ({ default: m.ToleranceCard })));

/** Where the sheet sits in the view: screen pixels per paper millimetre, and the page's top left corner. */
interface View {
  k: number;
  x: number;
  y: number;
}
/** Stands in for the model when none is given: nothing is asked of the kernel then. */
const EMPTY_DOC = { features: [] } as unknown as ModelDoc;
/** Clear space round a fitted sheet, px. */
const PAD = 24;
const MIN_K = 0.15;
const MAX_K = 60;
/** How far a press moves before it is a drag, so a double-click on the title block still lands. */
const SLOP = 4;

/** The view the Base view card starts with: the front, with hidden edges dashed, as Fusion does. */
const FIRST_VIEW: ViewChoice = { shows: { all: true }, direction: "front", hidden: true, tangent: false };
/** The view being placed, in the list of views asked of the kernel. */
const GHOST = "ghost";
/** How far an arrow key moves a selected view, mm; ten times that with Shift. */
const NUDGE = 1;

/**
 * The drawing's bar wraps onto more rows on a narrow window, so it says how tall it is: the sheet is fitted above it,
 * and fitted again when that changes.
 */
const barWatchers = new Set<() => void>();
function barHeight(px: number | null) {
  const style = document.documentElement.style;
  if (px === null) style.removeProperty("--bc-drawing-bar");
  else style.setProperty("--bc-drawing-bar", `${Math.ceil(px)}px`);
  for (const f of barWatchers) f();
}

/** A view's lines at a scale, worked out once per picture. */
const arts = new WeakMap<ModelView, Map<number, ViewArt>>();
function artOf(view: ModelView, scale: number): ViewArt {
  let by = arts.get(view);
  if (!by) arts.set(view, (by = new Map()));
  let art = by.get(scale);
  if (!art) by.set(scale, (art = viewArt(view, scale)));
  return art;
}

/** The drawing tool that is armed: placing a base view (#561) or views projected from one (#562), or Export (#569). */
export type DrawingTool = "base" | "projected" | "export" | "dimension" | "auto" | MarkTool | CutTool | NoteTool;
export { isNoteTool, type NoteTool } from "./NoteCard";
export { isCutTool, type CutTool } from "./CutCard";
export { isMarkTool, type MarkTool } from "./MarkLayer";
// For the properties panel's view card and the pictures, which load later: from here, so they share this chunk.
export { frameOf, scaleLabel, styleOf, VIEW_STYLES, viewScale } from "@bettercad/kernel/drawing";
export { viewName } from "./views";

export interface DrawingApi {
  fit(): void;
  /** Add centre marks to the selected view, or to every view when none is (#563). */
  autoMarks(): void;
  /** Arrange dimensions on the selected view, or on every view when none is (#565). */
  arrange(): void;
  /** Balloons on the selected view, or on every view when none is, and the parts list on or off (#574). */
  autoBalloons(): void;
  partsList(): void;
}

export interface DrawingPaperProps {
  drawing: Drawing;
  /** A model you can look at but not change: the title block is only drawn. */
  readOnly?: boolean;
  /** A title block field was typed in. */
  /** A title block field typed into on the sheet; `field-2` is the value of the third field of your own. */
  onTitle: (field: TitleEdit, value: string) => void;
  /** Fit, for the F key and the bar's button. */
  api?: MutableRefObject<DrawingApi | null>;
  /** The model the views are of, and how far its timeline is rolled. */
  doc?: ModelDoc;
  upTo?: number;
  /** Asks the kernel for a view; left out, views are placed but not drawn (the kernel is still starting). */
  call?: ViewCall;
  tool?: DrawingTool | null;
  onTool?: (tool: DrawingTool | null) => void;
  /** A change to the sheet: a view placed, moved, edited or deleted. */
  onSheet?: (change: (s: DrawingSheet) => DrawingSheet, label: string) => void;
  /** The sheet that is open (#572): the first when left out. Picking another in the strip asks for it here. */
  sheetId?: string | null;
  onSheetId?: (id: string) => void;
  /** A change to the drawing's sheets, or a view moved between two. Left out, sheets can only be switched. */
  onDrawing?: (change: (d: Drawing) => Drawing, label: string) => void;
  /** How many things on the sheet have lost what they were fixed to (#568), as that changes. */
  onProblems?: (count: number) => void;
  /** What a view can show besides the whole model: the model's components and bodies, which the parts list counts (#574). */
  components?: ListedComponent[];
  bodies?: ListedBody[];
  /** Saves an exported file (#569), and says how it went. */
  onSave?: (file: DrawingFile) => Promise<string | undefined>;
  say?: (text: string, bad?: boolean) => void;
  /** The drawing's decimal places were changed, from the Dimension card (#564). */
  onDecimals?: (places: number) => void;
  /** The meshes, looks and pose that shaded and rendered views are pictured from. Left out, they are drawn as line art. */
  pictures?: PictureModel;
  /** The view that is selected changed, for the properties panel's Style. */
  onSelectView?: (id: string | null) => void;
  /** The size that is selected changed, with what it measures, for the properties panel (#564). */
  onSelectSize?: (size: SelectedSize | null) => void;
  /** Edit in model (#564): open the step that sets a size, and the sketch dimension when it is one. */
  onEditModel?: (feature: string, dimension?: string) => void;
}

/** A selected size as the properties panel needs it: which, and what it measures in mm or degrees. */
export interface SelectedSize {
  id: string;
  value: number;
  unit: "mm" | "°";
}

/**
 * The Drawing workspace's sheet (#559): paper over the whole 3D view, under the floating cards. Drag moves it, the
 * wheel or a pinch zooms, and a double-click on a title block field types in it. Drawn as SVG in paper millimetres,
 * so it stays sharp at any zoom and reads to tests and screen readers.
 */
export function DrawingPaper(props: DrawingPaperProps) {
  const { drawing, readOnly, onDrawing, onSheetId, say } = props;
  const sheet = sheetOf(drawing, props.sheetId);
  const strip = drawing.sheets.length > 1 || (!!onDrawing && !readOnly);
  return (
    <>
      {/* A sheet's own state (what is selected, the armed tool's picks, where it is scrolled to) starts again with each sheet. */}
      <Paper key={sheet.id} {...props} sheetId={sheet.id} strip={strip} />
      {strip && (
        <SheetStrip
          drawing={drawing}
          open={sheet.id}
          onOpen={(id) => onSheetId?.(id)}
          onChange={readOnly ? undefined : onDrawing}
          newId={(kind) => newId(kind)}
          say={say}
        />
      )}
    </>
  );
}

function Paper({
  drawing,
  sheetId,
  onDrawing,
  strip,
  readOnly,
  onTitle,
  api,
  doc,
  upTo,
  call,
  tool = null,
  onTool,
  onSheet: write,
  onProblems,
  components = [],
  bodies = [],
  onSave,
  say,
  onDecimals,
  pictures: pictureFrom,
  onSelectView,
  onSelectSize,
  onEditModel,
}: DrawingPaperProps & { strip?: boolean }) {
  const sheet = sheetOf(drawing, sheetId);
  const sheetNumber = drawing.sheets.indexOf(sheet) + 1;
  const layout = useMemo(
    () => sheetLayout(sheet, { index: sheetNumber, count: drawing.sheets.length, logo: drawing.logo, fields: drawing.fields }),
    [sheet, sheetNumber, drawing.sheets.length, drawing.logo, drawing.fields],
  );
  const root = useRef<HTMLDivElement>(null);
  const clear = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  /** Moved by hand since it was last fitted: then a window resize leaves it where you put it. */
  const loose = useRef(false);
  const { w: pw, h: ph } = layout.page;

  const fit = useCallback(() => {
    const r = root.current?.getBoundingClientRect();
    const c = clear.current?.getBoundingClientRect();
    // Tests have no layout: fit an ordinary window instead.
    const w = c?.width || r?.width || 1024;
    const h = c?.height || r?.height || 768;
    const k = Math.max(MIN_K, Math.min((w - PAD * 2) / pw, (h - PAD * 2) / ph));
    loose.current = false;
    setView({ k, x: (c && r ? c.left - r.left : 0) + (w - pw * k) / 2, y: (c && r ? c.top - r.top : 0) + (h - ph * k) / 2 });
  }, [pw, ph]);

  // Fit when the drawing opens and when its page changes size or turns.
  useLayoutEffect(fit, [fit]);
  const autoRef = useRef<() => void>(() => {});
  const arrangeRef = useRef<() => void>(() => {});
  const balloonRef = useRef<() => void>(() => {});
  const listRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (api)
      api.current = {
        fit,
        autoMarks: () => autoRef.current(),
        arrange: () => arrangeRef.current(),
        autoBalloons: () => balloonRef.current(),
        partsList: () => listRef.current(),
      };
    return () => {
      if (api) api.current = null;
    };
  }, [api, fit]);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !root.current) return;
    const ro = new ResizeObserver(() => !loose.current && fit());
    ro.observe(root.current);
    return () => ro.disconnect();
  }, [fit]);
  useEffect(() => {
    const refit = () => !loose.current && fit();
    barWatchers.add(refit);
    return () => void barWatchers.delete(refit);
  }, [fit]);

  const zoomAt = useCallback((px: number, py: number, by: number) => {
    loose.current = true;
    setView((v) => {
      if (!v) return v;
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * by));
      return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) };
    });
  }, []);

  // The wheel zooms about the pointer. A trackpad pinch arrives as a wheel with Ctrl held, in finer steps.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Views (#561). The card's choices, the view being changed, the one selected and the one being dragged.
  const [choice, setChoice] = useState<ViewChoice>(FIRST_VIEW);
  const [changing, setChanging] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => onSelectView?.(selected), [onSelectView, selected]);
  useEffect(() => () => onSelectView?.(null), [onSelectView]);
  const [moving, setMoving] = useState<{ id: string; at: V2 } | null>(null);
  /** Where the pointer is on the sheet, for the view being placed. */
  const [pointer, setPointer] = useState<V2 | null>(null);
  const placing = tool === "base" && !readOnly;
  useEffect(() => {
    if (placing) {
      setChanging(null);
      setPointer(null);
    }
  }, [placing]);
  // Projected views (#562): the view they are taken from and the side of it the next one goes on.
  const projecting = tool === "projected" && !readOnly;
  const [from, setFrom] = useState<string | null>(null);
  const [side, setSide] = useState<Side>([1, 0]);
  const picked = useRef(selected);
  picked.current = selected;
  useEffect(() => {
    if (!projecting) return;
    setChanging(null);
    setPointer(null);
    setSide([1, 0]);
    // Start from the view that is selected, or the only one there is.
    setFrom(sheet.views.find((v) => v.id === picked.current)?.id ?? (sheet.views.length === 1 ? sheet.views[0]!.id : null));
    // Only when the tool is armed: views placed while it is up must not change what it projects from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projecting]);
  const parent = projecting && from ? sheet.views.find((v) => v.id === from) : undefined;
  // Section, detail and break (#571): the view being cut, and how.
  const cutting: CutTool | null = isCutTool(tool) && !readOnly ? tool : null;
  const [way, setWay] = useState<CutWay>("across");
  const [flip, setFlip] = useState(false);
  const [cutHow, setCutHow] = useState<CutKind>("full");
  const [tilt, setTilt] = useState(0);
  /** A stepped section's places so far, in the view's millimetres. */
  const [stepAt, setStepAt] = useState<V2[]>([]);
  const [radius, setRadius] = useState<number | null>(null);
  const [detailScale, setDetailScale] = useState<number | null>(null);
  const [breakStart, setBreakStart] = useState<number | null>(null);
  useEffect(() => {
    if (!cutting) return;
    setChanging(null);
    setPointer(null);
    setBreakStart(null);
    setStepAt([]);
    setCutHow("full");
    setTilt(0);
    setRadius(null);
    setDetailScale(null);
    setWay(cutting === "break" ? "up" : "across");
    setFrom(sheet.views.find((v) => v.id === picked.current)?.id ?? (sheet.views.length === 1 ? sheet.views[0]!.id : null));
    // Only when a tool is armed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutting]);
  const cutParent = cutting && from ? sheet.views.find((v) => v.id === from) : undefined;
  const angle = layout.angle;
  const ghostDirection = useMemo(() => (parent ? projectedDirection(parent.direction, side, angle) : undefined), [parent, side, angle]);
  const wanted = useMemo<ViewWanted[]>(() => {
    const list = sheet.views.map((v) => ({ id: v.id, request: viewRequest(v) }));
    if (placing) list.push({ id: GHOST, request: viewRequest(choice, true) });
    else if (parent && ghostDirection) list.push({ id: GHOST, request: viewRequest({ ...parent, direction: ghostDirection }, true) });
    return list;
  }, [sheet.views, placing, choice, parent, ghostDirection]);
  const rawGot = useModelViews(wanted, doc ?? EMPTY_DOC, upTo, doc ? call : undefined);
  // Each view's picture as it is drawn (#571): hatched where it is cut, a detail cut down to its circle, a broken
  // view closed up. Everything below works from these.
  const got = useMemo(() => {
    const out = new Map(rawGot);
    for (const v of sheet.views) {
      const g = rawGot.get(v.id);
      if (!g?.view) continue;
      const view = pictured(g.view, v, viewScale(sheet, v));
      if (view !== g.view) out.set(v.id, { ...g, view });
    }
    return out;
    // The views and the sheet's scale are all of the sheet a picture depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawGot, sheet.views, sheet.scale]);
  // The drawing follows the model (#568). What is drawn is the sheet with its rows stacked again where the model
  // changed sizes; your next change writes that down with it, so undo takes both back together.
  const pictureOf = useCallback((id: string) => got.get(id)?.view, [got]);
  const followed = useMemo(() => follow(sheet, pictureOf, drawing.decimals), [sheet, pictureOf, drawing.decimals]);
  // Shaded and rendered views (Kev, 2026-11-24): their pictures, as each is made.
  const { meshes, parts: looks, built, pose } = pictureFrom ?? {};
  const pictureModel = useMemo(() => meshes && looks && built && { meshes, parts: looks, built, pose }, [meshes, looks, built, pose]);
  const pics = usePictures(sheet, pictureOf, pictureModel);
  const onSheet = write
    ? (change: (s: DrawingSheet) => DrawingSheet, label: string) =>
        write((s) => stamp(change(follow(s, pictureOf, drawing.decimals)), pictureOf, drawing.decimals), label)
    : undefined;
  const wrong = useMemo(
    () => problems(followed, pictureOf, drawing.decimals, (id) => !!got.get(id)?.error && !got.get(id)?.busy),
    [followed, pictureOf, drawing.decimals, got],
  );
  const wrongCount = wrong.length;
  useEffect(() => {
    onProblems?.(wrongCount);
    if (wrongCount) say?.(`${problemCount(wrongCount)} on this sheet. Right-click a warning to pick again or delete it.`);
    // Said when the count changes, not each time the sheet is drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrongCount]);
  useEffect(() => () => onProblems?.(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  /** The lost thing Pick again is replacing: it goes when its replacement is placed. */
  const [replacing, setReplacing] = useState<Problem | null>(null);
  const [lostMenu, setLostMenu] = useState<{ at: ContextMenuState; problem: Problem } | null>(null);
  useEffect(() => {
    if (!tool) setReplacing(null);
  }, [tool]);
  const removeLost = (p: Problem) =>
    onSheet?.((s) => swapped(s, p), p.kind === "dimension" ? "Delete dimension" : p.kind === "note" ? "Delete note" : "Delete mark");
  const pickAgain = (p: Problem) => {
    const mark = p.kind === "mark" ? sheet.marks.find((m) => m.id === p.id) : undefined;
    const note = p.kind === "note" ? sheet.notes?.find((n) => n.id === p.id) : undefined;
    setReplacing(p);
    onTool?.(note ? `note-${note.kind}` : mark ? mark.kind : "dimension");
  };
  /** The sheet without what is being replaced, once its replacement is in. */
  const swapped = (s: DrawingSheet, gone: Problem | null): DrawingSheet =>
    !gone
      ? s
      : gone.kind === "dimension"
        ? { ...s, dimensions: s.dimensions.filter((d) => d.id !== gone.id) }
        : gone.kind === "note"
          ? { ...s, notes: (s.notes ?? []).filter((n) => n.id !== gone.id) }
          : { ...s, marks: s.marks.filter((m) => m.id !== gone.id) };
  const ghost = placing || parent ? got.get(GHOST) : undefined;
  const changed = changing ? sheet.views.find((v) => v.id === changing) : undefined;
  /** The picture Fit measures: the ghost while placing, the view itself while changing it. */
  const measured = placing ? ghost?.view : changing ? got.get(changing)?.view : undefined;
  const fitScaleNow = measured && !emptyView(measured) ? fitView(measured, layout) : undefined;
  const wait = !call
    ? "The geometry engine is starting."
    : measured && emptyView(measured)
      ? "There is nothing to draw yet. Add a body to the model first."
      : !fitScaleNow
        ? "Working out the view."
        : undefined;

  /** A point of the window as a sheet position: mm from the page's bottom left. */
  const sheetAt = (x: number, y: number): V2 | null => {
    const r = root.current?.getBoundingClientRect();
    return view && r ? fromPage([(x - r.left - view.x) / view.k, (y - r.top - view.y) / view.k], ph) : null;
  };
  const place = (at: V2) => {
    const scale = choice.scale ?? fitScaleNow;
    if (!scale || wait) return;
    const id = newId("vw");
    onSheet?.((s) => placeView(s, id, choice, scale, at), "Base view");
    setSelected(id);
    onTool?.(null);
  };
  const startChange = (v: DrawingView) => {
    if (readOnly) return;
    onTool?.(null);
    const next: ViewChoice = { shows: v.shows, direction: v.direction, hidden: v.hidden, tangent: v.tangent };
    // A projected view has its parent's scale until it is given its own.
    if (!v.parent || v.scale !== undefined) next.scale = viewScale(sheet, v);
    setChoice(next);
    setChanging(v.id);
  };
  const doneChange = () => {
    const scale = choice.scale ?? (changed?.parent ? inheritedScale(sheet, changed) : fitScaleNow);
    if (changing && scale) onSheet?.((s) => editView(s, changing, choice, scale), "Edit view");
    setChanging(null);
  };

  // Where the projected view being placed goes: by the pointer once it is clear of the parent, else just beside it.
  const parentArt = parent && got.get(parent.id)?.view ? artOf(got.get(parent.id)!.view!, viewScale(sheet, parent)) : undefined;
  const ghostArt = parent && ghost?.view && !emptyView(ghost.view) ? artOf(ghost.view, viewScale(sheet, parent)) : undefined;
  const clearOf = (at: V2) =>
    !!parent && (Math.abs(at[0] - parent.at[0]) > (parentArt?.w ?? 20) / 2 || Math.abs(at[1] - parent.at[1]) > (parentArt?.h ?? 20) / 2);
  const projectedSpot =
    parent && ghostArt
      ? pointer && clearOf(pointer)
        ? spotAt(parent.at, pointer, side)
        : spotBeside({ at: parent.at, w: parentArt?.w ?? 20, h: parentArt?.h ?? 20 }, ghostArt, side)
      : undefined;
  const projectWait = !sheet.views.length
    ? "Put a base view on the sheet first."
    : !parent
      ? "Click the view to project from."
      : !call
        ? "The geometry engine is starting."
        : !ghostArt
          ? "Working out the view."
          : undefined;
  const project = (at: V2 | undefined, s: Side = side) => {
    if (!parent || !at || projectWait) return;
    const id = newId("vw");
    const parentId = parent.id;
    onSheet?.((sh) => placeProjected(sh, id, parentId, s, angle, at), "Projected view");
  };
  // What the armed cut tool works on: the view's picture as drawn, and as the kernel gave it (for snapping).
  const cutPic = cutParent ? got.get(cutParent.id)?.view : undefined;
  const cutRaw = cutParent ? rawGot.get(cutParent.id)?.view : undefined;
  const cutScale = cutParent ? viewScale(sheet, cutParent) : 1;
  const cutBox = cutRaw && !emptyView(cutRaw) ? cutRaw.box : undefined;
  /** A detail's circle starts at a sixth of the view, as a round number, at twice the view's scale. */
  const radiusNow = radius ?? (cutBox ? Math.max(1, Math.round(Math.min(cutBox.max[0] - cutBox.min[0], cutBox.max[1] - cutBox.min[1]) / 6)) : 5);
  const detailScaleNow = detailScale ?? SCALES.find((k) => k >= cutScale * 2 - 1e-9) ?? cutScale * 2;
  const cutWait = !sheet.views.length
    ? "Put a base view on the sheet first."
    : !cutParent
      ? "Click the view to cut."
      : !call
        ? "The geometry engine is starting."
        : !cutPic || !cutBox
          ? "Working out the view."
          : cutting === "section" && isIso(frameOf(cutParent.direction).toEye)
            ? "A section is cut from a flat view. Pick a front, top or side view."
            : undefined;
  /** Where in the model the view shows a place on it is (paper mm from its middle), snapped for a section or detail. */
  const cutPoint = (rel: V2 | null): V2 | undefined => {
    if (!cutPic || !cutBox) return undefined;
    if (!rel) return [(cutBox.min[0] + cutBox.max[0]) / 2, (cutBox.min[1] + cutBox.max[1]) / 2];
    const p = viewPoint(cutPic, cutScale, rel);
    return cutting === "break" || !cutRaw ? p : snapPoint(cutRaw, p, 2 / cutScale);
  };
  /** Does what the armed cut tool does at a place on its view, or through the middle with no place given. */
  const cutAt = (rel: V2 | null) => {
    const p = cutPoint(rel);
    if (!cutParent || !cutPic || !cutBox || !p || cutWait || !cutting) return;
    const parentId = cutParent.id;
    const art = artOf(cutPic, cutScale);
    if (cutting === "section") {
      // A stepped cut takes a click for each place it goes through; the card's button makes it of what is picked.
      if (cutHow === "stepped" && rel) return setStepAt((list) => [...list, p]);
      const places = cutHow === "stepped" ? stepAt : [p];
      if (cutHow === "stepped" && places.length < 2) return;
      const how: CutHow = { kind: cutHow, tilt, more: places.slice(1) };
      const id = newId("vw");
      onSheet?.((s) => placeSection(s, id, parentId, places[0]!, way, flip, angle, { w: Math.max(art.w, 20), h: Math.max(art.h, 20) }, how), "Section view");
      setSelected(id);
      return onTool?.(null);
    }
    if (cutting === "detail") {
      const id = newId("vw");
      const at: V2 = [cutParent.at[0] + art.w / 2 + GAP + radiusNow * detailScaleNow, cutParent.at[1]];
      onSheet?.((s) => placeDetail(s, id, parentId, p, radiusNow, detailScaleNow, at), "Detail view");
      setSelected(id);
      return onTool?.(null);
    }
    const axis = way === "up" ? 0 : 1;
    if (!rel) {
      const [lo, hi] = [cutBox.min[axis], cutBox.max[axis]];
      onSheet?.((s) => addBreak(s, parentId, axis ? "y" : "x", lo + (hi - lo) / 3, lo + ((hi - lo) * 2) / 3), "Break");
      return onTool?.(null);
    }
    if (breakStart === null) return setBreakStart(p[axis]);
    const start = breakStart;
    onSheet?.((s) => addBreak(s, parentId, axis ? "y" : "x", start, p[axis]), "Break");
    setBreakStart(null);
    onTool?.(null);
  };
  /** What the armed cut tool would do where the pointer is, drawn on its view. */
  const cutGhost = ((): CutGhost | undefined => {
    if (!cutParent || !cutPic || cutWait) return undefined;
    const p = pointer ? cutPoint([pointer[0] - cutParent.at[0], pointer[1] - cutParent.at[1]]) : undefined;
    const P = onPaper(cutPic, cutScale);
    const art = artOf(cutPic, cutScale);
    if (cutting === "section") {
      // The line as it would be cut: through the places picked so far and where the pointer is.
      const places = cutHow === "stepped" ? [...stepAt, ...(p ? [p] : [])] : p ? [p] : [];
      if (!places.length) return undefined;
      const cut = cutThrough(frameOf(cutParent.direction), places[0]!, way, flip, { kind: cutHow, tilt, more: places.slice(1) });
      const path = cutPath(frameOf(cutParent.direction), cut, P, cutScale, art.w, art.h);
      return path && { kind: "line", ...path };
    }
    if (!p) return undefined;
    const at = P(p);
    const [w, h] = [art.w / 2 + 6, art.h / 2 + 6];
    if (cutting === "detail") return { kind: "ring", c: at, r: radiusNow * cutScale };
    const axis = way === "up" ? 0 : 1;
    const from = breakStart === null ? at[axis] : P(axis ? [p[0], breakStart] : [breakStart, p[1]])[axis];
    const [lo, hi] = [Math.min(from, at[axis]), Math.max(from, at[axis])];
    return axis ? { kind: "band", x: -w, y: lo, w: w * 2, h: Math.max(hi - lo, 0.3) } : { kind: "band", x: lo, y: -h, w: Math.max(hi - lo, 0.3), h: h * 2 };
  })();
  // Enter finishes, wherever the keyboard is; Esc does too, through the card.
  useEffect(() => {
    if (!projecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || (e.target as Element).closest?.("button, select, input, textarea, [role=button]")) return;
      e.preventDefault();
      onTool?.(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projecting, onTool]);
  // Marks (#563): the armed tool, what it has picked so far (in one view), and the mark that is selected.
  const markTool = isMarkTool(tool) && !readOnly ? tool : null;
  const [picks, setPicks] = useState<{ view: string; refs: DrawingRef[] }>({ view: "", refs: [] });
  const [join, setJoin] = useState<"circle" | "lines">("circle");
  const [selectedMark, setSelectedMark] = useState<string | null>(null);
  useEffect(() => {
    setPicks({ view: "", refs: [] });
    setJoin("circle");
    if (markTool) setChanging(null);
  }, [markTool]);
  const style = useMemo(() => markStyle(sheet.standard), [sheet.standard]);
  const addMark = (mark: DrawingMark) => {
    const gone = replacing;
    onSheet?.(
      (s) => (s.marks.some((m) => markKey(m) === markKey(mark) && markView(m) === markView(mark)) ? s : swapped({ ...s, marks: [...s.marks, mark] }, gone)),
      MARK_NAMES[mark.kind],
    );
    setReplacing(null);
  };
  /** The centres of a pattern's picked holes, to see whether a pitch circle fits them. */
  const pickedCentres = (viewId: string, refs: DrawingRef[]): V2[] => {
    const model = got.get(viewId)?.view;
    if (!model) return [];
    const all = targets(model);
    return refs.flatMap((r) => {
      const t = all.find((x) => refKey(refTo(viewId, x)) === refKey(r));
      return t?.kind === "round" ? [t.c] : [];
    });
  };
  const pick = (viewId: string, t: Target) => {
    if (!markTool) return;
    const ref = refTo(viewId, t);
    if (markTool === "centre-mark") return addMark({ id: newId("mk"), kind: "centre-mark", on: ref });
    if (markTool === "centre-line" && t.kind === "axis") return addMark({ id: newId("mk"), kind: "centre-line", a: ref });
    const mine = picks.view === viewId ? picks.refs : [];
    if (markTool === "centre-pattern") {
      if (mine.some((r) => refKey(r) === refKey(ref))) return setPicks({ view: viewId, refs: mine.filter((r) => refKey(r) !== refKey(ref)) });
      if (!mine.length && t.kind === "round") {
        // The first hole brings the others like it, when together they make a bolt circle or a row.
        const model = got.get(viewId)?.view;
        const like = (model ? targets(model) : []).filter(
          (x): x is Extract<Target, { kind: "round" }> =>
            x.kind === "round" && x.whole && x.source.kind === t.source.kind && x.hole === t.hole && Math.abs(x.r - t.r) < 1e-6,
        );
        const o = like[0]?.c ?? [0, 0];
        const d = like[1] ? [like[1].c[0] - o[0], like[1].c[1] - o[1]] : [0, 0];
        const inRow = like.every((x) => Math.abs((x.c[0] - o[0]) * d[1]! - (x.c[1] - o[1]) * d[0]!) < 1e-6);
        if (like.length >= 3 && (inRow || pitchCircle(like.map((x) => x.c)))) return setPicks({ view: viewId, refs: like.map((x) => refTo(viewId, x)) });
      }
      return setPicks({ view: viewId, refs: [...mine, ref] });
    }
    // Two edges: a centre line between them, or their extension to a corner.
    if (!mine.length || refKey(mine[0]!) === refKey(ref)) return setPicks({ view: viewId, refs: [ref] });
    addMark(
      markTool === "extension" ? { id: newId("mk"), kind: "extension", a: mine[0]!, b: ref } : { id: newId("mk"), kind: "centre-line", a: mine[0]!, b: ref },
    );
    setPicks({ view: "", refs: [] });
  };
  const onCircle = markTool === "centre-pattern" && !!pitchCircle(pickedCentres(picks.view, picks.refs));
  const addPattern = () => {
    if (picks.refs.length < 2) return;
    addMark({ id: newId("mk"), kind: "centre-pattern", on: picks.refs, join: onCircle ? join : "lines" });
    setPicks({ view: "", refs: [] });
  };
  const pickedKeys = useMemo(() => new Set(picks.refs.map(refKey)), [picks]);
  /** Add centre marks to this view: every hole seen end on, and an axis on every round feature seen from the side. */
  const markAll = (ids: string[]) => {
    const add = ids.flatMap((id) => {
      const model = got.get(id)?.view;
      return model ? autoMarks(model, id, sheet.marks, () => newId("mk")) : [];
    });
    if (add.length) onSheet?.((s) => ({ ...s, marks: [...s.marks, ...add] }), "Centre marks");
    say?.(add.length ? `Added ${add.length} ${add.length === 1 ? "mark" : "marks"}.` : "There are no holes or round features left to mark here.");
  };
  autoRef.current = () => {
    if (readOnly) return;
    const ids = selected && sheet.views.some((v) => v.id === selected) ? [selected] : sheet.views.map((v) => v.id);
    if (ids.length) markAll(ids);
    else say?.("Put a view on the sheet first.");
  };
  // Dimensions (#564): what the tool has picked so far (in one view), and the size that is selected.
  const dimensioning = tool === "dimension" && !readOnly;
  const [pending, setPending] = useState<Pending | null>(null);
  const [selectedDim, setSelectedDim] = useState<string | null>(null);
  const [dimMenu, setDimMenu] = useState<{ at: ContextMenuState; id: string } | null>(null);
  useEffect(() => {
    setPending(null);
    if (dimensioning) {
      setChanging(null);
      setPointer(null);
    }
  }, [dimensioning]);
  const sizeStyle = useMemo(() => dimStyle(sheet.standard), [sheet.standard]);
  const pendingView = pending ? sheet.views.find((v) => v.id === pending.view) : undefined;
  const pendingModel = pendingView ? got.get(pendingView.id)?.view : undefined;
  /** The size the picks make, with its text at a place from the middle of its view, or just clear of the view. */
  const sizeAt = (at: V2 | null) =>
    pendingView && pendingModel
      ? draftOf(pending, targets(pendingModel), at, pendingModel, viewScale(sheet, pendingView), isIso(frameOf(pendingView.direction).toEye))
      : undefined;
  const dimReady = !!sizeAt(null);
  const dimGhost = dimensioning && pendingView && pointer ? sizeAt([pointer[0] - pendingView.at[0], pointer[1] - pendingView.at[1]]) : undefined;
  const placeDim = (at: V2 | null) => {
    const d = sizeAt(at);
    if (!d) return;
    const id = newId("dm");
    const gone = replacing;
    onSheet?.((s) => swapped({ ...s, dimensions: [...s.dimensions, { ...d, id }] }, gone), "Dimension");
    setReplacing(null);
    setPending(null);
  };
  const pickDim = (viewId: string, p: DimPick) => {
    const model = got.get(viewId)?.view;
    if (model) setPending((was) => addPick(was, viewId, p.ref, targets(model)));
  };
  const pendingKeys = useMemo(() => new Set(pending?.refs.map(pickKey) ?? []), [pending]);
  /** A size moved or edited by hand is no longer Auto dimension's to replace. */
  const changeDim = (id: string, change: Partial<DrawingDimension>, label: string) =>
    onSheet?.(
      (s) => ({
        ...s,
        dimensions: s.dimensions.map((d) => {
          if (d.id !== id) return d;
          const next = { ...d, ...change };
          delete next.auto;
          if (next.decimals === undefined) delete next.decimals;
          if (next.tolerance === undefined) delete next.tolerance;
          return next;
        }),
      }),
      label,
    );
  const removeDim = (id: string) => onSheet?.((s) => ({ ...s, dimensions: s.dimensions.filter((d) => d.id !== id) }), "Delete dimension");
  /** What a size measures now, in mm or degrees; nothing while its view is being worked out or when it is lost. */
  const measureOf = (id: string | null) => {
    const d = id ? sheet.dimensions.find((x) => x.id === id) : undefined;
    const model = d && got.get(d.view)?.view;
    const ctx = model && contextOf(sheet, d.view, model, drawing.decimals);
    const art = ctx && dimArt(d, ctx);
    return art ? { dim: d!, value: art.value, unit: art.unit } : undefined;
  };
  const sizeNow = measureOf(selectedDim);
  const sizeKey = sizeNow ? `${sizeNow.dim.id} ${sizeNow.value} ${sizeNow.unit}` : "";
  useEffect(() => {
    const [id, value, unit] = sizeKey.split(" ");
    onSelectSize?.(id ? { id, value: Number(value), unit: unit as "mm" | "°" } : null);
  }, [onSelectSize, sizeKey]);
  useEffect(() => () => onSelectSize?.(null), [onSelectSize]);
  /** Edit in model (#564): sizes report and never drive, so this opens the sketch dimension or step that sets one. */
  const openSize = (id: string) => {
    const m = measureOf(id);
    if (!m || !onEditModel || !doc) return;
    void import("./source").then(({ sizeSource }) => {
      const from = sizeSource(doc, m.dim, m.value);
      if (from) onEditModel(from.feature, from.dimension);
      else say?.("No one sketch dimension or step sets this size. Change the model to change it.");
    });
  };
  const menuDim = dimMenu ? sheet.dimensions.find((d) => d.id === dimMenu.id) : undefined;
  // Tolerances (#573): the size whose tolerance card is up.
  const [tolerating, setTolerating] = useState<string | null>(null);
  const toleranced = tolerating ? sheet.dimensions.find((d) => d.id === tolerating) : undefined;
  const tolerancedSize = (() => {
    const model = toleranced && got.get(toleranced.view)?.view;
    const ctx = model && contextOf(sheet, toleranced.view, model, drawing.decimals);
    const art = ctx && dimArt(toleranced, ctx);
    return art ? `${sizeText(art.value, toleranced.decimals ?? drawing.decimals)}${art.unit === "mm" ? " mm" : "°"}` : "this size";
  })();
  // Notes (#573): the armed note tool's words, the note that is selected and the one whose words are being changed.
  const noteKind = isNoteTool(tool) && !readOnly ? noteKindOf(tool) : null;
  const [noteDraft, setNoteDraft] = useState<NoteDraft>(() => firstDraft("text", sheet));
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  useEffect(() => {
    if (!noteKind) return;
    setChanging(null);
    setEditingNote(null);
    // Pick again starts from what the lost note said.
    const was = replacing?.kind === "note" ? sheet.notes?.find((n) => n.id === replacing.id) : undefined;
    setNoteDraft(was && was.kind === noteKind ? draftOfNote(was) : firstDraft(noteKind, sheet));
    // Only when a note tool is armed or its kind changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKind]);
  const addNote = (on: DrawingRef | undefined, at: V2) => {
    if (!noteKind) return;
    const words = noteWords(noteKind, noteDraft);
    if (!words) return say?.(noteKind === "datum" ? "Type the datum's letter first." : "Type what the note says first.");
    const note: DrawingNote = { id: newId("nt"), kind: noteKind, ...words, ...(on ? { on } : {}), at };
    const gone = replacing;
    onSheet?.((s) => swapped({ ...s, notes: [...(s.notes ?? []), note] }, gone), noteKindName(noteKind));
    setReplacing(null);
    setSelectedNote(note.id);
    // The next datum gets the next letter.
    if (noteKind === "datum") setNoteDraft((d) => ({ ...d, text: nextDatum({ ...sheet, notes: [...(sheet.notes ?? []), note] }) }));
  };
  const pickNote = (viewId: string, t: Target) => {
    const v = sheet.views.find((x) => x.id === viewId);
    const model = got.get(viewId)?.view;
    if (v && model) addNote(refTo(viewId, t), noteSpot(t, model, viewScale(sheet, v)));
  };
  const changeNote = (id: string, change: Partial<DrawingNote>, label: string) =>
    onSheet?.(
      (s) => ({
        ...s,
        notes: (s.notes ?? []).map((n) => {
          if (n.id !== id) return n;
          // A note moved or edited by hand is no longer Auto dimension's to replace.
          const next = { ...n, ...change };
          delete next.auto;
          return next;
        }),
      }),
      label,
    );
  const removeNote = (id: string) => onSheet?.((s) => ({ ...s, notes: (s.notes ?? []).filter((n) => n.id !== id) }), "Delete note");
  const editedNote = editingNote ? sheet.notes?.find((n) => n.id === editingNote) : undefined;
  const startNoteEdit = (id: string) => {
    const n = sheet.notes?.find((x) => x.id === id);
    if (!n || readOnly) return;
    onTool?.(null);
    setNoteDraft(draftOfNote(n));
    setEditingNote(id);
  };
  const doneNoteEdit = () => {
    const words = editedNote && noteWords(editedNote.kind, noteDraft);
    if (editedNote && words) changeNote(editedNote.id, words, "Change note");
    setEditingNote(null);
  };
  // Arrange dimensions (#565): sizes into rows, and a neighbouring view they then run into is offered a move.
  const [crowd, setCrowd] = useState<Crowded | null>(null);
  const arrangeViews = (ids: string[]) => {
    const viewOf = (id: string) => got.get(id)?.view;
    const count = sheet.dimensions.filter((d) => ids.includes(d.view)).length;
    if (!count) return say?.("There are no sizes to arrange here.");
    const next = arrangeSheet(sheet, viewOf, drawing.decimals, { views: ids });
    if (next !== sheet) onSheet?.((s) => arrangeSheet(s, viewOf, drawing.decimals, { views: ids }), "Arrange dimensions");
    say?.(`Arranged ${count} ${count === 1 ? "size" : "sizes"}.`);
    setCrowd(crowded(next, viewOf, drawing.decimals).find((c) => ids.includes(c.view)) ?? null);
  };
  arrangeRef.current = () => {
    if (readOnly) return;
    arrangeViews(selected && sheet.views.some((v) => v.id === selected) ? [selected] : sheet.views.map((v) => v.id));
  };
  // Auto dimension (#566): what it is set to. The sheet shows the result as you choose, and OK keeps it.
  const autoing = tool === "auto" && !readOnly;
  // Patterns of features: their copies are left to a note on the first (one of eight cogs, "8× equally spaced").
  const repeats = useMemo(() => repeatsOf(doc?.features), [doc?.features]);
  const [autoOptions, setAutoOptions] = useState<AutoOptions>(AUTO_START);
  useEffect(() => {
    if (!autoing) return;
    setAutoOptions(sheet.auto ?? AUTO_START);
    setChanging(null);
    // Only when the tool is armed: it starts from what it was last run with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoing]);
  const autoRuns = useMemo(() => {
    if (!autoing) return null;
    const viewOf = (id: string) => got.get(id)?.view;
    let n = 0;
    const run = (recipe: AutoRecipe) => autoDimension(sheet, viewOf, drawing.decimals, { ...autoOptions, recipe }, (kind) => `auto-${kind}-${n++}`, repeats);
    const shown = run(autoOptions.recipe);
    const counts = Object.fromEntries(RECIPES.map((r) => [r.id, r.id === autoOptions.recipe ? shown : run(r.id)])) as Record<AutoRecipe, AutoResult>;
    return { shown, counts };
  }, [autoing, sheet, got, drawing.decimals, autoOptions, repeats]);
  /** The sheet as drawn: with Auto dimension's sizes while its card is up. */
  const live = autoRuns?.shown.sheet ?? followed;
  const keepAuto = () => {
    const viewOf = (id: string) => got.get(id)?.view;
    const count = autoRuns?.shown.count ?? 0;
    if (count) onSheet?.((s) => autoDimension(s, viewOf, drawing.decimals, autoOptions, (kind) => newId(kind), repeats).sheet, "Auto dimension");
    say?.(count ? `Added ${count} ${count === 1 ? "size" : "sizes"}.` : "There was nothing to dimension.");
    if (autoRuns) setCrowd(crowded(autoRuns.shown.sheet, viewOf, drawing.decimals)[0] ?? null);
    onTool?.(null);
  };
  /** Auto dimension again with what it was last set to: its own sizes are replaced, yours stay. */
  const runAgain = () => {
    const o = sheet.auto;
    if (!o) return;
    const count = autoDimension(followed, pictureOf, drawing.decimals, o, (kind) => `x-${kind}`, repeats).count;
    onSheet?.((s) => autoDimension(s, pictureOf, drawing.decimals, o, (kind) => newId(kind), repeats).sheet, "Auto dimension");
    say?.(count ? `Auto dimension ran again: ${count} ${count === 1 ? "size" : "sizes"}.` : "There was nothing to dimension.");
  };
  const crowdNames = crowd ? [sheet.views.find((v) => v.id === crowd.view), sheet.views.find((v) => v.id === crowd.into)] : [];
  /** A view's right-click menu. */
  const [menu, setMenu] = useState<{ at: ContextMenuState; view: string } | null>(null);
  const menuView = menu ? sheet.views.find((v) => v.id === menu.view) : undefined;

  /** A view about to be deleted that has views projected from it: you are asked first. */
  const [asking, setAsking] = useState<string | null>(null);
  const remove = (v: DrawingView) => {
    if (descendants(sheet, v.id).length) setAsking(v.id);
    else onSheet?.((s) => removeView(s, v.id), "Delete view");
  };
  const kept = asking ? sheet.views.filter((v) => v.parent === asking).length : 0;

  // One finger or the mouse drags the sheet, or the view it is on; two fingers pinch the sheet.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const press = useRef<{ x: number; y: number; dragging: boolean; view?: DrawingView } | null>(null);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The card over the sheet is drawn elsewhere on the page, but React still passes its presses up to here.
    if (!root.current?.contains(e.target as Node) || (e.target as Element).closest?.("input")) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size !== 1) return;
    const id = placing || parent || dimensioning ? undefined : (e.target as Element).closest?.("[data-view]")?.getAttribute("data-view");
    const on = id ? sheet.views.find((v) => v.id === id) : undefined;
    press.current = { x: e.clientX, y: e.clientY, dragging: false, view: on };
    if (!placing && !projecting) setSelected(on?.id ?? null);
    setSelectedNote(null);
    setSelectedDim(null);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const was = touches.current.get(e.pointerId);
    if (!was) {
      // Nothing pressed: the view being placed follows the pointer.
      if ((placing || parent || dimensioning || cutParent) && root.current?.contains(e.target as Node)) {
        const at = sheetAt(e.clientX, e.clientY);
        setPointer(at);
        // The side follows the pointer once it is clear of the parent.
        if (parent && at && clearOf(at)) {
          const s = sideAt([at[0] - parent.at[0], at[1] - parent.at[1]]);
          setSide((was) => (was[0] === s[0] && was[1] === s[1] ? was : s));
        }
      }
      return;
    }
    const now = { x: e.clientX, y: e.clientY };
    const el = root.current!;
    if (touches.current.size >= 2) {
      const other = [...touches.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const r = el.getBoundingClientRect();
      const before = Math.hypot(was.x - other.x, was.y - other.y) || 1;
      const after = Math.hypot(now.x - other.x, now.y - other.y) || 1;
      touches.current.set(e.pointerId, now);
      if (press.current) press.current.dragging = true;
      zoomAt((now.x + other.x) / 2 - r.left, (now.y + other.y) / 2 - r.top, after / before);
      setView((v) => v && { ...v, x: v.x + (now.x - was.x) / 2, y: v.y + (now.y - was.y) / 2 });
      return;
    }
    const p = press.current;
    if (!p) return;
    if (!p.dragging) {
      if (Math.hypot(now.x - p.x, now.y - p.y) < SLOP) return;
      p.dragging = true;
      // Only a real drag takes the pointer, so clicks and double-clicks still reach the title block.
      el.setPointerCapture?.(e.pointerId);
    }
    touches.current.set(e.pointerId, now);
    if (p.view && !readOnly && !projecting && !cutting && view) {
      // Dragging a view: it moves by what the pointer has, in paper mm (y is up on the sheet).
      const at: V2 = [p.view.at[0] + (now.x - p.x) / view.k, p.view.at[1] - (now.y - p.y) / view.k];
      setMoving({ id: p.view.id, at });
      return;
    }
    loose.current = true;
    setView((v) => v && { ...v, x: v.x + now.x - was.x, y: v.y + now.y - was.y });
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const had = touches.current.delete(e.pointerId);
    if (touches.current.size) return;
    const p = press.current;
    press.current = null;
    if (!had || !p || e.type === "pointercancel") return setMoving(null);
    if (p.dragging) {
      if (moving) {
        const { id, at } = moving;
        onSheet?.((s) => moveView(s, id, at), "Move view");
      }
      return setMoving(null);
    }
    // A click, not a drag: it puts the view being placed down where it landed.
    if (projecting) {
      // The first click picks the view to project from; each one after puts a view down.
      if (!parent) return p.view && setFrom(p.view.id);
      const at = sheetAt(e.clientX, e.clientY);
      if (!at || !clearOf(at)) return;
      const s = sideAt([at[0] - parent.at[0], at[1] - parent.at[1]]);
      return project(spotAt(parent.at, at, s), s);
    }
    if (cutting) {
      // The first click picks the view to cut, and so does a click on another view; a click on it cuts there.
      if (!cutParent || (p.view && p.view.id !== cutParent.id)) return p.view && setFrom(p.view.id);
      const at = sheetAt(e.clientX, e.clientY);
      return at ? cutAt([at[0] - cutParent.at[0], at[1] - cutParent.at[1]]) : undefined;
    }
    if (noteKind) {
      // Loose text goes where you click; every other note is put on the edge or hole it points at.
      const at = noteKind === "text" ? sheetAt(e.clientX, e.clientY) : null;
      return at ? addNote(undefined, at) : undefined;
    }
    if (dimensioning) {
      // A click on an edge or point picks it; a click anywhere else puts the size down there.
      if ((e.target as Element).closest?.(".bc-size-pick")) return;
      const at = sheetAt(e.clientX, e.clientY);
      if (at && pendingView) placeDim([at[0] - pendingView.at[0], at[1] - pendingView.at[1]]);
      return;
    }
    const at = placing ? sheetAt(e.clientX, e.clientY) : null;
    if (at) place(at);
  };
  const viewKey = (e: ReactKeyboardEvent, v: DrawingView) => {
    if (readOnly) return;
    const step = e.shiftKey ? NUDGE * 10 : NUDGE;
    const by: Record<string, V2> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = by[e.key];
    if (d) onSheet?.((s) => moveView(s, v.id, [v.at[0] + d[0], v.at[1] + d[1]]), "Move view");
    else if (e.key === "Delete" || e.key === "Backspace") remove(v);
    else if (e.key === "Enter") startChange(v);
    else return;
    e.preventDefault();
  };

  // The parts list and balloons (#574): the model's components and loose bodies, counted each time.
  const partRows = useMemo(() => modelParts(doc, bodies, components), [doc, bodies, components]);
  const itemFor = useCallback((body: string) => itemOf(partRows, body), [partRows]);
  const [listMenu, setListMenu] = useState<ContextMenuState | null>(null);
  const toggleList = (on: boolean) => {
    onSheet?.((s) => setPartsList(s, on), on ? "Parts list" : "Remove parts list");
    say?.(
      on
        ? partRows.length
          ? "The parts list is above the title block."
          : "The parts list is on. It fills in when the model has a body."
        : "The parts list is off the sheet.",
    );
  };
  listRef.current = () => !readOnly && toggleList(!sheet.partsList);
  const balloonViews = (ids: string[]) => {
    const add = ids.flatMap((id) => {
      const v = sheet.views.find((x) => x.id === id);
      const model = got.get(id)?.view;
      return v && model ? autoBalloons(model, id, viewScale(sheet, v), partRows, sheet.notes ?? [], () => newId("nt")) : [];
    });
    if (add.length) onSheet?.((s) => ({ ...s, notes: [...(s.notes ?? []), ...add] }), "Balloons");
    say?.(add.length ? `Added ${add.length} ${add.length === 1 ? "balloon" : "balloons"}.` : "Every part here has its balloon.");
  };
  balloonRef.current = () => {
    if (readOnly) return;
    const ids = selected && sheet.views.some((v) => v.id === selected) ? [selected] : sheet.views.map((v) => v.id);
    if (ids.length) balloonViews(ids);
    else say?.("Put a view on the sheet first.");
  };
  const noteLayer = {
    zoom: view?.k ?? 1,
    selected: selectedNote,
    onSelect: setSelectedNote,
    ...(readOnly || autoing ? {} : { onMove: (id: string, at: V2) => changeNote(id, { at }, "Move note"), onDelete: removeNote, onEdit: startNoteEdit }),
  };
  /** The sheet as drawn: with the view being dragged, and the views it carries, where the drag has them. */
  const shown = useMemo(() => (moving ? moveView(sheet, moving.id, moving.at) : sheet), [sheet, moving]);

  // Typing in a title block field: a text box over its cell. Enter or clicking away keeps it, Esc drops it, Tab
  // moves to the next field.
  const [editing, setEditing] = useState<TitleEdit | null>(null);
  const titleText = (field: TitleEdit) => (isOwnField(field) ? (drawing.fields?.[Number(field.slice(6))]?.value ?? "") : (sheet.title[field] ?? ""));
  const [draft, setDraft] = useState("");
  const open = useRef<{ field: TitleEdit; text: string } | null>(null);
  const fields = useMemo(() => layout.cells.filter((c) => c.edit), [layout]);
  const start = (field: TitleEdit) => {
    const text = titleText(field);
    open.current = { field, text };
    setDraft(text);
    setEditing(field);
  };
  const keep = () => {
    const o = open.current;
    if (!o) return;
    open.current = null;
    setEditing(null);
    if (o.text.trim() !== titleText(o.field)) onTitle(o.field, o.text.trim());
  };
  const drop = () => {
    open.current = null;
    setEditing(null);
  };
  useEscape(editing !== null, drop, ESC.overlay);
  const cell = editing ? fields.find((c) => c.edit === editing) : undefined;

  return (
    <div
      ref={root}
      className="bc-drawing"
      role="region"
      aria-label={`Drawing: ${drawing.name}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div ref={clear} className={strip ? "bc-drawing-clear bc-drawing-clear-strip" : "bc-drawing-clear"} aria-hidden="true" />
      <svg className="bc-drawing-svg" role="group" aria-label={`${sheet.name}: ${sizeName(sheet.size)}, ${sheet.landscape ? "landscape" : "portrait"}`}>
        {view && (
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <SheetArt layout={layout} onEdit={readOnly || placing ? undefined : start} editing={editing} />
            {shown.views.map((v) => {
              const g = got.get(v.id);
              const scale = viewScale(sheet, v);
              const art = g?.view ? artOf(g.view, scale) : undefined;
              const look = styleOf(v);
              const pic = look === "shaded" || look === "rendered" ? pics.get(v.id) : undefined;
              const [x, y] = toPage(v.at, ph);
              const gone = wrong.some((p) => p.kind === "view" && p.id === v.id);
              const state = g?.error ? ", could not be drawn" : !art ? ", being worked out" : gone ? ", nothing to show" : "";
              const lost = wrong.filter((p) => p.kind !== "view" && p.view === v.id).map((problem) => ({ problem, name: lostName(problem, sheet) }));
              // A view with no picture yet still has something to point at.
              const w = Math.max(art?.w ?? 0, 20) + 4;
              const h = Math.max(art?.h ?? 0, 20) + 4;
              return (
                <g
                  key={v.id}
                  data-view={v.id}
                  className={(parent ?? cutParent)?.id === v.id ? "bc-view bc-view-from" : selected === v.id ? "bc-view bc-view-on" : "bc-view"}
                  role="button"
                  aria-pressed={selected === v.id}
                  aria-label={`${viewName(v)}, ${scaleLabel(scale)}${state}`}
                  aria-busy={g?.busy || undefined}
                  tabIndex={0}
                  transform={`translate(${x} ${y})`}
                  onFocus={() => setSelected(v.id)}
                  onDoubleClick={() => startChange(v)}
                  onKeyDown={(e) => viewKey(e, v)}
                  onContextMenu={(e) => {
                    if (readOnly || placing || projecting || cutting) return;
                    e.preventDefault();
                    setSelected(v.id);
                    setMenu({ at: { x: e.clientX, y: e.clientY }, view: v.id });
                  }}
                >
                  <rect className={art ? "bc-view-hit" : "bc-view-hit bc-view-wait"} x={-w / 2} y={-h / 2} width={w} height={h} />
                  {art?.thin && <path className="bc-view-thin" d={art.thin} />}
                  {pic && art ? (
                    <image className="bc-view-picture" href={pic.data} x={-art.w / 2} y={-art.h / 2} width={art.w} height={art.h} preserveAspectRatio="none" />
                  ) : (
                    art && <path className={look === "wireframe" ? "bc-view-visible" : "bc-view-hidden"} d={art.hidden} />
                  )}
                  {art && (!pic || look === "shaded") && <path className="bc-view-visible" d={art.visible} />}
                  {g?.view && <CutLayer art={cutArt(shown, v, pictureOf)} ghost={cutParent?.id === v.id ? cutGhost : undefined} />}
                  {g?.view && (
                    <MarkLayer
                      viewId={v.id}
                      model={g.view}
                      scale={scale}
                      style={style}
                      marks={live.marks.filter((m) => markView(m) === v.id)}
                      tool={markTool}
                      pick={noteKind && noteKind !== "text" ? (t) => notePicks(noteKind, t) : undefined}
                      picked={picks.view === v.id ? pickedKeys : undefined}
                      onPick={(t) => (noteKind ? pickNote(v.id, t) : pick(v.id, t))}
                      selected={selectedMark}
                      onSelect={setSelectedMark}
                      onDelete={
                        readOnly || autoing ? undefined : (id) => onSheet?.((s) => ({ ...s, marks: s.marks.filter((m) => m.id !== id) }), "Delete mark")
                      }
                    />
                  )}
                  {g?.view && view && (
                    <DimensionLayer
                      viewId={v.id}
                      model={g.view}
                      scale={scale}
                      style={sizeStyle}
                      decimals={drawing.decimals}
                      iso={isIso(frameOf(v.direction).toEye)}
                      dimensions={live.dimensions.filter((d) => d.view === v.id)}
                      zoom={view.k}
                      picking={dimensioning}
                      picked={pending?.view === v.id ? pendingKeys : undefined}
                      started={!!pending}
                      onPick={(p) => pickDim(v.id, p)}
                      ghost={pending?.view === v.id ? dimGhost : undefined}
                      selected={selectedDim}
                      onSelect={setSelectedDim}
                      snap={(d, at) => {
                        const ctx = contextOf(sheet, v.id, g.view!, drawing.decimals);
                        return ctx ? snapRow(d, at, ctx, sheetRows(sheet)) : at;
                      }}
                      onMove={readOnly || autoing ? undefined : (id, at) => changeDim(id, { at }, "Move dimension")}
                      onDelete={readOnly || autoing ? undefined : removeDim}
                      onMenu={readOnly || autoing ? undefined : (id, x, y) => setDimMenu({ at: { x, y }, id })}
                      onOpen={readOnly || autoing || !onEditModel ? undefined : openSize}
                    />
                  )}
                  {g?.view && live.notes?.some((n) => n.on?.view === v.id) && (
                    <NoteLayer
                      notes={live.notes.filter((n) => n.on?.view === v.id)}
                      ctx={{ view: g.view, scale, frame: frameOf(v.direction), itemOf: itemFor, ...(doc ? { features: doc.features } : {}) }}
                      {...noteLayer}
                    />
                  )}
                  {gone && (
                    <g className="bc-view-lost">
                      <Warning />
                      <text y={7.5} fontSize={TEXT.label}>
                        {g?.error ? "Could not be drawn" : "Nothing to show"}
                      </text>
                    </g>
                  )}
                  {lost.length > 0 && (
                    <LostLayer
                      lost={lost}
                      onMenu={readOnly || autoing ? undefined : (problem, x, y) => setLostMenu({ at: { x, y }, problem })}
                      onDelete={readOnly || autoing ? undefined : removeLost}
                    />
                  )}
                  {scale !== sheet.scale && (
                    <text className="bc-view-scale" y={h / 2 + TEXT.value + 1} fontSize={TEXT.value}>
                      {`Scale ${scaleLabel(scale)}`}
                    </text>
                  )}
                </g>
              );
            })}
            {sheet.partsList && (
              <PartsList
                table={partsTable(partRows, layout)}
                onMenu={readOnly ? undefined : (x, y) => setListMenu({ x, y })}
                onDelete={readOnly ? undefined : () => toggleList(false)}
              />
            )}
            {live.notes?.some((n) => !n.on) && (
              <g transform={`translate(0 ${ph})`}>
                <NoteLayer notes={live.notes.filter((n) => !n.on)} {...noteLayer} />
              </g>
            )}
            {placing && ghost?.view && fitScaleNow && (
              <g className="bc-view-ghost" aria-hidden="true" transform={`translate(${toPage(pointer ?? defaultSpot(layout), ph).join(" ")})`}>
                <path className="bc-view-visible" d={artOf(ghost.view, choice.scale ?? fitScaleNow).visible} />
              </g>
            )}
            {parent && ghostArt && projectedSpot && (
              <g className="bc-view-ghost" aria-hidden="true" transform={`translate(${toPage(projectedSpot, ph).join(" ")})`}>
                <path className="bc-view-visible" d={ghostArt.visible} />
              </g>
            )}
          </g>
        )}
      </svg>
      {projecting && (
        <ProjectedViewCard
          views={sheet.views.map((v) => ({ id: v.id, name: `${viewName(v)}, ${scaleLabel(viewScale(sheet, v))}` }))}
          from={parent?.id ?? null}
          onFrom={(id) => {
            setFrom(id);
            setPointer(null);
          }}
          side={side}
          onSide={(s) => {
            setSide(s);
            setPointer(null);
          }}
          wait={projectWait}
          onPlace={() => project(parent && ghostArt ? spotBeside({ at: parent.at, w: parentArt?.w ?? 20, h: parentArt?.h ?? 20 }, ghostArt, side) : undefined)}
          onFinish={() => onTool?.(null)}
        />
      )}
      {cutting && (
        <CutCard
          tool={cutting}
          views={sheet.views.map((v) => ({ id: v.id, name: `${viewName(v)}, ${scaleLabel(viewScale(sheet, v))}` }))}
          from={cutParent?.id ?? null}
          onFrom={(id) => {
            setFrom(id);
            setPointer(null);
            setBreakStart(null);
            setStepAt([]);
          }}
          way={way}
          onWay={(w) => {
            setWay(w);
            setBreakStart(null);
            setStepAt([]);
          }}
          flip={flip}
          onFlip={setFlip}
          kind={cutHow}
          onKind={(k) => {
            setCutHow(k);
            setStepAt([]);
          }}
          tilt={tilt}
          onTilt={(t) => {
            setTilt(t);
            setStepAt([]);
          }}
          places={stepAt.length}
          radius={radiusNow}
          onRadius={setRadius}
          scale={detailScaleNow}
          onScale={setDetailScale}
          started={breakStart !== null}
          wait={cutWait}
          onPlace={() => cutAt(null)}
          onFinish={() => onTool?.(null)}
        />
      )}
      {markTool && (
        <MarkCard
          tool={markTool}
          picked={picks.refs.length}
          onCircle={onCircle}
          join={join}
          onJoin={setJoin}
          onAdd={addPattern}
          onFinish={() => onTool?.(null)}
        />
      )}
      {(noteKind || editedNote) && (
        <NoteCard
          kind={editedNote?.kind ?? noteKind!}
          onKind={editedNote ? undefined : (k) => onTool?.(`note-${k}`)}
          draft={noteDraft}
          onDraft={setNoteDraft}
          editing={!!editedNote}
          onPlace={!editedNote && noteKind === "text" ? () => addNote(undefined, defaultSpot(layout)) : undefined}
          onDone={() => (editedNote ? doneNoteEdit() : onTool?.(null))}
          onCancel={() => (editedNote ? setEditingNote(null) : onTool?.(null))}
        />
      )}
      {toleranced && (
        <Suspense fallback={null}>
          <ToleranceCard
            size={tolerancedSize}
            tolerance={toleranced.tolerance}
            gapOf={(fit) => fitGap(fit, doc?.print?.fits)}
            onCancel={() => setTolerating(null)}
            onDone={(tolerance) => {
              changeDim(toleranced.id, { tolerance }, "Tolerance");
              setTolerating(null);
            }}
          />
        </Suspense>
      )}
      {autoing && autoRuns && (
        <AutoCard
          options={autoOptions}
          onOptions={setAutoOptions}
          counts={autoRuns.counts}
          wait={!sheet.views.length ? "Put a view on the sheet first." : sheet.views.some((v) => !got.get(v.id)?.view) ? "Working out the views." : undefined}
          onDone={keepAuto}
          onCancel={() => onTool?.(null)}
        />
      )}
      {dimensioning && (
        <DimensionCard
          picked={pending?.refs.length ?? 0}
          ready={dimReady}
          decimals={drawing.decimals}
          onDecimals={(places) => onDecimals?.(places)}
          onPlace={() => placeDim(null)}
          onBack={() => setPending(null)}
          onFinish={() => onTool?.(null)}
        />
      )}
      <ContextMenu
        at={menuDim ? dimMenu!.at : null}
        onClose={() => setDimMenu(null)}
        label="Dimension actions"
        title="Dimension"
        entries={
          menuDim
            ? [
                ...[undefined, 0, 1, 2, 3].map((places) => ({
                  id: `places-${places ?? "drawing"}`,
                  label:
                    places === undefined
                      ? "Decimal places as the drawing"
                      : places === 0
                        ? "No decimal places"
                        : `${places} decimal ${places === 1 ? "place" : "places"}`,
                  checked: menuDim.decimals === places,
                  onSelect: () => changeDim(menuDim.id, { decimals: places }, "Decimal places"),
                })),
                { kind: "separator" as const, id: "t" },
                { id: "tolerance", label: "Tolerance…", icon: "dimension" as const, onSelect: () => setTolerating(menuDim.id) },
                ...(onEditModel ? [{ id: "model", label: "Edit in model", icon: "sketch" as const, keys: "Enter", onSelect: () => openSize(menuDim.id) }] : []),
                { kind: "separator" as const, id: "s" },
                { id: "delete", label: "Delete", danger: true, keys: "Del", onSelect: () => removeDim(menuDim.id) },
              ]
            : []
        }
      />
      <ContextMenu
        at={listMenu}
        onClose={() => setListMenu(null)}
        label="Parts list actions"
        title="Parts list"
        entries={[{ id: "remove", label: "Remove parts list", danger: true, keys: "Del", onSelect: () => toggleList(false) }]}
      />
      <ContextMenu
        at={lostMenu?.at ?? null}
        onClose={() => setLostMenu(null)}
        label="Warning actions"
        title={lostMenu ? lostName(lostMenu.problem, sheet) : undefined}
        entries={
          lostMenu
            ? [
                { id: "again", label: "Pick again", icon: "dimension", onSelect: () => pickAgain(lostMenu.problem) },
                { kind: "separator", id: "s" },
                { id: "delete", label: "Delete", danger: true, keys: "Del", onSelect: () => removeLost(lostMenu.problem) },
              ]
            : []
        }
      />
      <ContextMenu
        at={menuView ? menu!.at : null}
        onClose={() => setMenu(null)}
        label="View actions"
        title={menuView ? viewName(menuView) : undefined}
        entries={
          menuView
            ? [
                { id: "marks", label: "Add centre marks to this view", icon: "drawing", onSelect: () => markAll([menuView.id]) },
                { id: "arrange", label: "Arrange dimensions", icon: "dimension", onSelect: () => arrangeViews([menuView.id]) },
                { id: "balloons", label: "Add balloons to this view", icon: "drawing", onSelect: () => balloonViews([menuView.id]) },
                ...(sheet.auto ? [{ id: "again", label: "Run Auto dimension again", icon: "dimension" as const, onSelect: runAgain }] : []),
                { id: "edit", label: "Change this view", icon: "settings", onSelect: () => startChange(menuView) },
                ...(menuView.kind === "section" && menuView.section
                  ? [
                      {
                        id: "flip",
                        label: "Look from the other side",
                        icon: "drawing" as const,
                        onSelect: () => onSheet?.((s) => flipSection(s, menuView.id), "Flip section"),
                      },
                    ]
                  : []),
                ...(menuView.breaks?.length
                  ? [
                      {
                        id: "unbreak",
                        label: "Remove breaks",
                        icon: "drawing" as const,
                        onSelect: () => onSheet?.((s) => removeBreaks(s, menuView.id), "Remove breaks"),
                      },
                    ]
                  : []),
                ...(onDrawing
                  ? drawing.sheets
                      .filter((s) => s.id !== sheet.id)
                      .map((s) => ({
                        id: `to-${s.id}`,
                        label: `Move to ${s.name}`,
                        onSelect: () => {
                          onDrawing((d) => moveViewToSheet(d, menuView.id, sheet.id, s.id), "Move view to another sheet");
                          say?.(`Moved the ${viewName(menuView).toLowerCase()} to ${s.name}.`);
                        },
                      }))
                  : []),
                { kind: "separator", id: "s" },
                { id: "delete", label: "Delete", danger: true, keys: "Del", onSelect: () => remove(menuView) },
              ]
            : []
        }
      />
      {tool === "export" && onSave && (
        <Suspense fallback={null}>
          <ExportCard
            features={doc?.features}
            parts={partRows}
            drawing={drawing}
            sheet={followed}
            layout={layout}
            viewOf={(id) => got.get(id)?.view}
            pictures={pictureModel ? (sh, of) => import("./pictures").then((m) => m.sheetPictures(sh, of, pictureModel)) : undefined}
            viewsOf={
              doc && call
                ? async (other) => {
                    const model = { ...doc };
                    delete model.drawings;
                    const pictures = new Map<string, ModelView>();
                    await Promise.all(
                      other.views.map(async (v) => {
                        const p = call({ doc: model, upTo, ...viewRequest(v) });
                        if (p) pictures.set(v.id, await p);
                      }),
                    );
                    return picturesOf(other, (id) => pictures.get(id));
                  }
                : undefined
            }
            onSave={onSave}
            say={say ?? (() => {})}
            onClose={() => onTool?.(null)}
          />
        </Suspense>
      )}
      {crowd && crowdNames[0] && crowdNames[1] && (
        <Dialog
          open
          modal
          title="Make room for the sizes?"
          icon="drawing"
          width={340}
          onCancel={() => setCrowd(null)}
          onDone={() => {
            const { into, by } = crowd;
            setCrowd(null);
            onSheet?.((s) => {
              const v = s.views.find((x) => x.id === into);
              return v ? moveView(s, into, [v.at[0] + by[0], v.at[1] + by[1]]) : s;
            }, "Move view");
          }}
          doneLabel="Move it"
        >
          <p className="bc-note">{`The sizes on the ${viewName(crowdNames[0]).toLowerCase()} run into the ${viewName(crowdNames[1]).toLowerCase()}. It can move out of their way.`}</p>
        </Dialog>
      )}
      {asking && (
        <Dialog
          open
          modal
          title="Delete this view?"
          icon="drawing"
          width={340}
          onCancel={() => setAsking(null)}
          onDone={() => {
            const id = asking;
            setAsking(null);
            onSheet?.((s) => removeView(s, id), "Delete view");
          }}
          doneLabel="Delete"
        >
          <p className="bc-note">
            {kept === 1
              ? "The view projected from it stays on the sheet as a base view."
              : `The ${kept} views projected from it stay on the sheet as base views.`}
          </p>
        </Dialog>
      )}
      {(placing || changed) && (
        <BaseViewCard
          editing={!!changed}
          projected={!!changed?.parent}
          choice={choice}
          onChoice={setChoice}
          components={components}
          bodies={bodies}
          fit={changed?.parent ? inheritedScale(sheet, changed) : fitScaleNow}
          wait={changed?.parent ? undefined : wait}
          onCancel={() => (changed ? setChanging(null) : onTool?.(null))}
          onDone={() => (changed ? doneChange() : place(defaultSpot(layout)))}
        />
      )}
      {view && cell && (
        <input
          className="bc-drawing-field"
          aria-label={cell.label}
          autoFocus
          value={draft}
          style={{
            left: view.x + cell.x * view.k,
            top: view.y + cell.y * view.k,
            width: cell.w * view.k,
            height: cell.h * view.k,
            fontSize: Math.max(12, cell.size * view.k),
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            if (open.current) open.current.text = e.target.value;
          }}
          onBlur={keep}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              keep();
            } else if (e.key === "Tab") {
              e.preventDefault();
              const at = fields.findIndex((c) => c.edit === editing);
              const next = fields[(at + (e.shiftKey ? fields.length - 1 : 1)) % fields.length]!;
              keep();
              start(next.edit!);
            }
          }}
        />
      )}
    </div>
  );
}

export interface DrawingBarProps {
  name: string;
  readOnly?: boolean;
  /** Arms Base view (#561), and whether it is armed. */
  onBaseView?: () => void;
  baseView?: boolean;
  /** Arms Projected view (#562), and whether it is armed. */
  onProjectedView?: () => void;
  projectedView?: boolean;
  /** Arms Section view, Detail view or Break (#571), and the one that is armed. */
  onCut?: (tool: CutTool) => void;
  cut?: CutTool | null;
  /** Arms a note tool (#573), and the one that is armed. */
  onNote?: (tool: NoteTool) => void;
  note?: NoteTool | null;
  /** The parts list on or off, and balloons for the views (#574). */
  onPartsList?: () => void;
  onBalloons?: () => void;
  /** Arms Dimension (#564). */
  onDimension?: () => void;
  dimension?: boolean;
  /** Arrange dimensions (#565). */
  onArrange?: () => void;
  /** Opens Auto dimension (#566). */
  onAuto?: () => void;
  auto?: boolean;
  /** Opens Export (#569). */
  onExport?: () => void;
  /** Arms a mark tool (#563), the one that is armed, and Add centre marks. */
  onMark?: (tool: MarkTool) => void;
  mark?: MarkTool | null;
  onAutoMarks?: () => void;
  onSettings: () => void;
  onFit: () => void;
  /** The Drawing tab is showing (desktop), with the tools on it: the bar keeps only what is handy under the sheet. */
  ribbon?: boolean;
}

/**
 * The strip over the sheet while a drawing is open: its name, Sheet settings and Fit sheet. It has no Finish: any other
 * tab, tool or browser row leaves the drawing (Esc too), and the drawing keeps every change as you make it.
 */
export function DrawingBar({
  name,
  readOnly,
  onBaseView,
  baseView,
  onProjectedView,
  projectedView,
  onCut,
  cut,
  onNote,
  note,
  onPartsList,
  onDimension,
  dimension,
  onAuto,
  auto,
  onExport,
  onMark,
  mark,
  onSettings,
  onFit,
  ribbon,
}: DrawingBarProps) {
  const row = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bar = row.current?.closest<HTMLElement>(".bc-armed");
    if (!bar) return;
    barHeight(bar.getBoundingClientRect().height);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => barHeight(bar.getBoundingClientRect().height));
    ro?.observe(bar);
    return () => {
      ro?.disconnect();
      barHeight(null);
    };
  }, []);
  if (ribbon) {
    return (
      <ArmedBar title={name} icon="drawing">
        <span ref={row} hidden />
        <Button icon="frame" label="Fit sheet" title="Fit the sheet in the view" shortcut="F" onClick={onFit} />
      </ArmedBar>
    );
  }
  return (
    <ArmedBar title={name} icon="drawing">
      <span ref={row} hidden />
      {!readOnly && onBaseView && <Button icon="drawing" label="Base view" title="Put a view of the model on the sheet" on={!!baseView} onClick={onBaseView} />}
      {!readOnly && onProjectedView && (
        <Button icon="drawing" label="Projected view" title="Views from the sides of a view, lined up with it" on={!!projectedView} onClick={onProjectedView} />
      )}
      {!readOnly && onCut && (
        <>
          <Button
            icon="drawing"
            label={CUT_NAMES.section}
            title="Cut a view on a line and show what is inside"
            on={cut === "section"}
            onClick={() => onCut("section")}
          />
          <Button icon="drawing" label={CUT_NAMES.detail} title="A circle of a view, drawn larger" on={cut === "detail"} onClick={() => onCut("detail")} />
          <Button icon="drawing" label={CUT_NAMES.break} title="Leave out a stretch of a long part" on={cut === "break"} onClick={() => onCut("break")} />
        </>
      )}
      {!readOnly && <Button icon="settings" label="Sheet settings" title="Page size, standard and title block" onClick={onSettings} />}
      {!readOnly && onMark && (
        <Button
          icon="drawing"
          label="Centre mark"
          title="A cross at the centre of a hole or round edge"
          shortcut="C"
          on={mark === "centre-mark"}
          onClick={() => onMark("centre-mark")}
        />
      )}
      {!readOnly && onDimension && (
        <Button icon="dimension" label="Dimension" title="Show a size from the model on a view" shortcut="D" on={!!dimension} onClick={onDimension} />
      )}
      {!readOnly && onAuto && <Button icon="dimension" label="Auto dimension" title="Dimension the views for you" on={!!auto} onClick={onAuto} />}
      {!readOnly && onNote && (
        <Button icon="drawing" label="Note" title="Text, a leader, a hole note or a symbol" on={!!note} onClick={() => onNote(note ?? "note-leader")} />
      )}
      {!readOnly && onPartsList && (
        <Button icon="drawing" label="Parts list" title="A table of the model's parts above the title block" onClick={onPartsList} />
      )}
      {onExport && <Button icon="download" label="Export" title="Save the sheet as a PDF, SVG, DXF or PNG, or print it" onClick={onExport} />}
      <Button icon="frame" label="Fit sheet" title="Fit the sheet in the view" shortcut="F" onClick={onFit} />
    </ArmedBar>
  );
}

/** The ribbon's Drawing tab (desktop), in Fusion's order: Create, then the sheet, then Output. */
export function DrawingRibbon({
  readOnly,
  onBaseView,
  baseView,
  onProjectedView,
  projectedView,
  onCut,
  cut,
  onNote,
  note,
  onPartsList,
  onBalloons,
  onDimension,
  dimension,
  onArrange,
  onAuto,
  auto,
  onExport,
  onMark,
  mark,
  onAutoMarks,
  onSettings,
  onFit,
}: Omit<DrawingBarProps, "name">) {
  return (
    <>
      {!readOnly && (
        <RibbonGroup label="Create" entries={[]}>
          <RibbonButton icon="drawing" colour="drawing" label="Base view" pressed={!!baseView} onPress={onBaseView} />
          <RibbonButton icon="drawing" colour="drawing" label="Projected view" short="Projected" pressed={!!projectedView} onPress={onProjectedView} />
          {onCut && (
            <>
              <RibbonButton
                icon="drawing"
                colour="section"
                label={CUT_NAMES.section}
                short="Section"
                pressed={cut === "section"}
                onPress={() => onCut("section")}
              />
              <RibbonButton icon="drawing" colour="circle" label={CUT_NAMES.detail} short="Detail" pressed={cut === "detail"} onPress={() => onCut("detail")} />
              <RibbonButton icon="drawing" colour="sk-break" label={CUT_NAMES.break} pressed={cut === "break"} onPress={() => onCut("break")} />
            </>
          )}
        </RibbonGroup>
      )}
      {!readOnly && onMark && (
        <RibbonGroup label="Geometry" entries={[]}>
          <RibbonButton icon="drawing" colour="point" label="Centre mark" shortcut="C" pressed={mark === "centre-mark"} onPress={() => onMark("centre-mark")} />
          <RibbonButton
            icon="drawing"
            colour="sk-pattern"
            label="Centre mark pattern"
            short="Pattern"
            pressed={mark === "centre-pattern"}
            onPress={() => onMark("centre-pattern")}
          />
          <RibbonButton icon="drawing" colour="axis" label="Centre line" pressed={mark === "centre-line"} onPress={() => onMark("centre-line")} />
          <RibbonButton
            icon="drawing"
            colour="sk-extend"
            label="Edge extension"
            short="Extension"
            pressed={mark === "extension"}
            onPress={() => onMark("extension")}
          />
          {onAutoMarks && <RibbonButton icon="drawing" colour="sk-auto" label="Add centre marks" short="Auto marks" onPress={onAutoMarks} />}
        </RibbonGroup>
      )}
      {!readOnly && onDimension && (
        <RibbonGroup label="Dimensions" entries={[]}>
          <RibbonButton icon="dimension" colour="dimension" label="Dimension" shortcut="D" pressed={!!dimension} onPress={onDimension} />
          {onAuto && <RibbonButton icon="dimension" colour="sk-auto" label="Auto dimension" short="Auto" pressed={!!auto} onPress={onAuto} />}
          {onArrange && <RibbonButton icon="dimension" colour="sk-pattern" label="Arrange dimensions" short="Arrange" onPress={onArrange} />}
        </RibbonGroup>
      )}
      {!readOnly && onNote && (
        <RibbonGroup label="Text" entries={[]}>
          <RibbonButton icon="drawing" colour="text" label="Text" pressed={note === "note-text"} onPress={() => onNote("note-text")} />
          <RibbonButton icon="drawing" colour="arrow" label="Leader" pressed={note === "note-leader"} onPress={() => onNote("note-leader")} />
          <RibbonButton icon="drawing" colour="hole" label="Hole note" short="Hole" pressed={note === "note-hole"} onPress={() => onNote("note-hole")} />
          <RibbonButton
            icon="drawing"
            colour="sk-tangent"
            label="Surface finish"
            short="Surface"
            pressed={note === "note-finish"}
            onPress={() => onNote("note-finish")}
          />
          <RibbonButton icon="drawing" colour="sk-fix" label="Datum" pressed={note === "note-datum"} onPress={() => onNote("note-datum")} />
          <RibbonButton
            icon="drawing"
            colour="constraint"
            label="Feature control frame"
            short="Frame"
            pressed={note === "note-frame"}
            onPress={() => onNote("note-frame")}
          />
        </RibbonGroup>
      )}
      {!readOnly && onPartsList && (
        <RibbonGroup label="Tables" entries={[]}>
          <RibbonButton icon="drawing" colour="rect" label="Parts list" onPress={onPartsList} />
          {onNote && <RibbonButton icon="drawing" colour="circle" label="Balloon" pressed={note === "note-balloon"} onPress={() => onNote("note-balloon")} />}
          {onBalloons && <RibbonButton icon="drawing" colour="sk-auto" label="Add balloons" short="Auto balloons" onPress={onBalloons} />}
        </RibbonGroup>
      )}
      <RibbonGroup label="Sheet" entries={[]}>
        {!readOnly && <RibbonButton icon="settings" colour="sliders" label="Sheet settings" short="Settings" onPress={onSettings} />}
        <RibbonButton icon="frame" colour={false} label="Fit sheet" short="Fit" shortcut="F" onPress={onFit} />
      </RibbonGroup>
      {onExport && (
        <RibbonGroup label="Output" entries={[]}>
          <RibbonButton icon="download" colour="printer" label="Export" onPress={onExport} />
        </RibbonGroup>
      )}
    </>
  );
}
