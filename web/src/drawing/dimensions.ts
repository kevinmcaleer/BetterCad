import type { DrawingDimension, DrawingRef, DrawingStandard } from "@bettercad/kernel/drawing";
import { turn, type ModelView, type V2, type ViewCurve } from "@bettercad/kernel/view";
import { offered, refKey, refTo, resolve, targets, type Target } from "./marks";

/**
 * Dimensions on a drawing (#564): what in a view a size can be taken from, what it measures, and the lines, arrows
 * and text it draws. A dimension remembers the model's edges and faces by name and is worked out again from the view
 * each time, so it reports the model's true size whatever the view's scale and follows the model when it changes.
 * No DOM here: the sheet and export draw the same thing.
 */

/** Sizes on paper, mm, as each standard draws a dimension. */
export interface DimStyle {
  /** Letter height. */
  text: number;
  /** Clear paper between the part and the start of an extension line. */
  gap: number;
  /** How far an extension line runs past the dimension line. */
  over: number;
  /** An arrowhead's length and width. */
  arrow: number;
  arrowWidth: number;
  /** ISO: the text sits above its line and turns with it. ASME: it stays level, in a break in the line. */
  above: boolean;
}
export const dimStyle = (standard: DrawingStandard): DimStyle =>
  standard === "iso"
    ? { text: 3.5, gap: 1, over: 2, arrow: 3, arrowWidth: 1, above: true }
    : { text: 3.5, gap: 1.5, over: 3, arrow: 3, arrowWidth: 1, above: false };
/** Clear paper between a line and the text above it, and each side of text in a break. */
const LIFT = 1;
const BREAK = 0.8;
/** Roughly how wide a run of text is: enough to break a line round it and to tell when it fits between its arrows. */
export const textWidth = (text: string, size: number) => text.length * size * 0.58;

type V = V2;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const cross = (a: V, b: V) => a[0] * b[1] - a[1] * b[0];
const len = (a: V) => Math.hypot(a[0], a[1]);
const unit = (a: V): V => {
  const l = len(a);
  return l < 1e-12 ? [1, 0] : [a[0] / l, a[1] / l];
};
const perp = (a: V): V => [-a[1], a[0]];
const mid = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const near = (a: V, b: V) => len(sub(a, b)) < 1e-6;

/** Something a size can be taken from, in the view's own millimetres. */
export type DimPick =
  /** A straight edge, or the axis of a hole seen from the side. */
  | { kind: "edge"; ref: DrawingRef; a: V2; b: V2; name: string }
  /** A circle or arc: its diameter or radius. */
  | { kind: "round"; ref: DrawingRef; c: V2; r: number; whole: boolean; name: string }
  /** The end or middle of an edge, or the centre of a circle. */
  | { kind: "point"; ref: DrawingRef; p: V2; name: string };

const mm = (v: number) => String(Math.round(v * 100) / 100 + 0);
const roundName = (t: Extract<Target, { kind: "round" | "axis" }>) => (t.hole ? "hole" : t.source.kind === "face" ? "round face" : t.whole ? "circle" : "arc");
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * Everything in a view the Dimension tool can pick: edges and circles, then the points they give (ends, centres,
 * middles), each place once.
 */
export function dimPicks(viewId: string, view: ModelView): DimPick[] {
  const all = offered(targets(view));
  const out: DimPick[] = [];
  const points: Extract<DimPick, { kind: "point" }>[] = [];
  const point = (t: Target, at: NonNullable<DrawingRef["at"]>, p: V2, what: string) => {
    if (points.some((q) => near(q.p, p))) return;
    points.push({ kind: "point", ref: { ...refTo(viewId, t), at }, p, name: `${what} at ${mm(p[0])}, ${mm(p[1])} mm` });
  };
  for (const t of all) {
    if (t.kind === "edge") out.push({ kind: "edge", ref: refTo(viewId, t), a: t.a, b: t.b, name: `Edge, ${mm(len(sub(t.b, t.a)))} mm long` });
    else if (t.kind === "axis") out.push({ kind: "edge", ref: refTo(viewId, t), a: t.a, b: t.b, name: `Axis of a ${roundName(t)}, ${mm(t.r * 2)} mm across` });
    else out.push({ kind: "round", ref: refTo(viewId, t), c: t.c, r: t.r, whole: t.whole, name: `${cap(roundName(t))}, ${mm(t.r * 2)} mm across` });
  }
  for (const t of all) {
    if (t.kind !== "edge") continue;
    point(t, "start", t.a, "Point");
    point(t, "end", t.b, "Point");
  }
  for (const t of all) if (t.kind === "round") point(t, "centre", t.c, "Centre");
  for (const t of all) if (t.kind === "edge") point(t, "middle", mid(t.a, t.b), "Midpoint");
  return [...out, ...points];
}

/** The same thing picked twice: the same edge or face, at the same point of it. */
export const pickKey = (r: DrawingRef) => `${refKey(r)}@${r.at ?? ""}`;

type Geom = { kind: "point"; p: V2 } | { kind: "line"; a: V2; b: V2 } | { kind: "round"; c: V2; r: number; whole: boolean; hole: boolean };

/** What a ref points at now, in the view's millimetres. Nothing when the model lost it. */
function geomOf(all: Target[], ref: DrawingRef): Geom | undefined {
  const t = resolve(all, ref);
  if (!t) return undefined;
  if (t.kind === "round") return ref.at ? { kind: "point", p: t.c } : { kind: "round", c: t.c, r: t.r, whole: t.whole, hole: t.hole };
  if (ref.at === "start") return { kind: "point", p: t.a };
  if (ref.at === "end") return { kind: "point", p: t.b };
  if (ref.at === "middle" || ref.at === "centre") return { kind: "point", p: mid(t.a, t.b) };
  return { kind: "line", a: t.a, b: t.b };
}

const parallel = (a: Extract<Geom, { kind: "line" }>, b: Extract<Geom, { kind: "line" }>) => Math.abs(cross(unit(sub(a.b, a.a)), unit(sub(b.b, b.a)))) < 1e-6;
/** The point of a line nearest a point. */
const foot = (l: { a: V2; b: V2 }, p: V2): V2 => {
  const u = unit(sub(l.b, l.a));
  return add(l.a, u, dot(sub(p, l.a), u));
};

/** What a dimension measures, in the view's millimetres: the model's true size. */
export type Measured =
  /** From p to q. `free` when the pointer may choose across, up or aligned; otherwise it is square to an edge. */
  | { kind: "linear"; p: V2; q: V2; free: boolean }
  /** Between two edges that cross at `v` (they may need carrying on to get there). */
  | { kind: "angle"; v: V2; lines: [{ a: V2; b: V2 }, { a: V2; b: V2 }] }
  | { kind: "radius" | "diameter"; c: V2; r: number; hole: boolean };

/** What a set of picked refs measures. Nothing when they give no size: one point, the same thing twice, a lost edge. */
export function measured(refs: DrawingRef[], all: Target[]): Measured | undefined {
  const g = refs.map((r) => geomOf(all, r));
  const [a, b] = g;
  if (!a || g.length > 2 || (g.length === 2 && !b)) return undefined;
  if (!b) {
    if (a.kind === "line") return near(a.a, a.b) ? undefined : { kind: "linear", p: a.a, q: a.b, free: true };
    if (a.kind === "round") return { kind: a.whole ? "diameter" : "radius", c: a.c, r: a.r, hole: a.hole };
    return undefined;
  }
  // A circle picked with something else stands for its centre.
  const pt = (x: Geom): V2 | undefined => (x.kind === "point" ? x.p : x.kind === "round" ? x.c : undefined);
  const [pa, pb] = [pt(a), pt(b)];
  if (pa && pb) return near(pa, pb) ? undefined : { kind: "linear", p: pa, q: pb, free: true };
  if (a.kind === "line" && b.kind === "line") {
    if (!parallel(a, b)) {
      const [da, db] = [sub(a.b, a.a), sub(b.b, b.a)];
      const t = cross(sub(b.a, a.a), db) / cross(da, db);
      return { kind: "angle", v: add(a.a, da, t), lines: [a, b] };
    }
    const p = mid(a.a, a.b);
    const q = foot(b, p);
    return near(p, q) ? undefined : { kind: "linear", p, q, free: false };
  }
  const line = a.kind === "line" ? a : (b as Extract<Geom, { kind: "line" }>);
  const q = (pa ?? pb)!;
  const p = foot(line, q);
  return near(p, q) ? undefined : { kind: "linear", p, q, free: false };
}

/**
 * Which way a size between two points runs, from where its text is, as in a sketch (PR #252): above or below the
 * box the two points span it is level, beside it upright, anywhere else along the line between them.
 */
export function directionAt(p: V2, q: V2, at: V2): "x" | "y" | "aligned" {
  const span = Math.max(len(sub(q, p)), 1e-9);
  const [x0, x1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0])];
  const [y0, y1] = [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
  if (x1 - x0 < 1e-6 * span || y1 - y0 < 1e-6 * span) return "aligned";
  const inX = at[0] >= x0 && at[0] <= x1;
  const inY = at[1] >= y0 && at[1] <= y1;
  if (inX && !inY) return "x";
  if (inY && !inX) return "y";
  return "aligned";
}

/** A number as a dimension writes it: to so many places, without trailing zeros. */
export const sizeText = (value: number, decimals: number) => String(Number(value.toFixed(Math.max(0, Math.min(3, decimals)))) + 0);

/** The lines a dimension draws, in paper millimetres from the middle of its view with y up. */
export interface DimArt {
  /** Thin solid lines: extension lines, the dimension line, a leader. */
  lines: [V2, V2][];
  /** An angle's arc. */
  arcs: ViewCurve[];
  /** Filled arrowheads, each a triangle from its tip. */
  arrows: [V2, V2, V2][];
  /** The size: the middle of its text, how far it is turned (anticlockwise, radians) and about how wide it is. */
  text: { at: V2; turn: number; text: string; width: number };
  /** The size alone, in mm or degrees, and its unit, for naming the dimension. */
  value: number;
  unit: "mm" | "°";
}

const arrowAt = (tip: V2, dir: V2, s: DimStyle): [V2, V2, V2] => {
  const back = add(tip, dir, -s.arrow);
  const n = perp(dir);
  return [tip, add(back, n, s.arrowWidth / 2), add(back, n, -s.arrowWidth / 2)];
};

export interface DimContext {
  /** The view's picture and the scale it is drawn at. */
  view: ModelView;
  scale: number;
  style: DimStyle;
  /** The drawing's decimal places. */
  decimals: number;
  /** An isometric view: sizes run along what they measure, never across or up. */
  iso?: boolean;
  all?: Target[];
}

/** What a dimension draws, or nothing when what it was fixed to has gone from the model. */
export function dimArt(dim: Pick<DrawingDimension, "refs" | "across" | "at" | "decimals">, ctx: DimContext): DimArt | undefined {
  const { view, scale, style: s } = ctx;
  const all = ctx.all ?? targets(view);
  const m = measured(dim.refs, all);
  if (!m) return undefined;
  const centre: V2 = [(view.box.min[0] + view.box.max[0]) / 2, (view.box.min[1] + view.box.max[1]) / 2];
  const P = (q: V2): V2 => [(q[0] - centre[0]) * scale, (q[1] - centre[1]) * scale];
  const places = dim.decimals ?? ctx.decimals;
  const T = dim.at;
  const lines: [V2, V2][] = [];
  const arcs: ViewCurve[] = [];
  const arrows: [V2, V2, V2][] = [];

  if (m.kind === "linear") {
    const [p, q] = [P(m.p), P(m.q)];
    const way = !m.free || ctx.iso ? "aligned" : (dim.across ?? "aligned");
    // Level sizes read left to right and upright ones bottom to top, so the text is the right way up.
    let u: V2 = way === "x" ? [1, 0] : way === "y" ? [0, 1] : unit(sub(q, p));
    if (u[0] < -1e-9 || (Math.abs(u[0]) < 1e-9 && u[1] < 0)) u = [-u[0], -u[1]];
    const n = perp(u);
    // Across a break (#571) the two ends are drawn closer than they are: the size is between where they truly are.
    const real = (view as { real?: (p: V2) => V2 }).real;
    const value = Math.abs(dot(real ? sub(real(m.q), real(m.p)) : sub(m.q, m.p), u));
    const text = sizeText(value, places);
    const width = textWidth(text, s.text);
    const [s1, s2] = [dot(sub(p, T), u), dot(sub(q, T), u)];
    const [e1, e2] = [add(T, u, s1), add(T, u, s2)];
    for (const [from, to] of [
      [p, e1],
      [q, e2],
    ] as const) {
      const d = dot(sub(to, from), n);
      if (Math.abs(d) <= s.gap) continue;
      const k = Math.sign(d);
      lines.push([add(from, n, k * s.gap), add(to, n, k * s.over)]);
    }
    const [lo, hi] = [Math.min(s1, s2), Math.max(s1, s2)];
    const span = hi - lo;
    // The text's half length along the line: all of it when it turns with the line, less when it stays level.
    const half = s.above ? width / 2 : (Math.abs(u[0]) * width) / 2 + (Math.abs(u[1]) * s.text) / 2;
    const inside = lo < 0 && hi > 0;
    const fits = span >= s.arrow * 2.5;
    // Arrows that don't fit between the extension lines point in from outside, on short tails.
    const tail = fits ? 0 : s.arrow * 2;
    let [from, to] = [lo - tail, hi + tail];
    if (!inside) {
      // Text dragged past an end: the line runs on to it.
      if (hi <= 0) to = Math.max(to, s.above ? half : -half - BREAK);
      else from = Math.min(from, s.above ? -half : half + BREAK);
    }
    if (!s.above && from < -half - BREAK && to > half + BREAK) {
      lines.push([add(T, u, from), add(T, u, -half - BREAK)], [add(T, u, half + BREAK), add(T, u, to)]);
    } else lines.push([add(T, u, from), add(T, u, to)]);
    arrows.push(arrowAt(add(T, u, lo), fits ? [-u[0], -u[1]] : u, s), arrowAt(add(T, u, hi), fits ? u : [-u[0], -u[1]], s));
    const angle = Math.atan2(u[1], u[0]);
    const at = s.above ? add(T, n, LIFT + s.text * 0.36) : T;
    return { lines, arcs, arrows, text: { at, turn: s.above ? angle : 0, text, width }, value, unit: "mm" };
  }

  if (m.kind === "angle") {
    const v = P(m.v);
    const rays = m.lines.map((l) => unit(sub(P(l.b), P(l.a)))) as [V2, V2];
    // The text picks the quadrant: it lies between one way along each edge.
    const w = sub(T, v);
    const det = cross(rays[0], rays[1]);
    const [alpha, beta] = [cross(w, rays[1]) / det, cross(rays[0], w) / det];
    const d1: V2 = alpha < 0 ? [-rays[0][0], -rays[0][1]] : rays[0];
    const d2: V2 = beta < 0 ? [-rays[1][0], -rays[1][1]] : rays[1];
    const R = Math.max(len(w), s.arrow * 2);
    let [from, to] = [Math.atan2(d1[1], d1[0]), Math.atan2(d2[1], d2[0])];
    if (turn(to - from) > Math.PI) [from, to] = [to, from];
    const sweep = turn(to - from);
    const value = (sweep * 180) / Math.PI;
    const text = `${sizeText(value, places)}°`;
    const width = textWidth(text, s.text);
    const on = (t: number): V2 => [v[0] + R * Math.cos(t), v[1] + R * Math.sin(t)];
    // Where an arm's edge stops short of the arc, an extension line carries it there.
    m.lines.forEach((l, i) => {
      const d = i === 0 ? d1 : d2;
      const reach = [dot(sub(P(l.a), v), d), dot(sub(P(l.b), v), d)];
      const [lo, hi] = [Math.min(...reach), Math.max(...reach)];
      if (R > hi + 1e-6) lines.push([add(v, d, Math.max(hi, 0) + s.gap), add(v, d, R + s.over)]);
      else if (R < lo - 1e-6) lines.push([add(v, d, lo - s.gap), add(v, d, Math.max(R - s.over, 0))]);
    });
    const at = Math.atan2(w[1], w[0]);
    const within = turn(at - from) <= sweep;
    const gapAngle = (width / 2 + BREAK) / R;
    if (!s.above && within && sweep > gapAngle * 2 + 1e-6) {
      const a = turn(at - from);
      if (a - gapAngle > 1e-6) arcs.push({ kind: "arc", c: v, r: R, from, to: from + a - gapAngle });
      if (a + gapAngle < sweep - 1e-6) arcs.push({ kind: "arc", c: v, r: R, from: from + a + gapAngle, to: from + sweep });
    } else arcs.push({ kind: "arc", c: v, r: R, from, to: from + sweep });
    const fits = R * sweep >= s.arrow * 2.5;
    const tangent = (t: number, k: number): V2 => [-Math.sin(t) * k, Math.cos(t) * k];
    arrows.push(arrowAt(on(from), tangent(from, fits ? -1 : 1), s), arrowAt(on(from + sweep), tangent(from + sweep, fits ? 1 : -1), s));
    const out = unit(w);
    const where = s.above ? add(v, out, R + LIFT + s.text / 2) : add(v, out, R);
    return { lines, arcs, arrows, text: { at: where, turn: 0, text, width }, value, unit: "°" };
  }

  // A radius or a diameter: a leader from the text to the rim, or a line across when the text is inside.
  const c = P(m.c);
  const R = m.r * scale;
  const value = m.kind === "diameter" ? m.r * 2 : m.r;
  let count = 1;
  if (m.kind === "diameter" && m.hole) {
    count = offered(all).filter((t) => t.kind === "round" && t.hole && t.whole && Math.abs(t.r - m.r) < 1e-6).length;
  }
  const text = `${count > 1 ? `${count}× ` : ""}${m.kind === "diameter" ? "Ø" : "R"}${sizeText(value, places)}`;
  const width = textWidth(text, s.text);
  const w = sub(T, c);
  const d = len(w) < 1e-9 ? ([Math.SQRT1_2, Math.SQRT1_2] as V2) : unit(w);
  if (len(w) <= R) {
    const rim = add(c, d, R);
    const start = m.kind === "diameter" ? add(c, d, -R) : c;
    lines.push([start, rim]);
    arrows.push(arrowAt(rim, d, s));
    if (m.kind === "diameter") arrows.push(arrowAt(start, [-d[0], -d[1]], s));
    let n = perp(d);
    if (n[1] < 0) n = [-n[0], -n[1]];
    return { lines, arcs, arrows, text: { at: add(T, n, LIFT + s.text / 2), turn: 0, text, width }, value, unit: "mm" };
  }
  // Outside: a level shoulder beside the text, then the leader to the rim, its arrow pointing at the centre.
  const side = T[0] >= c[0] ? -1 : 1;
  const edge: V2 = [T[0] + side * (width / 2 + BREAK), T[1]];
  const elbow: V2 = [edge[0] + side * 2, T[1]];
  const toward = len(sub(elbow, c)) > R ? unit(sub(elbow, c)) : d;
  const rim = add(c, toward, R);
  lines.push([edge, elbow], [elbow, rim]);
  arrows.push(arrowAt(rim, [-toward[0], -toward[1]], s));
  return { lines, arcs, arrows, text: { at: T, turn: 0, text, width }, value, unit: "mm" };
}

/** What a dimension is called: "Dimension, 60 mm", "Dimension, Ø6 mm", "Dimension, 45°". */
export const dimName = (art: DimArt) => `Dimension, ${art.text.text}${art.unit === "mm" ? " mm" : ""}`;

/** The kind a set of refs is saved as. */
export const kindOf = (m: Measured): DrawingDimension["kind"] => m.kind;

/** Clear paper between a view and a size placed from the keyboard, mm. */
export const DIM_GAP = 10;

/**
 * Where a size goes with no pointer to say: a level one under the view and an upright one to its left, just clear of
 * it; an angle a little out from its corner; a radius or diameter up and to the right of its circle.
 */
export function defaultSpot(m: Measured, view: ModelView, scale: number, iso = false): { at: V2; across?: "x" | "y" | "aligned" } {
  const { min, max } = view.box;
  const centre: V2 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  const P = (q: V2): V2 => [(q[0] - centre[0]) * scale, (q[1] - centre[1]) * scale];
  const [w, h] = [(max[0] - min[0]) * scale, (max[1] - min[1]) * scale];
  if (m.kind === "linear") {
    const [p, q] = [P(m.p), P(m.q)];
    const c = mid(p, q);
    const d = sub(q, p);
    const level = Math.abs(d[1]) < 1e-6;
    const upright = Math.abs(d[0]) < 1e-6;
    if (m.free && !iso && !level && !upright) {
      return Math.abs(d[0]) >= Math.abs(d[1]) ? { at: [c[0], -h / 2 - DIM_GAP], across: "x" } : { at: [-w / 2 - DIM_GAP, c[1]], across: "y" };
    }
    if (level) return { at: [c[0], -h / 2 - DIM_GAP], across: "aligned" };
    if (upright) return { at: [-w / 2 - DIM_GAP, c[1]], across: "aligned" };
    // On a slant: square out from the line, on the side away from the middle of the view.
    let n = perp(unit(d));
    if (dot(n, c) < 0) n = [-n[0], -n[1]];
    return { at: add(c, n, DIM_GAP), across: "aligned" };
  }
  if (m.kind === "angle") {
    const v = P(m.v);
    // Between the far ends of the two edges, which is the corner you see.
    const far = m.lines.map((l) => {
      const [a, b] = [P(l.a), P(l.b)];
      return unit(sub(len(sub(a, v)) > len(sub(b, v)) ? a : b, v));
    });
    const bis = unit(add(far[0]!, far[1]!));
    return { at: add(v, bis, 15) };
  }
  const c = P(m.c);
  return { at: add(c, [Math.SQRT1_2, Math.SQRT1_2], m.r * scale + 8) };
}

/** What the Dimension tool has picked so far, in one view. */
export interface Pending {
  view: string;
  refs: DrawingRef[];
}

/**
 * The picks after one more: the first starts a size, a second (in the same view) makes it between the two, and a
 * third starts again. Picking the same thing twice lets go of it, and so does a pair that gives no size.
 */
export function addPick(pending: Pending | null, viewId: string, ref: DrawingRef, all: Target[]): Pending | null {
  if (!pending || pending.view !== viewId || pending.refs.length !== 1) return { view: viewId, refs: [ref] };
  if (pickKey(pending.refs[0]!) === pickKey(ref)) return null;
  const both = [pending.refs[0]!, ref];
  return measured(both, all) ? { view: viewId, refs: both } : { view: viewId, refs: [ref] };
}

/** The dimension the picks make with its text at `at` (from the middle of the view), or nothing yet. */
export function draftOf(
  pending: Pending | null,
  all: Target[],
  at: V2 | null,
  view: ModelView,
  scale: number,
  iso = false,
): Omit<DrawingDimension, "id"> | undefined {
  if (!pending) return undefined;
  const m = measured(pending.refs, all);
  if (!m) return undefined;
  const spot = at ? { at } : defaultSpot(m, view, scale, iso);
  const out: Omit<DrawingDimension, "id"> = { view: pending.view, kind: kindOf(m), refs: pending.refs, at: spot.at };
  if (m.kind === "linear") {
    if (!m.free || iso) out.across = "aligned";
    else if (at) {
      const centre: V2 = [(view.box.min[0] + view.box.max[0]) / 2, (view.box.min[1] + view.box.max[1]) / 2];
      const P = (q: V2): V2 => [(q[0] - centre[0]) * scale, (q[1] - centre[1]) * scale];
      out.across = directionAt(P(m.p), P(m.q), at);
    } else out.across = ("across" in spot && spot.across) || "aligned";
  }
  return out;
}

/** Whether a view looks along one of the model's axes. The rest are isometrics, whose sizes only run aligned. */
export const isIso = (toEye: readonly number[]) => toEye.filter((x) => Math.abs(x) > 1e-9).length > 1;
