import { boardPads, type BoardPad } from "../board";
import { q } from "../geom";
import type { CopperLayer, ElectronicsDesign, Id, P2, Track } from "../model";
import { clearanceBetween, copperOf, edgeLoops, gap, type Solid } from "./copper";
import { blockers, tidyRun, trackLength } from "./route";
import { slidePiece, slideTrack } from "./slide";

/**
 * Routing for tighter boards (#646): tracks that push their neighbours aside, wiggles that make a net a set length,
 * and two tracks laid together at one gap.
 */

export interface Run {
  net: string;
  layer: CopperLayer;
  pts: P2[];
  width: number;
}

const piecesOf = (r: Pick<Run, "pts" | "width">): Solid[] => r.pts.slice(1).map((b, i) => ({ pts: [r.pts[i]!, b], r: r.width / 2 }));
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: P2, b: P2): number => a[0] * b[0] + a[1] * b[1];

/** The point of piece `a`-`b` nearest to `p`. */
function nearestOn(p: P2, a: P2, b: P2): P2 {
  const d = sub(b, a);
  const l = dot(d, d);
  const t = l < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / l));
  return [a[0] + d[0] * t, a[1] + d[1] * t];
}

/** The nearest two points of two pieces that do not cross: one on each. */
function nearest(a1: P2, a2: P2, b1: P2, b2: P2): [P2, P2] {
  const tries: [P2, P2][] = [
    [a1, nearestOn(a1, b1, b2)],
    [a2, nearestOn(a2, b1, b2)],
    [nearestOn(b1, a1, a2), b1],
    [nearestOn(b2, a1, a2), b2],
  ];
  return tries.reduce((best, t) => (Math.hypot(...sub(t[0], t[1])) < Math.hypot(...sub(best[0], best[1])) ? t : best));
}

/** How many times a push may be passed on: the track you lay pushes one, which pushes the next. */
const DEPTH = 3;
/** Slides tried before giving up, over the whole push. */
const TRIES = 60;

/**
 * Makes room for a new run of track by sliding other nets' tracks sideways (#646). Each piece in the way moves just
 * far enough, parallel to itself, and what it then comes too close to is pushed in turn. Pads, vias, text, keep-outs
 * and the board's edge do not move: if a track would have to go into one, there is no room and the answer is null.
 *
 * The design that comes back has the other tracks moved and every clearance kept; the new run is not laid in it.
 */
export function shove(d: ElectronicsDesign, run: Run, pads: BoardPad[] = boardPads(d)): ElectronicsDesign | null {
  const start = d.board;
  if (!start || run.pts.length < 2) return null;
  const loops = edgeLoops(start);
  let cur = d;
  let tries = 0;

  /** Slides everything `by` is too close to. False when something cannot move far enough. */
  const push = (by: Run & { id?: Id }, level: number): boolean => {
    const mine = piecesOf(by);
    const pushed = new Set<Id>();
    for (;;) {
      const board = cur.board!;
      let hit: { t: Track; i: number; need: number } | undefined;
      for (const t of board.tracks) {
        if (t.layer !== by.layer || t.id === by.id || (t.net && t.net === by.net)) continue;
        const need = clearanceBetween(board, by.net, t.net);
        const i = piecesOf(t).findIndex((p) => mine.some((m) => gap(m, p) < need - 1e-6));
        if (i >= 0) {
          hit = { t, i, need };
          break;
        }
      }
      if (!hit) break;
      if (level > DEPTH || (tries += 1) > TRIES) return false;
      const { t, i, need } = hit;
      const a = t.pts[i]!;
      const b = t.pts[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-9) return false;
      const n: P2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      // Which way is away: from the nearest point of the pushing run to the nearest of this piece.
      let side = 0;
      let lateral = 0;
      let best = Infinity;
      for (const m of mine) {
        const [pm, pt] = nearest(m.pts[0]!, m.pts[1]!, a, b);
        const dist = Math.hypot(pt[0] - pm[0], pt[1] - pm[1]);
        if (dist < best) {
          best = dist;
          lateral = dot(n, sub(pt, pm));
          side = Math.sign(lateral);
        }
      }
      // Crossing, or end to end on one line: no side to go to.
      if (!side || best < 1e-6) return false;
      let off = Math.ceil((need + by.width / 2 + t.width / 2 - Math.abs(lateral)) * 100) / 100 + 0.01;
      // Only the stretch beside the pushing run moves, with room either end for the 45° pieces that reach across.
      const u: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const here: Solid = { pts: [a, b], r: t.width / 2 };
      const along = mine.filter((m) => gap(m, here) < need - 1e-6).flatMap((m) => m.pts.map((x) => Math.max(0, Math.min(len, dot(u, sub(x, a))))));
      const room = off + need + by.width / 2 + t.width / 2;
      const s1 = Math.min(...along) - room;
      const s2 = Math.max(...along) + room;
      const on = (s: number): P2 => [q(a[0] + u[0] * s), q(a[1] + u[1] * s)];
      const split = [...t.pts.slice(0, i + 1), ...(s1 > 0.05 ? [on(s1)] : []), ...(s2 < len - 0.05 ? [on(s2)] : []), ...t.pts.slice(i + 1)];
      const at = i + (s1 > 0.05 ? 1 : 0);
      let done = false;
      for (let k = 0; k < 8 && !done; k += 1) {
        const slid = slidePiece(split, at, [n[0] * side * off, n[1] * side * off]);
        if (!slid) return false;
        // The slid piece is the one lying on the line it was sent to.
        const target = dot(n, a) + side * off;
        const piece = piecesOf({ pts: slid.pts, width: t.width }).find((p) => p.pts.every((x) => Math.abs(dot(n, x) - target) < 1e-4));
        const g = piece ? Math.min(...mine.map((m) => gap(m, piece))) : need;
        if (g >= need - 1e-6) done = true;
        else off += need - g + 0.01;
      }
      if (!done) return false;
      const cut = { ...cur, board: { ...board, tracks: board.tracks.map((x) => (x === t ? { ...t, pts: split } : x)) } };
      const next = slideTrack(cut, t.id, at, [n[0] * side * off, n[1] * side * off]);
      if (next === cut) return false;
      cur = next;
      pushed.add(t.id);
    }
    // What moved now pushes what it has come too close to.
    for (const id of pushed) {
      const t = cur.board!.tracks.find((x) => x.id === id);
      if (t && !push(t, level + 1)) return false;
    }
    return true;
  };

  if (!push(run, 1)) return null;
  const board = cur.board!;
  if (board === start) return cur;
  // Every clearance kept: each track and via that moved is measured like one drawn by hand, with the new run there.
  const temp: Track = { id: "new-run", net: run.net, layer: run.layer, width: run.width, pts: run.pts };
  const copper = copperOf({ ...cur, board: { ...board, tracks: [...board.tracks, temp] } }, pads);
  const was = new Map(start.tracks.map((t) => [t.id, t]));
  for (const t of board.tracks) {
    if (was.get(t.id) === t) continue;
    const others = copper.filter((c) => c.id !== t.id);
    if (blockers(board, others, loops, { net: t.net, layers: [t.layer], pts: t.pts, width: t.width }).length) return null;
  }
  const vias = new Map(start.vias.map((v) => [v.id, v]));
  for (const v of board.vias) {
    if (vias.get(v.id) === v) continue;
    const mine = copper.find((c) => c.id === v.id);
    const others = copper.filter((c) => c.id !== v.id);
    if (mine && blockers(board, others, loops, { net: v.net, layers: mine.layers, pts: [[v.x, v.y]], width: v.diameter }).length) return null;
  }
  return cur;
}

// ---------------------------------------------------------------- length

/** How much track a net has, mm. Vias add nothing. */
export const netLength = (d: ElectronicsDesign, net: string): number =>
  (d.board?.tracks ?? []).reduce((n, t) => (t.net === net ? n + trackLength(t.pts) : n), 0);

/** What a 45° corner of size 1 costs a wiggle against a square one, mm. */
const CORNER = 4 * (2 - Math.SQRT2);
/** The tallest wiggle, mm. */
const TALLEST = 3;

/**
 * Wiggles along the piece `a`-`b` that make it `extra` longer: flat-topped bumps with upright sides and 45° corners,
 * all to one side. Null when the piece is too short to hold them.
 */
export function wiggles(a: P2, b: P2, extra: number, width: number, side: 1 | -1 = 1): P2[] | null {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (extra <= 1e-6 || len < 1e-6) return null;
  const flat = Math.max(2 * width, 0.4);
  let corner = flat / 2;
  const count = Math.max(1, Math.ceil(extra / (2 * TALLEST - CORNER * corner) - 1e-9));
  // Each bump adds twice its height, less what its four corners cut off.
  let h = (extra / count + CORNER * corner) / 2;
  if (h < 2 * corner) {
    // Too low for upright sides: the corners meet, and the sides are 45° all the way.
    h = extra / count / (2 - CORNER / 2);
    corner = h / 2;
  }
  const each = 4 * corner + 2 * flat;
  if (count * each > len + 1e-9) return null;
  const u: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: P2 = [-u[1] * side, u[0] * side];
  const at = (s: number, up: number): P2 => [q(a[0] + u[0] * s + n[0] * up), q(a[1] + u[1] * s + n[1] * up)];
  const out: P2[] = [a];
  let s = (len - count * each + flat) / 2;
  const c = corner;
  for (let k = 0; k < count; k += 1) {
    out.push(
      at(s, 0),
      at(s + c, c),
      at(s + c, h - c),
      at(s + 2 * c, h),
      at(s + 2 * c + flat, h),
      at(s + 3 * c + flat, h - c),
      at(s + 3 * c + flat, c),
      at(s + 4 * c + flat, 0),
    );
    s += each;
  }
  out.push(b);
  return tidyRun(out);
}

export type Tuned = { design: ElectronicsDesign; length: number } | { why: string };

/**
 * Makes a net `target` mm long by putting wiggles in one of its tracks (#646): in its longest straight piece, or the
 * one asked for. The wiggles go on whichever side has room.
 */
export function tuneLength(d: ElectronicsDesign, id: Id, target: number, piece?: number, pads: BoardPad[] = boardPads(d)): Tuned {
  const board = d.board;
  const t = board?.tracks.find((x) => x.id === id);
  if (!board || !t) return { why: "Pick a track first." };
  const now = netLength(d, t.net);
  const extra = target - now;
  if (extra <= 1e-3) return { why: `It is ${Math.round(now * 100) / 100} mm long already. Tuning only makes a net longer.` };
  const lengths = t.pts.slice(1).map((p, i) => Math.hypot(p[0] - t.pts[i]![0], p[1] - t.pts[i]![1]));
  const order = piece !== undefined ? [piece] : lengths.map((_, i) => i).sort((x, y) => lengths[y]! - lengths[x]!);
  const copper = copperOf(d, pads).filter((c) => c.id !== t.id);
  const loops = edgeLoops(board);
  let fits = false;
  for (const i of order) {
    for (const side of [1, -1] as const) {
      const w = wiggles(t.pts[i]!, t.pts[i + 1]!, extra, t.width, side);
      if (!w) continue;
      fits = true;
      const pts = tidyRun([...t.pts.slice(0, i), ...w, ...t.pts.slice(i + 2)]);
      if (blockers(board, copper, loops, { net: t.net, layers: [t.layer], pts, width: t.width }).length) continue;
      const design = { ...d, board: { ...board, tracks: board.tracks.map((x) => (x === t ? { ...t, pts } : x)) } };
      return { design, length: netLength(design, t.net) };
    }
  }
  return { why: fits ? "No room for the wiggles beside this track." : "This track has no straight piece long enough for the wiggles." };
}

// ---------------------------------------------------------------- pairs

const ENDS: [string, string][] = [
  ["+", "-"],
  ["_P", "_N"],
  ["DP", "DM"],
  ["P", "N"],
];

/** The net that makes a pair with this one, by its name: D+ and D-, USB_P and USB_N, DP and DM. */
export function pairOf(net: string, nets: string[]): string | null {
  for (const [x, y] of ENDS)
    for (const [mine, other] of [
      [x, y],
      [y, x],
    ] as const) {
      const base = net.slice(0, net.length - mine.length);
      if (base && net.toUpperCase().endsWith(mine)) {
        const found = nets.find((n) => n !== net && n.toUpperCase() === (base + other).toUpperCase());
        if (found) return found;
      }
    }
  return null;
}

/**
 * A run moved sideways by `d` (to the left of the way it goes; negative for the right), its corners mitred so it
 * stays `d` from the first all the way round. Null when a piece is too short for the corner to turn inside it.
 */
export function offsetRun(pts: P2[], d: number): P2[] | null {
  const run = tidyRun(pts);
  if (run.length < 2) return null;
  const normal = (a: P2, b: P2): P2 => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  const ns = run.slice(1).map((b, i) => normal(run[i]!, b));
  const out: P2[] = run.map((p, i) => {
    const n1 = ns[Math.max(0, i - 1)]!;
    const n2 = ns[Math.min(ns.length - 1, i)]!;
    const k = 1 + dot(n1, n2);
    if (k < 1e-6) return [NaN, NaN];
    return [p[0] + ((n1[0] + n2[0]) * d) / k, p[1] + ((n1[1] + n2[1]) * d) / k];
  });
  for (let i = 0; i + 1 < out.length; i += 1) {
    const way = dot(sub(out[i + 1]!, out[i]!), sub(run[i + 1]!, run[i]!));
    if (!(way > 1e-9)) return null;
  }
  return out.map((p) => [q(p[0]), q(p[1])]);
}

/** A pad joined to a run that starts beside it: across at 45° onto the run's first piece. */
function fan(pad: P2, run: P2[]): P2[] {
  const a = run[0]!;
  const b = run[1]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const along = dot(u, sub(pad, a));
  const across = Math.abs(dot([-u[1], u[0]], sub(pad, a)));
  const t = Math.min(len, Math.max(0, along) + across);
  return [pad, [q(a[0] + u[0] * t), q(a[1] + u[1] * t)], ...run.slice(1)];
}

export interface PairEnd {
  from: P2;
  /** Where this track of the pair lands, once the pair has got there. */
  to?: P2;
}

/**
 * The two tracks of a pair (#646), laid either side of a centre line, `pitch` apart centre to centre. They keep that
 * distance round every corner. Each starts on its own pad and comes across at 45° to its place beside the centre
 * line, and leaves the same way for the pad it lands on. Null when a corner is too tight for the inner track.
 */
export function pairRuns(centre: P2[], pitch: number, a: PairEnd, b: PairEnd): { a: P2[]; b: P2[] } | null {
  const mid = tidyRun(centre);
  if (mid.length < 2) return null;
  const left = offsetRun(mid, pitch / 2);
  const right = offsetRun(mid, -pitch / 2);
  if (!left || !right) return null;
  const first = sub(mid[1]!, mid[0]!);
  const cross = (p: P2) => first[0] * (p[1] - mid[0]![1]) - first[1] * (p[0] - mid[0]![0]);
  const aLeft = cross(a.from) >= cross(b.from);
  const lay = (run: P2[], end: PairEnd): P2[] => {
    const inward = tidyRun(fan(end.from, run));
    return end.to && inward.length > 1 ? tidyRun(fan(end.to, [...inward].reverse()).reverse()) : inward;
  };
  return { a: lay(aLeft ? left : right, a), b: lay(aLeft ? right : left, b) };
}

/** Lays, or lays again, the two tracks of a pair under the ids given, so a pair routed click by click stays two tracks. */
export function layPair(
  d: ElectronicsDesign,
  ids: [Id, Id],
  nets: [string, string],
  layer: CopperLayer,
  runs: { a: P2[]; b: P2[] },
  width: number,
): ElectronicsDesign {
  const board = d.board;
  if (!board) return d;
  return {
    ...d,
    board: {
      ...board,
      tracks: [
        ...board.tracks.filter((t) => !ids.includes(t.id)),
        { id: ids[0], net: nets[0], layer, width, pts: tidyRun(runs.a) },
        { id: ids[1], net: nets[1], layer, width, pts: tidyRun(runs.b) },
      ],
    },
  };
}
