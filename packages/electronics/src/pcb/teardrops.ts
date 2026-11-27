/**
 * Teardrops (#743): where a track runs into a pad or a via, copper flares from the track's width out to most of the
 * pad's, so a drill that wanders or a track that is etched thin does not leave the joint hanging by a thread. Like a
 * pour, they are never stored: a board setting (`Board.teardrops`) says to have them, and they are worked out from the
 * board each time. One that would come too close to another net's copper is left out, so they never fail the board
 * check.
 */
import { boardPads, type BoardPad } from "../board";
import type { CopperLayer, ElectronicsDesign, P2 } from "../model";
import { clearanceBetween, copperOf, gap, type Copper } from "./copper";
import { layersOf, viaLayers } from "./stack";
import { trackPath } from "../trackArcs";

export interface Teardrop {
  net: string;
  layer: CopperLayer;
  /** A closed outline, filled. */
  pts: P2[];
}

/** How far the flare runs along the track, as a share of the pad's width, and how much of the pad it spreads over. */
const LENGTH = 0.5;
const SPREAD = 0.8;

/**
 * The teardrops a board has: none unless its `teardrops` setting is on. `pads` and `copper` are the board's, as
 * `boardPads` and `copperOf` give them.
 */
export function teardrops(d: ElectronicsDesign, pads: BoardPad[] = boardPads(d), copper: Copper[] = copperOf(d, pads)): Teardrop[] {
  const b = d.board;
  if (!b?.teardrops) return [];
  const all = layersOf(b);
  // Round lands a track can end on: pads (by their narrower side) and vias.
  const lands: { at: P2; r: number; net: string; layers: CopperLayer[] }[] = [
    ...pads.map((p) => ({
      at: p.at,
      r: Math.min(p.pad.w, p.pad.h) / 2,
      net: p.net,
      layers: p.pad.kind === "smd" ? [p.side] : all,
    })),
    ...b.vias.map((v) => ({ at: [v.x, v.y] as P2, r: v.diameter / 2, net: v.net, layers: viaLayers(b, v) })),
  ];
  const out: Teardrop[] = [];
  for (const t of b.tracks) {
    if (t.pts.length < 2) continue;
    // Along a curved end (#755), the way it leaves the pad is its first short chord.
    const path = trackPath(t);
    for (const [end, next] of [
      [path[0]!, path[1]!],
      [path[path.length - 1]!, path[path.length - 2]!],
    ] as [P2, P2][]) {
      const land = lands.find((l) => l.net === t.net && l.layers.includes(t.layer) && Math.hypot(l.at[0] - end[0], l.at[1] - end[1]) < 1e-3);
      if (!land || land.r * 2 <= t.width * 1.2) continue;
      const len = Math.hypot(next[0] - end[0], next[1] - end[1]);
      const reach = land.r + land.r * 2 * LENGTH;
      // The flare needs the first piece of track to run that far straight.
      if (len < reach) continue;
      const u: P2 = [(next[0] - end[0]) / len, (next[1] - end[1]) / len];
      const n: P2 = [-u[1], u[0]];
      const tip: P2 = [end[0] + u[0] * reach, end[1] + u[1] * reach];
      const side = land.r * SPREAD;
      const pts: P2[] = [
        [tip[0] + (n[0] * t.width) / 2, tip[1] + (n[1] * t.width) / 2],
        [end[0] + n[0] * side, end[1] + n[1] * side],
        [end[0] - n[0] * side, end[1] - n[1] * side],
        [tip[0] - (n[0] * t.width) / 2, tip[1] - (n[1] * t.width) / 2],
      ];
      // Kept only when every other net's copper on its layer is far enough away.
      const solid = { pts, r: 0 };
      const near = copper.some((c) => c.net !== t.net && c.layers.includes(t.layer) && gap(solid, c) < clearanceBetween(b, t.net, c.net) - 1e-6);
      if (!near) out.push({ net: t.net, layer: t.layer, pts });
    }
  }
  return out;
}
