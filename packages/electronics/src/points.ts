/**
 * A circuit block's connection points (#770, #771): whether each is joined yet, and the volts a point names. Kept apart
 * from the hook-up edits so the rules check can read them without loading those.
 */
import { key, onSegment } from "./geom";
import type { BlockPoint, P2, SchGroup, Sheet } from "./model";

/** A voltage named in a point's volts or a net's name: "3.3 V", "5V" or "3V3". */
export const voltsOf = (s: string | undefined): number | null => {
  if (!s) return null;
  const split = /(\d+)V(\d+)/i.exec(s);
  if (split) return Number(`${split[1]}.${split[2]}`);
  const plain = /(\d+(?:\.\d+)?)\s*V/i.exec(s);
  return plain ? Number(plain[1]) : null;
};

/** True when a wire ends on the point or runs through it, or the point is a ground that joins by name. */
export function isJoined(sheet: Sheet, at: P2): boolean {
  const k = key(at[0], at[1]);
  return sheet.wires.some((w) => key(w.a[0], w.a[1]) === k || key(w.b[0], w.b[1]) === k || onSegment(at, w.a, w.b));
}

/** A block's points with whether each one is joined to something outside it yet. */
export function pointsJoined(sheet: Sheet, g: SchGroup): { point: BlockPoint; at: P2; joined: boolean }[] {
  const labels = new Map(sheet.labels.map((l) => [l.id, l]));
  return (g.block?.points ?? []).flatMap((p) => {
    const l = labels.get(p.label);
    if (!l) return [];
    const at: P2 = [l.x, l.y];
    // Ground is named plainly, so it is joined to the design's ground already.
    return [{ point: p, at, joined: p.kind === "ground" ? true : isJoined(sheet, at) }];
  });
}

/** The range a point's volts allow: "2.7 to 10.8 V", "up to 12 V" or "3.3 V". */
export function voltRange(s: string | undefined): [number, number] | null {
  if (!s) return null;
  const to = /(\d+(?:\.\d+)?)\s*(?:V\s*)?to\s*(\d+(?:\.\d+)?)\s*V/i.exec(s);
  if (to) return [Number(to[1]), Number(to[2])];
  const upTo = /up to\s*(\d+(?:\.\d+)?)\s*V/i.exec(s);
  if (upTo) return [0, Number(upTo[1])];
  const v = voltsOf(s);
  return v === null ? null : [v, v];
}
