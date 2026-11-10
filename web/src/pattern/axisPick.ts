import type { MeasureResult, TopoRef } from "@bettercad/kernel";
import { bodyRef, type ConstructRef, type Part } from "../state/document";
import { geoFromPick } from "../construct/pickGeo";
import type { Engine, ScreenPoint } from "../viewport/engine";
import type { Pick } from "../viewport/ids";

/** A circular pattern's axis picking on the model: loaded the first time the axis is picked. */

/** The edge or face of a body under the pointer, for a circular pattern's axis. Bodies in `skip` (its own copies) aren't. */
export function bodyUnder(eng: Engine, p: ScreenPoint, skip: ReadonlySet<string>): Pick | null {
  for (const f of ["edge", "face"] as const) {
    const hit = eng.pick(p.x, p.y, f);
    if (hit && !skip.has(hit.body)) return hit;
  }
  return null;
}

/**
 * The axis a pick on a body stands for: a round edge's or round face's centre line, or a straight edge's line. It is
 * kept in the body's own coordinates, so the pattern follows the body when it moves. A message when it has no axis.
 */
export async function axisOfPick(
  eng: Engine,
  hit: Pick,
  p: ScreenPoint,
  parts: Part[],
  measure: (refs: TopoRef[]) => Promise<MeasureResult | null>,
): Promise<ConstructRef | string> {
  const part = parts.find((x) => x.id === hit.body);
  if (!part || (hit.kind !== "edge" && hit.kind !== "face")) return NO_AXIS;
  const r = await measure([{ body: hit.body, kind: hit.kind, index: hit.index }]);
  const s = r?.items[0];
  const geo = s && geoFromPick(s, { ray: eng.ray(p.x, p.y) });
  if (!geo || (geo.t !== "circle" && geo.t !== "line")) return NO_AXIS;
  return bodyRef(part, hit.kind, hit.index, geo);
}

export const NO_AXIS = "That has no axis. Click a round edge, a round face or a straight edge.";
