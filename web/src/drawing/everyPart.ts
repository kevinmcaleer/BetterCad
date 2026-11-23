import { newSheet, standardFor, type Drawing } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import { newId, type ModelDoc } from "../state/document";
import { firstDirections, standardViews, type FirstView } from "./firstViews";
import { sheetLayout, today } from "./layout";
import { modelParts, type ListedBody, type ListedComponent, type PartsRow } from "./parts";
import { lastSheet } from "./prefs";
import type { ViewCall } from "./useModelViews";
import { emptyView, viewRequest } from "./views";

/**
 * Make drawings of every part (#574): a drawing for each row of the parts list, named for its part, on the page you
 * last set up, with a front view, the views beside it and an isometric. A part that already has a drawing of its
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
    const ways = firstDirections(l.angle);
    const pics = {} as Record<FirstView, ModelView>;
    let ready = true;
    await Promise.all(
      (Object.keys(ways) as FirstView[]).map(async (k) => {
        // Sizes are all that is needed here, so the quick picture will do.
        const p = call({ doc: model, upTo, ...viewRequest({ shows: row.shows, direction: ways[k], hidden: false, tangent: false }, true) });
        if (!p) ready = false;
        else pics[k] = await p;
      }),
    );
    if (!ready || emptyView(pics.front)) {
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

/**
 * The command as the editor runs it: works the drawings out from the model as it is built, adds them in one step
 * and says how it went. The model may change while the views are worked out, so only the new drawings are added.
 */
export async function makeEveryPart(
  store: { get(): ModelDoc; edit(change: (d: ModelDoc) => ModelDoc, label: string): void },
  bodies: readonly ListedBody[],
  components: readonly ListedComponent[],
  call: ViewCall,
  upTo: number | undefined,
  say: (text: string, bad?: boolean) => void,
  author?: string,
): Promise<void> {
  say("Making a drawing of every part.");
  const from = store.get();
  try {
    const r = await partDrawings(from, modelParts(from, bodies, components), call, upTo, { newId, ...(author ? { author } : {}) });
    if (!r.made.length) return say(r.skipped ? "Every part already has a drawing." : "There are no parts to draw yet.");
    const add = (r.doc.drawings ?? []).slice((from.drawings ?? []).length);
    store.edit((d) => ({ ...d, drawings: [...(d.drawings ?? []), ...add] }), "Make drawings of every part");
    say(`Made ${r.made.length} ${r.made.length === 1 ? "drawing" : "drawings"}. They are under Drawings in the browser.`);
  } catch {
    say("Couldn't make the drawings.", true);
  }
}
