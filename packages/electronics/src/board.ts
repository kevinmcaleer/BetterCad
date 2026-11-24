import { dist, placeOnBoard, q } from "./geom";
import { packageOf, padsOfPin, type Board, type Corner, type ElectronicsDesign, type Id, type P2, type Pad, type Side } from "./model";
import { netlist, pinKey, type Netlist } from "./nets";

/** An outline as straight pieces: arcs (corners with a bulge) are cut into short chords, `step` mm of sag at most. */
export function outlinePoints(corners: Corner[], sag = 0.01): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    out.push([a.x, a.y]);
    if (!a.bulge) continue;
    const arc = arcOf(a, b);
    if (!arc) continue;
    const sweep = 4 * Math.atan(a.bulge);
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.acos(Math.max(0, 1 - sag / arc.r)))));
    for (let k = 1; k < n; k += 1) {
      const t = arc.a0 + (sweep * k) / n;
      out.push([q(arc.cx + arc.r * Math.cos(t)), q(arc.cy + arc.r * Math.sin(t))]);
    }
  }
  return out;
}

/** The circle an arc edge lies on, with the angle it starts at (radians). A positive bulge runs anticlockwise. */
export function arcOf(a: Corner, b: Corner): { cx: number; cy: number; r: number; a0: number; sweep: number } | null {
  const bulge = a.bulge ?? 0;
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!bulge || chord < 1e-9) return null;
  const sweep = 4 * Math.atan(bulge);
  const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  // The centre sits on the chord's normal, to the left of travel for an anticlockwise arc.
  const h = (chord / 2) * ((1 - bulge * bulge) / (2 * bulge));
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const nx = -(b.y - a.y) / chord;
  const ny = (b.x - a.x) / chord;
  const cx = mx + nx * h;
  const cy = my + ny * h;
  return { cx, cy, r, a0: Math.atan2(a.y - cy, a.x - cx), sweep };
}

/** Area of a closed polygon; positive when it runs anticlockwise. */
export function area(pts: P2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInPolygon(p: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

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
  side: Side;
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
        side: at.side,
      });
    }
  }
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
