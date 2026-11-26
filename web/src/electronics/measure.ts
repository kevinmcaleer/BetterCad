import { outlinePoints, type BoardPad, type ElectronicsDesign, type P2 } from "@bettercad/electronics";
import { snap } from "./view2d";

/** What a measured point landed on (#732): a pad's or a hole's centre, a track's end, the board's edge, or the grid. */
export type MeasureSnap = { at: P2; on: "pad" | "via" | "hole" | "track" | "edge" | "grid" };

/** The nearest point of a line to `p`. */
function nearestOn(p: P2, a: P2, b: P2): P2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return [a[0] + t * dx, a[1] + t * dy];
}

const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Where a measure click lands: the nearest centre or end within `reach` mm wins (pads, vias, holes, track ends), then
 * the board's edge, then the grid.
 */
export function measureSnap(d: ElectronicsDesign, pads: BoardPad[], p: P2, reach: number, grid: number): MeasureSnap {
  const board = d.board;
  const found: { best: MeasureSnap | null; d: number } = { best: null, d: reach };
  const offer = (at: P2, on: MeasureSnap["on"]) => {
    const dd = dist(at, p);
    if (dd <= found.d) Object.assign(found, { best: { at, on }, d: dd });
  };
  for (const pad of pads) offer(pad.at, "pad");
  for (const v of board?.vias ?? []) offer([v.x, v.y], "via");
  for (const h of board?.holes ?? []) offer([h.x, h.y], "hole");
  for (const t of board?.tracks ?? []) for (const e of [t.pts[0], t.pts[t.pts.length - 1]]) if (e) offer(e, "track");
  if (found.best) return found.best;
  if (board)
    for (const loop of [outlinePoints(board.outline), ...(board.cutouts ?? []).map((c) => outlinePoints(c))])
      loop.forEach((a, i) => {
        const at = nearestOn(p, a, loop[(i + 1) % loop.length]!);
        offer([Math.round(at[0] * 1e6) / 1e6, Math.round(at[1] * 1e6) / 1e6], "edge");
      });
  return found.best ?? { at: snap(p, grid), on: "grid" };
}

const mm = (n: number) => `${Math.round(n * 1000) / 1000} mm`;

/** The distance between two points and its parts along x and y, as the tool reads it out. */
export function measureText(a: P2, b: P2): string {
  return `${mm(dist(a, b))} · dx ${mm(Math.abs(b[0] - a[0]))} · dy ${mm(Math.abs(b[1] - a[1]))}`;
}
