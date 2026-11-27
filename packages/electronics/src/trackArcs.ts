import { q } from "./geom";
import type { P2, Track } from "./model";
import { arcOf } from "./outlineGeom";

/**
 * Curved tracks (#755). A track is still a run of points; `arcs` gives each piece between two points a bulge, as an
 * outline's corners do (DXF's: tan of a quarter of the turn, positive anticlockwise, 0 straight). Moving a piece's ends
 * keeps how far round it turns. Everything that only needs the shape (the board check, pours, the router, drawing)
 * reads `trackPath`, the curve cut into short chords; Gerber, KiCad and Eagle write the arcs as arcs.
 */
type Arcs = Pick<Track, "pts" | "arcs">;

/** Whether the bulges line up with the pieces: a list of another length is ignored, and the track is straight. */
const fits = (t: Arcs): t is Arcs & { arcs: number[] } => !!t.arcs && t.arcs.length === t.pts.length - 1;

/** The bulge of piece `i`; 0 when it is straight. */
export const bulgeOf = (t: Arcs, i: number): number => (fits(t) ? (t.arcs[i] ?? 0) : 0);

/** Whether any piece of a track is curved. */
export const curved = (t: Arcs): boolean => fits(t) && t.arcs.some((b) => Math.abs(b) > 1e-9);

/** The circle a curved piece lies on. Null: it is straight. */
export const arcOn = (a: P2, b: P2, bulge: number) => (Math.abs(bulge) > 1e-9 ? arcOf({ x: a[0], y: a[1], bulge }, { x: b[0], y: b[1] }) : null);

/** The points inside a curved piece, `sag` mm off the true curve at most. None for a straight one. */
export function arcPoints(a: P2, b: P2, bulge: number, sag = 0.005): P2[] {
  const arc = arcOn(a, b, bulge);
  if (!arc) return [];
  const n = Math.min(128, Math.max(2, Math.ceil(Math.abs(arc.sweep) / (2 * Math.acos(Math.max(0, 1 - sag / arc.r))))));
  const out: P2[] = [];
  for (let k = 1; k < n; k += 1) {
    const t = arc.a0 + (arc.sweep * k) / n;
    out.push([q(arc.cx + arc.r * Math.cos(t)), q(arc.cy + arc.r * Math.sin(t))]);
  }
  return out;
}

/** A track's shape as straight pieces: its own points, with each arc cut into short chords. */
export function trackPath(t: Arcs, sag?: number): P2[] {
  if (!curved(t)) return t.pts;
  const out: P2[] = [];
  t.pts.forEach((p, i) => {
    out.push(p);
    const next = t.pts[i + 1];
    if (next) out.push(...arcPoints(p, next, bulgeOf(t, i), sag));
  });
  return out;
}

/** Each short straight bit of a track's shape, with the piece of the track it belongs to. */
export function trackBits(t: Arcs, sag?: number): { a: P2; b: P2; piece: number }[] {
  const out: { a: P2; b: P2; piece: number }[] = [];
  for (let i = 0; i + 1 < t.pts.length; i += 1) {
    const run = [t.pts[i]!, ...arcPoints(t.pts[i]!, t.pts[i + 1]!, bulgeOf(t, i), sag), t.pts[i + 1]!];
    for (let k = 0; k + 1 < run.length; k += 1) out.push({ a: run[k]!, b: run[k + 1]!, piece: i });
  }
  return out;
}

/** How long a piece is along its curve, mm. */
export function pieceLength(a: P2, b: P2, bulge = 0): number {
  const arc = arcOn(a, b, bulge);
  return arc ? arc.r * Math.abs(arc.sweep) : Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** How long a track is along its curves, mm. */
export const pathLength = (t: Arcs): number => t.pts.slice(1).reduce((n, p, i) => n + pieceLength(t.pts[i]!, p, bulgeOf(t, i)), 0);

/** The point halfway round a curved piece (or halfway along a straight one). */
export function arcMid(a: P2, b: P2, bulge: number): P2 {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (l < 1e-12) return a;
  // The sagitta is bulge × half the chord, off to the right of travel for an anticlockwise arc.
  const s = (bulge * l) / 2;
  return [q((a[0] + b[0]) / 2 + ((b[1] - a[1]) / l) * s), q((a[1] + b[1]) / 2 - ((b[0] - a[0]) / l) * s)];
}

/** The bulge of the arc from `a` through `m` to `b`, as KiCad gives them. 0: the three are in a line. */
export function bulgeThrough(a: P2, m: P2, b: P2): number {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const cross = (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]);
  if (l < 1e-12 || Math.abs(cross) < 1e-12 * l) return 0;
  // The sweep is twice the angle at `m` subtracted from a half turn, and runs anticlockwise when `m` is right of travel.
  const ang = (u: P2, v: P2) => Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
  const at = Math.abs(ang([a[0] - m[0], a[1] - m[1]], [b[0] - m[0], b[1] - m[1]]));
  const sweep = 2 * (Math.PI - at);
  return Math.tan(sweep / 4) * (cross > 0 ? 1 : -1);
}

/** The bulge of an arc that turns `deg` degrees, positive anticlockwise: Eagle's `curve`. */
export const bulgeOfTurn = (deg: number): number => Math.tan((deg * Math.PI) / 180 / 4);

/** How far round a curved piece turns, degrees, positive anticlockwise. */
export const turnOf = (bulge: number): number => (4 * Math.atan(bulge) * 180) / Math.PI;

/**
 * Rounds a run's corners (#755): each corner becomes an arc of `radius` that meets both pieces on their line, made
 * smaller where a piece is too short for it. Corners already curved, and straight-on points, are left.
 */
export function roundCorners(t: Arcs, radius: number): { pts: P2[]; arcs: number[] } {
  const pts = t.pts;
  const bulges = pts.slice(1).map((_, i) => bulgeOf(t, i));
  if (pts.length < 3 || radius <= 0) return { pts, arcs: bulges };
  const len = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
  const outPts: P2[] = [pts[0]!];
  const outArcs: number[] = [];
  for (let i = 1; i + 1 < pts.length; i += 1) {
    const [a, p, b] = [pts[i - 1]!, pts[i]!, pts[i + 1]!];
    const u: P2 = [(a[0] - p[0]) / len[i - 1]!, (a[1] - p[1]) / len[i - 1]!];
    const v: P2 = [(b[0] - p[0]) / len[i]!, (b[1] - p[1]) / len[i]!];
    const cross = u[0] * v[1] - u[1] * v[0];
    const between = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    const straight = Math.abs(cross) < 1e-9 || bulges[i - 1] || bulges[i];
    // The fillet meets each piece `cut` back from the corner, taking at most half of either piece.
    const room = Math.min(len[i - 1]!, len[i]!) / 2;
    const cut = straight ? 0 : Math.min(radius / Math.tan(between / 2), room);
    if (cut < 1e-6) {
      outArcs.push(bulges[i - 1]!);
      outPts.push(p);
      continue;
    }
    const s: P2 = [q(p[0] + u[0] * cut), q(p[1] + u[1] * cut)];
    const e: P2 = [q(p[0] + v[0] * cut), q(p[1] + v[1] * cut)];
    // The arc turns by what the run turns at the corner: the outside angle.
    const turn = (Math.PI - between) * (cross < 0 ? 1 : -1);
    outArcs.push(bulges[i - 1]!, Math.tan(turn / 4));
    outPts.push(s, e);
  }
  outArcs.push(bulges[bulges.length - 1]!);
  outPts.push(pts[pts.length - 1]!);
  // A fillet that took a whole piece leaves two points on top of each other: the straight piece between them goes.
  const keepPts: P2[] = [outPts[0]!];
  const keepArcs: number[] = [];
  for (let k = 1; k < outPts.length; k += 1) {
    const last = keepPts[keepPts.length - 1]!;
    if (Math.hypot(outPts[k]![0] - last[0], outPts[k]![1] - last[1]) < 1e-6) continue;
    keepPts.push(outPts[k]!);
    keepArcs.push(outArcs[k - 1]!);
  }
  return { pts: keepPts, arcs: keepArcs };
}

/** A track with new points. Bulges that no longer line up with its pieces are dropped, and it is straight. */
export function withPts<T extends Arcs>(t: T, pts: P2[]): T {
  if (!t.arcs || pts.length === t.pts.length) return { ...t, pts };
  const next = { ...t, pts };
  delete next.arcs;
  return next;
}

/** Bulges worth keeping: none when every piece is straight. */
export const arcsIfAny = (arcs: number[] | undefined): { arcs?: number[] } => (arcs && arcs.some((b) => Math.abs(b) > 1e-9) ? { arcs } : {});
