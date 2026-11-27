/**
 * Pads of any shape, and copper off the middle of its hole (#744). A `polygon` pad's outline is in `points`, around
 * the copper's middle and turned with the pad. `offset` moves the copper from the hole, also in the pad's own turn,
 * as KiCad keeps it. These helpers give the copper's middle and outline in the footprint and on the board, so the
 * writers and checks need not know.
 */
import { placeOnBoard } from "./geom";
import type { P2, Pad } from "./model";

const turn = ([x, y]: P2, deg: number): P2 => {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Where the copper's middle is in the footprint: the pad's place, moved by its offset. */
export function copperMiddle(pad: Pick<Pad, "x" | "y" | "angle" | "offset">): P2 {
  if (!pad.offset) return [pad.x, pad.y];
  const o = turn(pad.offset, pad.angle ?? 0);
  return [r4(pad.x + o[0]), r4(pad.y + o[1])];
}

/** A polygon pad's outline in the footprint, or null for the other shapes. */
export function padOutline(pad: Pick<Pad, "x" | "y" | "angle" | "offset" | "shape" | "points">): P2[] | null {
  if (pad.shape !== "polygon" || !pad.points || pad.points.length < 3) return null;
  const [cx, cy] = copperMiddle(pad);
  return pad.points.map((p) => {
    const t = turn(p, pad.angle ?? 0);
    return [r4(cx + t[0]), r4(cy + t[1])];
  });
}

/** The copper's middle and, for a polygon pad, its outline, on the board for a part placed `at`. */
export function padOnBoard(
  pad: Pick<Pad, "x" | "y" | "angle" | "offset" | "shape" | "points">,
  at: { x: number; y: number; rot: number; side: "top" | "bottom" },
): { centre?: P2; outline?: P2[] } {
  const outline = padOutline(pad);
  return {
    ...(pad.offset ? { centre: placeOnBoard(copperMiddle(pad), at) } : {}),
    ...(outline ? { outline: outline.map((p) => placeOnBoard(p, at)) } : {}),
  };
}

/** A regular octagon filling a w by h box, as Eagle draws its octagon pads: corners cut at 45°. */
export function octagon(w: number, h: number): P2[] {
  // Each side of a regular octagon is its width over 1 + √2; the corners take the rest, half at each end.
  const c = (Math.min(w, h) * (1 - 1 / (1 + Math.SQRT2))) / 2;
  const [x, y] = [w / 2, h / 2];
  return [
    [x, y - c],
    [x - c, y],
    [-x + c, y],
    [-x, y - c],
    [-x, -y + c],
    [-x + c, -y],
    [x - c, -y],
    [x, -y + c],
  ].map(([a, b]) => [r4(a!), r4(b!)] as P2);
}

/** A polygon's box: its width and height, and its middle. */
export function outlineBox(pts: P2[]): { w: number; h: number; mid: P2 } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { w: r4(x2 - x1), h: r4(y2 - y1), mid: [r4((x1 + x2) / 2), r4((y1 + y2) / 2)] };
}
