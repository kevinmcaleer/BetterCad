/**
 * The picking ID buffer packs a body and one of its elements into one RGBA8 pixel: R, G hold the body's index + 1
 * (0 is nothing), B, A hold the element (a face, edge or vertex index). FACE_ONLY marks a face drawn only to hide
 * the edges and points behind it.
 */
export type SelectFilter = "body" | "face" | "edge" | "vertex";

export interface Pick {
  /** The part (body) ID. */
  body: string;
  kind: SelectFilter;
  /** The face, edge or vertex index (0 for a whole body). */
  index: number;
}

export const FACE_ONLY = 0xffff;

export function encodeId(body: number, element: number): [number, number, number, number] {
  const b = body + 1;
  return [(b >> 8) & 0xff, b & 0xff, (element >> 8) & 0xff, element & 0xff];
}

/** The body index (−1: nothing) and element from four bytes. */
export function decodeId(r: number, g: number, b: number, a: number): { body: number; element: number } {
  return { body: ((r << 8) | g) - 1, element: (b << 8) | a };
}

/**
 * Finds the pick in a square of ID pixels (`size` × `size`, RGBA, row 0 at the bottom) round the cursor at its
 * centre. Faces and bodies take the pixel under the cursor (or the nearest within 3 px); edges and vertices take the
 * nearest one drawn, so thin lines are easy to hit.
 */
export function findPick(pixels: Uint8Array, size: number, kind: SelectFilter, wide = false): { body: number; element: number } | null {
  const c = (size - 1) / 2;
  // A body or face is found under the point; a finger (wide) may land a little off it.
  const reach = !wide && (kind === "body" || kind === "face") ? Math.min(3, c) : c;
  let best: { body: number; element: number } | null = null;
  let bestD = Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > reach || d >= bestD) continue;
      const i = (y * size + x) * 4;
      const id = decodeId(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!);
      if (id.body < 0) continue;
      if ((kind === "edge" || kind === "vertex") && id.element === FACE_ONLY) continue;
      best = id;
      bestD = d;
    }
  }
  return best;
}

export const samePick = (a: Pick | null, b: Pick | null) => a === b || (!!a && !!b && a.body === b.body && a.kind === b.kind && a.index === b.index);
