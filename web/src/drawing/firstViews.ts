import { SCALES, type DrawingSheet, type DrawingView, type ViewDirection } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import type { ModelDoc } from "../state/document";
import type { SheetLayout } from "./layout";
import type { ViewCall } from "./useModelViews";
import { GAP, placeProjected, projectedDirection, type Side } from "./projected";
import { emptyView, freeSpace, fromPage, placeView, viewRequest } from "./views";

/**
 * A finished first sheet (#574, #575): a front view with the views above or below it, beside it and an isometric,
 * each where the sheet's standard puts it, at the largest standard scale that leaves the four room.
 */
export type FirstView = "front" | "up" | "side" | "iso";

/** The side of the front view each of the others goes on: third angle puts the top view above, first angle below. */
export function firstSides(angle: "first" | "third"): Record<Exclude<FirstView, "front">, Side> {
  const sy = angle === "third" ? 1 : -1;
  return { up: [0, sy], side: [1, 0], iso: [1, sy] };
}

/** Which way each of the four looks. */
export function firstDirections(angle: "first" | "third"): Record<FirstView, ViewDirection> {
  const s = firstSides(angle);
  return {
    front: "front",
    up: projectedDirection("front", s.up, angle),
    side: projectedDirection("front", s.side, angle),
    iso: projectedDirection("front", s.iso, angle),
  };
}

const size = (v: ModelView) => ({ w: v.box.max[0] - v.box.min[0], h: v.box.max[1] - v.box.min[1] });

/** How much of the clear space the four views may take, each way. */
const ROOM = 0.85;

/** The four views on a sheet with none, from the kernel's pictures of them. The same sheet when there is nothing to draw. */
export function standardViews(
  sheet: DrawingSheet,
  l: SheetLayout,
  shows: DrawingView["shows"],
  pics: Record<FirstView, ModelView>,
  newId: () => string,
): DrawingSheet {
  if (emptyView(pics.front)) return sheet;
  const [f, u, s, i] = [size(pics.front), size(pics.up), size(pics.side), size(pics.iso)];
  const free = freeSpace(l);
  const cols = [f.w, Math.max(s.w, i.w)] as const;
  const rows = [f.h, Math.max(u.h, i.h)] as const;
  const fits = (k: number) => (cols[0] + cols[1]) * k + GAP <= free.w * ROOM && (rows[0] + rows[1]) * k + GAP <= free.h * ROOM;
  const scale = [...SCALES].reverse().find(fits) ?? SCALES[0];
  const [W, H] = [(cols[0] + cols[1]) * scale + GAP, (rows[0] + rows[1]) * scale + GAP];
  const [cx, cy] = fromPage([free.x + free.w / 2, free.y + free.h / 2], l.page.h);
  const sides = firstSides(l.angle);
  const sy = sides.up[1];
  const x0 = cx - W / 2 + (cols[0] * scale) / 2;
  const x1 = cx + W / 2 - (cols[1] * scale) / 2;
  // The front view's row is the lower one when the top view goes above it.
  const y0 = cy - (sy * H) / 2 + (sy * rows[0] * scale) / 2;
  const y1 = cy + (sy * H) / 2 - (sy * rows[1] * scale) / 2;
  const front = newId();
  const iso = newId();
  let next = placeView(sheet, front, { shows, direction: "front", hidden: true, tangent: false }, scale, [x0, y0]);
  next = placeProjected(next, newId(), front, sides.up, l.angle, [x0, y1]);
  next = placeProjected(next, newId(), front, sides.side, l.angle, [x1, y0]);
  next = placeProjected(next, iso, front, sides.iso, l.angle, [x1, y1]);
  // An isometric reads better without its hidden edges.
  return { ...next, views: next.views.map((v) => (v.id === iso ? { ...v, hidden: false } : v)) };
}

/**
 * The kernel's pictures of the four, from the model without its drawings. Sizes are all that is needed to lay them
 * out, so the quick picture will do. Nothing when the kernel can't be asked or there is nothing to see.
 */
export async function firstPictures(
  model: ModelDoc,
  shows: DrawingView["shows"],
  angle: "first" | "third",
  call: ViewCall,
  upTo: number | undefined,
): Promise<Record<FirstView, ModelView> | undefined> {
  const ways = firstDirections(angle);
  const pics = {} as Record<FirstView, ModelView>;
  let ready = true;
  await Promise.all(
    (Object.keys(ways) as FirstView[]).map(async (k) => {
      const p = call({ doc: model, upTo, ...viewRequest({ shows, direction: ways[k], hidden: false, tangent: false }, true) });
      if (!p) ready = false;
      else pics[k] = await p;
    }),
  );
  return ready && !emptyView(pics.front) ? pics : undefined;
}
