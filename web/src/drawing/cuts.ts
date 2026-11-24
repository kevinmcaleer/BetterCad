import { frameOf, scaleLabel, viewScale, type DrawingSheet, type DrawingView, type DrawingStandard } from "@bettercad/kernel/drawing";
import { pointsOn, TAU, turn, viewAxes, type ModelView, type V2, type V3, type ViewCurve, type ViewCut, type ViewFrame } from "@bettercad/kernel/view";
import { directionFor, frameFrom, lineUp, spotBeside, type Side } from "./projected";

/**
 * Section, detail and broken views (#571). A section view is the model cut on a plane and seen from the side taken
 * away, its cut faces hatched; a detail view is a circle of another view drawn larger; a break leaves a stretch of a
 * long part out. The kernel does the cutting; everything else here is sums on a view's picture. No DOM.
 */

/** A view's picture as it is drawn, when that is not just what the kernel gave. */
export interface Picture extends ModelView {
  /** Thin solid lines: hatching, break lines, the edge of a detail. In the view's millimetres. */
  thin?: ViewCurve[];
  /** What marks and dimensions are fixed to, when `edges` holds only the pieces that are drawn. */
  whole?: ModelView["edges"];
  /** From where a point is drawn to where it truly is, in a broken view: a size across a break reads true. */
  real?: (p: V2) => V2;
  /** From where a point truly is to where it is drawn. */
  drawn?: (p: V2) => V2;
}

/** Letters for sections and details. I, O and Q are left out: they read as 1 and 0. */
const LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";
export const letterOf = (v: DrawingView) => v.section?.label ?? v.detail?.label;
/** The next letter no section or detail on the sheet has. */
export function nextLetter(sheet: DrawingSheet): string {
  const used = new Set(sheet.views.map(letterOf));
  for (let round = 0; ; round++) for (const l of LETTERS) if (!used.has(round ? `${l}${round}` : l)) return round ? `${l}${round}` : l;
}

/** "Section A-A" or "Detail B", for a view that is one; nothing for any other. */
export function cutName(v: Pick<DrawingView, "kind" | "section" | "detail">): string | undefined {
  if (v.kind === "section" && v.section) return `Section ${v.section.label}-${v.section.label}`;
  if (v.kind === "detail" && v.detail) return `Detail ${v.detail.label}`;
  return undefined;
}
/** What is written over a section or detail view: ISO gives just the letters, ASME says what it is. */
export function caption(v: DrawingView, scale: number, standard: DrawingStandard): string | undefined {
  if (v.kind === "section" && v.section) return standard === "iso" ? `${v.section.label}-${v.section.label}` : `SECTION ${v.section.label}-${v.section.label}`;
  if (v.kind === "detail" && v.detail)
    return standard === "iso" ? `${v.detail.label} (${scaleLabel(scale)})` : `DETAIL ${v.detail.label}, SCALE ${scaleLabel(scale)}`;
  return undefined;
}

const tidy = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const world = (f: ViewFrame, p: V2): V3 => {
  const { x, y } = viewAxes(f);
  return [0, 1, 2].map((i) => tidy(x[i]! * p[0] + y[i]! * p[1])) as V3;
};

/** Which way a cutting line runs on its view: across it, or up it. */
export type CutWay = "across" | "up";

/**
 * The side of the parent a section looks from, as a projected view's would be: a line across is seen from above
 * (from below when flipped), a line up from the right (from the left). `tilt` turns the line, and the side with it,
 * anticlockwise by that many degrees, for a slanted cut.
 */
export const cutSide = (way: CutWay, flip: boolean, tilt = 0): Side => turned(way === "across" ? [0, flip ? -1 : 1] : [flip ? -1 : 1, 0], tilt);
/** The way a cutting line runs: to the right for a line across, up for a line up, turned as the line is. */
export const cutAlong = (way: CutWay, tilt = 0): Side => turned(way === "across" ? [1, 0] : [0, 1], tilt);
const turned = (v: Side, tilt: number): Side => {
  if (!tilt) return v;
  const [cs, sn] = [Math.cos((tilt * Math.PI) / 180), Math.sin((tilt * Math.PI) / 180)];
  return [tidy(v[0] * cs - v[1] * sn), tidy(v[0] * sn + v[1] * cs)];
};

/** How much of the view a section cuts: all of it on one plane, half of it, or on planes stepped from one to the next. */
export type CutKind = "full" | "half" | "stepped";
export interface CutHow {
  kind?: CutKind;
  /** Degrees the cutting line is turned anticlockwise from level or upright. */
  tilt?: number;
  /** A stepped cut: the other places it goes through, in the parent view's millimetres. */
  more?: V2[];
}

/**
 * The cut a line through `through` (in the parent view's millimetres) makes: the part on the looking side goes.
 * A half section takes only what is past `through` along the line; a stepped one goes through each place given,
 * stepping from one plane to the next halfway between them.
 */
export function cutThrough(parent: ViewFrame, through: V2, way: CutWay, flip: boolean, how: CutHow = {}): ViewCut {
  const side = cutSide(way, flip, how.tilt);
  const d = cutAlong(way, how.tilt);
  const normal = world(parent, [side[0], side[1]]);
  if (how.kind === "half") return { origin: world(parent, through), normal, along: world(parent, [d[0], d[1]]), half: true };
  if (how.kind === "stepped" && how.more?.length) {
    const on = (p: V2, v: Side) => p[0] * v[0] + p[1] * v[1];
    const pts = [through, ...how.more].sort((a, b) => on(a, d) - on(b, d));
    const first = pts[0]!;
    const steps: NonNullable<ViewCut["steps"]> = [];
    for (let i = 1; i < pts.length; i++) {
      const offset = tidy(on(pts[i]!, side) - on(first, side));
      // Two places on one plane are one stretch of the cut.
      if (Math.abs(offset - (steps.at(-1)?.offset ?? 0)) < 1e-6) continue;
      steps.push({ at: tidy((on(pts[i - 1]!, d) + on(pts[i]!, d)) / 2 - on(first, d)), offset });
    }
    if (steps.length) return { origin: world(parent, first), normal, along: world(parent, [d[0], d[1]]), steps };
    return { origin: world(parent, first), normal };
  }
  return { origin: world(parent, through), normal };
}

/** What kind of cut a section's is. */
export const cutKind = (cut: ViewCut): CutKind => (cut.half ? "half" : cut.steps?.length ? "stepped" : "full");

/** A section's cutting line as its parent sees it: a point on it, and the side the part taken away is on. Nothing when the parent no longer sees the cut edge on. */
export function cutLine(parent: ViewFrame, cut: ViewCut): { at: V2; side: V2 } | undefined {
  const { x, y, z } = viewAxes(parent);
  if (Math.abs(dot3(cut.normal, z)) > 1e-6) return undefined;
  const n: V2 = [dot3(cut.normal, x), dot3(cut.normal, y)];
  const l = Math.hypot(...n);
  if (l < 1e-9) return undefined;
  return { at: [dot3(cut.origin, x), dot3(cut.origin, y)], side: [n[0] / l + 0, n[1] / l + 0] };
}
const dot3 = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/**
 * A section's cutting line drawn on its parent: its corners in order, in paper mm from the view's middle (y up), and
 * the side taken away. It runs a little past a view `w` by `h` on paper; a half section's starts where its cut does,
 * and a stepped one's jogs at each step. `P` puts a point of the view on paper.
 */
export function cutPath(parent: ViewFrame, cut: ViewCut, P: (p: V2) => V2, scale: number, w: number, h: number): { pts: V2[]; side: V2 } | undefined {
  const line = cutLine(parent, cut);
  if (!line) return undefined;
  const n = line.side;
  let d: V2 = [-n[1], n[0]];
  if (cut.along) {
    const { x, y } = viewAxes(parent);
    if (dot3(cut.along, x) * d[0] + dot3(cut.along, y) * d[1] < 0) d = [-d[0] + 0, -d[1] + 0];
  }
  const o = P(line.at);
  // Along the line, as far as the view's box goes and a little past.
  const reach = Math.abs(d[0]) * (w / 2) + Math.abs(d[1]) * (h / 2) + PAST;
  const mid = o[0] * d[0] + o[1] * d[1];
  const [lo, hi] = [cut.half ? 0 : -reach - mid, reach - mid];
  if (hi - lo < 1) return undefined;
  const at = (t: number, off: number): V2 => [o[0] + d[0] * t + n[0] * off, o[1] + d[1] * t + n[1] * off];
  let off = 0;
  const pts: V2[] = [at(lo, 0)];
  for (const s of cut.half ? [] : [...(cut.steps ?? [])].sort((a, b) => a.at - b.at)) {
    const t = s.at * scale;
    if (t <= lo || t >= hi) {
      // A step off the end of the line: the line starts, or stays, on the plane it leads to.
      if (t <= lo) pts[0] = at(lo, (off = s.offset * scale));
      continue;
    }
    pts.push(at(t, off), at(t, (off = s.offset * scale)));
  }
  pts.push(at(hi, off));
  return { pts, side: n };
}

/** Clear paper between a parent and a slanted section put beside it, mm. */
const BESIDE = 15;

/** Puts a section view on the sheet, beside its parent on the side the standard's projection has it. */
export function placeSection(
  sheet: DrawingSheet,
  id: string,
  parentId: string,
  through: V2,
  way: CutWay,
  flip: boolean,
  angle: "first" | "third",
  size: { w: number; h: number },
  how: CutHow = {},
): DrawingSheet {
  const parent = sheet.views.find((v) => v.id === parentId);
  if (!parent) return sheet;
  const frame = frameOf(parent.direction);
  const from = cutSide(way, flip, how.tilt);
  const slant = !!(from[0] && from[1]);
  // A slanted cut is seen square on: from the side it looks from, with the line it was cut on level or upright.
  const seen: ViewFrame = slant
    ? {
        toEye: world(frame, [from[0], from[1]]),
        up: way === "across" ? (viewAxes(frame).z.map((k) => tidy(-k * (flip ? -1 : 1))) as V3) : world(frame, [...cutAlong(way, how.tilt)] as V2),
      }
    : frameFrom(frame, from);
  const view: DrawingView = {
    id,
    kind: "section",
    parent: parentId,
    shows: parent.shows,
    direction: directionFor(seen),
    hidden: false,
    tangent: parent.tangent,
    at: [0, 0],
    section: { ...cutThrough(frame, through, way, flip, how), label: nextLetter(sheet) },
  };
  // Third angle shows what you see from a side on that side; first angle puts it on the far one.
  const on: Side = angle === "first" ? [-from[0], -from[1]] : from;
  const far = Math.abs(on[0]) * size.w + Math.abs(on[1]) * size.h + BESIDE;
  let at: V2 = slant ? [tidy(parent.at[0] + on[0] * far), tidy(parent.at[1] + on[1] * far)] : spotBeside({ at: parent.at, ...size }, size, on);
  // A second section on the same side goes beyond the first, not on top of it.
  const step = Math.abs(on[0]) * size.w + Math.abs(on[1]) * size.h + BESIDE;
  for (let i = 0; i < 20 && sheet.views.some((v) => Math.hypot(v.at[0] - at[0], v.at[1] - at[1]) < 1); i++)
    at = [tidy(at[0] + on[0] * step), tidy(at[1] + on[1] * step)];
  const next = { ...sheet, views: [...sheet.views, view] };
  return { ...next, views: next.views.map((v) => (v.id === id ? { ...v, at: lineUp(next, view, at) } : v)) };
}

/** Looks at a section from the other side: the other half is cut away, and the view swaps sides of its parent. */
export function flipSection(sheet: DrawingSheet, id: string): DrawingSheet {
  const v = sheet.views.find((x) => x.id === id);
  const parent = v?.parent ? sheet.views.find((x) => x.id === v.parent) : undefined;
  if (!v?.section) return sheet;
  const section = { ...v.section, normal: v.section.normal.map((n) => -n + 0) as V3 };
  // The steps stay where they are: measured the other way along the turned normal.
  if (section.steps) section.steps = section.steps.map((s) => ({ at: s.at, offset: -s.offset + 0 }));
  const f = frameOf(v.direction);
  const direction = directionFor({ toEye: f.toEye.map((n) => -n + 0) as V3, up: f.up });
  const at: V2 = parent ? [2 * parent.at[0] - v.at[0], 2 * parent.at[1] - v.at[1]] : v.at;
  return { ...sheet, views: sheet.views.map((x) => (x.id === id ? { ...x, direction, at, section } : x)) };
}

/** Puts a detail view on the sheet: the circle at `c` (the parent view's millimetres) of radius `r`, at its own scale. */
export function placeDetail(sheet: DrawingSheet, id: string, parentId: string, c: V2, r: number, scale: number, at: V2): DrawingSheet {
  const parent = sheet.views.find((v) => v.id === parentId);
  if (!parent || !(r > 0)) return sheet;
  const view: DrawingView = {
    id,
    kind: "detail",
    parent: parentId,
    shows: parent.shows,
    direction: parent.direction,
    hidden: parent.hidden,
    tangent: parent.tangent,
    scale,
    at,
    detail: { c: [tidy(c[0]), tidy(c[1])], r: tidy(r), label: nextLetter(sheet) },
  };
  if (parent.section) view.section = parent.section;
  return { ...sheet, views: [...sheet.views, view] };
}

/** A stretch of a view left out, in the view's millimetres: `axis` "x" takes a band out across the sheet. */
export type ViewBreak = NonNullable<DrawingView["breaks"]>[number];

/** Adds a break between two places along an axis. One that overlaps another joins it. */
export function addBreak(sheet: DrawingSheet, id: string, axis: "x" | "y", a: number, b: number): DrawingSheet {
  let [from, to] = [tidy(Math.min(a, b)), tidy(Math.max(a, b))];
  if (!(to - from > 1e-6)) return sheet;
  return {
    ...sheet,
    views: sheet.views.map((v) => {
      if (v.id !== id) return v;
      const rest: ViewBreak[] = [];
      for (const k of v.breaks ?? []) {
        if (k.axis === axis && k.from <= to && k.to >= from) [from, to] = [Math.min(from, k.from), Math.max(to, k.to)];
        else rest.push(k);
      }
      return { ...v, breaks: [...rest, { axis, from, to }] };
    }),
  };
}
export function removeBreaks(sheet: DrawingSheet, id: string): DrawingSheet {
  return {
    ...sheet,
    views: sheet.views.map((v) => {
      if (v.id !== id || !v.breaks) return v;
      const next = { ...v };
      delete next.breaks;
      return next;
    }),
  };
}

// ---- Sums on curves ----

/** Hatch lines' spacing on paper, mm, and the clear paper a break leaves. */
export const HATCH = 2.5;
export const BREAK_GAP = 4;

/**
 * Hatching for a cut face: lines at `angle` every `gap` across the inside of an outline given as loose runs of
 * points. Inside is told by counting crossings, so holes stay clear without the runs being in any order.
 */
export function hatch(outline: V2[][], gap: number, angle = Math.PI / 4): [V2, V2][] {
  const [cs, sn] = [Math.cos(angle), Math.sin(angle)];
  // Turned so the hatch lines are level.
  const segs: [number, number, number, number][] = [];
  let [lo, hi] = [Infinity, -Infinity];
  for (const run of outline) {
    for (let i = 1; i < run.length; i++) {
      const [a, b] = [run[i - 1]!, run[i]!];
      const s: [number, number, number, number] = [a[0] * cs + a[1] * sn, -a[0] * sn + a[1] * cs, b[0] * cs + b[1] * sn, -b[0] * sn + b[1] * cs];
      segs.push(s);
      lo = Math.min(lo, s[1], s[3]);
      hi = Math.max(hi, s[1], s[3]);
    }
  }
  const out: [V2, V2][] = [];
  if (!(gap > 0) || !segs.length || (hi - lo) / gap > 5000) return out;
  const back = (x: number, y: number): V2 => [x * cs - y * sn, x * sn + y * cs];
  // Lines sit on a grid from the origin, so two faces of one body hatch in step.
  for (let k = Math.ceil(lo / gap + 1e-9); k * gap < hi; k++) {
    // A hair off the grid, so a line never runs exactly along a level edge.
    const y = k * gap + 1e-7;
    const xs: number[] = [];
    for (const [x0, y0, x1, y1] of segs) if (y0 <= y !== y1 <= y) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1]! - xs[i]! > 1e-6) out.push([back(xs[i]!, y), back(xs[i + 1]!, y)]);
  }
  return out;
}

/** Something a curve is cut at: a circle, or a line square to an axis. */
type Edge = { kind: "circle"; c: V2; r: number } | { kind: "line"; axis: 0 | 1; at: number };

const moved = (c: ViewCurve, f: (p: V2) => V2): ViewCurve => {
  switch (c.kind) {
    case "line":
      return { kind: "line", a: f(c.a), b: f(c.b) };
    case "poly":
      return { kind: "poly", pts: c.pts.map(f) };
    default:
      return { ...c, c: f(c.c) };
  }
};

/** A round curve as a run of points close enough to draw. */
const traced = (c: ViewCurve): V2[] =>
  c.kind === "poly"
    ? c.pts
    : pointsOn(
        c,
        Array.from({ length: 97 }, (_, i) => i / 96),
      );

/**
 * A curve cut where it crosses any of `edges`, as its pieces, each with what `where` says of its middle (pieces it
 * says nothing of are dropped). Lines, circles and arcs stay what they are; anything else is traced first.
 */
function pieces<T>(curve: ViewCurve, edges: Edge[], where: (p: V2) => T | undefined): { curve: ViewCurve; tag: T }[] {
  const out: { curve: ViewCurve; tag: T }[] = [];
  const line = (a: V2, b: V2) => {
    const d: V2 = [b[0] - a[0], b[1] - a[1]];
    const ts = [0, 1];
    for (const e of edges) {
      if (e.kind === "line") {
        if (Math.abs(d[e.axis]) > 1e-12) ts.push((e.at - a[e.axis]) / d[e.axis]);
        continue;
      }
      const f: V2 = [a[0] - e.c[0], a[1] - e.c[1]];
      const [qa, qb, qc] = [d[0] * d[0] + d[1] * d[1], 2 * (f[0] * d[0] + f[1] * d[1]), f[0] * f[0] + f[1] * f[1] - e.r * e.r];
      const disc = qb * qb - 4 * qa * qc;
      if (qa > 1e-18 && disc > 0) ts.push((-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa));
    }
    const cuts = [...new Set(ts.filter((t) => t >= 0 && t <= 1))].sort((x, y) => x - y);
    const at = (t: number): V2 => [a[0] + d[0] * t, a[1] + d[1] * t];
    const got: { a: V2; b: V2; tag: T }[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [t0, t1] = [cuts[i]!, cuts[i + 1]!];
      if (t1 - t0 < 1e-9) continue;
      const tag = where(at((t0 + t1) / 2));
      if (tag !== undefined) got.push({ a: at(t0), b: at(t1), tag });
    }
    return got;
  };
  if (curve.kind === "line") {
    for (const p of line(curve.a, curve.b)) out.push({ curve: { kind: "line", a: p.a, b: p.b }, tag: p.tag });
    return out;
  }
  if (curve.kind === "circle" || curve.kind === "arc") {
    const { c, r } = curve;
    const from = curve.kind === "arc" ? curve.from : 0;
    const sweep = curve.kind === "arc" ? turn(curve.to - curve.from) || TAU : TAU;
    const angles: number[] = [];
    for (const e of edges) {
      if (e.kind === "line") {
        const k = (e.at - c[e.axis]) / r;
        if (Math.abs(k) >= 1) continue;
        const t = e.axis === 0 ? Math.acos(k) : Math.asin(k);
        angles.push(t, e.axis === 0 ? -t : Math.PI - t);
        continue;
      }
      const d = Math.hypot(e.c[0] - c[0], e.c[1] - c[1]);
      if (d < 1e-12 || d >= r + e.r || d <= Math.abs(r - e.r)) continue;
      const base = Math.atan2(e.c[1] - c[1], e.c[0] - c[0]);
      const half = Math.acos((d * d + r * r - e.r * e.r) / (2 * d * r));
      angles.push(base - half, base + half);
    }
    const on = (t: number): V2 => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
    const inside = angles.map((t) => turn(t - from)).filter((t) => t > 1e-9 && t < sweep - 1e-9);
    if (!inside.length) {
      const tag = where(on(from + sweep / 2));
      if (tag !== undefined) out.push({ curve, tag });
      return out;
    }
    const cuts = [0, ...inside.sort((x, y) => x - y), sweep];
    // A whole circle has no start: its first and last pieces are one.
    if (curve.kind === "circle") cuts.splice(0, cuts.length, ...inside, inside[0]! + TAU);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [t0, t1] = [cuts[i]!, cuts[i + 1]!];
      if (t1 - t0 < 1e-9) continue;
      const tag = where(on(from + (t0 + t1) / 2));
      if (tag !== undefined) out.push({ curve: { kind: "arc", c, r, from: turn(from + t0), to: turn(from + t1) }, tag });
    }
    return out;
  }
  // Traced: each straight step is cut, and steps that stay together with the same word are one run again.
  const pts = traced(curve);
  let run: { pts: V2[]; tag: T } | undefined;
  const flush = () => {
    if (run && run.pts.length > 1) out.push({ curve: { kind: "poly", pts: run.pts }, tag: run.tag });
    run = undefined;
  };
  for (let i = 1; i < pts.length; i++) {
    const got = line(pts[i - 1]!, pts[i]!);
    for (const p of got) {
      const joins = run && run.tag === p.tag && Math.hypot(run.pts.at(-1)![0] - p.a[0], run.pts.at(-1)![1] - p.a[1]) < 1e-9;
      if (!joins) {
        flush();
        run = { pts: [p.a], tag: p.tag };
      }
      run!.pts.push(p.b);
    }
    if (!got.length) flush();
  }
  flush();
  return out;
}

const boxMid = (b: ModelView["box"]): V2 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];

/** The hatching of a section view's cut faces: each body's at its own angle, so parts that touch read apart. */
function hatching(view: ModelView, gap: number): ViewCurve[] {
  const out: ViewCurve[] = [];
  (view.cuts ?? []).forEach((c, i) => {
    for (const [a, b] of hatch(c.outline, i % 3 === 2 ? gap * 0.6 : gap, i % 2 ? (3 * Math.PI) / 4 : Math.PI / 4)) out.push({ kind: "line", a, b });
  });
  return out;
}

/** A view's picture cut down to a circle of it, for a detail view. */
function detailed(view: ModelView, thin: ViewCurve[], c: V2, r: number): Picture {
  const ring: Edge = { kind: "circle", c, r };
  const inside = (p: V2) => (Math.hypot(p[0] - c[0], p[1] - c[1]) < r ? true : undefined);
  const edges: ModelView["edges"] = [];
  const whole: ModelView["edges"] = [];
  for (const e of view.edges) {
    const kept = pieces(e.curve, [ring], inside);
    if (!kept.length) continue;
    whole.push(e);
    for (const k of kept) edges.push({ ...e, curve: k.curve });
  }
  const lines = thin.flatMap((t) => pieces(t, [ring], inside).map((k) => k.curve));
  lines.push({ kind: "circle", c, r });
  const rounds = view.rounds.filter((round) => {
    const s = round as unknown as { seen: "end"; c: V2 } | { seen: "side"; a: V2; b: V2 };
    return s.seen === "end" ? inside(s.c) : inside(s.a) || inside(s.b);
  });
  return { ...view, edges, whole, thin: lines, rounds, box: { min: [c[0] - r, c[1] - r], max: [c[0] + r, c[1] + r] } };
}

/** A break line: straight, with a zigzag in the middle, along `axis` at `at` from `lo` to `hi`. */
function breakLine(axis: 0 | 1, at: number, lo: number, hi: number, jog: number): ViewCurve {
  const mid = (lo + hi) / 2;
  const along = [lo, mid - jog, mid - jog / 2, mid + jog / 2, mid + jog, hi];
  const off = [0, 0, jog, -jog, 0, 0];
  return { kind: "poly", pts: along.map((v, i): V2 => (axis === 0 ? [at + off[i]!, v] : [v, at + off[i]!])) };
}

/** A view's picture with stretches left out and what is beyond them drawn closer, for a broken view. */
function broken(view: ModelView, thin: ViewCurve[], breaks: ViewBreak[], gap: number): Picture {
  const bands = ([0, 1] as const).map((axis) =>
    breaks.filter((b) => (b.axis === "x" ? 0 : 1) === axis && b.to > view.box.min[axis] && b.from < view.box.max[axis]).sort((a, b) => a.from - b.from),
  );
  if (!bands[0].length && !bands[1].length) return thin.length ? { ...view, thin } : view;
  // Along each axis: what is past a band comes back by the band's width, less the gap it leaves; a place inside a
  // band lands in the gap.
  const squash = (axis: 0 | 1, t: number) => {
    let by = 0;
    for (const b of bands[axis]) {
      if (t >= b.to) by += b.to - b.from - gap;
      else if (t > b.from) by += (t - b.from) * (1 - gap / (b.to - b.from));
    }
    return t - by;
  };
  const stretch = (axis: 0 | 1, t: number) => {
    let at = t;
    for (const b of bands[axis]) {
      if (at >= b.from + gap) at += b.to - b.from - gap;
      else if (at > b.from) at = b.from + ((at - b.from) / gap) * (b.to - b.from);
    }
    return at;
  };
  const drawn = (p: V2): V2 => [squash(0, p[0]), squash(1, p[1])];
  const real = (p: V2): V2 => [stretch(0, p[0]), stretch(1, p[1])];
  const edgesAt: Edge[] = bands.flatMap((list, axis) =>
    list.flatMap((b): Edge[] => [
      { kind: "line", axis: axis as 0 | 1, at: b.from },
      { kind: "line", axis: axis as 0 | 1, at: b.to },
    ]),
  );
  const out = (p: V2) => (bands.some((list, axis) => list.some((b) => p[axis as 0 | 1] > b.from && p[axis as 0 | 1] < b.to)) ? undefined : true);
  // Each piece lies between bands, so it moves as one.
  const shifted = (c: ViewCurve): ViewCurve => {
    const [m] = pointsOn(c) as [V2];
    const to = drawn(m);
    return moved(c, (p) => [p[0] + to[0] - m[0], p[1] + to[1] - m[1]]);
  };
  const cutUp = (c: ViewCurve) => pieces(c, edgesAt, out).map((k) => shifted(k.curve));
  const edges = view.edges.flatMap((e) => cutUp(e.curve).map((curve) => ({ ...e, curve })));
  // Marks and dimensions are fixed to the whole edges, their ends where they are drawn.
  const whole = view.edges.map((e) =>
    e.curve.kind === "line" || e.curve.kind === "circle" || e.curve.kind === "arc" ? { ...e, curve: moved(e.curve, drawn) } : e,
  );
  const rounds = view.rounds.map((round) => {
    const s = round as unknown as { seen: "end"; c: V2 } | { seen: "side"; a: V2; b: V2 };
    return (s.seen === "end" ? { ...round, c: drawn(s.c) } : { ...round, a: drawn(s.a), b: drawn(s.b) }) as unknown as typeof round;
  });
  const box = { min: drawn(view.box.min), max: drawn(view.box.max) };
  const lines = thin.flatMap(cutUp);
  const jog = gap / 4;
  bands.forEach((list, a) => {
    const axis = a as 0 | 1;
    const other = axis === 0 ? 1 : 0;
    for (const b of list) {
      const at = squash(axis, b.from);
      for (const edge of [at, at + gap]) lines.push(breakLine(axis, edge, box.min[other] - jog * 2, box.max[other] + jog * 2, jog));
    }
  });
  return { ...view, edges, whole, thin: lines, rounds, box, real, drawn };
}

const made = new WeakMap<ModelView, Map<string, ModelView>>();

/**
 * A view's picture as its view draws it: hatched where it is cut, cut down to its circle for a detail, and closed
 * up over its breaks. The kernel's own picture when the view is none of these. Kept, so asking twice gives the same.
 */
export function pictured(raw: ModelView, v: Pick<DrawingView, "kind" | "detail" | "breaks">, scale: number): ModelView {
  const detail = v.kind === "detail" ? v.detail : undefined;
  if (!raw.cuts?.length && !detail && !v.breaks?.length) return raw;
  const key = JSON.stringify([detail ?? 0, v.breaks ?? 0, scale]);
  let by = made.get(raw);
  if (!by) made.set(raw, (by = new Map()));
  let out = by.get(key);
  if (!out) {
    const thin = hatching(raw, HATCH / scale);
    out = detail ? detailed(raw, thin, detail.c, detail.r) : broken(raw, thin, v.breaks ?? [], BREAK_GAP / scale);
    by.set(key, out);
  }
  return out;
}

/** Every view's picture as drawn, from the kernel's. */
export function picturesOf(sheet: DrawingSheet, rawOf: (id: string) => ModelView | undefined): (id: string) => ModelView | undefined {
  return (id) => {
    const raw = rawOf(id);
    const v = raw && sheet.views.find((x) => x.id === id);
    return raw && v ? pictured(raw, v, viewScale(sheet, v)) : raw;
  };
}

/** A point of a view's own millimetres as paper millimetres from the middle of the view, y up. */
export const onPaper = (view: ModelView, scale: number) => {
  const mid = boxMid(view.box);
  const place = (view as Picture).drawn ?? ((p: V2) => p);
  return (p: V2): V2 => {
    const q = place(p);
    return [(q[0] - mid[0]) * scale, (q[1] - mid[1]) * scale];
  };
};

/** What is drawn over and round a view for the sections and details taken from it, and its own caption. Paper mm from the view's middle, y up. */
export interface CutArt {
  /** Cutting lines: thin chain lines. */
  chain: [V2, V2][];
  /** Their thick ends. */
  thick: [V2, V2][];
  /** Arrowheads showing which way a section looks. */
  arrows: [V2, V2, V2][];
  /** Detail circles. */
  rings: { c: V2; r: number }[];
  labels: { at: V2; text: string; size: number }[];
}

/** Letter height for section and detail letters, and how far a cutting line runs past the part, mm on paper. */
export const CUT_TEXT = 5;
const PAST = 6;
const HEAD = 4;

export function cutArt(sheet: DrawingSheet, v: DrawingView, viewOf: (id: string) => ModelView | undefined): CutArt {
  const art: CutArt = { chain: [], thick: [], arrows: [], rings: [], labels: [] };
  const view = viewOf(v.id);
  if (!view) return art;
  const scale = viewScale(sheet, v);
  const P = onPaper(view, scale);
  const [w, h] = [(view.box.max[0] - view.box.min[0]) * scale, (view.box.max[1] - view.box.min[1]) * scale];
  for (const child of sheet.views) {
    if (child.parent !== v.id) continue;
    if (child.kind === "section" && child.section) {
      const path = cutPath(frameOf(v.direction), child.section, P, scale, w, h);
      if (!path) continue;
      const { pts, side: n } = path;
      for (let i = 1; i < pts.length; i++) art.chain.push([pts[i - 1]!, pts[i]!]);
      const toward = (a: V2, b: V2, by: number): V2 => {
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [a[0] + ((b[0] - a[0]) / l) * Math.min(by, l), a[1] + ((b[1] - a[1]) / l) * Math.min(by, l)];
      };
      // Thick where the line turns, so a step reads as one.
      for (let i = 1; i + 1 < pts.length; i++) art.thick.push([toward(pts[i]!, pts[i - 1]!, HEAD), pts[i]!], [pts[i]!, toward(pts[i]!, pts[i + 1]!, HEAD)]);
      const ends: [V2, V2][] = [
        [pts[0]!, pts[1]!],
        [pts.at(-1)!, pts.at(-2)!],
      ];
      ends.forEach(([end, next], i) => {
        const inward = toward(end, next, PAST);
        art.thick.push([end, inward]);
        // A half section is marked where it is cut from: one arrow, at the end the cut runs out to.
        if (child.section!.half && i === 0) return;
        const d: V2 = [(inward[0] - end[0]) / PAST, (inward[1] - end[1]) / PAST];
        // The arrow points the way the section looks: at what is left, away from what was taken.
        const tail: V2 = [end[0] + n[0] * (HEAD + 4), end[1] + n[1] * (HEAD + 4)];
        const back: V2 = [end[0] + n[0] * HEAD, end[1] + n[1] * HEAD];
        art.chain.push([back, tail]);
        art.arrows.push([end, [back[0] + d[0] * (HEAD / 3), back[1] + d[1] * (HEAD / 3)], [back[0] - d[0] * (HEAD / 3), back[1] - d[1] * (HEAD / 3)]]);
        art.labels.push({ at: [tail[0] + n[0] * (CUT_TEXT * 0.7), tail[1] + n[1] * (CUT_TEXT * 0.7)], text: child.section!.label, size: CUT_TEXT });
      });
    } else if (child.kind === "detail" && child.detail) {
      const c = P(child.detail.c);
      const r = child.detail.r * scale;
      art.rings.push({ c, r });
      const k = Math.SQRT1_2;
      art.labels.push({ at: [c[0] + (r + CUT_TEXT * 0.7) * k, c[1] + (r + CUT_TEXT * 0.7) * k], text: child.detail.label, size: CUT_TEXT });
    }
  }
  const own = caption(v, scale, sheet.standard);
  if (own) art.labels.push({ at: [0, Math.max(h, 20) / 2 + 2 + CUT_TEXT], text: own, size: CUT_TEXT });
  return art;
}

/** A click on a view (paper mm from its middle, y up) as a place in the model the view shows, in its own millimetres. */
export function viewPoint(view: ModelView, scale: number, at: V2): V2 {
  const mid = boxMid(view.box);
  const p: V2 = [mid[0] + at[0] / scale, mid[1] + at[1] / scale];
  return (view as Picture).real?.(p) ?? p;
}

/**
 * Where a cutting line or a detail's centre snaps to: the centre of a hole or the middle of the view when the
 * pointer is within `reach` (the view's millimetres) of one, so a section goes through a hole's axis.
 */
export function snapPoint(view: ModelView, p: V2, reach: number): V2 {
  const spots: V2[] = [boxMid(view.box)];
  for (const round of view.rounds) {
    const s = round as unknown as { seen: "end"; c: V2 } | { seen: "side"; a: V2; b: V2 };
    spots.push(s.seen === "end" ? s.c : [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]);
  }
  const out: V2 = [p[0], p[1]];
  for (const axis of [0, 1] as const) {
    let best = reach;
    for (const s of spots) {
      const d = Math.abs(s[axis] - p[axis]);
      if (d < best) [best, out[axis]] = [d, s[axis]];
    }
  }
  return out;
}
