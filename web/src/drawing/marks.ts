import type { DrawingMark, DrawingRef, DrawingStandard } from "@bettercad/kernel/drawing";
import { TAU, type ModelView, type V2, type ViewCurve, type ViewSource } from "@bettercad/kernel/view";

/**
 * Centre marks, centre lines and edge extensions (#563): what in a view each tool can be put on, and the lines a
 * mark draws. A mark remembers the model's edge or face by name, so it is worked out again from the view each time
 * and follows the model. No DOM here: the sheet and export draw the same lines.
 */

/** Sizes on paper, mm, as each standard draws them: the little cross, the gap beside it, and how far lines run past. */
export interface MarkStyle {
  cross: number;
  gap: number;
  over: number;
}
export const markStyle = (standard: DrawingStandard): MarkStyle => (standard === "iso" ? { cross: 3, gap: 1.5, over: 3 } : { cross: 3.2, gap: 1.6, over: 3.2 });
/** A centre line's long dash, gap and short dash, mm. */
export const CENTRE = { long: 10, gap: 1.5, dot: 1.5 } as const;
/** The same as a dash pattern, for a pitch circle. */
export const CENTRE_DASH = [CENTRE.long, CENTRE.gap, CENTRE.dot, CENTRE.gap] as const;

/** Something in a view a mark can be put on, in the view's own millimetres. */
export type Target =
  /** A hole or pin seen end on, or a round edge. */
  | { kind: "round"; source: ViewSource; c: V2; r: number; hole: boolean; whole: boolean }
  /** A hole or pin seen from the side: its axis runs from a to b. */
  | { kind: "axis"; source: ViewSource; a: V2; b: V2; r: number; hole: boolean; whole: boolean }
  | { kind: "edge"; source: ViewSource; a: V2; b: V2 };

const WHOLE = TAU - 1e-6;
const key = (s: ViewSource) => `${s.body}|${s.kind}|${s.name ?? `#${s.index}`}`;
export const refKey = (r: Pick<DrawingRef, "body" | "kind" | "name" | "index">) => `${r.body}|${r.kind}|${r.name ?? `#${r.index}`}`;

/** Everything in a view the mark tools can pick, each once. Round faces come before the round edges that rim them. */
export function targets(view: ModelView): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  const put = (t: Target) => {
    const k = key(t.source);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (const r of view.rounds) {
    const whole = r.sweep >= WHOLE;
    // The kernel's type loses which of the two a round is once its body is swapped for a source; this puts it back.
    const seen = r as unknown as { seen: "end"; c: V2 } | { seen: "side"; a: V2; b: V2 };
    if (seen.seen === "end") put({ kind: "round", source: r.source, c: seen.c, r: r.r, hole: r.hole, whole });
    else put({ kind: "axis", source: r.source, a: seen.a, b: seen.b, r: r.r, hole: r.hole, whole });
  }
  // A detail or broken view draws pieces of its edges; marks and sizes are fixed to the whole ones (#571).
  for (const e of (view as { whole?: ModelView["edges"] }).whole ?? view.edges) {
    if (!e.source) continue;
    const c = e.curve;
    if (c.kind === "circle") put({ kind: "round", source: e.source, c: c.c, r: c.r, hole: false, whole: true });
    else if (c.kind === "arc") put({ kind: "round", source: e.source, c: c.c, r: c.r, hole: false, whole: false });
    else if (c.kind === "line") put({ kind: "edge", source: e.source, a: c.a, b: c.b });
  }
  return out;
}

/**
 * What the tools offer to click: a hole's rim is the hole again, and so is the rim at its far end, so there is one
 * thing for each centre and size, the face before its edges.
 */
export function offered(all: Target[]): Target[] {
  const out: Target[] = [];
  for (const t of all) {
    // A sketch view's point marks are lines of no length: sizes are fixed to them, but there is nothing to click.
    if (t.kind === "edge" && t.a[0] === t.b[0] && t.a[1] === t.b[1]) continue;
    if (t.kind === "round" && out.some((o) => o.kind === "round" && Math.hypot(o.c[0] - t.c[0], o.c[1] - t.c[1]) < 1e-6 && Math.abs(o.r - t.r) < 1e-6))
      continue;
    out.push(t);
  }
  return out;
}

/** A target as a mark remembers it. */
export const refTo = (view: string, t: Target): DrawingRef => {
  const ref: DrawingRef = { view, body: t.source.body, kind: t.source.kind, index: t.source.index };
  if (t.source.name) ref.name = t.source.name;
  return ref;
};

/** The target a mark was put on, by name where it has one and by number otherwise. Nothing when the model lost it. */
export function resolve(all: Target[], ref: DrawingRef): Target | undefined {
  const same = (t: Target) => t.source.body === ref.body && t.source.kind === ref.kind;
  // A name that is gone means the face or edge is: its old number now belongs to something else.
  return ref.name ? all.find((t) => same(t) && t.source.name === ref.name) : all.find((t) => same(t) && t.source.index === ref.index);
}

/** What a mark draws, in paper millimetres from the middle of its view with y up: solid thin lines, and dashed curves. */
export interface MarkArt {
  lines: [V2, V2][];
  curves: ViewCurve[];
}

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2, k = 1): V2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const unit = (a: V2): V2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const crossZ = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];

/** The cross at a centre: a short dash each way through the middle, then a line out past the rim. */
export function crossAt(c: V2, r: number, s: MarkStyle): [V2, V2][] {
  const out: [V2, V2][] = [];
  const reach = r + s.over;
  const inner = s.cross / 2 + s.gap;
  for (const d of [
    [1, 0],
    [0, 1],
  ] as V2[]) {
    // A circle too small for the gaps gets one line straight through.
    if (reach - inner < s.cross / 2) {
      out.push([add(c, d, -reach), add(c, d, reach)]);
      continue;
    }
    out.push([add(c, d, -s.cross / 2), add(c, d, s.cross / 2)], [add(c, d, inner), add(c, d, reach)], [add(c, d, -inner), add(c, d, -reach)]);
  }
  return out;
}

/** A long-dash-dot line from a to b, starting and ending on a long dash. Short lines are drawn solid. */
export function dashDot(a: V2, b: V2): [V2, V2][] {
  const L = len(sub(b, a));
  const d = unit(sub(b, a));
  const between = CENTRE.gap * 2 + CENTRE.dot;
  const n = Math.round((L - CENTRE.long) / (CENTRE.long + between));
  if (n < 1) return L > 1e-6 ? [[a, b]] : [];
  const long = (L - n * between) / (n + 1);
  const out: [V2, V2][] = [];
  let at = 0;
  for (let i = 0; i <= n; i++) {
    out.push([add(a, d, at), add(a, d, at + long)]);
    at += long;
    if (i < n) {
      out.push([add(a, d, at + CENTRE.gap), add(a, d, at + CENTRE.gap + CENTRE.dot)]);
      at += between;
    }
  }
  return out;
}

/** The circle through three points, or nothing when they are in a line. */
function circleThrough(a: V2, b: V2, c: V2): { c: V2; r: number } | undefined {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return undefined;
  const [a2, b2, c2] = [dot(a, a), dot(b, b), dot(c, c)];
  const o: V2 = [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
  return { c: o, r: len(sub(a, o)) };
}

/** The circle a set of centres all sit on (a bolt circle), to a hundredth of a millimetre; nothing for a row. */
export function pitchCircle(points: V2[]): { c: V2; r: number } | undefined {
  if (points.length < 3) return undefined;
  for (let i = 2; i < points.length; i++) {
    const fit = circleThrough(points[0]!, points[1]!, points[i]!);
    if (fit) return points.every((p) => Math.abs(len(sub(p, fit.c)) - fit.r) < 0.01) ? fit : undefined;
  }
  return undefined;
}

/**
 * The lines of a mark in a view drawn at a scale. Nothing when what it was put on is no longer in the view, or the
 * two edges of an extension never meet.
 */
export function markArt(mark: DrawingMark, view: ModelView, scale: number, style: MarkStyle, all: Target[] = targets(view)): MarkArt | undefined {
  const mid: V2 = [(view.box.min[0] + view.box.max[0]) / 2, (view.box.min[1] + view.box.max[1]) / 2];
  const P = (q: V2): V2 => [(q[0] - mid[0]) * scale, (q[1] - mid[1]) * scale];
  const round = (ref: DrawingRef) => {
    const t = resolve(all, ref);
    return t?.kind === "round" ? { c: P(t.c), r: t.r * scale } : undefined;
  };
  const edge = (ref: DrawingRef) => {
    const t = resolve(all, ref);
    return t?.kind === "edge" ? { a: P(t.a), b: P(t.b) } : undefined;
  };

  if (mark.kind === "centre-mark") {
    const r = round(mark.on);
    return r && { lines: crossAt(r.c, r.r, style), curves: [] };
  }
  if (mark.kind === "centre-pattern") {
    const rs = mark.on.map(round).filter((r): r is { c: V2; r: number } => !!r);
    if (!rs.length) return undefined;
    const lines = rs.flatMap((r) => crossAt(r.c, r.r, style));
    const curves: ViewCurve[] = [];
    const fit = mark.join === "circle" ? pitchCircle(rs.map((r) => r.c)) : undefined;
    if (fit) {
      curves.push({ kind: "circle", c: fit.c, r: fit.r });
      lines.push(
        [add(fit.c, [1, 0], -style.cross / 2), add(fit.c, [1, 0], style.cross / 2)],
        [add(fit.c, [0, 1], -style.cross / 2), add(fit.c, [0, 1], style.cross / 2)],
      );
    } else if (rs.length > 1) {
      // A row: joined in order along the way they run, the line carried past the first and last.
      const way = unit(sub(rs[rs.length - 1]!.c, rs[0]!.c));
      const sorted = [...rs].sort((p, q) => dot(p.c, way) - dot(q.c, way));
      for (let i = 0; i + 1 < sorted.length; i++) {
        const d = unit(sub(sorted[i + 1]!.c, sorted[i]!.c));
        const from = i === 0 ? add(sorted[i]!.c, d, -(sorted[i]!.r + style.over)) : sorted[i]!.c;
        const to = i + 2 === sorted.length ? add(sorted[i + 1]!.c, d, sorted[i + 1]!.r + style.over) : sorted[i + 1]!.c;
        lines.push(...dashDot(from, to));
      }
    }
    return { lines, curves };
  }
  if (mark.kind === "centre-line") {
    if (!mark.b) {
      const t = resolve(all, mark.a);
      if (t?.kind !== "axis") return undefined;
      const [a, b] = [P(t.a), P(t.b)];
      const d = unit(sub(b, a));
      return { lines: dashDot(add(a, d, -style.over), add(b, d, style.over)), curves: [] };
    }
    const [e, f] = [edge(mark.a), edge(mark.b)];
    if (!e || !f) return undefined;
    // Midway between the two edges, end for end the same way round.
    const flip = dot(sub(e.b, e.a), sub(f.b, f.a)) < 0;
    const [f1, f2] = flip ? [f.b, f.a] : [f.a, f.b];
    const a: V2 = [(e.a[0] + f1[0]) / 2, (e.a[1] + f1[1]) / 2];
    const b: V2 = [(e.b[0] + f2[0]) / 2, (e.b[1] + f2[1]) / 2];
    if (len(sub(b, a)) < 1e-6) return undefined;
    const d = unit(sub(b, a));
    return { lines: dashDot(add(a, d, -style.over), add(b, d, style.over)), curves: [] };
  }
  const [e, f] = [edge(mark.a), edge(mark.b)];
  if (!e || !f) return undefined;
  const [de, df] = [sub(e.b, e.a), sub(f.b, f.a)];
  const den = crossZ(de, df);
  if (Math.abs(den) < 1e-9 * (len(de) * len(df) || 1)) return undefined;
  const x = add(e.a, de, crossZ(sub(f.a, e.a), df) / den);
  const lines: [V2, V2][] = [];
  for (const s of [e, f]) {
    // From whichever end is nearer the corner, a little past it.
    const near = len(sub(s.a, x)) < len(sub(s.b, x)) ? s.a : s.b;
    if (len(sub(near, x)) < 1e-6) continue;
    lines.push([near, add(x, unit(sub(x, near)), style.over / 2)]);
  }
  return lines.length ? { lines, curves: [] } : undefined;
}

/** What a mark is fixed to, for telling whether one is already there. */
export function markKey(m: DrawingMark): string {
  const refs = m.kind === "centre-mark" ? [m.on] : m.kind === "centre-pattern" ? m.on : m.b ? [m.a, m.b] : [m.a];
  return `${m.kind}:${refs.map(refKey).sort().join(",")}`;
}
/** The view a mark is in. */
export const markView = (m: DrawingMark) => (m.kind === "centre-mark" ? m.on.view : m.kind === "centre-pattern" ? m.on[0]?.view : m.a.view);

/**
 * Add centre marks to this view: a centre mark on every whole hole or pin seen end on (one per centre, on the
 * biggest), and an axis on every one seen from the side (one per axis, the longest). Fillets get neither. Anything
 * already marked is left alone. Auto dimension (#566) uses the same pass.
 */
export function autoMarks(view: ModelView, viewId: string, existing: DrawingMark[], id: () => string): DrawingMark[] {
  const all = targets(view);
  const marked = new Set(
    existing
      .filter((m) => markView(m) === viewId)
      .flatMap((m) => (m.kind === "centre-mark" ? [m.on] : m.kind === "centre-pattern" ? m.on : [m.a]))
      .map(refKey),
  );
  const n = (v: number) => Math.round(v * 1000) / 1000;
  const ends = new Map<string, Extract<Target, { kind: "round" }>>();
  const sides = new Map<string, Extract<Target, { kind: "axis" }>>();
  for (const t of all) {
    if (t.kind === "edge" || t.source.kind !== "face" || !t.whole) continue;
    if (t.kind === "round") {
      const k = `${n(t.c[0])},${n(t.c[1])}`;
      if (!ends.has(k) || ends.get(k)!.r < t.r) ends.set(k, t);
    } else {
      // An axis is a line: which way it runs (either way round) and how far it passes from the origin.
      let d = unit(sub(t.b, t.a));
      if (d[0] < -1e-9 || (Math.abs(d[0]) <= 1e-9 && d[1] < 0)) d = [-d[0], -d[1]];
      const k = `${n(d[0])},${n(d[1])},${n(crossZ(t.a, d))}`;
      const was = sides.get(k);
      if (!was || len(sub(was.b, was.a)) < len(sub(t.b, t.a))) sides.set(k, t);
    }
  }
  const out: DrawingMark[] = [];
  for (const t of ends.values()) if (!marked.has(key(t.source))) out.push({ id: id(), kind: "centre-mark", on: refTo(viewId, t) });
  for (const t of sides.values()) if (!marked.has(key(t.source))) out.push({ id: id(), kind: "centre-line", a: refTo(viewId, t) });
  return out;
}

/** What a mark is called, for its label and its Undo step. */
export const MARK_NAMES: Record<DrawingMark["kind"], string> = {
  "centre-mark": "Centre mark",
  "centre-pattern": "Centre mark pattern",
  "centre-line": "Centre line",
  extension: "Edge extension",
};
