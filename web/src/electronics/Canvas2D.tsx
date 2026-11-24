import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import type { P2 } from "@bettercad/electronics";
import { pan, toWorld, zoomAt, type View2D } from "./view2d";

export interface Pointer {
  /** Where the pointer is, in world millimetres and in canvas pixels. */
  world: P2;
  screen: P2;
  shift: boolean;
  ctrl: boolean;
  touch: boolean;
}

export interface Canvas2DApi {
  size: () => { w: number; h: number };
  redraw: () => void;
}

export interface Canvas2DProps {
  label: string;
  view: View2D;
  onView: (v: View2D) => void;
  /** Draws the whole picture. Called when `drawKey` or the view changes, and when the canvas is resized. */
  draw: (ctx: CanvasRenderingContext2D, view: View2D, size: { w: number; h: number }) => void;
  drawKey: unknown;
  cursor?: string;
  api?: Ref<Canvas2DApi>;
  /** True from `onDown` to take the drag for yourself; otherwise a drag on a touch screen pans. */
  onDown?: (p: Pointer) => boolean | void;
  onMove?: (p: Pointer, dragging: boolean) => void;
  onUp?: (p: Pointer, moved: boolean) => void;
  onDouble?: (p: Pointer) => void;
  onMenu?: (p: Pointer) => void;
  onResize?: (size: { w: number; h: number }) => void;
}

/**
 * The canvas the schematic and the board draw on (#618). Scroll zooms about the pointer; middle or right drag, or a
 * drag with one finger on empty space, pans; two fingers pinch. Everything else is handed to the tool in charge.
 */
export function Canvas2D(p: Canvas2DProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef(p);
  live.current = p;
  const size = useRef({ w: 0, h: 0 });

  const redraw = () => {
    const c = ref.current;
    const ctx = c?.getContext?.("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.current.w, size.current.h);
    live.current.draw(ctx, live.current.view, size.current);
  };
  useImperativeHandle(p.api, () => ({ size: () => size.current, redraw }));

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const measure = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: r.width, h: r.height };
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      live.current.onResize?.(size.current);
      redraw();
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(redraw, [p.drawKey, p.view]);

  // Pointers: who is down, and what the drag is doing.
  const downs = useRef(new Map<number, P2>());
  const drag = useRef<{ mode: "pan" | "tool" | "pinch"; moved: boolean; last: P2; start: P2; gap?: number } | null>(null);

  const pointer = (e: { clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; pointerType?: string }): Pointer => {
    const r = ref.current!.getBoundingClientRect();
    const screen: P2 = [e.clientX - r.left, e.clientY - r.top];
    return { screen, world: toWorld(live.current.view, screen), shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, touch: e.pointerType === "touch" };
  };

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // React's wheel listener is passive, so zooming is wired by hand to stop the page scrolling.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = pointer(e).screen;
      const v = live.current.view;
      live.current.onView(
        e.ctrlKey || Math.abs(e.deltaY) >= 4 || e.deltaX === 0
          ? zoomAt(v, at, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
          : pan(v, -e.deltaX, -e.deltaY),
      );
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, []);

  return (
    <canvas
      ref={ref}
      className="bc-ec-canvas"
      role="img"
      aria-label={p.label}
      // Where the drawing sits, for tests that click a place on it: pixels per millimetre, then the origin.
      data-view={`${p.view.scale} ${p.view.ox} ${p.view.oy}`}
      tabIndex={0}
      style={{ cursor: p.cursor }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!drag.current?.moved) live.current.onMenu?.(pointer(e));
      }}
      onDoubleClick={(e) => live.current.onDouble?.(pointer(e))}
      onPointerDown={(e) => {
        const at = pointer(e);
        e.currentTarget.setPointerCapture?.(e.pointerId);
        downs.current.set(e.pointerId, at.screen);
        if (downs.current.size === 2) {
          const [a, b] = [...downs.current.values()] as [P2, P2];
          drag.current = {
            mode: "pinch",
            moved: true,
            last: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
            start: at.screen,
            gap: Math.hypot(a[0] - b[0], a[1] - b[1]),
          };
          return;
        }
        if (e.button === 1 || e.button === 2) {
          drag.current = { mode: "pan", moved: false, last: at.screen, start: at.screen };
          return;
        }
        const taken = live.current.onDown?.(at);
        drag.current = { mode: taken || !at.touch ? "tool" : "pan", moved: false, last: at.screen, start: at.screen };
      }}
      onPointerMove={(e) => {
        const at = pointer(e);
        const d = drag.current;
        if (downs.current.has(e.pointerId)) downs.current.set(e.pointerId, at.screen);
        if (!d) return live.current.onMove?.(at, false);
        if (d.mode === "pinch" && downs.current.size >= 2) {
          const [a, b] = [...downs.current.values()] as [P2, P2];
          const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
          live.current.onView(pan(zoomAt(live.current.view, mid, gap / (d.gap || gap)), mid[0] - d.last[0], mid[1] - d.last[1]));
          d.last = mid;
          d.gap = gap;
          return;
        }
        if (!d.moved && Math.hypot(at.screen[0] - d.start[0], at.screen[1] - d.start[1]) > (at.touch ? 8 : 3)) d.moved = true;
        if (d.mode === "pan") {
          if (d.moved) live.current.onView(pan(live.current.view, at.screen[0] - d.last[0], at.screen[1] - d.last[1]));
          d.last = at.screen;
          return;
        }
        live.current.onMove?.(at, d.moved);
      }}
      onPointerUp={(e) => {
        const at = pointer(e);
        const d = drag.current;
        downs.current.delete(e.pointerId);
        if (!d) return;
        if (d.mode === "pinch") {
          if (downs.current.size === 0) drag.current = null;
          return;
        }
        drag.current = null;
        // A tap that did not turn into a pan is a click for the tool, on touch as with a mouse.
        if (d.mode === "tool" || (d.mode === "pan" && !d.moved && e.button === 0)) live.current.onUp?.(at, d.moved);
      }}
      onPointerCancel={(e) => {
        downs.current.delete(e.pointerId);
        drag.current = null;
      }}
    />
  );
}
