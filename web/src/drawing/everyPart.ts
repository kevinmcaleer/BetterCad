import { newSheet, standardFor, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import { newId, type ModelDoc } from "../state/document";
import { firstPictures, standardViews } from "./firstViews";
import { sheetLayout, today } from "./layout";
import { modelParts, type ListedBody, type ListedComponent, type PartsRow } from "./parts";
import { lastSheet } from "./prefs";
import type { ViewCall } from "./useModelViews";

/** The drawing Drawing of every part fills, a page for each part. */
export const PARTS_DRAWING = "Parts";

/**
 * The drawing called `name` with pages added: a new drawing at the end when there is none of that name yet. Its
 * sheet names are the ones taken, so a page is only made for what has none.
 */
export function withPages(doc: ModelDoc, name: string, sheets: DrawingSheet[], newId: (kind: string) => string): ModelDoc {
  if (!sheets.length) return doc;
  const had = (doc.drawings ?? []).find((d) => d.name === name);
  if (had) return { ...doc, drawings: (doc.drawings ?? []).map((d) => (d === had ? { ...d, sheets: [...d.sheets, ...sheets] } : d)) };
  return { ...doc, drawings: [...(doc.drawings ?? []), { id: newId("dr"), name, decimals: 2, sheets }] };
}

/** The pages a drawing already has, by name: none when there is no drawing of that name. */
export const pagesOf = (doc: ModelDoc, name: string) => new Set((doc.drawings ?? []).find((d) => d.name === name)?.sheets.map((s) => s.name) ?? []);

/**
 * Drawing of every part (#574): one drawing, Parts, with a page for each row of the parts list, named for its
 * part, on the page size you last set up, with a front view, the views beside it and an isometric. A track's link gets
 * one too (`withTrackLinks`). A part that already has a page of its name is left alone, so running it again only adds
 * what is new.
 */
export async function partDrawings(
  doc: ModelDoc,
  rows: readonly PartsRow[],
  call: ViewCall,
  upTo: number | undefined,
  o: { author?: string; newId: (kind: string) => string },
): Promise<{ doc: ModelDoc; made: string[]; skipped: number }> {
  const model = { ...doc };
  delete model.drawings;
  const taken = pagesOf(doc, PARTS_DRAWING);
  const pick = lastSheet();
  const sheets: DrawingSheet[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (taken.has(row.name)) {
      skipped++;
      continue;
    }
    const sheet = newSheet(row.name, {
      ...pick,
      standard: pick.standard ?? standardFor(pick.size),
      date: today(),
      title: row.name,
      ...(o.author ? { author: o.author } : {}),
    });
    const l = sheetLayout(sheet);
    const pics = await firstPictures(model, row.shows, l.angle, call, upTo);
    if (!pics) {
      skipped++;
      continue;
    }
    taken.add(row.name);
    sheets.push(standardViews({ ...sheet, id: o.newId("sh") }, l, row.shows, pics, () => o.newId("vw")));
  }
  return { doc: withPages(doc, PARTS_DRAWING, sheets, o.newId), made: sheets.map((s) => s.name), skipped };
}

/** A track as the parts need it: its parts, the piece (the first link it was made from) first. */
export interface ListedTrack {
  parts: readonly string[];
}

/**
 * The parts with each track's link drawn on its own, as it was made and not tipped round a wheel, so you can print
 * it. A track outside any component is already a row of its own: its views now show the one link as made. A track
 * in a component is drawn with the component, so its link gets a row of its own after the rest.
 */
export function withTrackLinks(rows: readonly PartsRow[], bodies: readonly ListedBody[], tracks: readonly ListedTrack[]): PartsRow[] {
  const out = rows.map((r) => ({ ...r }));
  const names = new Set(out.map((r) => r.name));
  for (const t of tracks) {
    const piece = bodies.find((b) => b.id === t.parts[0]);
    if (!piece || piece.hidden || piece.hole) continue;
    const shows: DrawingView["shows"] = { bodies: [piece.id], asMade: true };
    const row = out.find((r) => r.bodies.includes(piece.id));
    if (row && "bodies" in row.shows) {
      row.shows = shows;
      continue;
    }
    let name = piece.name;
    if (names.has(name)) name = `${piece.name} link`;
    for (let n = 2; names.has(name); n++) name = `${piece.name} link ${n}`;
    names.add(name);
    out.push({ item: out.length + 1, name, count: t.parts.length, material: row?.material ?? "", bodies: [...t.parts], shows });
  }
  return out;
}

/**
 * The command as the editor runs it: works the drawings out from the model as it is built, adds them in one step
 * and says how it went. The model may change while the views are worked out, so only the new drawings are added.
 */
export async function makeEveryPart(
  store: { get(): ModelDoc; edit(change: (d: ModelDoc) => ModelDoc, label: string): void },
  bodies: readonly ListedBody[],
  components: readonly ListedComponent[],
  tracks: readonly ListedTrack[],
  call: ViewCall,
  upTo: number | undefined,
  say: (text: string, bad?: boolean) => void,
  author?: string,
): Promise<string | undefined> {
  say("Making a drawing of every part.");
  const from = store.get();
  try {
    const r = await partDrawings(from, withTrackLinks(modelParts(from, bodies, components), bodies, tracks), call, upTo, {
      newId,
      ...(author ? { author } : {}),
    });
    if (!r.made.length) return void say(r.skipped ? "Every part already has a page." : "There are no parts to draw yet.");
    store.edit((d) => addPages(d, r.doc, PARTS_DRAWING, newId), "Drawing of every part");
    say(`${pagesSaid(r.made.length)} to ${PARTS_DRAWING}, one for each part.`);
    return drawingNamed(store.get(), PARTS_DRAWING);
  } catch {
    say("Couldn't make the drawing.", true);
  }
}

/** The id of the drawing of a name. */
export const drawingNamed = (doc: ModelDoc, name: string) => (doc.drawings ?? []).find((d) => d.name === name)?.id;

/** "Added 3 pages", "Added a page". */
export const pagesSaid = (n: number) => (n === 1 ? "Added a page" : `Added ${n} pages`);

/**
 * The new pages from `made` added to the model as it is now: it may have changed while the views were worked out, so
 * only the pages are taken across, onto the drawing of that name (made again if it went meanwhile).
 */
export function addPages(now: ModelDoc, made: ModelDoc, name: string, newId: (kind: string) => string): ModelDoc {
  const had = pagesOf(now, name);
  const got = (made.drawings ?? []).find((d) => d.name === name)?.sheets.filter((s) => !had.has(s.name)) ?? [];
  return withPages(now, name, got, newId);
}
