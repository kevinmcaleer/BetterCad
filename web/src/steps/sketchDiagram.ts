/**
 * A sketch step's diagram: the sketch face on, zoomed to fit the picture, with thick curves and every size drawn as
 * the sketch draws it (extension lines, arrows and the value). Flat 2D canvas work, in the Light theme's colours.
 */
import { formatDimension, SketchIndex, type Sketch, type Vec2 } from "@bettercad/sketch";
import { dimensionArt, type DimensionArt } from "../sketch/dimensions";
import { sketchCurves } from "./curves";
import { lightPalette, toPng } from "./picture";

const css = (c: { getHexString(): string }) => `#${c.getHexString()}`;

class Box {
  min: Vec2 = [Infinity, Infinity];
  max: Vec2 = [-Infinity, -Infinity];
  add(p: Vec2, pad = 0): void {
    this.min = [Math.min(this.min[0], p[0] - pad), Math.min(this.min[1], p[1] - pad)];
    this.max = [Math.max(this.max[0], p[0] + pad), Math.max(this.max[1], p[1] + pad)];
  }
  get empty(): boolean {
    return !(this.min[0] <= this.max[0]);
  }
}

/** Where the sketch's curves and sizes sit, and the scale (pixels per mm) and centre that fit them in the picture. */
export interface DiagramFit {
  scale: number;
  centre: Vec2;
  art: { text: string; art: DimensionArt }[];
}

/**
 * Fits the curves first, then the sizes drawn at that scale (they sit a fixed number of pixels out), and again with
 * them in, so the labels fit too. `textWidth` measures a label in pixels.
 */
export function fitDiagram(sketch: Sketch, width: number, height: number, margin: number, textWidth: (t: string) => number): DiagramFit | null {
  const curves = sketchCurves(sketch);
  const box = new Box();
  for (const c of curves) for (const p of c.points) box.add(p);
  if (box.empty) return null;
  const idx = new SketchIndex(sketch);
  const dims = sketch.dimensions.filter((d) => !d.suppressed);
  const geo = { min: box.min, max: box.max };
  let fit: DiagramFit = { scale: 1, centre: [0, 0], art: [] };
  for (let pass = 0; pass < 3; pass++) {
    const b = pass === 0 ? geo : grown(geo, fit, textWidth);
    const w = Math.max(b.max[0] - b.min[0], 1e-3);
    const h = Math.max(b.max[1] - b.min[1], 1e-3);
    const scale = Math.min((width - 2 * margin) / w, (height - 2 * margin) / h);
    const centre: Vec2 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
    // Sizes sit on the side away from the middle of the points, as the sketch draws them.
    const pts = sketch.entities.flatMap((e) => (e.kind === "point" ? [[e.x, e.y] as Vec2] : []));
    const mid: Vec2 = pts.length ? [pts.reduce((n, q) => n + q[0], 0) / pts.length, pts.reduce((n, q) => n + q[1], 0) / pts.length] : centre;
    const art = dims.flatMap((d) => {
      try {
        return [{ text: formatDimension(d), art: dimensionArt(idx, d, 1 / scale, mid) }];
      } catch {
        return [];
      }
    });
    fit = { scale, centre, art };
  }
  return fit;
}

function grown(geo: { min: Vec2; max: Vec2 }, fit: DiagramFit, textWidth: (t: string) => number): { min: Vec2; max: Vec2 } {
  const b = new Box();
  b.add(geo.min);
  b.add(geo.max);
  const px = 1 / fit.scale;
  for (const { text, art } of fit.art) {
    for (const [p, q] of art.lines) {
      b.add(p);
      b.add(q);
    }
    for (const a of art.arrows) b.add(a.tip);
    b.add(art.text, ((textWidth(text) + 12) / 2) * px);
  }
  return b;
}

/** The diagram as a PNG, or null for a sketch with nothing drawn. */
export async function sketchDiagram(sketch: Sketch, width = 1200, height = 900): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const p = lightPalette();
  const font = getComputedStyle(document.documentElement).getPropertyValue("--bc-font-sans").trim() || "sans-serif";
  const size = Math.round(width / 50);
  ctx.font = `600 ${size}px ${font}`;
  const fit = fitDiagram(sketch, width, height, width / 16, (t) => ctx.measureText(t).width);
  if (!fit) return null;
  const { scale, centre } = fit;
  const at = (q: Vec2): Vec2 => [width / 2 + (q[0] - centre[0]) * scale, height / 2 - (q[1] - centre[1]) * scale];

  ctx.fillStyle = css(p.viewport);
  ctx.fillRect(0, 0, width, height);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const stroke = (pts: Vec2[], closed: boolean) => {
    ctx.beginPath();
    pts.forEach((q, i) => {
      const [x, y] = at(q);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    if (closed) ctx.closePath();
    ctx.stroke();
  };

  // References first, then the sketch's own curves over them.
  const curves = sketchCurves(sketch);
  const line = Math.max(3, width / 300);
  for (const c of curves.filter((x) => x.construction || x.projected)) {
    ctx.strokeStyle = css(c.projected ? p["part-line"] : p.muted);
    ctx.lineWidth = line / 2;
    ctx.setLineDash(c.construction ? [line * 3, line * 2] : []);
    stroke(c.points, c.closed);
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = css(p.accent);
  ctx.lineWidth = line;
  for (const c of curves.filter((x) => !x.construction && !x.projected)) stroke(c.points, c.closed);

  // Sizes: thin lines, filled arrows, and the value on a patch of the background so it reads over any line.
  const ink = css(p.ink);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(1.5, width / 800);
  const arrow = size * 0.8;
  for (const { art } of fit.art) {
    for (const [a, b] of art.lines) stroke([a, b], false);
    for (const { tip, dir } of art.arrows) {
      const [x, y] = at(tip);
      // Sketch y runs up, the canvas's down.
      const ux = dir[0];
      const uy = -dir[1];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - ux * arrow - uy * arrow * 0.35, y - uy * arrow + ux * arrow * 0.35);
      ctx.lineTo(x - ux * arrow + uy * arrow * 0.35, y - uy * arrow - ux * arrow * 0.35);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { text, art } of fit.art) {
    const [x, y] = at(art.text);
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = css(p.viewport);
    ctx.fillRect(x - w / 2, y - size * 0.75, w, size * 1.5);
    ctx.fillStyle = ink;
    ctx.fillText(text, x, y);
  }
  return toPng(canvas);
}
