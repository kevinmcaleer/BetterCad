import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { ArmedBar, Button, ESC, useEscape } from "@bettercad/ui";
import type { Drawing, TitleBlock } from "@bettercad/kernel/drawing";
import { sheetLayout, sizeName } from "./layout";
import { SheetArt } from "./Sheet";

export { SheetCard, type SheetChoice } from "./SheetCard";
export { drawingChange, makeDrawing, sheetChange, titleChange } from "./ops";

/** Where the sheet sits in the view: screen pixels per paper millimetre, and the page's top left corner. */
interface View {
  k: number;
  x: number;
  y: number;
}
/** Clear space round a fitted sheet, px. */
const PAD = 24;
const MIN_K = 0.15;
const MAX_K = 60;
/** How far a press moves before it is a drag, so a double-click on the title block still lands. */
const SLOP = 4;

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
}

/**
 * The Drawing workspace's sheet (#559): paper over the whole 3D view, under the floating cards. Drag moves it, the
 * wheel or a pinch zooms, and a double-click on a title block field types in it. Drawn as SVG in paper millimetres,
 * so it stays sharp at any zoom and reads to tests and screen readers.
 */
export function DrawingPaper({ drawing, readOnly, onTitle, api }: DrawingPaperProps) {
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

  // One finger or the mouse drags the sheet; two fingers pinch it.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest?.("input")) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 1) press.current = { x: e.clientX, y: e.clientY, dragging: false };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const was = touches.current.get(e.pointerId);
    if (!was) return;
    const now = { x: e.clientX, y: e.clientY };
    const el = root.current!;
    if (touches.current.size >= 2) {
      const other = [...touches.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const r = el.getBoundingClientRect();
      const before = Math.hypot(was.x - other.x, was.y - other.y) || 1;
      const after = Math.hypot(now.x - other.x, now.y - other.y) || 1;
      touches.current.set(e.pointerId, now);
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
    loose.current = true;
    setView((v) => v && { ...v, x: v.x + now.x - was.x, y: v.y + now.y - was.y });
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    if (!touches.current.size) press.current = null;
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
            <SheetArt layout={layout} onEdit={readOnly ? undefined : start} editing={editing} />
          </g>
        )}
      </svg>
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
  onSettings: () => void;
  onFit: () => void;
  onFinish: () => void;
}

/** The strip over the sheet while a drawing is open: its name, Sheet settings, Fit sheet and Finish drawing. */
export function DrawingBar({ name, readOnly, onSettings, onFit, onFinish }: DrawingBarProps) {
  return (
    <ArmedBar title={name} icon="drawing">
      {!readOnly && <Button icon="settings" label="Sheet settings" title="Page size, standard and title block" onClick={onSettings} />}
      <Button icon="frame" label="Fit sheet" title="Fit the sheet in the view" shortcut="F" onClick={onFit} />
      <Button kind="done" icon="finish" label="Finish drawing" title="Go back to the model" shortcut="Esc" onClick={onFinish} />
    </ArmedBar>
  );
}
