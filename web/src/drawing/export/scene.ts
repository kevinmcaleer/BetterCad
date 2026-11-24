import { frameOf, scaleLabel, styleOf, viewScale, type DrawingSheet } from "@bettercad/kernel/drawing";
import { TAU, turn, type ModelView, type V2, type ViewCurve } from "@bettercad/kernel/view";
import { TEXT, WEIGHT, type SheetLayout } from "../layout";
import { dimArt, dimStyle, isIso } from "../dimensions";
import { CENTRE_DASH, markArt, markStyle, markView, targets } from "../marks";
import { cutArt, type Picture } from "../cuts";
import { NOTE_TEXT, noteArt, type NoteContext } from "../notes";
import type { Feature } from "../../state/document";
import { itemOf, partsTable, type PartsRow } from "../parts";

/**
 * A sheet as plain lines and text, for export (#569). Millimetres from the page's bottom left corner with y up, the
 * way PDF and DXF count, so each writer only has to spell the same shapes its own way. No DOM, no colours: an
 * export is black on white whatever the theme.
 */
export type Layer = "visible" | "hidden" | "centre" | "dimension" | "border" | "title" | "section";

export interface Stroke {
  layer: Layer;
  /** Line width on paper, mm. */
  width: number;
  /** Dash and gap lengths, mm. */
  dash?: readonly number[];
  curve: ViewCurve;
}
export interface Label {
  layer: Layer;
  /** Where the text is anchored: its start or middle across, its middle or baseline up. */
  at: V2;
  /** Letter height, mm (the font size). */
  size: number;
  anchor: "start" | "middle";
  baseline: "central" | "alphabetic";
  text: string;
  /** Turned anticlockwise about `at`, radians: a dimension's size along its line. */
  turn?: number;
}
/** A filled shape: an arrowhead. */
export interface Fill {
  layer: Layer;
  pts: V2[];
}
export interface Scene {
  w: number;
  h: number;
  strokes: Stroke[];
  labels: Label[];
  /** Left out when there is nothing filled. */
  fills?: Fill[];
  /** Pictures (#575): the title block's logo. Left out when there are none. */
  images?: SceneImage[];
}
/** A JPEG on the page: its data URL, its size in pixels, and the box it fills, from the box's bottom left corner. */
export interface SceneImage {
  data: string;
  px: { w: number; h: number };
  at: V2;
  w: number;
  h: number;
}

/** A shaded or rendered view's picture (see `pictures.ts`): a JPEG on white and its size in pixels. */
export interface ViewPicture {
  data: string;
  px: { w: number; h: number };
}

/** A cutting line's long dash, gap, dot and gap, mm: that of `drawing.css`. */
export const CUT_DASH = [8, 1.5, 1, 1.5] as const;

/** Line widths and dashes on paper, mm: those of `drawing.css`. */
export const LINES = { visible: 0.5, hidden: 0.25, dash: [2, 1] } as const;

/** A curve scaled by `s` and moved by (`ox`, `oy`). Angles stay as they are. */
export function placed(c: ViewCurve, s: number, ox: number, oy: number): ViewCurve {
  const p = (q: V2): V2 => [ox + q[0] * s, oy + q[1] * s];
  switch (c.kind) {
    case "line":
      return { kind: "line", a: p(c.a), b: p(c.b) };
    case "poly":
      return { kind: "poly", pts: c.pts.map(p) };
    case "circle":
      return { kind: "circle", c: p(c.c), r: c.r * s };
    case "arc":
      return { ...c, c: p(c.c), r: c.r * s };
    case "ellipse":
      return { ...c, c: p(c.c), rx: c.rx * s, ry: c.ry * s };
  }
}

/** A round curve as centre, radii, tilt and the parameter it runs over; a whole one sweeps a full turn. */
export interface Round {
  c: V2;
  rx: number;
  ry: number;
  tilt: number;
  from: number;
  sweep: number;
}
export function roundOf(c: Extract<ViewCurve, { kind: "circle" | "arc" | "ellipse" }>): Round {
  if (c.kind === "circle") return { c: c.c, rx: c.r, ry: c.r, tilt: 0, from: 0, sweep: TAU };
  if (c.kind === "arc") return { c: c.c, rx: c.r, ry: c.r, tilt: 0, from: c.from, sweep: turn(c.to - c.from) || TAU };
  const whole = c.from === undefined || c.to === undefined;
  return { c: c.c, rx: c.rx, ry: c.ry, tilt: c.turn, from: whole ? 0 : c.from!, sweep: whole ? TAU : turn(c.to! - c.from!) || TAU };
}
/** The point of a round curve at a parameter, and how fast it moves there. */
export function roundAt(r: Round, t: number): { p: V2; d: V2 } {
  const [cs, sn] = [Math.cos(r.tilt), Math.sin(r.tilt)];
  const [u, v] = [r.rx * Math.cos(t), r.ry * Math.sin(t)];
  const [du, dv] = [-r.rx * Math.sin(t), r.ry * Math.cos(t)];
  return { p: [r.c[0] + u * cs - v * sn, r.c[1] + u * sn + v * cs], d: [du * cs - dv * sn, du * sn + dv * cs] };
}

/** A cubic Bézier piece: two control points and where it ends. */
export type Cubic = [V2, V2, V2];
/** A round curve as cubic Béziers of a quarter turn at most, which are within a hair of the true curve. */
export function cubics(r: Round): { start: V2; pieces: Cubic[] } {
  const n = Math.max(1, Math.ceil(r.sweep / (Math.PI / 2) - 1e-9));
  const step = r.sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const pieces: Cubic[] = [];
  let a = roundAt(r, r.from);
  const start = a.p;
  for (let i = 1; i <= n; i++) {
    const b = roundAt(r, r.from + step * i);
    pieces.push([[a.p[0] + a.d[0] * k, a.p[1] + a.d[1] * k], [b.p[0] - b.d[0] * k, b.p[1] - b.d[1] * k], b.p]);
    a = b;
  }
  return { start, pieces };
}

const box = (x: number, y: number, w: number, h: number): ViewCurve => ({
  kind: "poly",
  pts: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ],
});

/** Everything on a sheet: the frame, zones and title block, and each view's lines from the kernel's picture of it. */
export function sheetScene(
  sheet: DrawingSheet,
  l: SheetLayout,
  viewOf: (id: string) => ModelView | undefined,
  decimals?: number,
  /** The model's steps, which hole notes read (#573), and its parts list, for the table and balloons (#574). */
  model: {
    features?: readonly Feature[] | undefined;
    parts?: readonly PartsRow[] | undefined;
    /** Shaded and rendered views' pictures. Left out (DXF), or missing for a view, the view is drawn as line art. */
    pictures?: (id: string) => ViewPicture | undefined;
  } = {},
): Scene {
  const { features, parts, pictures } = model;
  const H = l.page.h;
  // The layout counts down from the top of the page; the scene counts up from the bottom.
  const up = (y: number) => H - y;
  const strokes: Stroke[] = [];
  const labels: Label[] = [];
  const fills: Fill[] = [];
  const line = (layer: Layer, width: number, s: { x1: number; y1: number; x2: number; y2: number }) =>
    strokes.push({ layer, width, curve: { kind: "line", a: [s.x1, up(s.y1)], b: [s.x2, up(s.y2)] } });

  if (l.border) {
    const f = l.frame;
    strokes.push({ layer: "border", width: WEIGHT.thick, curve: box(f.x, up(f.y + f.h), f.w, f.h) });
    for (const t of l.ticks) line("border", WEIGHT.thin, t);
    for (const c of l.centring) line("border", WEIGHT.thick, c);
    for (const z of l.labels) labels.push({ layer: "border", at: [z.x, up(z.y)], size: TEXT.zone, anchor: "middle", baseline: "central", text: z.text });
  }

  strokes.push({ layer: "title", width: WEIGHT.thick, curve: box(l.block.x, up(l.block.y + l.block.h), l.block.w, l.block.h) });
  const images: SceneImage[] = [];
  for (const c of l.cells) {
    strokes.push({ layer: "title", width: WEIGHT.thin, curve: box(c.x, up(c.y + c.h), c.w, c.h) });
    if (c.image) {
      const b = c.image.box;
      images.push({ data: c.image.logo.data, px: { w: c.image.logo.w, h: c.image.logo.h }, at: [b.x, up(b.y + b.h)], w: b.w, h: b.h });
      continue;
    }
    labels.push({ layer: "title", at: [c.x + 1, up(c.y + 2)], size: TEXT.label, anchor: "start", baseline: "central", text: c.label });
    const cy = up(c.y + c.h / 2 + 1.2);
    const cx = c.x + c.w / 2;
    if (c.key === "projection") {
      // The cone from the side and from its small end, as `Sheet.tsx` draws them.
      const cone = l.angle === "first" ? cx - 6.4 : cx + 0.4;
      const rings = l.angle === "first" ? cx + 3.9 : cx - 3.9;
      strokes.push({
        layer: "title",
        width: WEIGHT.thin,
        curve: {
          kind: "poly",
          pts: [
            [cone, cy + 1.3],
            [cone + 6, cy + 2.5],
            [cone + 6, cy - 2.5],
            [cone, cy - 1.3],
            [cone, cy + 1.3],
          ],
        },
      });
      for (const r of [2.5, 1.3]) strokes.push({ layer: "title", width: WEIGHT.thin, curve: { kind: "circle", c: [rings, cy], r } });
    } else if (c.value) {
      labels.push({ layer: "title", at: [cx, cy], size: c.size, anchor: "middle", baseline: "central", text: c.value });
    }
  }

  // The parts list (#574), above the title block.
  if (sheet.partsList) {
    const t = partsTable(parts ?? [], l);
    strokes.push({ layer: "title", width: WEIGHT.thick, curve: box(t.box.x, up(t.box.y + t.box.h), t.box.w, t.box.h) });
    for (const s of t.lines) line("title", WEIGHT.thin, s);
    for (const r of t.rows)
      for (const c of r.cells) labels.push({ layer: "title", at: [c.x, up(c.y)], size: t.size, anchor: c.anchor, baseline: "central", text: c.text });
  }

  // Notes (#573): thin lines, filled arrowheads and text, about the middle of their view or, loose, from the page's corner.
  const notes = (ox: number, oy: number, mine: NonNullable<DrawingSheet["notes"]>, ctx?: NoteContext) => {
    const here = (q: V2): V2 => [ox + q[0], oy + q[1]];
    for (const n of mine) {
      const art = noteArt(n, ctx);
      if (!art) continue;
      for (const [a, b] of art.lines) strokes.push({ layer: "dimension", width: WEIGHT.thin, curve: { kind: "line", a: here(a), b: here(b) } });
      for (const c of art.curves) strokes.push({ layer: "dimension", width: WEIGHT.thin, curve: placed(c, 1, ox, oy) });
      for (const f of art.fills) fills.push({ layer: "dimension", pts: f.map(here) });
      for (const t of art.texts) labels.push({ layer: "dimension", at: here(t.at), size: NOTE_TEXT, anchor: t.anchor, baseline: "central", text: t.text });
    }
  };
  notes(
    0,
    0,
    (sheet.notes ?? []).filter((n) => !n.on),
  );

  for (const v of sheet.views) {
    const view = viewOf(v.id);
    if (!view) continue;
    const s = viewScale(sheet, v);
    const { min, max } = view.box;
    const ox = v.at[0] - ((min[0] + max[0]) / 2) * s;
    const oy = v.at[1] - ((min[1] + max[1]) / 2) * s;
    // Hatching, break lines and a detail's edge (#571), thin, under the view's own lines.
    for (const c of (view as Picture).thin ?? []) strokes.push({ layer: "section", width: WEIGHT.thin, curve: placed(c, s, ox, oy) });
    // A shaded or rendered view's picture fills its box, under its lines; a rendered one has no lines.
    const style = styleOf(v);
    const pic = (style === "shaded" || style === "rendered") && !v.breaks?.length ? pictures?.(v.id) : undefined;
    if (pic) images.push({ data: pic.data, px: pic.px, at: [ox + min[0] * s, oy + min[1] * s], w: (max[0] - min[0]) * s, h: (max[1] - min[1]) * s });
    // Hidden lines first, so the edges you see are drawn over them. A wireframe draws them solid.
    if (!pic)
      for (const e of view.edges)
        if (!e.visible)
          strokes.push(
            style === "wireframe"
              ? { layer: "visible", width: LINES.visible, curve: placed(e.curve, s, ox, oy) }
              : { layer: "hidden", width: LINES.hidden, dash: LINES.dash, curve: placed(e.curve, s, ox, oy) },
          );
    if (!pic || style === "shaded")
      for (const e of view.edges) if (e.visible) strokes.push({ layer: "visible", width: LINES.visible, curve: placed(e.curve, s, ox, oy) });
    // Cutting lines, detail circles and letters (#571), about the middle of the view.
    const cuts = cutArt(sheet, v, viewOf);
    const here2 = (q: V2): V2 => [v.at[0] + q[0], v.at[1] + q[1]];
    for (const [a, b] of cuts.chain) strokes.push({ layer: "section", width: WEIGHT.thin, dash: CUT_DASH, curve: { kind: "line", a: here2(a), b: here2(b) } });
    for (const [a, b] of cuts.thick) strokes.push({ layer: "section", width: WEIGHT.thick, curve: { kind: "line", a: here2(a), b: here2(b) } });
    for (const a of cuts.arrows) fills.push({ layer: "section", pts: a.map(here2) });
    for (const r of cuts.rings) strokes.push({ layer: "section", width: WEIGHT.thin, curve: { kind: "circle", c: here2(r.c), r: r.r } });
    for (const l of cuts.labels) labels.push({ layer: "section", at: here2(l.at), size: l.size, anchor: "middle", baseline: "central", text: l.text });
    // Centre marks and centre lines (#563), thin, about the middle of the view.
    const mine = sheet.marks.filter((m) => markView(m) === v.id);
    if (mine.length) {
      const all = targets(view);
      const style = markStyle(sheet.standard);
      for (const m of mine) {
        const art = markArt(m, view, s, style, all);
        if (!art) continue;
        for (const [a, b] of art.lines) {
          strokes.push({
            layer: "centre",
            width: WEIGHT.thin,
            curve: { kind: "line", a: [v.at[0] + a[0], v.at[1] + a[1]], b: [v.at[0] + b[0], v.at[1] + b[1]] },
          });
        }
        for (const c of art.curves) strokes.push({ layer: "centre", width: WEIGHT.thin, dash: CENTRE_DASH, curve: placed(c, 1, v.at[0], v.at[1]) });
      }
    }
    // Dimensions (#564): thin lines, filled arrowheads and the size.
    const sizes = sheet.dimensions.filter((d) => d.view === v.id);
    if (sizes.length) {
      const ctx = { view, scale: s, style: dimStyle(sheet.standard), decimals: decimals ?? 2, iso: isIso(frameOf(v.direction).toEye), all: targets(view) };
      const here = (q: V2): V2 => [v.at[0] + q[0], v.at[1] + q[1]];
      for (const d of sizes) {
        const art = dimArt(d, ctx);
        if (!art) continue;
        for (const [a, b] of art.lines) strokes.push({ layer: "dimension", width: WEIGHT.thin, curve: { kind: "line", a: here(a), b: here(b) } });
        for (const c of art.arcs) strokes.push({ layer: "dimension", width: WEIGHT.thin, curve: placed(c, 1, v.at[0], v.at[1]) });
        for (const a of art.arrows) fills.push({ layer: "dimension", pts: a.map(here) });
        const label: Label = { layer: "dimension", at: here(art.text.at), size: ctx.style.text, anchor: "middle", baseline: "central", text: art.text.text };
        if (art.text.turn) label.turn = art.text.turn;
        labels.push(label);
      }
    }
    const pointing = (sheet.notes ?? []).filter((n) => n.on?.view === v.id);
    if (pointing.length)
      notes(v.at[0], v.at[1], pointing, {
        view,
        scale: s,
        frame: frameOf(v.direction),
        ...(features ? { features } : {}),
        ...(parts ? { itemOf: (body: string) => itemOf(parts, body) } : {}),
      });
    if (s !== sheet.scale) {
      // As on the sheet: under the view's box, which has 2 mm of room round the lines.
      const h = Math.max((max[1] - min[1]) * s, 20) + 4;
      labels.push({
        layer: "visible",
        at: [v.at[0], v.at[1] - h / 2 - TEXT.value - 1],
        size: TEXT.value,
        anchor: "middle",
        baseline: "alphabetic",
        text: `Scale ${scaleLabel(s)}`,
      });
    }
  }
  const scene: Scene = { w: l.page.w, h: l.page.h, strokes, labels };
  if (fills.length) scene.fills = fills;
  if (images.length) scene.images = images;
  return scene;
}

/**
 * One view on its own at full size, for a laser cutter: just its lines in the model's millimetres, from the bottom
 * left corner of its box. Hidden edges go only when asked for.
 */
export function viewScene(view: ModelView, hidden: boolean): Scene {
  const { min, max } = view.box;
  const strokes: Stroke[] = [];
  for (const e of view.edges) {
    if (!e.visible && !hidden) continue;
    const curve = placed(e.curve, 1, -min[0], -min[1]);
    strokes.push(e.visible ? { layer: "visible", width: LINES.visible, curve } : { layer: "hidden", width: LINES.hidden, dash: LINES.dash, curve });
  }
  return { w: Math.max(0, max[0] - min[0]), h: Math.max(0, max[1] - min[1]), strokes, labels: [] };
}
