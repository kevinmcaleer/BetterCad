import { Mesh, SRGBColorSpace, WebGLRenderTarget } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Vec2 } from "@bettercad/sketch";
import type { Engine, ScreenPoint } from "../viewport/engine";
import { LOUPE_SIZE, type Loupe } from "./loupe";
import type { OverlayView, Shade } from "./overlay";

/**
 * Drawing the magnifier loupe (loaded the first time it opens): the view itself rendered again round the anchor, or
 * the sketch alone redrawn bigger where WebGL can't read back.
 */

let lens: { target: WebGLRenderTarget; px: Uint8Array; canvas: HTMLCanvasElement } | null = null;

/**
 * The view round a point (CSS px), `zoom` times bigger, drawn afresh from the scene rather than stretched, so edges
 * and sketch lines stay sharp. A `size` CSS px square canvas, or null where WebGL can't read back.
 */
export function magnify(eng: Engine, x: number, y: number, zoom: number, size = LOUPE_SIZE): HTMLCanvasElement | null {
  const r = eng.renderer;
  const { scene, camera: cam } = eng.stage;
  const { width, height } = eng.size;
  const dpr = r.getPixelRatio();
  const n = Math.round(size * dpr);
  if (lens?.target.width !== n) {
    lens?.target.dispose();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = n;
    lens = { target: new WebGLRenderTarget(n, n, { colorSpace: SRGBColorSpace, samples: 4 }), px: new Uint8Array(n * n * 4), canvas };
  }
  const { target, px, canvas } = lens;
  const side = n / zoom;
  cam.setViewOffset(width * dpr, height * dpr, x * dpr - side / 2, y * dpr - side / 2, side, side);
  // Screen-width lines measure their width against the picture they are drawn into.
  const mats: LineMaterial[] = [];
  scene.traverseVisible((o) => {
    const m = (o as Mesh).material;
    if (m instanceof LineMaterial) mats.push(m);
  });
  const res = mats.map((m) => m.resolution.clone());
  for (const m of mats) m.resolution.set(size, size);
  try {
    r.setRenderTarget(target);
    r.clear();
    r.render(scene, cam);
    r.readRenderTargetPixels(target, 0, 0, n, n, px);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(n, n);
    // WebGL rows run bottom up.
    for (let row = 0; row < n; row++) img.data.set(px.subarray((n - 1 - row) * n * 4, (n - row) * n * 4), row * n * 4);
    ctx.putImageData(img, 0, 0);
    return canvas;
  } catch {
    return null;
  } finally {
    mats.forEach((m, i) => m.resolution.copy(res[i]!));
    r.setRenderTarget(null);
    cam.clearViewOffset();
  }
}

/** Colours for each shade, read from the tokens at draw time. */
export type LoupeColours = Record<"snap" | "ink" | "accent" | "danger" | "muted" | "viewport", string>;

const colourOf = (c: LoupeColours, s: Shade) =>
  s === "fixed" ? c.ink : s === "picked" || s === "hover" ? c.accent : s === "conflict" ? c.danger : s === "guide" ? c.muted : c.snap;

/**
 * Draws the loupe: `picture`, the view itself rendered `zoom` times bigger round the anchor (model, grid and sketch,
 * `Engine.magnify`), or where there is none, the sketch's curves and points near the anchor redrawn bigger. `toScreen`
 * takes a sketch point to view pixels, so the loupe matches the view at any camera angle. The pointer shows as a cross
 * at its 1:1 place.
 */
export function drawLoupe(
  ctx: CanvasRenderingContext2D,
  view: OverlayView,
  l: Loupe,
  toScreen: (xy: Vec2) => ScreenPoint,
  colours: LoupeColours,
  size = LOUPE_SIZE,
  picture?: CanvasImageSource | null,
) {
  const c = size / 2;
  const reach = (size / 2 / l.zoom) * 1.5;
  const map = (s: ScreenPoint) => ({ x: c + (s.x - l.anchor.x) * l.zoom, y: c + (s.y - l.anchor.y) * l.zoom });
  const near = (s: ScreenPoint) => Math.abs(s.x - l.anchor.x) < reach * 4 && Math.abs(s.y - l.anchor.y) < reach * 4;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, c, 0, 2 * Math.PI);
  ctx.clip();
  if (picture) {
    ctx.drawImage(picture, 0, 0, size, size);
    drawPointer(ctx, l, colours, c);
    ctx.restore();
    return;
  }
  ctx.fillStyle = colours.viewport;
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const curve of view.curves) {
    const pts = curve.pts.map(toScreen);
    // Skip curves nowhere near; a long line crossing the loupe still draws, since one of its ends may be far away.
    if (pts.length > 2 && !pts.some(near)) continue;
    ctx.strokeStyle = colourOf(colours, curve.shade);
    ctx.lineWidth = curve.shade === "picked" || curve.shade === "conflict" ? 2.5 : 1.5;
    ctx.setLineDash(curve.dashed ? [6, 4] : []);
    ctx.beginPath();
    pts.map(map).forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const p of view.points) {
    const s = toScreen(p.xy);
    if (!near(s)) continue;
    const q = map(s);
    const r = p.big ? 5 : 3.5;
    ctx.fillStyle = colourOf(colours, p.shade);
    ctx.fillRect(q.x - r, q.y - r, 2 * r, 2 * r);
  }
  drawPointer(ctx, l, colours, c);
  ctx.restore();
}

/** The pointer: a thin cross where it is inside the loupe, with a halo so it shows on any picture. */
function drawPointer(ctx: CanvasRenderingContext2D, l: Loupe, colours: LoupeColours, c: number) {
  const m = l.why === "touch" ? { x: c, y: c } : { x: c + (l.pointer.x - l.anchor.x), y: c + (l.pointer.y - l.anchor.y) };
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(m.x - 9, m.y);
  ctx.lineTo(m.x - 3, m.y);
  ctx.moveTo(m.x + 3, m.y);
  ctx.lineTo(m.x + 9, m.y);
  ctx.moveTo(m.x, m.y - 9);
  ctx.lineTo(m.x, m.y - 3);
  ctx.moveTo(m.x, m.y + 3);
  ctx.lineTo(m.x, m.y + 9);
  ctx.strokeStyle = colours.viewport;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = colours.ink;
  ctx.lineWidth = 1;
  ctx.stroke();
}
