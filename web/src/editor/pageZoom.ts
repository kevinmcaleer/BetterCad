/**
 * Pinches zoom the 3D view, never the page. A trackpad pinch arrives as a wheel with Ctrl held (Chrome, Edge,
 * Firefox) or as Safari's gesture events; started over a floating card, the ribbon or the timeline, the browser would
 * otherwise zoom the whole page. Here the page zoom is blocked everywhere and the pinch is handed to whichever view
 * canvas lies under the pointer. Plain wheels are left alone, so panels still scroll, and Ctrl/Cmd with + and − still
 * zoom the page from the keyboard. Touch pinches are held back by `touch-action` in app.css.
 */

/** The canvases that zoom on a Ctrl-wheel: the Render picture first, it sits over the modelling view. */
const VIEWS = ".bc-render-canvas, .bc-view-canvas";

/** The view canvas under a point, unless a modal dialog covers it. */
export function viewAt(doc: Document, x: number, y: number): HTMLElement | null {
  const stack = doc.elementsFromPoint?.(x, y) ?? [];
  for (const el of stack) {
    if (el.closest('[aria-modal="true"]')) return null;
    if (el.matches(VIEWS)) return el as HTMLElement;
  }
  return null;
}

function forward(view: HTMLElement, x: number, y: number, deltaY: number) {
  view.dispatchEvent(new WheelEvent("wheel", { clientX: x, clientY: y, deltaY, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true }));
}

/** Safari's gesture events: `scale` is the pinch so far, 1 at the start. */
type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };

/** Installs the guard on a window; returns a function that takes it off. */
export function guardPageZoom(win: Window = window): () => void {
  const doc = win.document;
  const wheel = (e: WheelEvent) => {
    // The view already zoomed (or a field used it): only page zoom is left to stop.
    if (!e.ctrlKey || e.defaultPrevented) return;
    e.preventDefault();
    const view = viewAt(doc, e.clientX, e.clientY);
    if (view && view !== e.target) forward(view, e.clientX, e.clientY, e.deltaY);
  };

  // Safari on a Mac sends a trackpad pinch only as gesture events. On an iPad the same events come with touches,
  // which the view already reads as pointers, so there they are only blocked.
  let touches = 0;
  let scale = 1;
  const touch = (e: TouchEvent) => (touches = e.touches.length);
  const start = (e: Event) => {
    e.preventDefault();
    scale = 1;
  };
  const change = (e: Event) => {
    e.preventDefault();
    const g = e as GestureEvent;
    if (touches > 0 || !g.scale) return;
    const view = viewAt(doc, g.clientX, g.clientY);
    // Matches the view's Ctrl-wheel zoom, exp(deltaY × 0.01): fingers apart zoom in.
    if (view) forward(view, g.clientX, g.clientY, Math.log(scale / g.scale) * 100);
    scale = g.scale;
  };

  win.addEventListener("wheel", wheel, { passive: false });
  win.addEventListener("touchstart", touch, { passive: true, capture: true });
  win.addEventListener("touchend", touch, { passive: true, capture: true });
  win.addEventListener("touchcancel", touch, { passive: true, capture: true });
  win.addEventListener("gesturestart", start);
  win.addEventListener("gesturechange", change);
  win.addEventListener("gestureend", start);
  return () => {
    win.removeEventListener("wheel", wheel);
    win.removeEventListener("touchstart", touch, { capture: true });
    win.removeEventListener("touchend", touch, { capture: true });
    win.removeEventListener("touchcancel", touch, { capture: true });
    win.removeEventListener("gesturestart", start);
    win.removeEventListener("gesturechange", change);
    win.removeEventListener("gestureend", start);
  };
}
