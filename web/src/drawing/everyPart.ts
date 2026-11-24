import { newSheet, standardFor, type Drawing, type DrawingView } from "@bettercad/kernel/drawing";
import { newId, type ModelDoc } from "../state/document";
import { firstPictures, standardViews } from "./firstViews";
import { sheetLayout, today } from "./layout";
import { modelParts, type ListedBody, type ListedComponent, type PartsRow } from "./parts";
import { lastSheet } from "./prefs";
import type { ViewCall } from "./useModelViews";

/**
 * Make drawings of every part (#574): a drawing for each row of the parts list, named for its part, on the page you
 * last set up, with a front view, the views beside it and an isometric. A track's link gets one too (`withTrackLinks`). A part that already has a drawing of its
 * name is left alone, so running it again only adds what is new.
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
  const taken = new Set((doc.drawings ?? []).map((d) => d.name));
  const pick = lastSheet();
  const drawings: Drawing[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (taken.has(row.name)) {
      skipped++;
      continue;
    }
    const sheet = newSheet("Sheet 1", {
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
    drawings.push({
      id: o.newId("dr"),
      name: row.name,
      decimals: 2,
      sheets: [standardViews({ ...sheet, id: o.newId("sh") }, l, row.shows, pics, () => o.newId("vw"))],
    });
  }
  return { doc: drawings.length ? { ...doc, drawings: [...(doc.drawings ?? []), ...drawings] } : doc, made: drawings.map((d) => d.name), skipped };
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
): Promise<void> {
  say("Making a drawing of every part.");
  const from = store.get();
  try {
    const r = await partDrawings(from, withTrackLinks(modelParts(from, bodies, components), bodies, tracks), call, upTo, {
      newId,
      ...(author ? { author } : {}),
    });
    if (!r.made.length) return say(r.skipped ? "Every part already has a drawing." : "There are no parts to draw yet.");
    const add = (r.doc.drawings ?? []).slice((from.drawings ?? []).length);
    store.edit((d) => ({ ...d, drawings: [...(d.drawings ?? []), ...add] }), "Make drawings of every part");
    say(`Made ${r.made.length} ${r.made.length === 1 ? "drawing" : "drawings"}. They are under Drawings in the browser.`);
  } catch {
    say("Couldn't make the drawings.", true);
  }
}
