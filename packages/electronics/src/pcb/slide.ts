import { q } from "../geom";
import type { ElectronicsDesign, Id, P2 } from "../model";
import { arcsIfAny } from "../trackArcs";

const same = (a: P2, b: P2): boolean => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/**
 * Slides one piece of a track sideways (#640). The piece stays parallel to itself, and the pieces either side keep
 * their own directions and grow or shrink to meet it, so 45° corners stay 45°. At an end of the track, which sits on
 * a pad or a via and must not move, a short piece at 45° is put in to reach the slid piece instead.
 *
 * `by` is how far the pointer has gone; only the part of it across the piece counts. Null when the piece cannot go
 * that far: a neighbour would have to turn back on itself, or the piece itself would.
 */
export function slidePiece(pts: P2[], i: number, by: P2, arcs?: number[]): { pts: P2[]; arcs?: number[]; moved: [P2, P2][] } | null {
  // Curved pieces (#755) keep their bulge as their ends move; a piece put in is straight.
  const bulge = (k: number) => (arcs && arcs.length === pts.length - 1 ? (arcs[k] ?? 0) : 0);
  const a = pts[i];
  const b = pts[i + 1];
  if (!a || !b) return null;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-9) return null;
  const u: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: P2 = [-u[1], u[0]];
  const off = by[0] * n[0] + by[1] * n[1];
  if (Math.abs(off) < 1e-9) return { pts, ...(arcs ? { arcs } : {}), moved: [] };
  // The slid piece lies on the line through `o` along `u`; places on it are measured from `o`.
  const o: P2 = [a[0] + n[0] * off, a[1] + n[1] * off];
  const on = (t: number): P2 => [q(o[0] + u[0] * t), q(o[1] + u[1] * t)];
  /** Where the line through `p` along `d` crosses the slid piece's line. Null when they run the same way. */
  const meet = (p: P2, d: P2): number | null => {
    const den = u[0] * d[1] - u[1] * d[0];
    return Math.abs(den) < 1e-9 ? null : ((p[0] - o[0]) * d[1] - (p[1] - o[1]) * d[0]) / den;
  };
  const dir = (from: P2 | undefined, to: P2): P2 | null => {
    if (!from) return null;
    const l = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return l < 1e-9 ? null : [(to[0] - from[0]) / l, (to[1] - from[1]) / l];
  };
  const moved: [P2, P2][] = [];
  const eps = 1e-9;

  const before = pts[i - 1];
  const dBefore = dir(before, a);
  let tA = dBefore && meet(before!, dBefore);
  // Each point with the bulge of the piece that starts at it.
  let head: [P2, number][];
  if (tA === null || tA === undefined) {
    // An end of the track, or a piece running the same way: the corner stays and a 45° piece reaches across.
    tA = Math.abs(off);
    head = pts.slice(0, i + 1).map((p, k) => [p, k < i ? bulge(k) : 0]);
  } else {
    const at = on(tA);
    if ((at[0] - before![0]) * dBefore![0] + (at[1] - before![1]) * dBefore![1] < -eps) return null;
    head = pts.slice(0, i).map((p, k) => [p, bulge(k)]);
    moved.push([a, at]);
  }

  const after = pts[i + 2];
  const dAfter = dir(b, after ?? b);
  let tB = after && dAfter ? meet(b, dAfter) : null;
  let tail: [P2, number][];
  let joinB = 0;
  if (tB === null) {
    tB = len - Math.abs(off);
    tail = pts.slice(i + 1).map((p, k) => [p, bulge(i + 1 + k)]);
  } else {
    const at = on(tB);
    if ((after![0] - at[0]) * dAfter![0] + (after![1] - at[1]) * dAfter![1] < -eps) return null;
    tail = pts.slice(i + 2).map((p, k) => [p, bulge(i + 2 + k)]);
    joinB = bulge(i + 1);
    moved.push([b, at]);
  }
  if (tB - tA < -eps) return null;

  const out: [P2, number][] = [];
  for (const e of [...head, [on(tA), bulge(i)] as [P2, number], [on(tB), joinB] as [P2, number], ...tail]) {
    // A point on top of the last: the piece between goes, and the last takes on the next piece's bulge.
    if (out.length && same(out[out.length - 1]![0], e[0])) out[out.length - 1]![1] = e[1];
    else out.push([e[0], e[1]]);
  }
  if (out.length < 2) return null;
  const kept = arcsIfAny(out.slice(0, -1).map((e) => e[1]));
  return { pts: out.map((e) => e[0]), ...(arcs ? kept : {}), moved };
}

/**
 * Slides a piece of a track on the board, as far towards `by` as it can go. Other tracks of the net that end on a
 * corner that moves, and a via sitting on one, go with it, so everything stays joined.
 */
export function slideTrack(d: ElectronicsDesign, id: Id, piece: number, by: P2): ElectronicsDesign {
  const board = d.board;
  const track = board?.tracks.find((t) => t.id === id);
  if (!board || !track) return d;
  let slid = slidePiece(track.pts, piece, by, track.arcs);
  if (!slid) {
    // Too far: find how far it can go, to within a few microns.
    let [lo, hi] = [0, 1];
    for (let k = 0; k < 14; k += 1) {
      const mid = (lo + hi) / 2;
      if (slidePiece(track.pts, piece, [by[0] * mid, by[1] * mid], track.arcs)) lo = mid;
      else hi = mid;
    }
    slid = lo > 0 ? slidePiece(track.pts, piece, [by[0] * lo, by[1] * lo], track.arcs) : null;
  }
  if (!slid || slid.pts === track.pts) return d;
  const { pts, arcs, moved } = slid;
  const to = (p: P2): P2 | undefined => moved.find(([from]) => same(from, p))?.[1];
  return {
    ...d,
    board: {
      ...board,
      tracks: board.tracks.map((t) => {
        if (t.id === id) {
          const next = { ...t, pts, ...(arcs ? { arcs } : {}) };
          if (!arcs) delete next.arcs;
          return next;
        }
        if (t.net !== track.net || t.layer !== track.layer || !moved.length) return t;
        const first = to(t.pts[0]!);
        const last = to(t.pts[t.pts.length - 1]!);
        return first || last ? { ...t, pts: t.pts.map((p, k) => (k === 0 && first ? first : k === t.pts.length - 1 && last ? last : p)) } : t;
      }),
      vias: board.vias.map((v) => {
        const at = v.net === track.net ? to([v.x, v.y]) : undefined;
        return at ? { ...v, x: at[0], y: at[1] } : v;
      }),
    },
  };
}
