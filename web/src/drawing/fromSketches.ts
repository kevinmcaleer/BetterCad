import { newSheet, SCALES, standardFor, type DrawingDimension, type DrawingRef, type DrawingSheet } from "@bettercad/kernel/drawing";
import { sketchBody, sketchFrame } from "@bettercad/kernel/sketch-view";
import type { ModelView } from "@bettercad/kernel/view";
import type { Sketch } from "@bettercad/sketch";
import { newId, type ModelDoc } from "../state/document";
import { arrangeSheet } from "./arrange";
import { defaultSpot, kindOf, measured } from "./dimensions";
import { addPages, drawingNamed, pagesOf, pagesSaid, withPages } from "./everyPart";
import { sheetLayout, today } from "./layout";
import { targets } from "./marks";
import { lastSheet } from "./prefs";
import type { ViewCall } from "./useModelViews";
import { emptyView, fromPage, freeSpace, placeView, viewRequest } from "./views";

/** The drawing Drawing from sketches fills, a page for each sketch. */
export const SKETCHES_DRAWING = "Sketches";

/** A sketch as the model built it. */
export interface ListedSketch {
  id: string;
  name: string;
  sketch: Sketch;
}

/** How much of the clear space the sketch may take each way, leaving room round it for its sizes. */
const ROOM = 0.6;

/**
 * The sketch's own sizes as drawing dimensions on its view, fixed to the curves the view names after the sketch's
 * entities. A point is measured from the hidden mark the view gives it; a circle or arc picked with something else
 * stands for its centre. Sizes the sheet can't take the same way (to a circle's edge, a pattern's count, a curve of
 * its own shape) are left out.
 */
export function sketchSizes(sketch: Sketch, viewId: string, view: ModelView, id: () => string): DrawingDimension[] {
  const body = view.edges[0]?.source?.body ?? sketchBody(sketch.id);
  const index = new Map(view.edges.flatMap((e) => (e.source?.name ? [[e.source.name, e.source.index] as const] : [])));
  const kinds = new Map(sketch.entities.map((e) => [e.id, e.kind]));
  const ref = (name: string, at?: DrawingRef["at"]): DrawingRef | undefined => {
    const i = index.get(name);
    return i === undefined ? undefined : { view: viewId, body, kind: "edge", name, index: i, ...(at ? { at } : {}) };
  };
  // In a distance a point is a place; so is a circle or arc, by its centre.
  const place = (e: string) => {
    const k = kinds.get(e);
    return k === "point" ? ref(`p:${e}`, "start") : k === "circle" || k === "arc" ? ref(e, "centre") : k === "line" ? ref(e) : undefined;
  };
  const all = targets(view);
  const out: DrawingDimension[] = [];
  const groups = new Set<string>();
  for (const d of sketch.dimensions) {
    if (d.suppressed || d.kind === "pattern" || d.edges) continue;
    if (d.group) {
      if (groups.has(d.group)) continue;
      groups.add(d.group);
    }
    const refs = d.kind === "length" || d.kind === "radius" || d.kind === "diameter" || d.kind === "angle" ? d.refs.map((e) => ref(e)) : d.refs.map(place);
    if (!refs.length || refs.some((r) => !r)) continue;
    const m = measured(refs as DrawingRef[], all);
    if (!m) continue;
    const dim: DrawingDimension = { id: id(), view: viewId, kind: kindOf(m), refs: refs as DrawingRef[], at: [0, 0] };
    if (m.kind === "linear") dim.across = d.kind === "distanceX" ? "x" : d.kind === "distanceY" ? "y" : "aligned";
    out.push(dim);
  }
  return out;
}

/** The largest standard scale at which the sketch takes no more than ROOM of the clear space each way. */
function fitting(view: ModelView, free: { w: number; h: number }): number {
  const [w, h] = [view.box.max[0] - view.box.min[0], view.box.max[1] - view.box.min[1]];
  return [...SCALES].reverse().find((k) => w * k <= free.w * ROOM && h * k <= free.h * ROOM) ?? SCALES[0];
}

/**
 * Drawing from sketches: one drawing, Sketches, with a page for each sketch that has curves, named for it, on the page
 * size you last set up. Each page shows its sketch face on, with the sketch's sizes laid out in rows round it. A sketch
 * that already has a page of its name is left alone, so running it again only adds what is new.
 */
export async function sketchDrawings(
  doc: ModelDoc,
  sketches: readonly ListedSketch[],
  call: ViewCall,
  upTo: number | undefined,
  o: { author?: string; newId: (kind: string) => string },
): Promise<{ doc: ModelDoc; made: string[]; skipped: number; had: number }> {
  const model = { ...doc };
  delete model.drawings;
  const taken = pagesOf(doc, SKETCHES_DRAWING);
  let had = 0;
  const pick = lastSheet();
  const sheets: DrawingSheet[] = [];
  let skipped = 0;
  for (const s of sketches) {
    if (taken.has(s.name)) {
      skipped++;
      had++;
      continue;
    }
    const choice = { shows: { sketch: s.id }, direction: sketchFrame(s.sketch), hidden: true, tangent: false };
    const p = call({ doc: model, upTo, ...viewRequest(choice) });
    const view = p && (await p);
    if (!view || emptyView(view)) {
      skipped++;
      continue;
    }
    let sheet = newSheet(s.name, {
      ...pick,
      standard: pick.standard ?? standardFor(pick.size),
      date: today(),
      title: s.name,
      block: { type: "Sketch" },
      ...(o.author ? { author: o.author } : {}),
    });
    sheet = { ...sheet, id: o.newId("sh") };
    const l = sheetLayout(sheet);
    const free = freeSpace(l);
    const vid = o.newId("vw");
    sheet = placeView(sheet, vid, choice, fitting(view, free), fromPage([free.x + free.w / 2, free.y + free.h / 2], l.page.h));
    const scale = sheet.scale;
    const dims = sketchSizes(s.sketch, vid, view, () => o.newId("dm")).map((d) => {
      const m = measured(d.refs, targets(view));
      return m ? { ...d, at: defaultSpot(m, view, scale).at.map((n) => Math.round(n * 1e3) / 1e3 + 0) as [number, number] } : d;
    });
    sheet = arrangeSheet({ ...sheet, dimensions: dims }, (id) => (id === vid ? view : undefined), 2);
    taken.add(s.name);
    sheets.push(sheet);
  }
  return { doc: withPages(doc, SKETCHES_DRAWING, sheets, o.newId), made: sheets.map((s) => s.name), skipped, had };
}

/** The command as the editor runs it: works the pages out, adds them in one step and says how it went. */
export async function makeFromSketches(
  store: { get(): ModelDoc; edit(change: (d: ModelDoc) => ModelDoc, label: string): void },
  sketches: readonly ListedSketch[],
  call: ViewCall,
  upTo: number | undefined,
  say: (text: string, bad?: boolean) => void,
  author?: string,
): Promise<string | undefined> {
  say("Making a drawing from your sketches.");
  const from = store.get();
  try {
    const r = await sketchDrawings(from, sketches, call, upTo, { newId, ...(author ? { author } : {}) });
    if (!r.made.length) return void say(r.had ? "Every sketch already has a page." : "There are no sketches to draw yet.");
    store.edit((d) => addPages(d, r.doc, SKETCHES_DRAWING, newId), "Drawing from sketches");
    say(`${pagesSaid(r.made.length)} to ${SKETCHES_DRAWING}, one for each sketch.`);
    return drawingNamed(store.get(), SKETCHES_DRAWING);
  } catch {
    say("Couldn't make the drawing.", true);
  }
}
