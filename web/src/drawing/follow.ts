import { type DrawingMark, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { arrangeSheet, contextOf, rowAxis, sheetRows } from "./arrange";
import { dimArt, type DimContext } from "./dimensions";
import { markArt, markStyle, markView, targets } from "./marks";
import { noteArt } from "./notes";
import { emptyView } from "./views";

/**
 * A drawing follows its model (#568). Marks and dimensions are fixed to edges and faces by name, so they read the
 * new sizes by themselves; what is left is to stack the rows again when sizes change, and to say so when something
 * a mark or dimension was fixed to has gone. No DOM here.
 */
type Laid = NonNullable<DrawingView["laid"]>;
type ViewOf = (id: string) => ModelView | undefined;

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
/** How far off a row a size can be and still count as in it, mm. */
const ON_ROW = 0.05;

/** A view as it is laid out now: its size on paper and what each of its dimensions reads. */
function laidNow(sheet: DrawingSheet, v: DrawingView, ctx: DimContext): Laid {
  const { min, max } = ctx.view.box;
  const sizes = sheet.dimensions
    .filter((d) => d.view === v.id)
    .map((d) => `${d.id}:${dimArt(d, ctx)?.text.text ?? "?"}`)
    .join("|");
  return { w: r2((max[0] - min[0]) * ctx.scale), h: r2((max[1] - min[1]) * ctx.scale), sizes };
}
const same = (a: Laid | undefined, b: Laid) => !!a && a.w === b.w && a.h === b.h && a.sizes === b.sizes;

/** Where a mark is drawn: the middle of its lines. */
function markSpot(m: DrawingMark, ctx: DimContext, sheet: DrawingSheet): V2 | undefined {
  const art = markArt(m, ctx.view, ctx.scale, markStyle(sheet.standard), ctx.all ?? targets(ctx.view));
  const pts = art?.lines.flat() ?? [];
  if (!pts.length) return undefined;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [r2((Math.min(...xs) + Math.max(...xs)) / 2), r2((Math.min(...ys) + Math.max(...ys)) / 2)];
}

/**
 * The sheet with how it is laid out now written down: each view's size and readings, and where each mark is. Done
 * with every change you make, so the next change to the model can be told from it. The same sheet when nothing moved.
 */
export function stamp(sheet: DrawingSheet, viewOf: ViewOf, decimals: number): DrawingSheet {
  let changed = false;
  const ctxs = new Map<string, DimContext>();
  const views = sheet.views.map((v) => {
    const model = viewOf(v.id);
    const ctx = model && contextOf(sheet, v.id, model, decimals);
    if (!ctx) return v;
    ctxs.set(v.id, ctx);
    const laid = laidNow(sheet, v, ctx);
    if (same(v.laid, laid)) return v;
    changed = true;
    return { ...v, laid };
  });
  const marks = sheet.marks.map((m) => {
    const ctx = ctxs.get(markView(m) ?? "");
    const was = ctx && markSpot(m, ctx, sheet);
    if (!was || (m.was && m.was[0] === was[0] && m.was[1] === was[1])) return m;
    changed = true;
    return { ...m, was };
  });
  return changed ? { ...sheet, views, marks } : sheet;
}

/**
 * The sheet as it should be drawn after the model changed: in every view whose size or readings differ from when it
 * was laid out, the sizes that sat in rows (and the automatic ones) are stacked again, shortest nearest the part,
 * and the rest keep their distance from the view's outline. The same sheet when nothing changed. Nothing is written
 * down here; `stamp` does that with your next change.
 */
export function follow(sheet: DrawingSheet, viewOf: ViewOf, decimals: number): DrawingSheet {
  let next = sheet;
  const rows = sheetRows(sheet);
  for (const v of sheet.views) {
    const model = viewOf(v.id);
    const ctx = model && contextOf(sheet, v.id, model, decimals);
    if (!ctx || !v.laid || emptyView(model) || same(v.laid, laidNow(sheet, v, ctx))) continue;
    const { min, max } = model.box;
    const was = [v.laid.w / 2, v.laid.h / 2] as const;
    const now = [((max[0] - min[0]) * ctx.scale) / 2, ((max[1] - min[1]) * ctx.scale) / 2] as const;
    const inRows = new Set<string>();
    const moved = new Map<string, V2>();
    for (const d of sheet.dimensions) {
      if (d.view !== v.id) continue;
      const j = rowAxis(d, ctx);
      const out = j === undefined ? -1 : Math.abs(d.at[j]!) - was[j]! - rows.first;
      const k = Math.round(out / rows.next);
      if (dimArt(d, ctx) && (d.auto || (out > -ON_ROW && Math.abs(out - k * rows.next) < ON_ROW))) {
        inRows.add(d.id);
        continue;
      }
      // Anything else that sat outside the view stays as far outside it.
      const at: V2 = [d.at[0], d.at[1]];
      for (const a of [0, 1] as const) if (Math.abs(at[a]) > was[a]) at[a] = r2(at[a] + Math.sign(at[a]) * (now[a] - was[a]));
      if (at[0] !== d.at[0] || at[1] !== d.at[1]) moved.set(d.id, at);
    }
    if (moved.size) next = { ...next, dimensions: next.dimensions.map((d) => (moved.has(d.id) ? { ...d, at: moved.get(d.id)! } : d)) };
    if (inRows.size) next = arrangeSheet(next, viewOf, decimals, { views: [v.id], dimensions: (d) => inRows.has(d.id) });
  }
  return next;
}

/** Something on a sheet that lost what it was fixed to, or a view with nothing left to show. */
export interface Problem {
  kind: "dimension" | "mark" | "note" | "view";
  id: string;
  view: string;
  /** Where its warning goes, from the middle of its view in paper mm, y up. */
  at: V2;
}

/**
 * What is wrong on a sheet, among the views whose pictures are in: dimensions and marks whose edge or face is gone,
 * and views with nothing to draw (their body was deleted or hidden) or that could not be drawn.
 */
export function problems(sheet: DrawingSheet, viewOf: ViewOf, decimals: number, failed: (id: string) => boolean = () => false): Problem[] {
  const out: Problem[] = [];
  for (const v of sheet.views) {
    const model = viewOf(v.id);
    if (failed(v.id) || (model && emptyView(model))) {
      out.push({ kind: "view", id: v.id, view: v.id, at: [0, 0] });
      continue;
    }
    const ctx = model && contextOf(sheet, v.id, model, decimals);
    if (!ctx) continue;
    const { min, max } = model.box;
    const corner: V2 = [((min[0] - max[0]) * ctx.scale) / 2 + 3, ((max[1] - min[1]) * ctx.scale) / 2 - 3];
    for (const d of sheet.dimensions) if (d.view === v.id && !dimArt(d, ctx)) out.push({ kind: "dimension", id: d.id, view: v.id, at: d.at });
    for (const m of sheet.marks) {
      if (markView(m) !== v.id || markArt(m, model, ctx.scale, markStyle(sheet.standard), ctx.all)) continue;
      out.push({ kind: "mark", id: m.id, view: v.id, at: m.was ?? corner });
    }
    for (const n of sheet.notes ?? []) {
      if (n.on?.view === v.id && !noteArt(n, { view: model, scale: ctx.scale, all: ctx.all })) out.push({ kind: "note", id: n.id, view: v.id, at: n.at });
    }
  }
  return out;
}

/** "2 problems", for the browser's row and the notice. */
export const problemCount = (n: number) => `${n} ${n === 1 ? "problem" : "problems"}`;

/** What a lost thing is called. */
export const lostName = (p: Problem, sheet: DrawingSheet): string => {
  if (p.kind === "view") return "Nothing to show";
  if (p.kind === "dimension") return "Lost dimension";
  if (p.kind === "note") return "Lost note";
  const m = sheet.marks.find((x) => x.id === p.id);
  return `Lost ${m?.kind === "centre-line" ? "centre line" : m?.kind === "extension" ? "edge extension" : m?.kind === "centre-pattern" ? "centre mark pattern" : "centre mark"}`;
};
