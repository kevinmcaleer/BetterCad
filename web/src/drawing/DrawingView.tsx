import {
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
  scaleLabel,
  viewScale,
  type Drawing,
  type DrawingDimension,
  type DrawingMark,
  type DrawingRef,
  type DrawingSheet,
  type DrawingView,
  type TitleBlock,
} from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newId, type ModelDoc } from "../state/document";
import { arrangeSheet, contextOf, crowded, sheetRows, snapRow, type Crowded } from "./arrange";
import { BaseViewCard, type ShowOption } from "./BaseViewCard";
import { DimensionCard } from "./DimensionCard";
import { DimensionLayer } from "./DimensionLayer";
import { addPick, dimStyle, draftOf, isIso, pickKey, type DimPick, type Pending } from "./dimensions";
import { ExportCard, type DrawingFile } from "./ExportCard";
import { sheetLayout, sizeName, TEXT } from "./layout";
import { MarkCard } from "./MarkCard";
import { isMarkTool, MarkLayer, type MarkTool } from "./MarkLayer";
import { autoMarks, MARK_NAMES, markKey, markStyle, markView, pitchCircle, refKey, refTo, targets, type Target } from "./marks";
import { descendants, inheritedScale, placeProjected, projectedDirection, sideAt, spotAt, spotBeside, type Side } from "./projected";
import { ProjectedViewCard } from "./ProjectedViewCard";
import { SheetArt } from "./Sheet";
import { useModelViews, type ViewCall, type ViewWanted } from "./useModelViews";
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

export { SheetCard, type SheetChoice } from "./SheetCard";
export type { ViewCall } from "./useModelViews";
export type { ShowOption } from "./BaseViewCard";
export type { DrawingFile } from "./ExportCard";
export { decimalsChange, drawingChange, makeDrawing, sheetChange, sheetEdit, titleChange } from "./ops";

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
export type DrawingTool = "base" | "projected" | "export" | "dimension" | MarkTool;
export { isMarkTool, type MarkTool } from "./MarkLayer";

export interface DrawingApi {
  fit(): void;
  /** Add centre marks to the selected view, or to every view when none is (#563). */
  autoMarks(): void;
  /** Arrange dimensions on the selected view, or on every view when none is (#565). */
  arrange(): void;
}

export interface DrawingPaperProps {
  drawing: Drawing;
  /** A model you can look at but not change: the title block is only drawn. */
  readOnly?: boolean;
  /** A title block field was typed in. */
  onTitle: (field: keyof TitleBlock, value: string) => void;
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
  /** What a view can show besides the whole model. */
  components?: ShowOption[];
  bodies?: ShowOption[];
  /** Saves an exported file (#569), and says how it went. */
  onSave?: (file: DrawingFile) => Promise<string | undefined>;
  say?: (text: string, bad?: boolean) => void;
  /** The drawing's decimal places were changed, from the Dimension card (#564). */
  onDecimals?: (places: number) => void;
}

/**
 * The Drawing workspace's sheet (#559): paper over the whole 3D view, under the floating cards. Drag moves it, the
 * wheel or a pinch zooms, and a double-click on a title block field types in it. Drawn as SVG in paper millimetres,
 * so it stays sharp at any zoom and reads to tests and screen readers.
 */
export function DrawingPaper({
  drawing,
  readOnly,
  onTitle,
  api,
  doc,
  upTo,
  call,
  tool = null,
  onTool,
  onSheet,
  components = [],
  bodies = [],
  onSave,
  say,
  onDecimals,
}: DrawingPaperProps) {
  const sheet = drawing.sheets[0]!;
  const layout = useMemo(() => sheetLayout(sheet, { index: 1, count: drawing.sheets.length }), [sheet, drawing.sheets.length]);
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
  useEffect(() => {
    if (api) api.current = { fit, autoMarks: () => autoRef.current(), arrange: () => arrangeRef.current() };
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
  const angle = layout.angle;
  const ghostDirection = useMemo(() => (parent ? projectedDirection(parent.direction, side, angle) : undefined), [parent, side, angle]);
  const wanted = useMemo<ViewWanted[]>(() => {
    const list = sheet.views.map((v) => ({ id: v.id, request: viewRequest(v) }));
    if (placing) list.push({ id: GHOST, request: viewRequest(choice, true) });
    else if (parent && ghostDirection) list.push({ id: GHOST, request: viewRequest({ ...parent, direction: ghostDirection }, true) });
    return list;
  }, [sheet.views, placing, choice, parent, ghostDirection]);
  const got = useModelViews(wanted, doc ?? EMPTY_DOC, upTo, doc ? call : undefined);
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
  const addMark = (mark: DrawingMark) =>
    onSheet?.(
      (s) => (s.marks.some((m) => markKey(m) === markKey(mark) && markView(m) === markView(mark)) ? s : { ...s, marks: [...s.marks, mark] }),
      MARK_NAMES[mark.kind],
    );
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
    onSheet?.((s) => ({ ...s, dimensions: [...s.dimensions, { ...d, id }] }), "Dimension");
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
          return next;
        }),
      }),
      label,
    );
  const removeDim = (id: string) => onSheet?.((s) => ({ ...s, dimensions: s.dimensions.filter((d) => d.id !== id) }), "Delete dimension");
  const menuDim = dimMenu ? sheet.dimensions.find((d) => d.id === dimMenu.id) : undefined;
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
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const was = touches.current.get(e.pointerId);
    if (!was) {
      // Nothing pressed: the view being placed follows the pointer.
      if ((placing || parent || dimensioning) && root.current?.contains(e.target as Node)) {
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
    if (p.view && !readOnly && !projecting && view) {
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

  /** The sheet as drawn: with the view being dragged, and the views it carries, where the drag has them. */
  const shown = useMemo(() => (moving ? moveView(sheet, moving.id, moving.at) : sheet), [sheet, moving]);

  // Typing in a title block field: a text box over its cell. Enter or clicking away keeps it, Esc drops it, Tab
  // moves to the next field.
  const [editing, setEditing] = useState<keyof TitleBlock | null>(null);
  const [draft, setDraft] = useState("");
  const open = useRef<{ field: keyof TitleBlock; text: string } | null>(null);
  const fields = useMemo(() => layout.cells.filter((c) => c.edit), [layout]);
  const start = (field: keyof TitleBlock) => {
    const text = sheet.title[field] ?? "";
    open.current = { field, text };
    setDraft(text);
    setEditing(field);
  };
  const keep = () => {
    const o = open.current;
    if (!o) return;
    open.current = null;
    setEditing(null);
    if (o.text.trim() !== (sheet.title[o.field] ?? "")) onTitle(o.field, o.text.trim());
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
      <div ref={clear} className="bc-drawing-clear" aria-hidden="true" />
      <svg className="bc-drawing-svg" role="group" aria-label={`${sheet.name}: ${sizeName(sheet.size)}, ${sheet.landscape ? "landscape" : "portrait"}`}>
        {view && (
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <SheetArt layout={layout} onEdit={readOnly || placing ? undefined : start} editing={editing} />
            {shown.views.map((v) => {
              const g = got.get(v.id);
              const scale = viewScale(sheet, v);
              const art = g?.view ? artOf(g.view, scale) : undefined;
              const [x, y] = toPage(v.at, ph);
              const state = g?.error ? ", could not be drawn" : !art ? ", being worked out" : "";
              // A view with no picture yet still has something to point at.
              const w = Math.max(art?.w ?? 0, 20) + 4;
              const h = Math.max(art?.h ?? 0, 20) + 4;
              return (
                <g
                  key={v.id}
                  data-view={v.id}
                  className={parent?.id === v.id ? "bc-view bc-view-from" : selected === v.id ? "bc-view bc-view-on" : "bc-view"}
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
                    if (readOnly || placing || projecting) return;
                    e.preventDefault();
                    setSelected(v.id);
                    setMenu({ at: { x: e.clientX, y: e.clientY }, view: v.id });
                  }}
                >
                  <rect className={art ? "bc-view-hit" : "bc-view-hit bc-view-wait"} x={-w / 2} y={-h / 2} width={w} height={h} />
                  {art && <path className="bc-view-hidden" d={art.hidden} />}
                  {art && <path className="bc-view-visible" d={art.visible} />}
                  {g?.view && (
                    <MarkLayer
                      viewId={v.id}
                      model={g.view}
                      scale={scale}
                      style={style}
                      marks={sheet.marks.filter((m) => markView(m) === v.id)}
                      tool={markTool}
                      picked={picks.view === v.id ? pickedKeys : undefined}
                      onPick={(t) => pick(v.id, t)}
                      selected={selectedMark}
                      onSelect={setSelectedMark}
                      onDelete={readOnly ? undefined : (id) => onSheet?.((s) => ({ ...s, marks: s.marks.filter((m) => m.id !== id) }), "Delete mark")}
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
                      dimensions={sheet.dimensions.filter((d) => d.view === v.id)}
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
                      onMove={readOnly ? undefined : (id, at) => changeDim(id, { at }, "Move dimension")}
                      onDelete={readOnly ? undefined : removeDim}
                      onMenu={readOnly ? undefined : (id, x, y) => setDimMenu({ at: { x, y }, id })}
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
                { kind: "separator" as const, id: "s" },
                { id: "delete", label: "Delete", danger: true, keys: "Del", onSelect: () => removeDim(menuDim.id) },
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
                { id: "edit", label: "Change this view", icon: "settings", onSelect: () => startChange(menuView) },
                { kind: "separator", id: "s" },
                { id: "delete", label: "Delete", danger: true, keys: "Del", onSelect: () => remove(menuView) },
              ]
            : []
        }
      />
      {tool === "export" && onSave && (
        <ExportCard
          drawing={drawing}
          sheet={sheet}
          layout={layout}
          viewOf={(id) => got.get(id)?.view}
          onSave={onSave}
          say={say ?? (() => {})}
          onClose={() => onTool?.(null)}
        />
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
  /** Arms Dimension (#564). */
  onDimension?: () => void;
  dimension?: boolean;
  /** Arrange dimensions (#565). */
  onArrange?: () => void;
  /** Opens Export (#569). */
  onExport?: () => void;
  /** Arms a mark tool (#563), the one that is armed, and Add centre marks. */
  onMark?: (tool: MarkTool) => void;
  mark?: MarkTool | null;
  onAutoMarks?: () => void;
  onSettings: () => void;
  onFit: () => void;
  onFinish: () => void;
  /** The Drawing tab is showing (desktop), with the tools on it: the bar keeps only what is handy under the sheet. */
  ribbon?: boolean;
}

/** The strip over the sheet while a drawing is open: its name, Sheet settings, Fit sheet and Finish drawing. */
export function DrawingBar({
  name,
  readOnly,
  onBaseView,
  baseView,
  onProjectedView,
  projectedView,
  onDimension,
  dimension,
  onExport,
  onMark,
  mark,
  onSettings,
  onFit,
  onFinish,
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
        <Button kind="done" icon="finish" label="Finish drawing" title="Go back to the model" shortcut="Esc" onClick={onFinish} />
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
      {onExport && <Button icon="download" label="Export" title="Save the sheet as a PDF, SVG, DXF or PNG, or print it" onClick={onExport} />}
      <Button icon="frame" label="Fit sheet" title="Fit the sheet in the view" shortcut="F" onClick={onFit} />
      <Button kind="done" icon="finish" label="Finish drawing" title="Go back to the model" shortcut="Esc" onClick={onFinish} />
    </ArmedBar>
  );
}

/** The ribbon's Drawing tab (desktop), in Fusion's order: Create, then the sheet, then Finish drawing. */
export function DrawingRibbon({
  readOnly,
  onBaseView,
  baseView,
  onProjectedView,
  projectedView,
  onDimension,
  dimension,
  onArrange,
  onExport,
  onMark,
  mark,
  onAutoMarks,
  onSettings,
  onFit,
  onFinish,
}: Omit<DrawingBarProps, "name">) {
  return (
    <>
      {!readOnly && (
        <RibbonGroup label="Create" entries={[]}>
          <RibbonButton icon="drawing" colour="drawing" label="Base view" pressed={!!baseView} onPress={onBaseView} />
          <RibbonButton icon="drawing" colour="drawing" label="Projected view" short="Projected" pressed={!!projectedView} onPress={onProjectedView} />
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
          {onArrange && <RibbonButton icon="dimension" colour="sk-auto" label="Arrange dimensions" short="Arrange" onPress={onArrange} />}
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
      <RibbonGroup label="Finish" entries={[]}>
        <RibbonButton icon="finish" colour={false} label="Finish drawing" short="Finish" shortcut="Esc" done onPress={onFinish} />
      </RibbonGroup>
    </>
  );
}
