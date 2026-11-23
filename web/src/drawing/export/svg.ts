import type { PathCommand } from "@bettercad/sketch";
import { curvePath } from "../views";
import type { Layer, Scene, Stroke } from "./scene";

const n = (v: number) => String(Math.round(v * 1000) / 1000);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Layers in the order they are drawn: hidden lines under the edges you see. */
export const LAYERS: Layer[] = ["border", "title", "hidden", "visible", "centre"];

/** Strokes that share a layer, width and dash, so each kind is written once. */
export function grouped(strokes: Stroke[]): { layer: Layer; width: number; dash?: readonly number[]; strokes: Stroke[] }[] {
  const by = new Map<string, { layer: Layer; width: number; dash?: readonly number[]; strokes: Stroke[] }>();
  for (const s of strokes) {
    const key = `${s.layer}|${s.width}|${s.dash?.join(" ") ?? ""}`;
    let g = by.get(key);
    if (!g) by.set(key, (g = { layer: s.layer, width: s.width, dash: s.dash, strokes: [] }));
    g.strokes.push(s);
  }
  return [...by.values()].sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer));
}

export interface SvgOptions {
  /** The text as outlines (see `outline.ts`); left out, it is written as text in the app's font. */
  outlines?: PathCommand[];
  /** Size in pixels for a picture; left out, the SVG is its page size in millimetres. */
  pixels?: { w: number; h: number };
}

/**
 * A scene as an SVG file: one unit is one millimetre, and the page is its true size. Black on white whatever the
 * theme, because this is the drawing as it prints; these two are the only colour names an export uses.
 */
export function sceneSvg(scene: Scene, o: SvgOptions = {}): string {
  const { w, h } = scene;
  const out: string[] = [];
  const size = o.pixels ? `width="${o.pixels.w}" height="${o.pixels.h}"` : `width="${n(w)}mm" height="${n(h)}mm"`;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${n(w)} ${n(h)}">`);
  out.push(`<rect width="${n(w)}" height="${n(h)}" fill="white"/>`);
  out.push(`<g fill="none" stroke="black" stroke-linejoin="round">`);
  for (const g of grouped(scene.strokes)) {
    const d = g.strokes.map((s) => curvePath(s.curve, 1, [0, h])).join("");
    const dash = g.dash ? ` stroke-dasharray="${g.dash.join(" ")}"` : ` stroke-linecap="round"`;
    out.push(`<path class="${g.layer}" stroke-width="${g.width}"${dash} d="${d}"/>`);
  }
  out.push(`</g>`);
  if (o.outlines) {
    const d = o.outlines
      .map((c) =>
        c.type === "Z"
          ? "Z"
          : c.type === "Q"
            ? `Q${n(c.x1)} ${n(h - c.y1)} ${n(c.x)} ${n(h - c.y)}`
            : c.type === "C"
              ? `C${n(c.x1)} ${n(h - c.y1)} ${n(c.x2)} ${n(h - c.y2)} ${n(c.x)} ${n(h - c.y)}`
              : `${c.type}${n(c.x)} ${n(h - c.y)}`,
      )
      .join("");
    if (d) out.push(`<path class="text" fill="black" d="${d}"/>`);
  } else if (scene.labels.length) {
    out.push(`<g fill="black" font-family="Inter, Helvetica, Arial, sans-serif">`);
    for (const l of scene.labels) {
      const anchor = l.anchor === "middle" ? ` text-anchor="middle"` : "";
      const base = l.baseline === "central" ? ` dominant-baseline="central"` : "";
      out.push(`<text class="${l.layer}" x="${n(l.at[0])}" y="${n(h - l.at[1])}" font-size="${n(l.size)}"${anchor}${base}>${esc(l.text)}</text>`);
    }
    out.push(`</g>`);
  }
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}
