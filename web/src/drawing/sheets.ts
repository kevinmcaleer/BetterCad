import {
  removeView,
  sheetBox,
  viewScale,
  type Drawing,
  type DrawingMark,
  type DrawingRef,
  type DrawingSheet,
  type DrawingView,
  type TitleBlock,
} from "@bettercad/kernel/drawing";
import { markView } from "./marks";

/**
 * More than one sheet in a drawing (#572): add, rename, reorder, duplicate and delete sheets, and move a view from
 * one to another. Each takes the drawing and gives it back changed, or the same drawing when there is nothing to do.
 */

/** The next free "Sheet N". */
export function nextSheetName(drawing: Drawing): string {
  const taken = new Set(drawing.sheets.map((s) => s.name));
  for (let n = drawing.sheets.length + 1; ; n++) if (!taken.has(`Sheet ${n}`)) return `Sheet ${n}`;
}

/** A blank sheet after another, with that one's page, standard, scale and title block. */
export function addSheet(drawing: Drawing, after: string, id: string): Drawing {
  const at = drawing.sheets.findIndex((s) => s.id === after);
  const like = drawing.sheets[at] ?? drawing.sheets[drawing.sheets.length - 1]!;
  const sheet: DrawingSheet = {
    id,
    name: nextSheetName(drawing),
    size: like.size,
    landscape: like.landscape,
    standard: like.standard,
    border: like.border,
    scale: like.scale,
    title: { ...like.title },
    views: [],
    marks: [],
    dimensions: [],
  };
  if (like.rows) sheet.rows = { ...like.rows };
  const sheets = [...drawing.sheets];
  sheets.splice((at < 0 ? sheets.length - 1 : at) + 1, 0, sheet);
  return { ...drawing, sheets };
}

const reRef = (r: DrawingRef, ids: Map<string, string>): DrawingRef => ({ ...r, view: ids.get(r.view) ?? r.view });
const reMark = (m: DrawingMark, id: string, ids: Map<string, string>): DrawingMark =>
  m.kind === "centre-mark"
    ? { ...m, id, on: reRef(m.on, ids) }
    : m.kind === "centre-pattern"
      ? { ...m, id, on: m.on.map((r) => reRef(r, ids)) }
      : m.kind === "centre-line"
        ? { ...m, id, a: reRef(m.a, ids), ...(m.b ? { b: reRef(m.b, ids) } : {}) }
        : { ...m, id, a: reRef(m.a, ids), b: reRef(m.b, ids) };

/** A copy of a sheet straight after it, everything on it included, under ids of its own from `newId`. */
export function duplicateSheet(drawing: Drawing, sheet: string, newId: (kind: "sh" | "vw" | "mk" | "dm" | "nt") => string): Drawing {
  const at = drawing.sheets.findIndex((s) => s.id === sheet);
  const from = drawing.sheets[at];
  if (!from) return drawing;
  const ids = new Map(from.views.map((v) => [v.id, newId("vw")]));
  const taken = new Set(drawing.sheets.map((s) => s.name));
  let name = `${from.name} copy`;
  for (let n = 2; taken.has(name); n++) name = `${from.name} copy ${n}`;
  const copy: DrawingSheet = {
    ...from,
    id: newId("sh"),
    name,
    title: { ...from.title },
    views: from.views.map((v) => {
      const next: DrawingView = { ...v, id: ids.get(v.id)! };
      if (v.parent) next.parent = ids.get(v.parent) ?? v.parent;
      return next;
    }),
    marks: from.marks.map((m) => reMark(m, newId("mk"), ids)),
    dimensions: from.dimensions.map((d) => ({ ...d, id: newId("dm"), view: ids.get(d.view) ?? d.view, refs: d.refs.map((r) => reRef(r, ids)) })),
  };
  if (from.notes) copy.notes = from.notes.map((n) => ({ ...n, id: newId("nt"), ...(n.on ? { on: reRef(n.on, ids) } : {}) }));
  const sheets = [...drawing.sheets];
  sheets.splice(at + 1, 0, copy);
  return { ...drawing, sheets };
}

/** Takes a sheet out. A drawing keeps at least one. */
export function removeSheet(drawing: Drawing, sheet: string): Drawing {
  if (drawing.sheets.length < 2 || !drawing.sheets.some((s) => s.id === sheet)) return drawing;
  return { ...drawing, sheets: drawing.sheets.filter((s) => s.id !== sheet) };
}

export function renameSheet(drawing: Drawing, sheet: string, name: string): Drawing {
  const n = name.trim();
  const was = drawing.sheets.find((s) => s.id === sheet);
  if (!n || !was || was.name === n) return drawing;
  return { ...drawing, sheets: drawing.sheets.map((s) => (s.id === sheet ? { ...s, name: n } : s)) };
}

/** Moves a sheet along the strip to a place counted from 0. */
export function moveSheet(drawing: Drawing, sheet: string, to: number): Drawing {
  const at = drawing.sheets.findIndex((s) => s.id === sheet);
  const where = Math.max(0, Math.min(drawing.sheets.length - 1, to));
  if (at < 0 || at === where) return drawing;
  const sheets = [...drawing.sheets];
  const [moved] = sheets.splice(at, 1);
  sheets.splice(where, 0, moved!);
  return { ...drawing, sheets };
}

/**
 * Moves a view to another sheet with the views projected from it and every mark and dimension on them. It keeps its
 * place on the page where that fits, and comes in from the edge where the new page is smaller. A projected view
 * moved without its parent becomes a base view.
 */
export function moveViewToSheet(drawing: Drawing, view: string, from: string, to: string): Drawing {
  const src = drawing.sheets.find((s) => s.id === from);
  const dst = drawing.sheets.find((s) => s.id === to);
  const top = src?.views.find((v) => v.id === view);
  if (!src || !dst || !top || from === to) return drawing;
  const going = new Set([view]);
  for (let grew = true; grew;) {
    grew = false;
    for (const v of src.views) if (v.parent && going.has(v.parent) && !going.has(v.id)) grew = !!going.add(v.id);
  }
  const on = (r: DrawingRef) => going.has(r.view);
  const marks = src.marks.filter((m) => going.has(markView(m) ?? ""));
  const dimensions = src.dimensions.filter((d) => going.has(d.view) || d.refs.some(on));
  // What stays: `removeView` also turns anything left behind that was projected from a view that went into a base view.
  let left = src;
  for (const id of going) left = removeView(left, id);
  const page = sheetBox(dst);
  const fit = (at: readonly [number, number]): [number, number] => [Math.max(20, Math.min(page.w - 20, at[0])), Math.max(20, Math.min(page.h - 20, at[1]))];
  const by: [number, number] = [fit(top.at)[0] - top.at[0], fit(top.at)[1] - top.at[1]];
  const views = src.views
    .filter((v) => going.has(v.id))
    .map((v) => {
      const next: DrawingView = { ...v, at: [v.at[0] + by[0], v.at[1] + by[1]] };
      if (v.id !== view) return next;
      // It stays the size it was: its parent, or the scale of the sheet it came from, is left behind.
      if (v.parent) {
        next.kind = "base";
        delete next.parent;
        next.scale = viewScale(src, v);
      } else if (!v.scale && src.scale !== dst.scale) next.scale = src.scale;
      return next;
    });
  const arrived: DrawingSheet = { ...dst, views: [...dst.views, ...views], marks: [...dst.marks, ...marks], dimensions: [...dst.dimensions, ...dimensions] };
  // Notes pointing into a view that went go with it (#573); loose text stays on its sheet.
  const notes = (src.notes ?? []).filter((n) => n.on && going.has(n.on.view));
  if (notes.length) arrived.notes = [...(dst.notes ?? []), ...notes];
  return { ...drawing, sheets: drawing.sheets.map((s) => (s.id === from ? left : s.id === to ? arrived : s)) };
}

/** The title block fields every sheet of a drawing shares: all of them, so a change on one sheet is on the others. */
export function shareTitle(drawing: Drawing, field: keyof TitleBlock, value: string): Drawing {
  return {
    ...drawing,
    sheets: drawing.sheets.map((s) => {
      const title = { ...s.title };
      if (value) title[field] = value;
      else delete title[field];
      return { ...s, title };
    }),
  };
}
