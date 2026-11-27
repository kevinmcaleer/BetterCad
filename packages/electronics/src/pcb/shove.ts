import { boardPads, type BoardPad } from "../board";
import { q } from "../geom";
import type { CopperLayer, ElectronicsDesign, Id, P2 } from "../model";
import { copperOf, edgeLoops } from "./copper";
import { blockers, tidyRun, trackLength } from "./route";
import { bulgeOf, curved, trackPath } from "../trackArcs";

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: P2, b: P2): number => a[0] * b[0] + a[1] * b[1];

/**
 * Routing for tighter boards (#646): wiggles that make a net a set length, and two tracks laid together at one gap.
 * Pushing other tracks aside is in `./push`, which loads with the router.
 */

// ---------------------------------------------------------------- length

/** How much track a net has, mm. Vias add nothing. */
export const netLength = (d: ElectronicsDesign, net: string): number =>
  (d.board?.tracks ?? []).reduce((n, t) => (t.net === net ? n + trackLength(t.pts, t.arcs) : n), 0);

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
      // Wiggles go on straight pieces only; a curved track (#755) keeps its other pieces' bulges.
      if (bulgeOf(t, i)) continue;
      const w = wiggles(t.pts[i]!, t.pts[i + 1]!, extra, t.width, side);
      if (!w) continue;
      fits = true;
      const bent = curved(t);
      const raw = [...t.pts.slice(0, i), ...w, ...t.pts.slice(i + 2)];
      const pts = bent ? raw : tidyRun(raw);
      const next = bent ? { ...t, pts, arcs: [...t.arcs!.slice(0, i), ...w.slice(1).map(() => 0), ...t.arcs!.slice(i + 1)] } : { ...t, pts };
      if (blockers(board, copper, loops, { net: t.net, layers: [t.layer], pts: trackPath(next), width: t.width }).length) continue;
      const design = { ...d, board: { ...board, tracks: board.tracks.map((x) => (x === t ? next : x)) } };
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
