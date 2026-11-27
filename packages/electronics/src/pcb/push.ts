/**
 * The router's push and walk (#646, #753). A track being laid pushes other nets' tracks and vias aside, and what moves
 * pushes in turn; where fixed copper (a pad, a plated hole, a keep-out, the board's edge) leaves no room, the track
 * walks round it instead. Dragging a piece of track pushes its neighbours the same way. Every result is measured with
 * `blockers`, as a track drawn by hand is, before it is given back.
 *
 * This loads with the route tool, so the board view's first paint does not carry it.
 */
import { boardPads, type BoardPad } from "../board";
import { q } from "../geom";
import { pointInPolygon } from "../outlineGeom";
import type { CopperLayer, ElectronicsDesign, Id, P2, Track, Via } from "../model";
import { clearanceBetween, copperOf, edgeLoops, gap, netRules, type Copper, type Layer, type Solid } from "./copper";
import { blockers, corner45, tidyRun } from "./route";
import { slidePiece, slideTrack } from "./slide";
import { viaLayers } from "./stack";

export interface Run {
  net: string;
  layer: CopperLayer;
  pts: P2[];
  width: number;
}

/** What pushes: a run of track, a via, or a track that was pushed and passes it on. */
interface Pusher {
  net: string;
  layers: Layer[];
  solids: Solid[];
  /** Itself, which it never pushes. */
  self?: Id;
}

const piecesOf = (r: Pick<Run, "pts" | "width">): Solid[] => r.pts.slice(1).map((b, i) => ({ pts: [r.pts[i]!, b], r: r.width / 2 }));
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: P2, b: P2): number => a[0] * b[0] + a[1] * b[1];
const same = (a: P2, b: P2): boolean => Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;

/** The point of piece `a`-`b` nearest to `p`. */
function nearestOn(p: P2, a: P2, b: P2): P2 {
  const d = sub(b, a);
  const l = dot(d, d);
  const t = l < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / l));
  return [a[0] + d[0] * t, a[1] + d[1] * t];
}

/** The nearest two points of two pieces that do not cross: one on each. A piece may be a single point. */
function nearest(a1: P2, a2: P2, b1: P2, b2: P2): [P2, P2] {
  const tries: [P2, P2][] = [
    [a1, nearestOn(a1, b1, b2)],
    [a2, nearestOn(a2, b1, b2)],
    [nearestOn(b1, a1, a2), b1],
    [nearestOn(b2, a1, a2), b2],
  ];
  return tries.reduce((best, t) => (Math.hypot(...sub(t[0], t[1])) < Math.hypot(...sub(best[0], best[1])) ? t : best));
}
const ends = (s: Solid): [P2, P2] => [s.pts[0]!, s.pts[1] ?? s.pts[0]!];

/** How many times a push may be passed on: the track you lay pushes one, which pushes the next. */
const DEPTH = 4;
/** Moves tried before giving up, over the whole push. */
const TRIES = 80;

const viaSolid = (v: Via): Solid => ({ pts: [[v.x, v.y]], r: v.diameter / 2 });
const trackPusher = (t: Track): Pusher => ({ net: t.net, layers: [t.layer], solids: piecesOf(t), self: t.id });

/**
 * Makes room for `by` by sliding other nets' tracks sideways and moving their vias (#646, #753). Each piece in the way
 * moves just far enough, parallel to itself; a via moves straight away, and its own tracks' ends go with it. What then
 * comes too close is pushed in turn. Pads, plated holes, text, keep-outs and the board's edge never move. Null when
 * there is no room. `moved` says which tracks and vias were moved, for the check after.
 */
function pushFrom(d: ElectronicsDesign, start: Pusher): { design: ElectronicsDesign; moved: Set<Id> } | null {
  let cur = d;
  let tries = 0;
  const moved = new Set<Id>();

  const push = (by: Pusher, level: number): boolean => {
    const mine = by.solids;
    const pushed: Pusher[] = [];
    /** How far piece `i` of `t` lies to one side of what pushes, at their nearest. */
    const sideOf = (t: Track, i: number): { lateral: number; best: number; r: number; side: number } => {
      const a = t.pts[i]!;
      const b = t.pts[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const n: P2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      let out = { lateral: 0, best: Infinity, r: 0, side: 0 };
      for (const m of mine) {
        const [m1, m2] = ends(m);
        const [pm, pt] = nearest(m1, m2, a, b);
        const dist = Math.hypot(pt[0] - pm[0], pt[1] - pm[1]);
        if (dist < out.best) {
          const l = dot(n, sub(pt, pm));
          out = { lateral: Math.abs(l), best: dist, r: m.r, side: Math.sign(l) };
        }
      }
      return out;
    };
    for (;;) {
      const board = cur.board!;
      let hitTrack: { t: Track; i: number; need: number } | undefined;
      let hitVia: { v: Via; need: number } | undefined;
      // Vias first: a track that ends on one is carried with it.
      for (const v of board.vias) {
        if (v.id === by.self || (v.net && v.net === by.net) || !viaLayers(board, v).some((l) => by.layers.includes(l))) continue;
        const need = clearanceBetween(board, by.net, v.net);
        if (mine.some((m) => gap(m, viaSolid(v)) < need - 1e-6)) {
          hitVia = { v, need };
          break;
        }
      }
      if (!hitVia)
        for (const t of board.tracks) {
          if (!by.layers.includes(t.layer) || t.id === by.self || (t.net && t.net === by.net)) continue;
          const need = clearanceBetween(board, by.net, t.net);
          const hits = piecesOf(t).flatMap((p, k) => (mine.some((m) => gap(m, p) < need - 1e-6) ? [k] : []));
          if (hits.length) {
            // Of the pieces too close, the one that lies most beside what pushes: a piece met end on has no side to go to.
            const i = hits.reduce((b, k) => (sideOf(t, k).lateral > sideOf(t, b).lateral ? k : b));
            hitTrack = { t, i, need };
            break;
          }
        }
      if (!hitTrack && !hitVia) break;
      if (level > DEPTH || (tries += 1) > TRIES) return false;

      if (hitVia) {
        // A via goes straight away from the nearest point of what pushes it, and its own tracks' ends go with it.
        const { v, need } = hitVia;
        const c: P2 = [v.x, v.y];
        let best: { p: P2; r: number; dist: number } | undefined;
        for (const m of mine) {
          const [a, b] = ends(m);
          const p = nearestOn(c, a, b);
          const dist = Math.hypot(c[0] - p[0], c[1] - p[1]);
          if (!best || dist < best.dist) best = { p, r: m.r, dist };
        }
        if (!best || best.dist < 1e-6) return false;
        const go = need + best.r + v.diameter / 2 - best.dist + 0.01;
        const by2: P2 = [((c[0] - best.p[0]) / best.dist) * go, ((c[1] - best.p[1]) / best.dist) * go];
        const to: P2 = [q(v.x + by2[0]), q(v.y + by2[1])];
        const nv = { ...v, x: to[0], y: to[1] };
        const tracks = board.tracks.map((t) => {
          if (t.net !== v.net) return t;
          const pts = t.pts.map((p, k) => ((k === 0 || k === t.pts.length - 1) && same(p, c) ? to : p));
          return pts.some((p, k) => p !== t.pts[k]) ? { ...t, pts } : t;
        });
        cur = { ...cur, board: { ...board, vias: board.vias.map((x) => (x === v ? nv : x)), tracks } };
        moved.add(v.id);
        pushed.push({ net: v.net, layers: viaLayers(board, v), solids: [viaSolid(nv)], self: v.id });
        tracks.forEach((t, k) => {
          if (t !== board.tracks[k]) {
            moved.add(t.id);
            pushed.push(trackPusher(t));
          }
        });
        continue;
      }

      const { t, i, need } = hitTrack!;
      const a = t.pts[i]!;
      const b = t.pts[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-9) return false;
      const n: P2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      // Which way is away: from the nearest point of what pushes to the nearest of this piece.
      const { lateral, best, r, side } = sideOf(t, i);
      // Crossing, or end to end on one line: no side to go to.
      if (!side || best < 1e-6) return false;
      let off = Math.ceil((need + r + t.width / 2 - Math.abs(lateral)) * 100) / 100 + 0.01;
      // Only the stretch beside what pushes moves, with room either end for the 45° pieces that reach across.
      const u: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const here: Solid = { pts: [a, b], r: t.width / 2 };
      const along = mine.filter((m) => gap(m, here) < need - 1e-6).flatMap((m) => m.pts.map((x) => Math.max(0, Math.min(len, dot(u, sub(x, a))))));
      const room = off + need + r + t.width / 2;
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
      // Whatever the slide carried with it (other tracks of the net, a via on a corner) has moved too.
      const was = new Map(board.tracks.map((x) => [x.id, x]));
      for (const x of next.board!.tracks) if (was.get(x.id) !== x) moved.add(x.id);
      const vias = new Map(board.vias.map((x) => [x.id, x]));
      for (const x of next.board!.vias) if (vias.get(x.id) !== x) moved.add(x.id);
      cur = next;
      const now = next.board!.tracks.find((x) => x.id === t.id)!;
      pushed.push(trackPusher(now));
    }
    // What moved now pushes what it has come too close to.
    for (const p of pushed) {
      // A track pushes from where it is now, which may have changed since.
      const t = cur.board!.tracks.find((x) => x.id === p.self);
      if (!push(t ? trackPusher(t) : p, level + 1)) return false;
    }
    return true;
  };
  return push(start, 1) ? { design: cur, moved } : null;
}

/** Whether everything that moved, and `extra` copper laid with it, keeps every clearance. */
function allClear(d: ElectronicsDesign, start: ElectronicsDesign, moved: Set<Id>, pads: BoardPad[], extra: Track[]): boolean {
  const board = d.board!;
  const loops = edgeLoops(board);
  const copper = copperOf({ ...d, board: { ...board, tracks: [...board.tracks, ...extra] } }, pads);
  const was = new Map(start.board!.tracks.map((t) => [t.id, t]));
  for (const t of [...board.tracks, ...extra]) {
    if (!moved.has(t.id) && was.get(t.id) === t && !extra.includes(t)) continue;
    const others = copper.filter((c) => c.id !== t.id);
    if (blockers(board, others, loops, { net: t.net, layers: [t.layer], pts: t.pts, width: t.width }).length) return false;
  }
  for (const v of board.vias) {
    if (!moved.has(v.id)) continue;
    const mine = copper.find((c) => c.id === v.id);
    const others = copper.filter((c) => c.id !== v.id);
    if (mine && blockers(board, others, loops, { net: v.net, layers: mine.layers, pts: [[v.x, v.y]], width: v.diameter }).length) return false;
  }
  return true;
}

/**
 * Makes room for a new run of track (#646, #753): other nets' tracks slide aside and their vias move, and what moves
 * pushes in turn. Null when there is no room. The new run is not laid in the design that comes back.
 */
export function shove(d: ElectronicsDesign, run: Run, pads: BoardPad[] = boardPads(d)): ElectronicsDesign | null {
  if (!d.board || run.pts.length < 2) return null;
  const made = pushFrom(d, { net: run.net, layers: [run.layer], solids: piecesOf(run) });
  if (!made) return null;
  if (made.design.board === d.board) return d;
  const temp: Track = { id: "new-run", net: run.net, layer: run.layer, width: run.width, pts: run.pts };
  return allClear(made.design, d, made.moved, pads, [temp]) ? made.design : null;
}

/**
 * Drags a piece of track sideways (#753), pushing what it comes too close to. The slide is worked out from the
 * design as it was when the piece was picked up. Gives back the design as it was when the slide or the push has
 * no room.
 */
export function dragPushing(d: ElectronicsDesign, id: Id, piece: number, by: P2, pads: BoardPad[] = boardPads(d)): ElectronicsDesign {
  const slid = slideTrack(d, id, piece, by);
  if (slid === d || !slid.board) return d;
  const t = slid.board.tracks.find((x) => x.id === id);
  if (!t) return d;
  const moved = new Set<Id>([id]);
  const was = new Map(d.board!.tracks.map((x) => [x.id, x]));
  for (const x of slid.board.tracks) if (was.get(x.id) !== x) moved.add(x.id);
  const made = pushFrom(slid, trackPusher(t));
  if (!made) return d;
  for (const m of moved) made.moved.add(m);
  return allClear(made.design, d, made.moved, pads, []) ? made.design : d;
}

// ---------------------------------------------------------------- walking round

/** The most grid cells a walk looks over, so one click never stalls the page. */
const CELLS = 60_000;
const MOVES: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * A way from `from` to `to` that walks round copper it may not touch (#753): straight runs and 45° corners, found on a
 * fine grid over the ground between the two and a margin, then pulled tight. Null when there is no way within that
 * ground. Pass the copper that stays put; anything of the run's own net is never in the way.
 */
export function walkRound(
  board: NonNullable<ElectronicsDesign["board"]>,
  copper: Copper[],
  run: { net: string; layer: Layer; width: number },
  from: P2,
  to: P2,
  margin = 6,
): P2[] | null {
  const loops = edgeLoops(board);
  // Only copper near the ground between the two ends can be in the way of a walk over it.
  const x0 = Math.min(from[0], to[0]) - margin - 3;
  const y0 = Math.min(from[1], to[1]) - margin - 3;
  const xe = Math.max(from[0], to[0]) + margin + 3;
  const ye = Math.max(from[1], to[1]) + margin + 3;
  const near = copper.filter((c) => {
    if (!c.layers.includes(run.layer)) return false;
    const xs = c.pts.map((p) => p[0]);
    const ys = c.pts.map((p) => p[1]);
    return Math.max(...xs) + c.r > x0 && Math.min(...xs) - c.r < xe && Math.max(...ys) + c.r > y0 && Math.min(...ys) - c.r < ye;
  });
  const clear = (pts: P2[]) => !blockers(board, near, loops, { net: run.net, layers: [run.layer], pts, width: run.width }).length;
  const straight = corner45(from, to);
  if (clear(straight)) return straight;
  const rules = netRules(board, run.net);
  const pitch0 = Math.max(0.05, Math.min(rules.clearance, run.width) / 2);
  const x1 = Math.min(from[0], to[0]) - margin;
  const y1 = Math.min(from[1], to[1]) - margin;
  const w0 = Math.max(from[0], to[0]) + margin - x1;
  const h0 = Math.max(from[1], to[1]) + margin - y1;
  const pitch = Math.max(pitch0, Math.sqrt((w0 * h0) / CELLS));
  // The grid is laid from `from`, so the walk starts exactly on it.
  const ox = from[0] - Math.ceil((from[0] - x1) / pitch) * pitch;
  const oy = from[1] - Math.ceil((from[1] - y1) / pitch) * pitch;
  const nx = Math.ceil(w0 / pitch) + 2;
  const ny = Math.ceil(h0 / pitch) + 2;
  const at = (i: number, j: number): P2 => [ox + i * pitch, oy + j * pitch];
  // Each piece of copper marks the cells too close to it, looking only at the cells round it.
  const blocked = new Uint8Array(nx * ny);
  const r = run.width / 2;
  const mark = (s: Solid, need: number) => {
    const reach = s.r + need + r;
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1]);
    const i1 = Math.max(0, Math.floor((Math.min(...xs) - reach - ox) / pitch));
    const i2 = Math.min(nx - 1, Math.ceil((Math.max(...xs) + reach - ox) / pitch));
    const j1 = Math.max(0, Math.floor((Math.min(...ys) - reach - oy) / pitch));
    const j2 = Math.min(ny - 1, Math.ceil((Math.max(...ys) + reach - oy) / pitch));
    for (let j = j1; j <= j2; j += 1)
      for (let i = i1; i <= i2; i += 1) {
        const k = j * nx + i;
        if (!blocked[k] && gap({ pts: [at(i, j)], r }, s) < need - 1e-6) blocked[k] = 1;
      }
  };
  for (const c of near) if (!(c.net && c.net === run.net)) mark(c, clearanceBetween(board, run.net, c.net));
  // The board's edge is a wall: a walk that starts on the board stays on it.
  for (const loop of loops) for (let k = 0; k < loop.length; k += 1) mark({ pts: [loop[k]!, loop[(k + 1) % loop.length]!], r: 0 }, board.rules.copperToEdge);
  for (const k of board.keepouts ?? [])
    if (k.tracks) {
      for (let e = 0; e < k.outline.length; e += 1) mark({ pts: [k.outline[e]!, k.outline[(e + 1) % k.outline.length]!], r: 0 }, 0.001);
      const xs = k.outline.map((p) => p[0]);
      const ys = k.outline.map((p) => p[1]);
      for (let j = Math.max(0, Math.floor((Math.min(...ys) - oy) / pitch)); j <= Math.min(ny - 1, Math.ceil((Math.max(...ys) - oy) / pitch)); j += 1)
        for (let i = Math.max(0, Math.floor((Math.min(...xs) - ox) / pitch)); i <= Math.min(nx - 1, Math.ceil((Math.max(...xs) - ox) / pitch)); i += 1)
          if (pointInPolygon(at(i, j), k.outline)) blocked[j * nx + i] = 1;
    }
  const si = Math.round((from[0] - ox) / pitch);
  const sj = Math.round((from[1] - oy) / pitch);
  const ti = Math.round((to[0] - ox) / pitch);
  const tj = Math.round((to[1] - oy) / pitch);
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny;
  if (!inside(ti, tj)) return null;
  // The two ends sit on their own net's copper, which may read as too close to a neighbour's: they are always open.
  blocked[sj * nx + si] = 0;
  blocked[tj * nx + ti] = 0;
  // A* over eight ways, with a small cost on each turn so the walk keeps to few corners.
  const n = nx * ny;
  const cost = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const way = new Int8Array(n).fill(-1);
  const h = (i: number, j: number) => {
    const dx = Math.abs(i - ti);
    const dy = Math.abs(j - tj);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap: [number, number][] = [];
  const pushHeap = (f: number, k: number) => {
    heap.push([f, k]);
    let c = heap.length - 1;
    while (c > 0) {
      const pa = (c - 1) >> 1;
      if (heap[pa]![0] <= heap[c]![0]) break;
      [heap[pa], heap[c]] = [heap[c]!, heap[pa]!];
      c = pa;
    }
  };
  const popHeap = (): number => {
    const top = heap[0]![1];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const rr = l + 1;
        let m = c;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (rr < heap.length && heap[rr]![0] < heap[m]![0]) m = rr;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c]!, heap[m]!];
        c = m;
      }
    }
    return top;
  };
  const s = sj * nx + si;
  const goal = tj * nx + ti;
  cost[s] = 0;
  pushHeap(h(si, sj), s);
  while (heap.length) {
    const k = popHeap();
    if (k === goal) break;
    const i = k % nx;
    const j = (k - i) / nx;
    for (let m = 0; m < 8; m += 1) {
      const [di, dj] = MOVES[m]!;
      const a = i + di;
      const b = j + dj;
      if (!inside(a, b)) continue;
      const kk = b * nx + a;
      // A diagonal step may not cut the corner between two blocked cells.
      if (blocked[kk] || (di && dj && blocked[j * nx + a] && blocked[b * nx + i])) continue;
      const c = cost[k]! + (di && dj ? Math.SQRT2 : 1) + (way[k] >= 0 && way[k] !== m ? 0.5 : 0);
      if (c < cost[kk]!) {
        cost[kk] = c;
        came[kk] = k;
        way[kk] = m;
        pushHeap(c + h(a, b), kk);
      }
    }
  }
  if (came[goal] < 0) return null;
  const cells: P2[] = [];
  for (let k = goal; k >= 0; k = came[k]!) cells.push(at(k % nx, (k - (k % nx)) / nx));
  cells.reverse();
  const raw = tidyRun([from, ...cells.slice(1, -1).map((p): P2 => [q(p[0]), q(p[1])]), to]);
  // Pulled tight: from each corner, the furthest one a straight run or one 45° corner reaches clear.
  const out: P2[] = [raw[0]!];
  let i = 0;
  while (i < raw.length - 1) {
    let next = i + 1;
    let hop: P2[] = [raw[i]!, raw[i + 1]!];
    for (let j = raw.length - 1; j > i + 1; j -= 1) {
      const found = [corner45(raw[i]!, raw[j]!), corner45(raw[i]!, raw[j]!, true)].find(clear);
      if (found) {
        next = j;
        hop = found;
        break;
      }
    }
    out.push(...hop.slice(1));
    i = next;
  }
  const pts = tidyRun(out);
  return clear(pts) ? pts : null;
}

/**
 * The way a track goes on to `to` (#753): straight on if it can, else pushing other tracks and vias aside, else
 * walking round what stays put. `pushed` is the design with the others moved, when they were.
 */
export function routeOn(
  d: ElectronicsDesign,
  run: { net: string; layer: CopperLayer; width: number },
  from: P2,
  to: P2,
  opts: { push: boolean; walk: boolean; diag?: boolean },
  pads: BoardPad[] = boardPads(d),
): { pts: P2[]; pushed?: ElectronicsDesign } | null {
  const board = d.board;
  if (!board) return null;
  const copper = copperOf(d, pads);
  const loops = edgeLoops(board);
  const clear = (pts: P2[]) => !blockers(board, copper, loops, { net: run.net, layers: [run.layer], pts, width: run.width }).length;
  const tries = [corner45(from, to, !!opts.diag), corner45(from, to, !opts.diag)];
  for (const pts of tries) if (clear(pts)) return { pts };
  if (opts.push)
    for (const pts of tries) {
      const made = shove(d, { ...run, pts }, pads);
      if (made && made !== d) return { pts, pushed: made };
    }
  if (!opts.walk) return null;
  // Round everything: first what can't move, pushing the rest aside; then round everything as it stands.
  if (opts.push) {
    const fixed = copper.filter((c) => c.kind === "pad" || c.kind === "text" || (c.kind === "via" && !board.vias.some((v) => v.id === c.id)));
    const pts = walkRound(board, fixed, run, from, to);
    if (pts) {
      if (clear(pts)) return { pts };
      const made = shove(d, { ...run, pts }, pads);
      if (made && made !== d) return { pts, pushed: made };
    }
  }
  const pts = walkRound(board, copper, run, from, to);
  return pts ? { pts } : null;
}
