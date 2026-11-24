import { boardPads, type BoardPad } from "../board";
import type { ElectronicsDesign } from "../model";
import { netlist, type Netlist } from "../nets";
import { copperGroups, copperOf } from "./copper";
import { pourFills } from "./pour";

/**
 * What the board still needs: the pads, the copper, the pours as they fill, and which pads copper already joins (for
 * `ratsnest`), through tracks, vias and pours on either side.
 */
export function boardState(d: ElectronicsDesign, nl: Netlist = netlist(d)) {
  const pads = boardPads(d, nl);
  const copper = copperOf(d, pads);
  const fills = pourFills(d, pads, copper);
  const groups = copperGroups(
    copper,
    fills.flatMap((f) => f.joins),
  );
  return { pads, copper, fills, groups, joined: (_: BoardPad, i: number) => groups[i]! };
}
