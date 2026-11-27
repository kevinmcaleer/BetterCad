import type { Box, P2 } from "@bettercad/electronics";

/**
 * The 2D view (#618): where the drawing sits on the screen. World millimetres, y up; screen pixels, y down.
 * `scale` is pixels per millimetre and (`ox`, `oy`) is where the world's origin lands on the screen.
 */
export interface View2D {
  scale: number;
  ox: number;
  oy: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 400;

export const toScreen = (v: View2D, p: P2): P2 => [v.ox + p[0] * v.scale, v.oy - p[1] * v.scale];
export const toWorld = (v: View2D, s: P2): P2 => [(s[0] - v.ox) / v.scale, (v.oy - s[1]) / v.scale];

/** Zooms by `factor`, keeping the point under the pointer where it is. */
export function zoomAt(v: View2D, at: P2, factor: number): View2D {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
  const w = toWorld(v, at);
  return { scale, ox: at[0] - w[0] * scale, oy: at[1] + w[1] * scale };
}

export const pan = (v: View2D, dx: number, dy: number): View2D => ({ ...v, ox: v.ox + dx, oy: v.oy + dy });

/** Fits a box into the part of the canvas the floating cards leave clear. */
export function fit(box: Box, size: { w: number; h: number }, clear = { top: 0, right: 0, bottom: 0, left: 0 }, margin = 32): View2D {
  const w = Math.max(size.w - clear.left - clear.right - margin * 2, 40);
  const h = Math.max(size.h - clear.top - clear.bottom - margin * 2, 40);
  const bw = Math.max(box.x2 - box.x1, 1e-6);
  const bh = Math.max(box.y2 - box.y1, 1e-6);
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(w / bw, h / bh)));
  const cx = clear.left + margin + w / 2;
  const cy = clear.top + margin + h / 2;
  return { scale, ox: cx - ((box.x1 + box.x2) / 2) * scale, oy: cy + ((box.y1 + box.y2) / 2) * scale };
}

/** Snaps a world point to a grid. */
export const snap = (p: P2, grid: number): P2 => [Math.round(p[0] / grid) * grid, Math.round(p[1] / grid) * grid].map((n) => Math.round(n * 1e6) / 1e6) as P2;

/**
 * The grid as dots, every step worth drawing, with a bigger, stronger dot every fifth step so distances read at a
 * glance. Sizes are screen pixels; `strength` fades it, under copper on the board.
 */
export function drawGridDots(ctx: CanvasRenderingContext2D, v: View2D, size: { w: number; h: number }, base: number, colour: string, strength = 1) {
  const step = gridStep(v, base, 12);
  const a = toWorld(v, [0, size.h]);
  const b = toWorld(v, [size.w, 0]);
  ctx.save();
  ctx.fillStyle = colour;
  for (let i = Math.ceil(a[0] / step); i * step <= b[0]; i++)
    for (let j = Math.ceil(a[1] / step); j * step <= b[1]; j++) {
      const major = i % 5 === 0 && j % 5 === 0;
      const r = major ? 2.5 : 1.5;
      ctx.globalAlpha = (major ? 0.9 : 0.55) * strength;
      const s = toScreen(v, [i * step, j * step]);
      ctx.fillRect(s[0] - r / 2, s[1] - r / 2, r, r);
    }
  ctx.restore();
}

/** The grid spacing worth drawing: the base grid, doubled until its dots are far enough apart to read. */
export function gridStep(v: View2D, base: number, minPx = 9): number {
  let step = base;
  while (step * v.scale < minPx) step *= step === base && base === 2.54 ? 5 : 2;
  return step;
}
