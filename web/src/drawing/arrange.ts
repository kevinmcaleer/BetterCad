import { frameOf, viewScale, type DrawingDimension, type DrawingSheet, type DrawingStandard } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { dimArt, dimStyle, isIso, measured, sizeText, textWidth, type DimContext } from "./dimensions";
import { targets } from "./marks";

/**
 * Stacking dimensions (#565): the sizes on each side of a view sit in rows, the shortest nearest the part and each
 * longer one outside it, so no extension line crosses a dimension line. Sizes that don't overlap share a row, so a
 * chain is one row. Radii and diameters go on leaders outside the view. No DOM here.
 */

/** Row spacing on paper, mm: the first row from the view's outline, and each further row from the one inside it. */
export interface Rows {
  first: number;
  next: number;
}
export const rowsFor = (standard: DrawingStandard): Rows => (standard === "iso" ? { first: 10, next: 8 } : { first: 10, next: 6 });
export const sheetRows = (sheet: Pick<DrawingSheet, "rows" | "standard">): Rows => sheet.rows ?? rowsFor(sheet.standard);

type Side = "below" | "above" | "left" | "right";
/** Where a size was put: its text, and for a length the way it runs. */
export type Spot = Pick<DrawingDimension, "at" | "across">;

const EPS = 1e-6;
/** Clear paper between neighbouring texts in a row, and between a line's end and text moved outside it. */
const CLEAR = 1.5;

interface Run {
  id: string;
  /** What it measures, along its row. */
  lo: number;
  hi: number;
  /** The room it takes in the row, with tails and text that sit outside the arrows. */
  from: number;
  to: number;
  /** Where the text sits along the row. */
  text: number;
  across: DrawingDimension["across"];
}

/** Rows for one side: shortest first, each into the nearest row where it runs into nothing. */
function stack(runs: Run[]): Run[][] {
  const rows: Run[][] = [];
  const sorted = [...runs].sort((a, b) => a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo);
  for (const r of sorted) {
    let row = rows.find((placed) => placed.every((o) => r.from >= o.to - EPS || r.to <= o.from + EPS));
    if (!row) rows.push((row = []));
    row.push(r);
  }
  return rows;
}

/**
 * Where each of a view's dimensions goes when they are tidied. Lengths that run level go under the view (over it
 * when what they measure is nearer the top), upright ones to its left (or right); slanted ones sit one row out from
 * their line; radii and diameters go outside the view, fanned so their leaders don't cross. Angles stay put.
 */
export function arrange(dims: DrawingDimension[], ctx: DimContext, rows: Rows): Map<string, Spot> {
  const { view, scale, style: s } = ctx;
  const all = ctx.all ?? targets(view);
  const { min, max } = view.box;
  const centre: V2 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  const P = (q: V2): V2 => [(q[0] - centre[0]) * scale, (q[1] - centre[1]) * scale];
  const [w, h] = [(max[0] - min[0]) * scale, (max[1] - min[1]) * scale];
  const out = new Map<string, Spot>();
  const sides: Record<Side, Run[]> = { below: [], above: [], left: [], right: [] };
  const rounds: { id: string; c: V2; r: number; width: number }[] = [];

  for (const d of dims) {
    const m = measured(d.refs, all);
    if (!m || m.kind === "angle") continue;
    const places = d.decimals ?? ctx.decimals;
    if (m.kind !== "linear") {
      const art = dimArt(d, { ...ctx, all });
      rounds.push({ id: d.id, c: P(m.c), r: m.r * scale, width: art?.text.width ?? 0 });
      continue;
    }
    const [p, q] = [P(m.p), P(m.q)];
    const way = !m.free || ctx.iso ? "aligned" : (d.across ?? "aligned");
    const level = way === "x" || (way === "aligned" && Math.abs(p[1] - q[1]) < EPS);
    const upright = way === "y" || (way === "aligned" && Math.abs(p[0] - q[0]) < EPS);
    if (!level && !upright) {
      // On a slant: one row out from its own line, on the side away from the middle of the view.
      const u: V2 = [(q[0] - p[0]) / Math.hypot(q[0] - p[0], q[1] - p[1]), (q[1] - p[1]) / Math.hypot(q[0] - p[0], q[1] - p[1])];
      let n: V2 = [-u[1], u[0]];
      const mid: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (n[0] * mid[0] + n[1] * mid[1] < 0) n = [-n[0], -n[1]];
      out.set(d.id, { at: [mid[0] + n[0] * rows.first, mid[1] + n[1] * rows.first], across: "aligned" });
      continue;
    }
    // Along the row (x for a level size, y for an upright one) and across it.
    const [i, j] = level ? [0, 1] : [1, 0];
    const [lo, hi] = [Math.min(p[i]!, q[i]!), Math.max(p[i]!, q[i]!)];
    const span = hi - lo;
    const value =
      level && way === "x" ? Math.abs(m.q[0] - m.p[0]) : upright && way === "y" ? Math.abs(m.q[1] - m.p[1]) : Math.hypot(m.q[0] - m.p[0], m.q[1] - m.p[1]);
    const width = textWidth(sizeText(value, places), s.text);
    // Text that turns with an upright line runs along the row; level text across an upright row takes its height.
    const along = level || s.above ? width : s.text;
    const tails = span < s.arrow * 2.5 ? s.arrow * 2 : 0;
    const run: Run = { id: d.id, lo, hi, from: lo - tails, to: hi + tails, text: (lo + hi) / 2, across: d.across };
    // Text over its line (ISO) only has to fit the span; in a break in it (ASME) it has to fit between the arrows.
    const room = s.above ? along + 1 : along + 1.6 + (tails ? 0 : s.arrow * 2);
    if (room > span + EPS) {
      // The text won't fit between its arrows: it moves outside them, past the far end.
      run.text = run.to + CLEAR + along / 2;
      run.to = run.text + along / 2;
    }
    if (m.free && !ctx.iso) run.across = level ? (way === "x" ? "x" : "aligned") : way === "y" ? "y" : "aligned";
    else run.across = "aligned";
    // The default side is below or to the left; the far side when what is measured is nearer it.
    const size = level ? h : w;
    const [near, far] = [Math.min(p[j]!, q[j]!) + size / 2, size / 2 - Math.max(p[j]!, q[j]!)];
    const side: Side = level ? (far < near - EPS ? "above" : "below") : far < near - EPS ? "right" : "left";
    sides[side].push(run);
  }

  for (const side of Object.keys(sides) as Side[]) {
    const level = side === "below" || side === "above";
    const sign = side === "below" || side === "left" ? -1 : 1;
    const edge = (level ? h : w) / 2;
    stack(sides[side]).forEach((row, k) => {
      const off = sign * (edge + rows.first + rows.next * k);
      for (const r of row) out.set(r.id, { at: level ? [r.text, off] : [off, r.text], across: r.across });
    });
  }

  if (rounds.length) {
    // Leaders: each out from the middle of the view through its circle, to just past the outline. Up and to the
    // right when the circle is at the middle, where no rows are by default.
    const placed: { at: V2; width: number }[] = [];
    const ordered = rounds
      .map((r) => {
        const l = Math.hypot(r.c[0], r.c[1]);
        const d: V2 = l < EPS ? [Math.SQRT1_2, Math.SQRT1_2] : [r.c[0] / l, r.c[1] / l];
        return { ...r, d };
      })
      .sort((a, b) => Math.atan2(a.d[1], a.d[0]) - Math.atan2(b.d[1], b.d[0]));
    for (const r of ordered) {
      // How far along the ray the outline, a row's distance out, is reached.
      const tx = Math.abs(r.d[0]) < EPS ? Infinity : (w / 2 + rows.first - Math.sign(r.d[0]) * r.c[0]) / Math.abs(r.d[0]);
      const ty = Math.abs(r.d[1]) < EPS ? Infinity : (h / 2 + rows.first - Math.sign(r.d[1]) * r.c[1]) / Math.abs(r.d[1]);
      const t = Math.max(Math.min(tx, ty), r.r + rows.first / 2);
      const at: V2 = [r.c[0] + r.d[0] * t + (Math.sign(r.d[0]) || 1) * (r.width / 2 + CLEAR), r.c[1] + r.d[1] * t];
      // Fan: a text that would sit on one already placed steps away from the middle of the view, a line at a time.
      const step = (Math.sign(r.d[1]) || 1) * (s.text + CLEAR);
      while (placed.some((o) => Math.abs(o.at[0] - at[0]) < (o.width + r.width) / 2 + CLEAR && Math.abs(o.at[1] - at[1]) < s.text + CLEAR - EPS)) at[1] += step;
      placed.push({ at, width: r.width });
      out.set(r.id, { at });
    }
  }
  return out;
}

/** What `arrange` needs to know about a view, from its sheet. */
export function contextOf(sheet: DrawingSheet, viewId: string, model: ModelView, decimals: number): DimContext | undefined {
  const v = sheet.views.find((x) => x.id === viewId);
  if (!v) return undefined;
  return { view: model, scale: viewScale(sheet, v), style: dimStyle(sheet.standard), decimals, iso: isIso(frameOf(v.direction).toEye), all: targets(model) };
}

/** The sheet with the dimensions of some views (all of them when none are named) tidied into rows. */
export function arrangeSheet(
  sheet: DrawingSheet,
  viewOf: (id: string) => ModelView | undefined,
  decimals: number,
  only?: { views?: string[]; dimensions?: (d: DrawingDimension) => boolean },
): DrawingSheet {
  const spots = new Map<string, Spot>();
  for (const v of sheet.views) {
    if (only?.views && !only.views.includes(v.id)) continue;
    const model = viewOf(v.id);
    const ctx = model && contextOf(sheet, v.id, model, decimals);
    if (!ctx) continue;
    const mine = sheet.dimensions.filter((d) => d.view === v.id && (!only?.dimensions || only.dimensions(d)));
    for (const [id, spot] of arrange(mine, ctx, sheetRows(sheet))) spots.set(id, spot);
  }
  let changed = false;
  const dimensions = sheet.dimensions.map((d) => {
    const spot = spots.get(d.id);
    if (!spot || (spot.at[0] === d.at[0] && spot.at[1] === d.at[1] && spot.across === d.across)) return d;
    changed = true;
    const next = { ...d, at: spot.at };
    if (spot.across) next.across = spot.across;
    return next;
  });
  return changed ? { ...sheet, dimensions } : sheet;
}

/** How near a row a dragged size has to be to drop into it, mm. */
const SNAP = 2;

/**
 * A dragged size's text, dropped into a row when it is near one: a level size snaps up and down to the rows under
 * and over the view, an upright one across to the rows beside it. Anything else goes where it is put.
 */
export function snapRow(dim: Pick<DrawingDimension, "refs" | "across">, at: V2, ctx: DimContext, rows: Rows): V2 {
  const m = measured(dim.refs, ctx.all ?? targets(ctx.view));
  if (!m || m.kind !== "linear") return at;
  const { min, max } = ctx.view.box;
  const way = !m.free || ctx.iso ? "aligned" : (dim.across ?? "aligned");
  const level = way === "x" || (way === "aligned" && Math.abs(m.p[1] - m.q[1]) < EPS);
  const upright = way === "y" || (way === "aligned" && Math.abs(m.p[0] - m.q[0]) < EPS);
  if (!level && !upright) return at;
  const j = level ? 1 : 0;
  const edge = ((max[j]! - min[j]!) * ctx.scale) / 2;
  const out = Math.abs(at[j]!) - edge - rows.first;
  const k = Math.max(0, Math.round(out / rows.next));
  const row = edge + rows.first + rows.next * k;
  if (Math.abs(Math.abs(at[j]!) - row) > SNAP) return at;
  const snapped = (at[j]! < 0 ? -1 : 1) * row;
  return level ? [at[0], snapped] : [snapped, at[1]];
}

/** The box round everything a view's dimensions draw, in paper mm from the middle of the view. Nothing with no sizes. */
export function sizesBox(dims: DrawingDimension[], ctx: DimContext): { min: V2; max: V2 } | undefined {
  let box: { min: V2; max: V2 } | undefined;
  const grow = (q: V2, pad = 0) => {
    box ??= { min: [q[0], q[1]], max: [q[0], q[1]] };
    box.min = [Math.min(box.min[0], q[0] - pad), Math.min(box.min[1], q[1] - pad)];
    box.max = [Math.max(box.max[0], q[0] + pad), Math.max(box.max[1], q[1] + pad)];
  };
  for (const d of dims) {
    const art = dimArt(d, ctx);
    if (!art) continue;
    for (const [a, b] of art.lines) {
      grow(a);
      grow(b);
    }
    for (const t of art.arrows) grow(t[0]);
    grow(art.text.at, Math.max(art.text.width, ctx.style.text) / 2);
  }
  return box;
}

/** A view whose dimensions run into a neighbour, and how far that neighbour has to move to be clear of them. */
export interface Crowded {
  view: string;
  into: string;
  by: V2;
}
/** Clear paper left between a view's sizes and a neighbour that is moved out of their way, mm. */
const ROOM = 5;

/** Every view whose dimensions run into another view's outline. */
export function crowded(sheet: DrawingSheet, viewOf: (id: string) => ModelView | undefined, decimals: number): Crowded[] {
  const out: Crowded[] = [];
  for (const v of sheet.views) {
    const model = viewOf(v.id);
    const ctx = model && contextOf(sheet, v.id, model, decimals);
    const box =
      ctx &&
      sizesBox(
        sheet.dimensions.filter((d) => d.view === v.id),
        ctx,
      );
    if (!box) continue;
    const [x0, y0, x1, y1] = [v.at[0] + box.min[0], v.at[1] + box.min[1], v.at[0] + box.max[0], v.at[1] + box.max[1]];
    for (const o of sheet.views) {
      const other = o.id === v.id ? undefined : viewOf(o.id);
      if (!other) continue;
      const k = viewScale(sheet, o);
      const [ow, oh] = [((other.box.max[0] - other.box.min[0]) * k) / 2, ((other.box.max[1] - other.box.min[1]) * k) / 2];
      if (o.at[0] - ow >= x1 || o.at[0] + ow <= x0 || o.at[1] - oh >= y1 || o.at[1] + oh <= y0) continue;
      // Away from this view, along whichever of across and up the neighbour mostly lies.
      const [dx, dy] = [o.at[0] - v.at[0], o.at[1] - v.at[1]];
      const by: V2 =
        Math.abs(dx) >= Math.abs(dy)
          ? [dx >= 0 ? x1 - (o.at[0] - ow) + ROOM : x0 - (o.at[0] + ow) - ROOM, 0]
          : [0, dy >= 0 ? y1 - (o.at[1] - oh) + ROOM : y0 - (o.at[1] + oh) - ROOM];
      out.push({ view: v.id, into: o.id, by });
    }
  }
  return out;
}
