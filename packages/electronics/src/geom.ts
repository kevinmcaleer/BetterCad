import type { P2, Rot, SchSymbol, SymbolPin } from "./model";

/** Rounds to a nanometre, so points that should meet do. */
export const q = (n: number): number => Math.round(n * 1e6) / 1e6;
/** A point as a map key, to a tenth of a micron. */
export const key = (x: number, y: number): string => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;

export const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Turns a point about the origin, anticlockwise. Right angles stay exact. */
export function turn(p: P2, deg: number): P2 {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return [p[0], p[1]];
  if (d === 90) return [-p[1], p[0]];
  if (d === 180) return [-p[0], -p[1]];
  if (d === 270) return [p[1], -p[0]];
  const c = Math.cos(rad(d));
  const s = Math.sin(rad(d));
  return [q(p[0] * c - p[1] * s), q(p[0] * s + p[1] * c)];
}

/** Where a point of a symbol lands on the sheet: mirrored, then turned, then moved. */
export function placeOnSheet(p: P2, s: Pick<SchSymbol, "x" | "y" | "rot" | "mirror">): P2 {
  const m: P2 = s.mirror ? [-p[0], p[1]] : p;
  const t = turn(m, s.rot);
  return [q(t[0] + s.x), q(t[1] + s.y)];
}

/** The way a placed pin's line runs on the sheet. */
export function pinDirOnSheet(pin: Pick<SymbolPin, "dir">, s: Pick<SchSymbol, "rot" | "mirror">): Rot {
  let d: number = pin.dir;
  if (s.mirror) d = (180 - d + 360) % 360;
  return ((((d + s.rot) % 360) + 360) % 360) as Rot;
}

/** Where a point of a footprint lands on the board. Parts on the bottom are mirrored left to right first. */
export function placeOnBoard(p: P2, at: { x: number; y: number; rot: number; side: "top" | "bottom" }): P2 {
  const m: P2 = at.side === "bottom" ? [-p[0], p[1]] : p;
  const t = turn(m, at.rot);
  return [q(t[0] + at.x), q(t[1] + at.y)];
}

/** True when `p` lies on the segment a-b, ends included. */
export function onSegment(p: P2, a: P2, b: P2, eps = 1e-4): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (Math.abs(cross) > eps * Math.max(len, 1)) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  return dot >= -eps && dot <= len * len + eps;
}

export const dist = (a: P2, b: P2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Distance from a point to a segment. */
export function distToSegment(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Shortest distance between two segments; 0 when they cross. */
export function segmentDistance(a1: P2, a2: P2, b1: P2, b2: P2): number {
  const o = (p: P2, q2: P2, r: P2) => Math.sign((q2[0] - p[0]) * (r[1] - p[1]) - (q2[1] - p[1]) * (r[0] - p[0]));
  if (o(a1, a2, b1) * o(a1, a2, b2) < 0 && o(b1, b2, a1) * o(b1, b2, a2) < 0) return 0;
  return Math.min(distToSegment(a1, b1, b2), distToSegment(a2, b1, b2), distToSegment(b1, a1, a2), distToSegment(b2, a1, a2));
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export const emptyBox = (): Box => ({ x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
export function grow(b: Box, p: P2, by = 0): Box {
  b.x1 = Math.min(b.x1, p[0] - by);
  b.y1 = Math.min(b.y1, p[1] - by);
  b.x2 = Math.max(b.x2, p[0] + by);
  b.y2 = Math.max(b.y2, p[1] + by);
  return b;
}
export const boxesTouch = (a: Box, b: Box, gap = 0): boolean => a.x1 <= b.x2 + gap && b.x1 <= a.x2 + gap && a.y1 <= b.y2 + gap && b.y1 <= a.y2 + gap;
