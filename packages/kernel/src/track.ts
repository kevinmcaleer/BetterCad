import type { Geo } from "./construct";
import type { ConstructRef } from "./construct";
import type { Mat4 } from "./pose";

/**
 * Tracks (a tank tread, a chain): one piece repeated round two or more wheels, each piece joined to the next at its
 * pivots, the last back to the first. The pivots lie on a loop that wraps the wheels' round edges `lift` mm outside
 * them, as a belt goes round pulleys: the circles' convex hull. Ported from the kevsrobots Projects 2.0 scene editor.
 *
 * Each piece is placed so its start pivot sits on the loop and its end pivot on the next piece's start pivot (a chord
 * of the loop, the pieces being rigid), the line through its pins along the wheels' axle. Units are mm.
 */

type V3 = [number, number, number];
export type P2 = [number, number];

/** A Track's settings (Pattern's Track kind), kept on its step. */
export interface TrackSpec {
  /** How many pieces go round, the piece itself counted. */
  count: number;
  /** Round edges (or round faces) on the piece: the pins or holes where it joins the piece before, and the one after. */
  start?: ConstructRef;
  end?: ConstructRef;
  /** A round edge or face on each wheel it goes round. */
  wheels: ConstructRef[];
  /** Mm the pieces are moved on round the loop (lines teeth up with holes). */
  offset: number;
  /** Mm the pivots sit outside the wheels' round edges. */
  lift: number;
  /** Mm along the axle, from the first wheel's round edge. */
  side: number;
  /** Turned over: the piece's other side faces the wheels. */
  flip?: boolean;
}

/** The most pieces a track may have (the pattern limit, as each is its own body). */
export const MAX_TRACK_PIECES = 100;

export const TRACK_DEFAULTS: TrackSpec = { count: 0, wheels: [], offset: 0, lift: 0, side: 0 };

/** A wheel's circle in the world: centre, axle, radius. */
export interface WorldCircle {
  centre: V3;
  normal: V3;
  radius: number;
}

/** A piece's pivots in the world: where it joins the piece before, the piece after, and the way its pins run. */
export interface Pivots {
  start: V3;
  end: V3;
  axis: V3;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));

/** A circle as a pivot: its centre and axis, from a round edge or face. Null for anything else. */
export function circleOf(g: Geo | string | undefined): WorldCircle | null {
  if (!g || typeof g === "string" || g.t !== "circle" || !(g.radius > 0)) return null;
  return { centre: [...g.centre] as V3, normal: unit([...g.axis] as V3), radius: g.radius };
}

/**
 * The loop round the circles, as a belt goes round pulleys: their convex hull, as a polygon (anticlockwise), fine
 * enough that its chords are a hair from the true curve.
 */
export function wrapLoop(circles: { x: number; y: number; r: number }[], steps = 360): P2[] {
  const pts: P2[] = [];
  for (const c of circles) {
    if (!(c.r > 0)) {
      pts.push([c.x, c.y]);
      continue;
    }
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      pts.push([c.x + Math.cos(a) * c.r, c.y + Math.sin(a) * c.r]);
    }
  }
  return convexHull(pts);
}

/** Andrew's monotone chain: the hull, anticlockwise, without repeats. */
function convexHull(points: P2[]): P2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const turn = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** How far round a closed loop is. */
export function loopLength(loop: P2[]): number {
  let l = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    l += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return l;
}

/** A place on the loop: the segment it's on (from point `seg`), how far along it (0 to 1), and the point. */
interface At {
  seg: number;
  t: number;
  p: P2;
}

function pointAt(loop: P2[], dist: number): At {
  const L = loopLength(loop);
  let d = ((dist % L) + L) % L;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    const s = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= s || i === loop.length - 1) {
      const t = s > 0 ? Math.min(1, d / s) : 0;
      return { seg: i, t, p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
    }
    d -= s;
  }
  return { seg: 0, t: 0, p: loop[0]! };
}

/** The next place round the loop exactly `pitch` from `from` in a straight line, and the length of loop passed. */
function nextPivot(loop: P2[], from: At, pitch: number): { at: At; run: number } {
  const n = loop.length;
  const P = from.p;
  let run = 0;
  let seg = from.seg;
  let t0 = from.t;
  for (let k = 0; k <= n; k++) {
    const a = loop[seg]!;
    const b = loop[(seg + 1) % n]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const s = Math.hypot(dx, dy);
    // |a + t·(b − a) − P| = pitch, for t past t0: the far root.
    const fx = a[0] - P[0];
    const fy = a[1] - P[1];
    const A = dx * dx + dy * dy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - pitch * pitch;
    const disc = B * B - 4 * A * C;
    if (A > 0 && disc >= 0) {
      const t = (-B + Math.sqrt(disc)) / (2 * A);
      if (t >= t0 - 1e-9 && t <= 1 + 1e-9) {
        const tt = Math.max(t0, Math.min(1, t));
        run += (tt - t0) * s;
        return { at: { seg, t: tt, p: [a[0] + dx * tt, a[1] + dy * tt] }, run };
      }
    }
    run += (1 - t0) * s;
    seg = (seg + 1) % n;
    t0 = 0;
  }
  return { at: from, run };
}

export interface ChainLayout {
  /** Each piece's start pivot; piece i's end pivot is piece i+1's start (the last's, the first's). */
  pivots: P2[];
  /** How far round the loop is. */
  length: number;
  /** How many pieces go round exactly (a fraction): the count that makes the track neither tight nor slack. */
  fits: number;
}

/** Pivots for `count` pieces `pitch` apart round the loop, the first `offset` along it. */
export function layChain(loop: P2[], pitch: number, count: number, offset: number): ChainLayout {
  const length = loopLength(loop);
  if (loop.length < 3 || !(pitch > 0) || !(length > 0)) return { pivots: [], length, fits: 0 };
  const first = pointAt(loop, offset);
  const pivots: P2[] = [first.p];
  let at = first;
  for (let i = 1; i < count; i++) {
    at = nextPivot(loop, at, pitch).at;
    pivots.push(at.p);
  }
  // How many fit: step round once from the first, counting.
  let gone = 0;
  let fits = 0;
  at = first;
  for (let i = 0; i < 4000; i++) {
    const step = nextPivot(loop, at, pitch);
    if (!(step.run > 0)) break;
    if (gone + step.run >= length) {
      fits = i + (length - gone) / step.run;
      break;
    }
    gone += step.run;
    at = step.at;
  }
  return { pivots, length, fits };
}

/** The distance between a piece's pivots, across its pins. */
export function trackPitch(p: Pivots): number {
  const a = unit(p.axis);
  const d = sub(p.end, p.start);
  return len(sub(d, mul(a, dot(d, a))));
}

/** The piece's own directions: along it (start to end), its pins, and the side that faces the wheels. */
export function pieceFrame(p: Pivots): { d: V3; a: V3; o: V3 } {
  const a = unit(p.axis);
  const d0 = sub(p.end, p.start);
  const d = unit(sub(d0, mul(a, dot(d0, a))));
  return { d, a, o: cross(a, d) };
}

export interface TrackLayout extends ChainLayout {
  /** Each piece's move from where the piece is to its place on the track, column-major. */
  pieces: Mat4[];
  pitch: number;
}

/** A column-major 4 × 4 from a 3 × 3 (rows) and a move. */
function mat(r: number[][], t: V3): Mat4 {
  return [r[0]![0]!, r[1]![0]!, r[2]![0]!, 0, r[0]![1]!, r[1]![1]!, r[2]![1]!, 0, r[0]![2]!, r[1]![2]!, r[2]![2]!, 0, t[0], t[1], t[2], 1];
}

/** Where every piece of the track goes round the wheels' circles: each piece's move from where it is now. */
export function layTrack(t: Pick<TrackSpec, "count" | "offset" | "lift" | "side" | "flip">, piece: Pivots, wheels: WorldCircle[]): TrackLayout {
  const pitch = trackPitch(piece);
  const empty: TrackLayout = { pieces: [], pivots: [], length: 0, fits: 0, pitch };
  if (wheels.length < 2 || !(pitch > 0.01)) return empty;
  // The plane the track runs in: the first wheel's round edge, as in the kevsrobots scene editor; Sideways moves it.
  const W = unit(wheels[0]!.normal);
  const O = wheels[0]!.centre;
  let u = cross([1, 0, 0], W);
  if (len(u) < 1e-3) u = cross([0, 1, 0], W);
  u = unit(u);
  const v = cross(W, u);
  const circles = wheels.map((w) => {
    const c = sub(w.centre, O);
    return { x: dot(c, u), y: dot(c, v), r: Math.max(0, w.radius + t.lift) };
  });
  const loop = wrapLoop(circles);
  const count = Math.max(1, Math.min(MAX_TRACK_PIECES, Math.round(t.count)));
  const chain = layChain(loop, pitch, count, t.offset);
  if (!chain.pivots.length) return { ...empty, length: chain.length };
  const to3 = (p: P2): V3 => add(add(add(O, mul(u, p[0])), mul(v, p[1])), mul(W, t.side));
  const own = pieceFrame(piece);
  const n = chain.pivots.length;
  // Turned over, a piece stays where it was along the axle: its pins turn end for end about the start pivot.
  const pieces = chain.pivots.map((p, i) => {
    const P = to3(p);
    const next = n > 1 ? to3(chain.pivots[(i + 1) % n]!) : add(P, u);
    const d = unit(sub(next, P));
    // Its pins along the axle; the loop runs anticlockwise about W, so W × d points in, at the wheels.
    const a = t.flip ? mul(W, -1) : W;
    const o = cross(a, d);
    // R takes the piece's own directions (d, a, o) to the new ones: R = [d a o] · [d a o]ᵀ of the piece.
    const R = [0, 1, 2].map((r) => [0, 1, 2].map((c) => d[r] * own.d[c]! + a[r] * own.a[c]! + o[r] * own.o[c]!));
    const Rs: V3 = [0, 1, 2].map((r) => dot(R[r] as V3, piece.start)) as V3;
    return mat(R, sub(P, Rs));
  });
  return { pieces, pivots: chain.pivots, length: chain.length, fits: chain.fits, pitch };
}

/** Why a track can't be laid as set, or null. */
export function trackProblem(t: TrackSpec | undefined, parts: number): string | null {
  if (parts !== 1) return "Pick one body: the track piece";
  if (!t?.start || !t.end) return "Pick the pins at both ends of the piece";
  if (t.wheels.length < 2) return "Pick a round edge on two or more wheels";
  if (!Number.isInteger(t.count) || t.count < 2) return "Give it 2 or more pieces";
  if (t.count > MAX_TRACK_PIECES) return `That's more than ${MAX_TRACK_PIECES} pieces. Use fewer.`;
  return null;
}

/**
 * A track laid round its wheels where they are now: `resolve` finds a pick where it stands. A message when a pick is
 * gone or the track can't be laid.
 */
export function trackLayoutOf(t: TrackSpec, resolve: (r: ConstructRef) => Geo | string): TrackLayout | string {
  const s = t.start && circleOf(resolve(t.start));
  const e = t.end && circleOf(resolve(t.end));
  if (!s || !e) return "The pins it joins at are gone";
  const wheels: WorldCircle[] = [];
  for (const w of t.wheels) {
    const c = circleOf(resolve(w));
    if (!c) return "A wheel it goes round is gone";
    wheels.push(c);
  }
  const piece = { start: s.centre, end: e.centre, axis: s.normal };
  if (!(trackPitch(piece) > 0.5)) return "Its two pins are on the same line. Pick the pin at the piece's other end.";
  const lay = layTrack(t, piece, wheels);
  return lay.pieces.length ? lay : "It can't go round those wheels";
}
