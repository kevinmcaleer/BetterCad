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
import { ArmedBar, Button, ESC, RibbonButton, RibbonGroup, useEscape } from "@bettercad/ui";
import { removeView, scaleLabel, viewScale, type Drawing, type DrawingSheet, type DrawingView, type TitleBlock } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newId, type ModelDoc } from "../state/document";
import { BaseViewCard, type ShowOption } from "./BaseViewCard";
import { sheetLayout, sizeName } from "./layout";
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
export { drawingChange, makeDrawing, sheetChange, sheetEdit, titleChange } from "./ops";

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

/** A view's lines at a scale, worked out once per picture. */
const arts = new WeakMap<ModelView, Map<number, ViewArt>>();
function artOf(view: ModelView, scale: number): ViewArt {
  let by = arts.get(view);
  if (!by) arts.set(view, (by = new Map()));
  let art = by.get(scale);
  if (!art) by.set(scale, (art = viewArt(view, scale)));
  return art;
}

/** The drawing tool that is armed: placing a base view (#561). */
export type DrawingTool = "base";

export interface DrawingApi {
  fit(): void;
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
  useEffect(() => {
    if (api) api.current = { fit };
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
  const wanted = useMemo<ViewWanted[]>(() => {
    const list = sheet.views.map((v) => ({ id: v.id, request: viewRequest(v) }));
    if (placing) list.push({ id: GHOST, request: viewRequest(choice, true) });
    return list;
  }, [sheet.views, placing, choice]);
  const got = useModelViews(wanted, doc ?? EMPTY_DOC, upTo, doc ? call : undefined);
  const ghost = placing ? got.get(GHOST) : undefined;
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
    setChoice({ shows: v.shows, direction: v.direction, hidden: v.hidden, tangent: v.tangent, scale: viewScale(sheet, v) });
    setChanging(v.id);
  };
  const doneChange = () => {
    const scale = choice.scale ?? fitScaleNow;
    if (changing && scale) onSheet?.((s) => editView(s, changing, choice, scale), "Edit view");
    setChanging(null);
  };

  // One finger or the mouse drags the sheet, or the view it is on; two fingers pinch the sheet.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const press = useRef<{ x: number; y: number; dragging: boolean; view?: DrawingView } | null>(null);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The card over the sheet is drawn elsewhere on the page, but React still passes its presses up to here.
    if (!root.current?.contains(e.target as Node) || (e.target as Element).closest?.("input")) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size !== 1) return;
    const id = placing ? undefined : (e.target as Element).closest?.("[data-view]")?.getAttribute("data-view");
    const on = id ? sheet.views.find((v) => v.id === id) : undefined;
    press.current = { x: e.clientX, y: e.clientY, dragging: false, view: on };
    if (!placing) setSelected(on?.id ?? null);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const was = touches.current.get(e.pointerId);
    if (!was) {
      // Nothing pressed: the view being placed follows the pointer.
      if (placing && root.current?.contains(e.target as Node)) setPointer(sheetAt(e.clientX, e.clientY));
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
    if (p.view && !readOnly && view) {
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
    const at = placing ? sheetAt(e.clientX, e.clientY) : null;
    if (at) place(at);
  };
  const viewKey = (e: ReactKeyboardEvent, v: DrawingView) => {
    if (readOnly) return;
    const step = e.shiftKey ? NUDGE * 10 : NUDGE;
    const by: Record<string, V2> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = by[e.key];
    if (d) onSheet?.((s) => moveView(s, v.id, [v.at[0] + d[0], v.at[1] + d[1]]), "Move view");
    else if (e.key === "Delete" || e.key === "Backspace") onSheet?.((s) => removeView(s, v.id), "Delete view");
    else if (e.key === "Enter") startChange(v);
    else return;
    e.preventDefault();
  };

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
            {sheet.views.map((v) => {
              const g = got.get(v.id);
              const scale = viewScale(sheet, v);
              const art = g?.view ? artOf(g.view, scale) : undefined;
              const [x, y] = toPage(moving?.id === v.id ? moving.at : v.at, ph);
              const state = g?.error ? ", could not be drawn" : !art ? ", being worked out" : "";
              // A view with no picture yet still has something to point at.
              const w = Math.max(art?.w ?? 0, 20) + 4;
              const h = Math.max(art?.h ?? 0, 20) + 4;
              return (
                <g
                  key={v.id}
                  data-view={v.id}
                  className={selected === v.id ? "bc-view bc-view-on" : "bc-view"}
                  role="button"
                  aria-pressed={selected === v.id}
                  aria-label={`${viewName(v)}, ${scaleLabel(scale)}${state}`}
                  aria-busy={g?.busy || undefined}
                  tabIndex={0}
                  transform={`translate(${x} ${y})`}
                  onFocus={() => setSelected(v.id)}
                  onDoubleClick={() => startChange(v)}
                  onKeyDown={(e) => viewKey(e, v)}
                >
                  <rect className={art ? "bc-view-hit" : "bc-view-hit bc-view-wait"} x={-w / 2} y={-h / 2} width={w} height={h} />
                  {art && <path className="bc-view-hidden" d={art.hidden} />}
                  {art && <path className="bc-view-visible" d={art.visible} />}
                </g>
              );
            })}
            {placing && ghost?.view && fitScaleNow && (
              <g className="bc-view-ghost" aria-hidden="true" transform={`translate(${toPage(pointer ?? defaultSpot(layout), ph).join(" ")})`}>
                <path className="bc-view-visible" d={artOf(ghost.view, choice.scale ?? fitScaleNow).visible} />
              </g>
            )}
          </g>
        )}
      </svg>
      {(placing || changed) && (
        <BaseViewCard
          editing={!!changed}
          choice={choice}
          onChoice={setChoice}
          components={components}
          bodies={bodies}
          fit={fitScaleNow}
          wait={wait}
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
  onSettings: () => void;
  onFit: () => void;
  onFinish: () => void;
}

/** The strip over the sheet while a drawing is open: its name, Sheet settings, Fit sheet and Finish drawing. */
export function DrawingBar({ name, readOnly, onBaseView, baseView, onSettings, onFit, onFinish }: DrawingBarProps) {
  return (
    <ArmedBar title={name} icon="drawing">
      {!readOnly && onBaseView && <Button icon="drawing" label="Base view" title="Put a view of the model on the sheet" on={!!baseView} onClick={onBaseView} />}
      {!readOnly && <Button icon="settings" label="Sheet settings" title="Page size, standard and title block" onClick={onSettings} />}
      <Button icon="frame" label="Fit sheet" title="Fit the sheet in the view" shortcut="F" onClick={onFit} />
      <Button kind="done" icon="finish" label="Finish drawing" title="Go back to the model" shortcut="Esc" onClick={onFinish} />
    </ArmedBar>
  );
}

/** The ribbon's Drawing tab (desktop), in Fusion's order: Create, then the sheet, then Finish drawing. */
export function DrawingRibbon({ readOnly, onBaseView, baseView, onSettings, onFit, onFinish }: Omit<DrawingBarProps, "name">) {
  return (
    <>
      {!readOnly && (
        <RibbonGroup label="Create" entries={[]}>
          <RibbonButton icon="drawing" colour="drawing" label="Base view" pressed={!!baseView} onPress={onBaseView} />
        </RibbonGroup>
      )}
      <RibbonGroup label="Sheet" entries={[]}>
        {!readOnly && <RibbonButton icon="settings" colour="sliders" label="Sheet settings" short="Settings" onPress={onSettings} />}
        <RibbonButton icon="frame" colour={false} label="Fit sheet" short="Fit" shortcut="F" onPress={onFit} />
      </RibbonGroup>
      <RibbonGroup label="Finish" entries={[]}>
        <RibbonButton icon="finish" colour={false} label="Finish drawing" short="Finish" shortcut="Esc" done onPress={onFinish} />
      </RibbonGroup>
    </>
  );
}
