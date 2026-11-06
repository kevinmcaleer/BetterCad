/**
 * Layered Escape. One press backs out one layer: a drag, then a menu or dialog, then the armed tool, then a panel
 * sheet, then the selection. Within a level, whatever opened last goes first. Each layer is a function; pushing returns the function that removes it. Framework-free, so the
 * viewport (#3) and the kernel bridge (#4) can push layers without React.
 */
type Layer = { id: number; run: () => void; priority: number };

/** Higher backs out first; equal priorities go most recent first. */
export const ESC = { drag: 40, overlay: 30, tool: 20, panel: 10, selection: 0 } as const;

const layers: Layer[] = [];
let nextId = 1;
let installed = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const top = topLayer();
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  top.run();
}

function topLayer(): Layer | undefined {
  let best: Layer | undefined;
  for (const l of layers) if (!best || l.priority >= best.priority) best = l;
  return best;
}

/** Adds a layer. Returns the remover; call it when the thing closes by any other route. */
export function pushEscape(run: () => void, priority: number = ESC.overlay): () => void {
  if (!installed && typeof window !== "undefined") {
    window.addEventListener("keydown", onKeyDown);
    installed = true;
  }
  const layer = { id: nextId++, run, priority };
  layers.push(layer);
  return () => {
    const i = layers.findIndex((l) => l.id === layer.id);
    if (i >= 0) layers.splice(i, 1);
  };
}

/** The number of open layers (tests and the status line). */
export function escapeDepth(): number {
  return layers.length;
}

/** Runs the top layer, as pressing Escape would. Returns false when nothing was open. */
export function backOut(): boolean {
  const top = topLayer();
  if (!top) return false;
  top.run();
  return true;
}
