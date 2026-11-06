/** The element overlays (menus, tooltips, dialogs) render into, so they escape the stage's overflow. */
export function overlayRoot(): HTMLElement {
  let el = document.getElementById("bc-overlays");
  if (!el) {
    el = document.createElement("div");
    el.id = "bc-overlays";
    el.className = "bc bc-overlays";
    document.body.appendChild(el);
  }
  return el;
}

/** Keeps a box of size w×h, wanted at (x, y), inside the window; flips to the other side of the point when needed. */
export function placeInWindow(x: number, y: number, w: number, h: number, vw = window.innerWidth, vh = window.innerHeight, margin = 4) {
  let left = x;
  let top = y;
  if (left + w > vw - margin) left = Math.max(margin, x - w);
  if (top + h > vh - margin) top = Math.max(margin, y - h);
  return { left: Math.max(margin, left), top: Math.max(margin, top) };
}
