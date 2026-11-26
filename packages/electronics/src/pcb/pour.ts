import { boardPads, outlinePoints, pointInPolygon, type BoardPad } from "../board";
import { distToSegment, key, rad } from "../geom";
import { eid, type Board, type CopperLayer, type ElectronicsDesign, type Id, type P2, type Pour } from "../model";
import { clearanceBetween, copperOf, type Copper, type Layer, type Solid } from "./copper";

/**
 * Copper pours (#641): an area filled with copper on one net, usually ground. The fill flows round other nets at the
 * rule clearance, stays back from the edge, holes and keep-outs, joins its own pads with thermal spokes, and drops
 * islands that reach nothing. It is never stored: it is worked out from the board each time, so it cannot go stale.
 *
 * Two forms of the same fill. `pourShape` is exact geometry to paint: the area, then shapes to knock out of it, then
 * spokes to put back; a canvas and a Gerber file both draw it that way. `pourFill` is the fill on a fine grid, which
 * answers what the painting cannot: which pieces of the pour are joined to which pads, and which are islands.
 */
export interface Knock extends Solid {
  /** How far the copper keeps back from the core, beyond its own radius. */
  reach: number;
}

export interface PourShape {
  pour: Pour;
  /** The area asked for, and the board it is cut to: its edge, then its cut-outs. */
  outline: P2[];
  board: P2[][];
  /**
   * Painted in this order: the area, cut to the board; the rings round the pour's own pads knocked out; the spokes
   * laid back across them; then everything the copper keeps clear of knocked out, each shape grown by its reach.
   */
  rings: Knock[];
  spokes: { a: P2; b: P2; width: number }[];
  knocks: Knock[];
}

/** The gap round a pad joined by spokes, and how wide a spoke is, mm. */
export const THERMAL_GAP = 0.3;
export const SPOKE = 0.4;

const layerOf = (l: CopperLayer): Layer => l;
/** Pours in the order they fill: higher priority first, then as drawn. */
const order = (board: Board): Pour[] =>
  board.pours
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.priority ?? 0) - (a.p.priority ?? 0) || a.i - b.i)
    .map((x) => x.p);

/** What a pour is painted from. `copper` and `pads` are the board's, as `copperOf` and `boardPads` give them. */
export function pourShape(d: ElectronicsDesign, pour: Pour, pads: BoardPad[] = boardPads(d), copper: Copper[] = copperOf(d, pads)): PourShape {
  const board = d.board!;
  const layer = layerOf(pour.layer);
  const rules = board.rules;
  const knocks: Knock[] = [];
  const rings: Knock[] = [];
  const spokes: PourShape["spokes"] = [];
  const loops = [board.outline, ...(board.cutouts ?? [])].filter((o) => o.length > 2).map((o) => outlinePoints(o, 0.02));

  // The edge and the cut-outs, as lines to stay back from.
  for (const loop of loops)
    for (let i = 0; i < loop.length; i += 1) knocks.push({ pts: [loop[i]!, loop[(i + 1) % loop.length]!], r: 0, reach: rules.copperToEdge });
  for (const k of board.keepouts) if (k.pours) knocks.push({ pts: k.outline, r: 0, reach: 0 });
  // Pours that fill before this one keep their ground.
  for (const other of order(board)) {
    if (other.id === pour.id) break;
    if (layerOf(other.layer) === layer && other.net !== pour.net)
      knocks.push({ pts: other.outline, r: 0, reach: clearanceBetween(board, pour.net, other.net) });
  }
  const joins = new Map(board.placements.map((p) => [p.part, p.joins]));
  copper.forEach((c, i) => {
    if (!c.layers.includes(layer)) return;
    if (c.net !== pour.net || !c.net) {
      knocks.push({ pts: c.pts, r: c.r, reach: clearanceBetween(board, pour.net, c.net) });
      return;
    }
    const pad = c.kind === "pad" ? pads[i] : undefined;
    if (!pad) return;
    // The pad's own way of joining wins over the pour's.
    const how = joins.get(pad.part)?.[pad.pad.number] ?? (pour.thermal ? "spokes" : "solid");
    if (how === "solid") return;
    // Its own pad: a ring of bare board round it, bridged by four spokes along the pad's own axes.
    rings.push({ pts: c.pts, r: c.r, reach: THERMAL_GAP });
    const far = Math.max(pad.pad.w, pad.pad.h) / 2 + THERMAL_GAP + SPOKE;
    for (const turn of [0, 90, 180, 270]) {
      const a = rad(pad.angle + turn);
      spokes.push({
        a: pad.centre ?? pad.at,
        b: [(pad.centre ?? pad.at)[0] + far * Math.cos(a), (pad.centre ?? pad.at)[1] + far * Math.sin(a)],
        width: Math.min(SPOKE, Math.min(pad.pad.w, pad.pad.h)),
      });
    }
  });
  // Bare holes have no copper to measure from, so the fill stays back from the drill itself.
  for (const p of pads) if (p.pad.kind === "npth" && p.pad.drill) knocks.push({ pts: [p.at], r: p.pad.drill / 2, reach: rules.copperToEdge });
  for (const h of board.holes) if (!h.pad) knocks.push({ pts: [[h.x, h.y]], r: h.drill / 2, reach: rules.copperToEdge });
  return { pour, outline: pour.outline, board: loops, rings, spokes, knocks };
}

/** How far a point is from a core: 0 inside an outline. */
function away(s: Solid, x: number, y: number): number {
  const p: P2 = [x, y];
  if (s.pts.length === 1) return Math.hypot(x - s.pts[0]![0], y - s.pts[0]![1]);
  if (s.pts.length === 2) return distToSegment(p, s.pts[0]!, s.pts[1]!);
  if (pointInPolygon(p, s.pts)) return 0;
  let best = Infinity;
  for (let i = 0; i < s.pts.length; i += 1) best = Math.min(best, distToSegment(p, s.pts[i]!, s.pts[(i + 1) % s.pts.length]!));
  return best;
}

export interface PourFill {
  pour: Pour;
  /** The grid: cell (i, j) is centred on (x0 + i * step, y0 + j * step). */
  x0: number;
  y0: number;
  step: number;
  w: number;
  h: number;
  /** For each cell, 0 for bare board or the number of the piece of copper it is part of (from 1). */
  cells: Int32Array;
  /** For each piece, the copper (by its place in `copper`) it is joined to. An empty list is an island, left out. */
  joins: number[][];
  /** The islands that were dropped, as rows of cells to knock out of the painting: [x, y, width, height]. */
  islands: [number, number, number, number][];
  /** Filled area, mm², with islands left out. */
  area: number;
}

const MAX_CELLS = 250_000;

/** The fill on a grid: which cells are copper, as pieces, and what each piece is joined to. */
export function pourFill(
  d: ElectronicsDesign,
  pour: Pour,
  pads: BoardPad[] = boardPads(d),
  copper: Copper[] = copperOf(d, pads),
  /** Keep islands in: where the pour would fill if something joined it, as stitching vias (#737) would. */
  o: { islands?: boolean } = {},
): PourFill {
  const shape = pourShape(d, pour, pads, copper);
  const layer = layerOf(pour.layer);
  const xs = pour.outline.map((p) => p[0]);
  const ys = pour.outline.map((p) => p[1]);
  const edge = shape.board[0] ?? pour.outline;
  const x1 = Math.max(Math.min(...xs), Math.min(...edge.map((p) => p[0])));
  const x2 = Math.min(Math.max(...xs), Math.max(...edge.map((p) => p[0])));
  const y1 = Math.max(Math.min(...ys), Math.min(...edge.map((p) => p[1])));
  const y2 = Math.min(Math.max(...ys), Math.max(...edge.map((p) => p[1])));
  const empty: PourFill = { pour, x0: 0, y0: 0, step: 1, w: 0, h: 0, cells: new Int32Array(0), joins: [], islands: [], area: 0 };
  if (!(x2 > x1) || !(y2 > y1) || pour.outline.length < 3) return empty;
  const step = Math.max(0.1, Math.sqrt(((x2 - x1) * (y2 - y1)) / MAX_CELLS));
  const w = Math.ceil((x2 - x1) / step);
  const h = Math.ceil((y2 - y1) / step);
  const x0 = x1 + step / 2;
  const y0 = y1 + step / 2;
  const cells = new Int32Array(w * h);

  // Inside the area, on the board, out of the cut-outs: a row at a time, between the crossings of each outline.
  const rows = (poly: P2[], each: (j: number, from: number, to: number) => void) => {
    for (let j = 0; j < h; j += 1) {
      const y = y0 + j * step;
      const cross: number[] = [];
      for (let k = 0; k < poly.length; k += 1) {
        const a = poly[k]!;
        const b = poly[(k + 1) % poly.length]!;
        if (a[1] > y !== b[1] > y) cross.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      cross.sort((p, q) => p - q);
      for (let k = 0; k + 1 < cross.length; k += 2)
        each(j, Math.max(0, Math.ceil((cross[k]! - x0) / step)), Math.min(w - 1, Math.floor((cross[k + 1]! - x0) / step)));
    }
  };
  rows(pour.outline, (j, from, to) => cells.fill(1, j * w + from, j * w + to + 1));
  const onBoard = new Uint8Array(w * h);
  rows(edge, (j, from, to) => onBoard.fill(1, j * w + from, j * w + to + 1));
  for (const hole of shape.board.slice(1)) rows(hole, (j, from, to) => onBoard.fill(0, j * w + from, j * w + to + 1));
  for (let i = 0; i < cells.length; i += 1) if (!onBoard[i]) cells[i] = 0;

  // Knock out everything the copper keeps clear of. Half a cell more, so the grid never says joined when it is not.
  const near = (s: Solid, reach: number, each: (i: number, far: number) => void) => {
    const sx = s.pts.map((p) => p[0]);
    const sy = s.pts.map((p) => p[1]);
    const i1 = Math.max(0, Math.floor((Math.min(...sx) - reach - x0) / step));
    const i2 = Math.min(w - 1, Math.ceil((Math.max(...sx) + reach - x0) / step));
    const j1 = Math.max(0, Math.floor((Math.min(...sy) - reach - y0) / step));
    const j2 = Math.min(h - 1, Math.ceil((Math.max(...sy) + reach - y0) / step));
    for (let j = j1; j <= j2; j += 1)
      for (let i = i1; i <= i2; i += 1) {
        const far = away(s, x0 + i * step, y0 + j * step);
        if (far <= reach) each(j * w + i, far);
      }
  };
  const spokeAt = new Uint8Array(w * h);
  for (const s of shape.spokes) near({ pts: [s.a, s.b], r: 0 }, s.width / 2, (i) => (spokeAt[i] = 1));
  // A ring is only the gap round the pad, and the spokes cross it.
  for (const k of shape.rings)
    near(k, k.r + k.reach, (i, far) => {
      if (far > k.r && !spokeAt[i]) cells[i] = 0;
    });
  for (const k of shape.knocks) near(k, k.r + k.reach + step / 2, (i) => (cells[i] = 0));

  // Pieces: copper cells that touch side to side.
  let pieces = 0;
  const stack: number[] = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (cells[start] !== 1) continue;
    pieces += 1;
    const id = pieces + 1;
    cells[start] = id;
    stack.push(start);
    while (stack.length) {
      const c = stack.pop()!;
      const i = c % w;
      for (const n of [i > 0 ? c - 1 : -1, i < w - 1 ? c + 1 : -1, c - w, c + w])
        if (n >= 0 && n < cells.length && cells[n] === 1) {
          cells[n] = id;
          stack.push(n);
        }
    }
  }
  for (let i = 0; i < cells.length; i += 1) if (cells[i]) cells[i] -= 1;

  // What each piece is joined to: its own net's copper on this layer that lies on it.
  const joins: number[][] = Array.from({ length: pieces }, () => []);
  copper.forEach((c, index) => {
    if (!c.net || c.net !== pour.net || !c.layers.includes(layer)) return;
    const on = new Set<number>();
    near(c, c.r + step, (i) => cells[i] && on.add(cells[i]!));
    for (const piece of on) joins[piece - 1]!.push(index);
  });
  // Islands go, as rows half a cell wider all round so the painting loses the whole of each.
  const islands: PourFill["islands"] = [];
  let filled = 0;
  for (let j = 0; j < h; j += 1) {
    let from = -1;
    for (let i = 0; i <= w; i += 1) {
      const c = i < w ? cells[j * w + i]! : 0;
      const island = c > 0 && !o.islands && !joins[c - 1]!.length;
      if (c > 0 && !island) filled += 1;
      if (island && from < 0) from = i;
      else if (!island && from >= 0) {
        islands.push([x0 + (from - 1) * step, y0 + (j - 1) * step, (i - from + 1) * step, step * 2]);
        from = -1;
      }
      if (island) cells[j * w + i] = 0;
    }
  }
  return { pour, x0, y0, step, w, h, cells, joins, islands, area: filled * step * step };
}

/** Every pour's fill, in the order they fill. */
export function pourFills(d: ElectronicsDesign, pads: BoardPad[] = boardPads(d), copper: Copper[] = copperOf(d, pads)): PourFill[] {
  return d.board ? order(d.board).map((p) => pourFill(d, p, pads, copper)) : [];
}

const onBoard = (d: ElectronicsDesign, change: (b: Board) => Board): ElectronicsDesign => (d.board ? { ...d, board: change(d.board) } : d);

/** Takes out points that repeat, and says no to an area with fewer than three corners. */
function tidyArea(pts: P2[]): P2[] | null {
  const out: P2[] = [];
  for (const p of pts) if (!out.some((o) => key(o[0], o[1]) === key(p[0], p[1]))) out.push(p);
  return out.length >= 3 ? out : null;
}

/** Adds a pour over an area. Spokes join it to its pads unless you say otherwise. */
export function addPour(d: ElectronicsDesign, net: string, layer: CopperLayer, outline: P2[], thermal = true): ElectronicsDesign {
  const area = tidyArea(outline);
  return area ? onBoard(d, (b) => ({ ...b, pours: [...b.pours, { id: eid("po"), net, layer, outline: area, thermal }] })) : d;
}

/**
 * How one pad joins a pour on its net (#641): with spokes, so it solders easily, or all round, so it carries heat and
 * current. Nothing given: as the pour says.
 */
export function setPadJoin(d: ElectronicsDesign, part: Id, pad: string, how?: "spokes" | "solid"): ElectronicsDesign {
  return onBoard(d, (b) => ({
    ...b,
    placements: b.placements.map((p) => {
      if (p.part !== part) return p;
      const joins = { ...p.joins };
      if (how) joins[pad] = how;
      else delete joins[pad];
      const next: typeof p = { ...p, joins };
      if (!Object.keys(joins).length) delete next.joins;
      return next;
    }),
  }));
}

export function setPour(d: ElectronicsDesign, id: Id, change: Partial<Pick<Pour, "net" | "layer" | "thermal" | "priority">>): ElectronicsDesign {
  return onBoard(d, (b) => ({ ...b, pours: b.pours.map((p) => (p.id === id ? { ...p, ...change } : p)) }));
}

/** The board's own outline as an area, for a pour over the whole board. */
export const wholeBoard = (board: Pick<Board, "outline">): P2[] => outlinePoints(board.outline, 0.02);

/** Adds an area tracks, parts or pours must stay out of, from its corners. */
export function addKeepoutArea(
  d: ElectronicsDesign,
  outline: P2[],
  what: { tracks?: boolean; parts?: boolean; pours?: boolean } = { tracks: true, pours: true },
): ElectronicsDesign {
  const area = tidyArea(outline);
  return area ? onBoard(d, (b) => ({ ...b, keepouts: [...b.keepouts, { id: eid("ko"), outline: area, ...what }] })) : d;
}

export function setKeepout(d: ElectronicsDesign, id: Id, change: { tracks?: boolean; parts?: boolean; pours?: boolean }): ElectronicsDesign {
  return onBoard(d, (b) => ({ ...b, keepouts: b.keepouts.map((k) => (k.id === id ? { ...k, ...change } : k)) }));
}

/** Cuts a hole of any shape through the board. */
export function addCutout(d: ElectronicsDesign, outline: P2[]): ElectronicsDesign {
  const area = tidyArea(outline);
  return area ? onBoard(d, (b) => ({ ...b, cutouts: [...(b.cutouts ?? []), area.map(([x, y]) => ({ x, y }))] })) : d;
}

/** Deletes keep-outs (by id) and cut-outs (by "cut:" and their place in the list). */
export function removeAreas(d: ElectronicsDesign, ids: Id[]): ElectronicsDesign {
  const set = new Set(ids);
  if (!d.board || !ids.some((id) => id.startsWith("cut:") || d.board!.keepouts.some((k) => k.id === id))) return d;
  return onBoard(d, (b) => {
    const cutouts = (b.cutouts ?? []).filter((_, i) => !set.has(`cut:${i}`));
    const next: Board = { ...b, keepouts: b.keepouts.filter((k) => !set.has(k.id)), cutouts };
    if (!cutouts.length) delete next.cutouts;
    return next;
  });
}
