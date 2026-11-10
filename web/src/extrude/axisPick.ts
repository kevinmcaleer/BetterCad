import { SketchIndex, planeFrame, toWorld, type Frame, type Sketch } from "@bettercad/sketch";
import { bodyRef, type AxisRef, type Mat4, type Part } from "../state/document";
import { shownPart } from "./posed";
import type { Engine, ScreenPoint } from "../viewport/engine";
import type { Pick } from "../viewport/ids";
import type { OverlayCurve } from "../sketch/overlay";

/** Revolve's axis picking (#62), loaded with the Revolve tool. */

type V3 = [number, number, number];

/** The line of a body edge when it is straight (every point within 1 µm of the line through its ends), else null. */
export function straightEdge(pts: V3[]): { origin: V3; dir: V3; length: number } | null {
  if (pts.length < 2) return null;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...d);
  if (!(length > 1e-6)) return null;
  const u: V3 = [d[0] / length, d[1] / length, d[2] / length];
  for (const p of pts) {
    const w: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const t = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
    if (Math.hypot(w[0] - u[0] * t, w[1] - u[1] * t, w[2] - u[2] * t) > 1e-3) return null;
  }
  return { origin: a, dir: u, length };
}

/** How far a screen point is from a screen segment, px. */
function toSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

/** What the pointer is over while Revolve wants its axis: the axis it would pick, and what to light. */
export type AxisHit = { axis: AxisRef; shape?: string; line?: string; edge?: Pick };

const AXIS_ONLY: ReadonlySet<"axis"> = new Set(["axis"]);

/**
 * The axis under the pointer while Revolve wants one: an origin or construction axis first, then a line of the
 * step's sketch, then a straight edge of a body (not the one the revolve makes).
 */
export function axisAt(
  eng: Engine,
  p: ScreenPoint,
  own: string,
  sk: Sketch | null,
  parts: Part[],
  shown?: Frame | null,
  moves?: Map<string, Mat4>,
): AxisHit | null {
  const shape = eng.constructAt(p.x, p.y, AXIS_ONLY);
  if (shape) {
    if (shape.startsWith("origin:")) return { axis: { kind: "ref", ref: { origin: shape.slice(7) as "X" | "Y" | "Z" } }, shape };
    return { axis: { kind: "ref", ref: { step: shape } }, shape };
  }
  if (sk) {
    // Where the sketch and bodies are shown: carried by their components' pose while the model is posed.
    const frame = shown ?? planeFrame(sk.plane);
    const idx = new SketchIndex(sk);
    let best: { id: string; d: number } | null = null;
    for (const e of sk.entities) {
      if (e.kind !== "line") continue;
      const [a, b] = [idx.xy(e.a), idx.xy(e.b)].map((q) => eng.project(toWorld(frame, q) as V3));
      const dist = toSegment(p, a!, b!);
      if (dist <= 6 && (!best || dist < best.d)) best = { id: e.id, d: dist };
    }
    if (best) return { axis: { kind: "line", id: best.id }, line: best.id };
  }
  const hit = eng.pick(p.x, p.y, "edge");
  const found = hit && parts.find((x) => x.id === hit.body);
  const part = found && shownPart(found, moves);
  if (!hit || !part || hit.body === own) return null;
  const line = straightEdge(eng.edgePoints(hit.body, hit.index) ?? []);
  if (!line) return null;
  return { axis: { kind: "ref", ref: bodyRef(part, "edge", hit.index, { t: "line", ...line }) }, edge: hit };
}

/** A revolve's axis line (picked) and the line under the pointer (hover), drawn over the sketch. */
export function lineCurves(sk: Sketch, picked: string | null, hover: string | null): OverlayCurve[] {
  const idx = new SketchIndex(sk);
  const out: OverlayCurve[] = [];
  for (const [id, shade] of [
    [picked, "picked"],
    [hover, "hover"],
  ] as const) {
    const e = id ? idx.get(id) : null;
    if (e?.kind === "line") out.push({ pts: [idx.xy(e.a), idx.xy(e.b)], shade });
  }
  return out;
}
