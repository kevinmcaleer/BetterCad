import type { ScreenPoint } from "../viewport/engine";

/**
 * The magnifier loupe: a round, zoomed-in view of the sketch near the pointer, for telling apart points that sit too
 * close together to pick. It opens by itself when two or more points crowd the pointer, while Alt (Option) is held,
 * and under a finger. While it is open the pointer moves at 1:1 inside it, so each pixel the mouse moves is a fraction
 * of a pixel in the sketch, and picking reaches only as far as the zoom allows.
 */
export interface Loupe {
  /** Where the zoom is centred, in view pixels. */
  anchor: ScreenPoint;
  zoom: number;
  /** Where the pointer really is. Inside the loupe it shows at `pointer - anchor` from the middle. */
  pointer: ScreenPoint;
  why: "crowd" | "alt" | "touch";
}

/** The loupe's width and height in CSS pixels. */
export const LOUPE_SIZE = 168;
/** How far the pointer may wander from the anchor before a crowd loupe closes: the edge of the loupe. */
export const LOUPE_REACH = LOUPE_SIZE / 2 - 8;
/** Points this close to the pointer, in screen pixels, count towards a crowd. */
export const CROWD_REACH = 12;
/** Two points nearer each other than this, in screen pixels, are hard to pick apart. */
export const CROWD_GAP = 8;
/** The zoom aims to spread the closest pair this far apart in the loupe. */
const SPREAD = 28;
const MIN_ZOOM = 4;
const MAX_ZOOM = 40;
/** How long the pointer rests on a crowd before the loupe opens, in ms. */
export const CROWD_DWELL = 250;

/** The points near the pointer and the smallest gap between any two of them. Null when they don't crowd it. */
export function crowding(points: ScreenPoint[], p: ScreenPoint, reach = CROWD_REACH, gap = CROWD_GAP): { count: number; gap: number } | null {
  const near = points.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) <= reach);
  if (near.length < 2) return null;
  let min = Infinity;
  for (let i = 0; i < near.length; i++)
    for (let j = i + 1; j < near.length; j++) min = Math.min(min, Math.hypot(near[i]!.x - near[j]!.x, near[i]!.y - near[j]!.y));
  return min < gap ? { count: near.length, gap: min } : null;
}

/** Enough zoom to spread the closest pair about 28 px apart, between 4× and 40×. Points on top of each other get 40×. */
export function loupeZoom(gap: number | null): number {
  if (gap === null) return MIN_ZOOM * 1.5;
  if (gap <= 1e-6) return MAX_ZOOM;
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, SPREAD / gap)));
}

/** Where the pointer acts while the loupe is open: its movement from the anchor, shrunk by the zoom. */
export function lensed(l: Loupe | null, p: ScreenPoint): ScreenPoint {
  if (!l || l.why === "touch") return p;
  return { x: l.anchor.x + (p.x - l.anchor.x) / l.zoom, y: l.anchor.y + (p.y - l.anchor.y) / l.zoom };
}

/**
 * Where the loupe sits: above the point it magnifies, or below it when there isn't room above (near the top of the
 * view, under the top bar and tool bar), and kept inside the view across. `top` is the view's top inset.
 */
export function loupeBox(
  at: ScreenPoint,
  view: { width: number; height: number; top: number },
  size = LOUPE_SIZE,
  gap = 40,
): { left: number; top: number; below: boolean } {
  const above = at.y - gap - size;
  const below = above < view.top + 8;
  const top = below ? Math.min(at.y + gap, view.height - size - 8) : above;
  const left = Math.min(Math.max(at.x - size / 2, 8), Math.max(8, view.width - size - 8));
  return { left, top, below };
}

/** The hint above the loupe: how to close it (#386). A finger's loupe closes as the finger lifts, so it has none. */
export function loupeHint(why: Loupe["why"]): string | null {
  return why === "crowd" ? "Esc closes the loupe" : why === "alt" ? "Let go of Alt to close the loupe" : null;
}
