/**
 * Stitching vias (#737): a pour's card fills it with vias on a grid, joining it to the same net's pour on the other
 * side, as KiCad's via stitching plug-in and Fusion's via stitching do. Vias go only where both pours fill all round
 * the via and every clearance holds; afterwards they are ordinary vias, so one undo or a delete takes them out.
 */
import { boardPads } from "../board";
import { q } from "../geom";
import type { ElectronicsDesign, Id, P2 } from "../model";
import { copperOf, edgeLoops, gap, netRules, type Copper } from "./copper";
import { pourFill, type PourFill } from "./pour";
import { addVia, blockers } from "./route";
import { layersOf } from "./stack";

/** The usual gap between stitching vias, mm. */
export const STITCH_SPACING = 5;

/** Whether the fill is copper at a point: its cell is part of a piece. */
function filledAt(f: PourFill, p: P2): boolean {
  const i = Math.round((p[0] - f.x0) / f.step);
  const j = Math.round((p[1] - f.y0) / f.step);
  return i >= 0 && j >= 0 && i < f.w && j < f.h && f.cells[j * f.w + i]! > 0;
}

/** Whether the fill is copper all round a disc: its middle and eight points on a ring a cell wider than it. */
function filledRound(f: PourFill, p: P2, r: number): boolean {
  const reach = r + f.step;
  if (!filledAt(f, p)) return false;
  for (let k = 0; k < 8; k += 1) {
    const a = (k * Math.PI) / 4;
    if (!filledAt(f, [p[0] + reach * Math.cos(a), p[1] + reach * Math.sin(a)])) return false;
  }
  return true;
}

export interface StitchPlan {
  /** Where the vias would go. */
  at: P2[];
  /** Why there are none, in words, when there are none. */
  why?: string;
}

/**
 * Where stitching vias would go in a pour, `spacing` mm apart on a grid lined up with the board's origin. Each needs
 * the pour and another pour of its net on another layer to fill all round it, at least one of them joined to
 * something already, and room from every other net's copper, pads of its own net, holes and the edge.
 */
export function stitchPlan(d: ElectronicsDesign, pourId: Id, spacing = STITCH_SPACING): StitchPlan {
  const board = d.board;
  const pour = board?.pours.find((p) => p.id === pourId);
  if (!board || !pour) return { at: [], why: "There is no such pour." };
  if (!pour.net) return { at: [], why: "The pour is on no net." };
  const others = board.pours.filter((p) => p.id !== pour.id && p.net === pour.net && p.layer !== pour.layer);
  if (!others.length) return { at: [], why: `There is no ${pour.net} pour on another layer to join it to. Pour one first.` };
  if (!(spacing > 0)) return { at: [], why: "The spacing has to be more than 0 mm." };

  const pads = boardPads(d);
  const copper = copperOf(d, pads);
  const loops = edgeLoops(board);
  const rules = netRules(board, pour.net);
  const r = rules.viaDiameter / 2;
  const layers = layersOf(board);
  // Where each pour fills as it is, and where it would fill once joined.
  const mine = { now: pourFill(d, pour, pads, copper), joined: pourFill(d, pour, pads, copper, { islands: true }) };
  const theirs = others.map((p) => ({ now: pourFill(d, p, pads, copper), joined: pourFill(d, p, pads, copper, { islands: true }) }));
  // A via never sits on a pad, its own net's included, nor on a hole.
  const keepOff: Copper[] = copper.filter((c) => c.kind === "pad" || (c.kind === "via" && !c.net));
  const holes = board.holes.map((h) => ({ pts: [[h.x, h.y]] as P2[], r: Math.max(h.pad ?? 0, h.drill) / 2 }));
  const placed: P2[] = board.vias.map((v) => [v.x, v.y]);

  const xs = pour.outline.map((p) => p[0]);
  const ys = pour.outline.map((p) => p[1]);
  const at: P2[] = [];
  for (let y = Math.ceil(Math.min(...ys) / spacing) * spacing; y <= Math.max(...ys) + 1e-9; y += spacing)
    for (let x = Math.ceil(Math.min(...xs) / spacing) * spacing; x <= Math.max(...xs) + 1e-9; x += spacing) {
      const p: P2 = [q(x), q(y)];
      if (!filledRound(mine.joined, p, r)) continue;
      const under = theirs.filter((t) => filledRound(t.joined, p, r));
      if (!under.length) continue;
      // Two pieces of copper that join nothing stay joined to nothing; one of them has to reach the rest already.
      if (!filledAt(mine.now, p) && !under.some((t) => filledAt(t.now, p))) continue;
      const via = { pts: [p], r };
      if (keepOff.some((c) => gap(via, c) < board.rules.clearance - 1e-6)) continue;
      if (holes.some((h) => gap(via, h) < board.rules.clearance - 1e-6)) continue;
      if (placed.some((v) => Math.hypot(v[0] - p[0], v[1] - p[1]) < rules.viaDiameter + board.rules.clearance - 1e-6)) continue;
      if (blockers(board, copper, loops, { net: pour.net, layers, pts: [p], width: rules.viaDiameter }).length) continue;
      at.push(p);
      placed.push(p);
    }
  return at.length ? { at } : { at, why: `Nowhere in the pour has room for a via ${spacing} mm apart. Try a smaller spacing.` };
}

/** Fills a pour with stitching vias: one step to undo. They are ordinary vias on the pour's net. */
export function addStitching(d: ElectronicsDesign, pourId: Id, spacing = STITCH_SPACING): { design: ElectronicsDesign; added: number; why?: string } {
  const plan = stitchPlan(d, pourId, spacing);
  const net = d.board?.pours.find((p) => p.id === pourId)?.net ?? "";
  const design = plan.at.reduce((acc, p) => addVia(acc, net, p[0], p[1]), d);
  return { design, added: plan.at.length, ...(plan.why ? { why: plan.why } : {}) };
}
