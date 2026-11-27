import { dist, placeOnBoard, q } from "./geom";
import { packageOf, padsOfPin, type Board, type ElectronicsDesign, type Id, type P2, type Pad, type Side } from "./model";
import { netlist, pinKey, type Netlist } from "./nets";
import { outlinePoints } from "./outlineGeom";
import { markPads } from "./pcb/marks";
import { padOnBoard } from "./padShape";

export { arcOf, area, outlinePoints, pointInPolygon } from "./outlineGeom";

/** A pad of a placed part, where it is on the board. */
export interface BoardPad {
  part: Id;
  ref: string;
  pad: Pad;
  /** The net its pin is on; "" for none. */
  net: string;
  at: P2;
  /** The pad's turn on the board, degrees. */
  angle: number;
  /** The side its copper is on, for a surface pad: its part's, or the other for a pad on the part's back. */
  side: Side;
  /** Where its copper's middle is, when that is off the hole (#744). None: at `at`. */
  centre?: P2;
  /** A polygon pad's outline on the board (#744). */
  outline?: P2[];
}

/** Every pad on the board, with its net from the schematic. */
export function boardPads(d: ElectronicsDesign, nl: Netlist = netlist(d)): BoardPad[] {
  const out: BoardPad[] = [];
  if (!d.board) return out;
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  for (const at of d.board.placements) {
    const part = parts.get(at.part);
    const pkg = part && packageOf(d, part);
    const def = part && d.defs[part.def];
    if (!part || !pkg || !def) continue;
    // Pad number to net, through the pin map.
    const netOfPad = new Map<string, string>();
    for (const pin of def.symbol.pins) {
      const net = nl.of.get(pinKey(part.id, pin.number));
      if (net) for (const pad of padsOfPin(pkg, pin.number)) netOfPad.set(pad, net);
    }
    for (const pad of pkg.footprint.pads) {
      const flip = at.side === "bottom" ? -1 : 1;
      out.push({
        part: part.id,
        ref: part.ref,
        pad,
        net: netOfPad.get(pad.number) ?? "",
        at: placeOnBoard([pad.x, pad.y], at),
        angle: at.rot + flip * (pad.angle ?? 0),
        side: pad.back && pad.kind === "smd" ? (at.side === "top" ? "bottom" : "top") : at.side,
        ...padOnBoard(pad, at),
      });
    }
  }
  // Fiducials and test points (#735) are pads of the board's own.
  out.push(...markPads(d.board));
  return out;
}

/** A line of the ratsnest: a connection still to be routed. */
export interface Air {
  net: string;
  a: P2;
  b: P2;
}

/**
 * The ratsnest: for each net, the shortest set of lines that would join its pads, leaving out pads that `joined`
 * says are already connected by copper. `joined` gives each pad a group; pads in one group need no line.
 */
export function ratsnest(pads: BoardPad[], joined?: (pad: BoardPad, index: number) => string | number): Air[] {
  const byNet = new Map<string, number[]>();
  pads.forEach((p, i) => {
    if (!p.net || p.pad.kind === "npth") return;
    if (!byNet.has(p.net)) byNet.set(p.net, []);
    byNet.get(p.net)!.push(i);
  });
  const out: Air[] = [];
  for (const [net, list] of byNet) {
    if (list.length < 2) continue;
    // Prim's, starting with pads already joined by copper in one group.
    const group = list.map((i) => (joined ? joined(pads[i]!, i) : i));
    const done = new Set<string | number>([group[0]!]);
    while (done.size < new Set(group).size) {
      let best: [number, number, number] | null = null;
      for (let x = 0; x < list.length; x += 1) {
        if (!done.has(group[x]!)) continue;
        for (let y = 0; y < list.length; y += 1) {
          if (done.has(group[y]!)) continue;
          const len = dist(pads[list[x]!]!.at, pads[list[y]!]!.at);
          if (!best || len < best[2]) best = [x, y, len];
        }
      }
      if (!best) break;
      done.add(group[best[1]]!);
      out.push({ net, a: pads[list[best[0]]!]!.at, b: pads[list[best[1]]!]!.at });
    }
  }
  return out;
}

/** The board's size, edge to edge. */
export function boardSize(board: Pick<Board, "outline">): { w: number; h: number; x: number; y: number } {
  const pts = outlinePoints(board.outline);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: q(Math.max(...xs) - x), h: q(Math.max(...ys) - y) };
}
