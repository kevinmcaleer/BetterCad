import {
  frameOf,
  viewScale,
  type AutoRecipe,
  type DatumCorner,
  type DrawingDimension,
  type DrawingMark,
  type DrawingNote,
  type DrawingRef,
  type DrawingSheet,
} from "@bettercad/kernel/drawing";
import type { Feature } from "@bettercad/kernel/document";
import { viewAxes, type ModelView, type V2 } from "@bettercad/kernel/view";
import { arrangeSheet } from "./arrange";
import { defaultSpot, isIso, measured, pickKey, textWidth } from "./dimensions";
import { autoMarks, offered, pitchCircle, refTo, resolve, targets, type Target } from "./marks";

/**
 * Auto dimension (#566): the sizes a sheet's views need, ranked so that the first few are the ones you would put on
 * by hand first. A recipe says how positions are measured (all from one datum, or each from the one before), the
 * datum which corner they start from, and the density how far down the ranked list to go. No DOM here.
 */
export interface AutoOptions {
  recipe: AutoRecipe;
  datum: DatumCorner;
  /** 0 keeps only the overall sizes, 1 keeps everything. */
  density: number;
}
export const AUTO_START: AutoOptions = { recipe: "baseline", datum: "bottom-left", density: 0.5 };

/** What kind of size a candidate is, in the order they are kept: overall sizes first, radii and angles last. */
export const RANKS = ["overall", "hole position", "hole size", "step", "small step", "radius or angle"] as const;

export interface Candidate {
  rank: number;
  /** How long it is, mm: within a rank the longer sizes come first. */
  size: number;
  /** The same size in any view has the same key, so it is shown once. */
  key: string;
  dim: Omit<DrawingDimension, "id" | "at">;
  /** A length's two ends along one of the model's axes, so a later view does not say again what an earlier one has. */
  span?: { axis: number; lo: number; hi: number };
}

/**
 * A Pattern or Mirror of features, as Auto dimension needs it: how many there are and what to say about them. The
 * faces it makes are named for its step (#47), so its copies are known in a view and only the first is measured.
 */
export interface Repeat {
  count: number;
  /** The note beside the one that is measured: "8× equally spaced", "4× 20 mm apart", "2×, mirrored". */
  says: string;
  /** The steps it copies: the faces they made are the first one, which is measured. */
  from: string[];
}
export type Repeats = ReadonlyMap<string, Repeat>;

const mm = (v: number) => `${Math.round(v * 100) / 100 + 0} mm`;

/** The steps of a model that make features again, by id. A pattern of whole bodies is not here: its copies are bodies. */
export function repeatsOf(features: readonly Feature[] | undefined): Map<string, Repeat> {
  const out = new Map<string, Repeat>();
  for (const f of features ?? []) {
    if (f.type !== "pattern" || f.suppressed || (f.of ?? "bodies") !== "features") continue;
    const from = f.features ?? [];
    if (f.kind === "mirror") out.set(f.id, { count: 2, says: "2×, mirrored", from });
    else if (f.kind === "circle" && f.count > 1)
      out.set(f.id, { count: f.count, says: f.angle >= 360 ? `${f.count}× equally spaced` : `${f.count}× over ${Math.round(f.angle * 100) / 100}°`, from });
    else if (f.kind === "rect" && f.count1 * f.count2 > 1) {
      const says =
        f.count2 > 1 && f.count1 > 1
          ? `${f.count1} × ${f.count2}, ${mm(f.spacing1)} and ${mm(f.spacing2)} apart`
          : `${f.count1 * f.count2}× ${mm(f.count1 > 1 ? f.spacing1 : f.spacing2)} apart`;
      out.set(f.id, { count: f.count1 * f.count2, says, from });
    }
  }
  return out;
}

/** The steps a face or edge name was made by: `fmw1:side(l2)|chamfer(fmw3:cap.end|…)` gives fmw1 and fmw3. */
const stepsIn = (name: string | undefined) => (name ? [...name.matchAll(/([A-Za-z0-9_]+):/g)].map((m) => m[1]!) : []);

/**
 * The bodies a view shows that are copies of one shown before it (a wheel and its copy, side by side or one behind
 * the other): the same lengths and the same circles, wherever they are and however they are turned. Only the first is
 * measured.
 */
export function copiedBodies(model: ModelView): Set<string> {
  // An edge partly hidden comes in pieces: each edge's are added up, so a copy behind another reads the same.
  const per = new Map<string, Map<string, number>>();
  for (const e of model.edges) {
    if (!e.source) continue;
    const c = e.curve;
    const key = `${e.source.kind}${e.source.index}`;
    const edges = per.get(e.source.body) ?? new Map<string, number>();
    per.set(e.source.body, edges);
    if (c.kind === "line") edges.set(key, (edges.get(key) ?? 0) + Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]));
    else if (c.kind === "circle" || c.kind === "arc") edges.set(key, -c.r);
  }
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const b of model.bodies.length ? model.bodies : [...per.keys()]) {
    const edges = per.get(b);
    if (!edges) continue;
    const sig = [...edges.values()]
      .map((v) => v.toFixed(1))
      .sort()
      .join(",");
    if (seen.has(sig)) out.add(b);
    else seen.add(sig);
  }
  return out;
}

const EPS = 1e-6;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
/** How far out from its view a pattern's note sits, paper mm. */
const NOTE_GAP = 12;
/** A note's letter height, as `notes.ts` has it. */
const NOTE_TEXT = 3.5;
/** A step this small beside the whole part is a detail: it comes after the bigger steps. */
const SMALL = 0.15;

interface Place {
  /** Where it is along the axis, in the view's millimetres. */
  v: number;
  ref: DrawingRef;
  /** Only hole centres are here, no edges. */
  hole: boolean;
  /** How far it is along the other axis: the nearest to the datum's side is the one measured from. */
  other: number;
}

/** Every distinct position along one axis of a view: where edges end and where holes are. */
function places(points: { p: V2; ref: DrawingRef; hole: boolean }[], axis: 0 | 1, low: boolean): Place[] {
  const by = new Map<number, Place>();
  for (const pt of points) {
    const v = r4(pt.p[axis]);
    const other = pt.p[axis === 0 ? 1 : 0];
    const was = by.get(v);
    if (!was) {
      by.set(v, { v, ref: pt.ref, hole: pt.hole, other });
      continue;
    }
    // An edge end stands for the place before a hole centre does, then the one nearest the datum's side.
    const nearer = low ? other < was.other - EPS : other > was.other + EPS;
    if ((was.hole && !pt.hole) || (was.hole === pt.hole && nearer)) by.set(v, { v, ref: pt.ref, hole: pt.hole, other });
  }
  return [...by.values()].sort((a, b) => a.v - b.v);
}

interface Point {
  p: V2;
  ref: DrawingRef;
  hole: boolean;
  /** A hole's radius. */
  r?: number;
  /** One of a set made again (a pattern's copy, or the third of four holes in a row): it adds no position. */
  copy: boolean;
  /** The end of an edge at a slant: it bounds the view, but a corner of a diamond or a hexagon is no place to measure to. */
  slant?: boolean;
}

/**
 * Holes alike in a set: a bolt circle, or a row evenly spaced. The first of a bolt circle and the first two of a row
 * are enough to place the rest (the hole size says how many there are), so the others are marked as copies.
 */
function holeSets(points: Point[]): void {
  const by = new Map<number, Point[]>();
  for (const p of points) {
    if (!p.hole || p.copy || p.r === undefined) continue;
    const r = Math.round(p.r * 100);
    by.set(r, [...(by.get(r) ?? []), p]);
  }
  for (const set of by.values()) {
    if (set.length < 3) continue;
    set.sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
    const d = (i: number) => [set[i + 1]!.p[0] - set[i]!.p[0], set[i + 1]!.p[1] - set[i]!.p[1]] as V2;
    const step = d(0);
    const row = set.slice(1, -1).every((_, i) => Math.hypot(d(i + 1)[0] - step[0], d(i + 1)[1] - step[1]) < 0.01);
    if (row) set.slice(2).forEach((p) => (p.copy = true));
    else if (pitchCircle(set.map((p) => p.p))) set.slice(1).forEach((p) => (p.copy = true));
  }
}

/** Places closer than this share one size: a chamfer's edge beside a corner, or a hair between two faces. */
const NEAR = 0.015;

/**
 * The places along an axis that are worth a size: the ends of the whole view, then every place not made by a copy,
 * with places closer together than a sliver of the whole (`NEAR`) taken as one. Of those, an end of the view stands
 * for its group, then an edge's end before a hole.
 */
function worthPlaces(points: Point[], axis: 0 | 1, low: boolean): Place[] {
  const every = places(points, axis, low);
  if (every.length < 2) return every;
  const [first, last] = [every[0]!, every[every.length - 1]!];
  const tol = Math.max(0.05, (last.v - first.v) * NEAR);
  const list = [
    first,
    ...places(
      points.filter((p) => !p.copy && !p.slant),
      axis,
      low,
    ).filter((p) => p.v > first.v && p.v < last.v),
    last,
  ];
  const groups: Place[][] = [];
  for (const p of list) {
    const g = groups[groups.length - 1];
    if (g && p.v - g[0]!.v < tol) g.push(p);
    else groups.push([p]);
  }
  // The last group ends at the far end: if it began nearer than that, the far end still stands for it.
  return groups.map((g, i) => (i === 0 ? g[0]! : i === groups.length - 1 ? g[g.length - 1]! : (g.find((p) => !p.hole) ?? g[0]!)));
}

/** The sizes one view offers, for a recipe and datum, unranked, and the notes its patterns need. */
function viewCandidates(
  viewId: string,
  model: ModelView,
  toEye: readonly number[],
  frame: ReturnType<typeof frameOf>,
  o: AutoOptions,
  repeats: Repeats,
): { sizes: Candidate[]; notes: AutoNote[] } {
  if (isIso(toEye)) return { sizes: [], notes: [] };
  // A copy of a body shown before it is not measured again, nor is a pattern's copy of a feature.
  const copied = copiedBodies(model);
  const everything = offered(targets(model)).filter((t) => !copied.has(t.source.body));
  const copyOf = (t: Target) => (repeats.size ? stepsIn(t.source.name).find((s) => repeats.has(s)) : undefined);
  const all = everything.filter((t) => !copyOf(t));
  const seen = new Set(
    model.edges.filter((e) => e.visible && e.source).map((e) => `${e.source!.body}|${e.source!.kind}|${e.source!.name ?? `#${e.source!.index}`}`),
  );
  const keyOf = (t: Target) => `${t.source.body}|${t.source.kind}|${t.source.name ?? `#${t.source.index}`}`;
  const points: Point[] = [];
  for (const t of everything) {
    const copy = !!copyOf(t);
    if (t.kind === "edge" && seen.has(keyOf(t))) {
      const slant = Math.abs(t.a[0] - t.b[0]) > EPS && Math.abs(t.a[1] - t.b[1]) > EPS;
      points.push(
        { p: t.a, ref: { ...refTo(viewId, t), at: "start" }, hole: false, copy, slant },
        { p: t.b, ref: { ...refTo(viewId, t), at: "end" }, hole: false, copy, slant },
      );
    } else if (t.kind === "round" && t.whole && t.source.kind === "face")
      points.push({ p: t.c, ref: { ...refTo(viewId, t), at: "centre" }, hole: true, r: t.r, copy });
  }
  holeSets(points);
  // In a broken view (#571) places are where they truly are, not where they are drawn.
  const real = (model as { real?: (p: V2) => V2 }).real;
  if (real) for (const pt of points) pt.p = real(pt.p);
  const out: Candidate[] = [];
  const axes = viewAxes(frame);
  const centre: V2 = [(model.box.min[0] + model.box.max[0]) / 2, (model.box.min[1] + model.box.max[1]) / 2];

  ([0, 1] as const).forEach((axis) => {
    // Which of the model's axes this is, and which way it runs, so the same size in another view is known for the same.
    const world = axis === 0 ? axes.x : axes.y;
    const wi = world.findIndex((c) => Math.abs(c) > 0.5);
    const sign = Math.sign(world[wi] ?? 1) || 1;
    const span = (a: number, b: number) => ({ axis: wi, lo: r4(Math.min(a * sign, b * sign)), hi: r4(Math.max(a * sign, b * sign)) });
    // Extension lines are shortest from the side the rows are on: under the view for across, left of it for up.
    const low = axis === 0 ? !o.datum.startsWith("top") : !o.datum.endsWith("right");
    const list = worthPlaces(points, axis, low);
    if (list.length < 2) return;
    const [first, last] = [list[0]!, list[list.length - 1]!];
    const overall = last.v - first.v;
    const across = axis === 0 ? "x" : "y";
    const add = (a: Place, b: Place, rank: number) => {
      const sp = span(a.v, b.v);
      const dim: Candidate["dim"] = { view: viewId, kind: "linear", refs: [a.ref, b.ref], across, auto: true };
      out.push({ rank, size: Math.abs(b.v - a.v), key: `lin|${sp.axis}|${sp.lo}|${sp.hi}`, dim, span: sp });
    };
    add(first, last, 0);
    const rankOf = (a: Place, b: Place) => (a.hole || b.hole ? 1 : Math.abs(b.v - a.v) < overall * SMALL ? 4 : 3);
    if (o.recipe === "chain" || o.recipe === "centre-chain") {
      if (list.length < 3) return;
      // With the overall size, one link of the chain says nothing new: the one at the end away from the datum is left
      // out, or the nearest to it that is not to a hole.
      const far = axis === 0 ? o.datum.endsWith("right") : o.datum.startsWith("top");
      const links = [...list.keys()].slice(0, -1);
      const skip = (far ? links : links.reverse()).find((i) => !list[i]!.hole && !list[i + 1]!.hole) ?? -1;
      for (let i = 0; i + 1 < list.length; i++) if (i !== skip) add(list[i]!, list[i + 1]!, rankOf(list[i]!, list[i + 1]!));
      return;
    }
    // Baseline: everything from the datum, which is an end, or the place at the middle when there is one.
    const far = axis === 0 ? o.datum.endsWith("right") : o.datum.startsWith("top");
    const middle = o.datum === "centre" ? list.find((p) => Math.abs(p.v - centre[axis]) < EPS) : undefined;
    const datum = middle ?? (far ? last : first);
    for (const p of list) {
      // The overall size has the far end already; about a middle it has both ends.
      if (p === datum || p === (far ? first : last) || (middle && p === (far ? last : first))) continue;
      add(datum, p, p.hole || datum.hole ? 1 : Math.min(Math.abs(p.v - datum.v), overall - Math.abs(p.v - datum.v)) < overall * SMALL ? 4 : 3);
    }
  });

  // One diameter for each size of hole or circle, and one radius for each size of arc that is not one of those
  // circles in pieces (a rim broken by its cogs).
  const sizes = new Set<string>();
  const rounds = all.filter((t): t is Extract<Target, { kind: "round" }> => t.kind === "round").sort((a, b) => Number(b.whole) - Number(a.whole));
  for (const t of rounds) {
    const key = `${t.whole ? "dia" : "rad"}|${r4(t.r)}`;
    if (sizes.has(key) || (!t.whole && sizes.has(`dia|${r4(t.r)}`))) continue;
    sizes.add(key);
    out.push({ rank: t.whole ? 2 : 5, size: t.r * 2, key, dim: { view: viewId, kind: t.whole ? "diameter" : "radius", refs: [refTo(viewId, t)], auto: true } });
  }

  // The angle of each edge that is not square to the view, from a square edge it meets.
  const lines = all.filter((t): t is Extract<Target, { kind: "edge" }> => t.kind === "edge" && seen.has(keyOf(t)));
  const square = (t: { a: V2; b: V2 }) => Math.abs(t.a[0] - t.b[0]) < EPS || Math.abs(t.a[1] - t.b[1]) < EPS;
  const meet = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS;
  for (const t of lines) {
    if (square(t)) continue;
    const to = lines.find((x) => x !== t && square(x) && (meet(x.a, t.a) || meet(x.a, t.b) || meet(x.b, t.a) || meet(x.b, t.b)));
    if (!to) continue;
    const slope = r4(Math.abs(Math.atan2(t.b[1] - t.a[1], t.b[0] - t.a[0])) % Math.PI);
    out.push({
      rank: 5,
      size: Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]),
      key: `ang|${viewId}|${slope}`,
      dim: { view: viewId, kind: "angle", refs: [refTo(viewId, to), refTo(viewId, t)], auto: true },
    });
  }

  // A note on the first of each pattern's set, saying how many there are and how they are spaced.
  const notes: AutoNote[] = [];
  const shown = new Set(everything.map(copyOf).filter((s): s is string => !!s));
  for (const step of shown) {
    const rep = repeats.get(step)!;
    const firstOne = (t: Target) => stepsIn(t.source.name).some((s) => rep.from.includes(s));
    const on =
      all.find((t) => firstOne(t) && t.kind === "round" && t.whole) ??
      all.find((t) => firstOne(t) && t.kind === "edge" && seen.has(keyOf(t))) ??
      everything.find((t) => copyOf(t) === step && t.kind === "edge" && seen.has(keyOf(t)));
    if (on) notes.push({ step, view: viewId, says: rep.says, on: { ...refTo(viewId, on), at: on.kind === "edge" ? "middle" : "centre" } });
  }
  return { sizes: out, notes };
}

/** A pattern's note as Auto dimension puts it on: a leader to the first of the set. */
export interface AutoNote {
  step: string;
  view: string;
  says: string;
  on: DrawingRef;
}

/**
 * Every size Auto dimension could add to a sheet, best first: overall sizes, hole positions, hole sizes, big steps,
 * small steps, then radii and angles. A size seen in two views is offered once, in the first; one already put on by
 * hand is not offered at all.
 */
export function candidates(sheet: DrawingSheet, viewOf: (id: string) => ModelView | undefined, o: AutoOptions, repeats: Repeats = NONE): Candidate[] {
  return offers(sheet, viewOf, o, repeats).sizes;
}
const NONE: Repeats = new Map();

/** What `candidates` gives, and a note for each pattern, on the first view that shows its copies. */
function offers(sheet: DrawingSheet, viewOf: (id: string) => ModelView | undefined, o: AutoOptions, repeats: Repeats) {
  const found: Candidate[] = [];
  const notes = new Map<string, AutoNote>();
  const known = new Map<number, Set<number>>();
  for (const v of sheet.views) {
    const model = viewOf(v.id);
    // A detail view shows again what its parent has.
    if (!model || v.kind === "detail") continue;
    const frame = frameOf(v.direction);
    const { sizes: mine, notes: said } = viewCandidates(v.id, model, frame.toEye, frame, o, repeats);
    for (const n of said) if (!notes.has(n.step)) notes.set(n.step, n);
    // A length between two places an earlier view has already shown adds nothing here, however it is measured.
    found.push(...mine.filter((c) => !c.span || !(known.get(c.span.axis)?.has(c.span.lo) && known.get(c.span.axis)?.has(c.span.hi))));
    for (const c of mine) {
      if (!c.span) continue;
      const set = known.get(c.span.axis) ?? new Set<number>();
      known.set(c.span.axis, set.add(c.span.lo).add(c.span.hi));
    }
  }
  const refsKey = (d: Pick<DrawingDimension, "view" | "refs">) => `${d.view}|${d.refs.map(pickKey).sort().join("+")}`;
  const byHand = new Set(sheet.dimensions.filter((d) => !d.auto).map(refsKey));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  // Sorting is stable: within a rank and size, the sheet's first view comes first.
  for (const c of [...found].sort((a, b) => a.rank - b.rank || b.size - a.size)) {
    if (seen.has(c.key) || byHand.has(refsKey(c.dim))) continue;
    seen.add(c.key);
    out.push(c);
  }
  return { sizes: out, notes: [...notes.values()] };
}

/** Past the hole sizes, how many of the bigger steps each view gets in the suggested amount. */
const STEPS_EACH = 5;

/**
 * How many sizes you would put on first: the overall sizes, the holes' positions and sizes, and a few of each view's
 * biggest steps. It is what the slider gives at its middle.
 */
export function suggested(list: Candidate[]): number {
  const steps = new Map<string, number>();
  let n = 0;
  for (const c of list) {
    if (c.rank <= 2) n++;
    else if (c.rank === 3) steps.set(c.dim.view, (steps.get(c.dim.view) ?? 0) + 1);
  }
  for (const k of steps.values()) n += Math.min(k, STEPS_EACH);
  return n;
}

/**
 * How many of the ranked sizes a density keeps: the overall sizes at least, all of them at 1, and the suggested
 * amount at the middle, where the slider starts.
 */
export function keep(list: Candidate[], density: number): number {
  if (!list.length) return 0;
  const least = Math.min(list.length, Math.max(1, list.filter((c) => c.rank === 0).length));
  const mid = Math.max(least, Math.min(list.length, suggested(list)));
  const d = Math.max(0, Math.min(1, density));
  return Math.round(d <= 0.5 ? least + (mid - least) * d * 2 : mid + (list.length - mid) * (d - 0.5) * 2);
}

export interface AutoResult {
  sheet: DrawingSheet;
  /** How many sizes were kept, of how many there could be. */
  count: number;
  total: number;
}

/**
 * The sheet with Auto dimension run on it: the automatic sizes from last time are replaced, the ones placed by hand
 * stay, and the new ones are laid out in rows (#565). The centre mark recipes mark every hole first (#563).
 */
export function autoDimension(
  sheet: DrawingSheet,
  viewOf: (id: string) => ModelView | undefined,
  decimals: number,
  o: AutoOptions,
  id: (kind: "dm" | "mk" | "nt") => string,
  repeats: Repeats = NONE,
): AutoResult {
  const { sizes: list, notes: patterns } = offers(sheet, viewOf, o, repeats);
  const count = keep(list, o.density);
  const marks: DrawingMark[] = [...sheet.marks];
  if (o.recipe === "centre-baseline" || o.recipe === "centre-chain") {
    for (const v of sheet.views) {
      const model = viewOf(v.id);
      if (model && !isIso(frameOf(v.direction).toEye)) marks.push(...autoMarks(model, v.id, marks, () => id("mk")));
    }
  }
  const added: DrawingDimension[] = list.slice(0, count).map((c) => {
    // Rows are for lengths and leaders; an angle goes a little out from its corner.
    const v = c.dim.kind === "angle" ? sheet.views.find((x) => x.id === c.dim.view) : undefined;
    const model = v && viewOf(v.id);
    const m = model && measured(c.dim.refs, targets(model));
    const at: V2 = m && model && v ? (defaultSpot(m, model, viewScale(sheet, v)).at.map((n) => Math.round(n * 1e3) / 1e3 + 0) as V2) : [0, 0];
    return { ...c.dim, id: id("dm"), at };
  });
  // A pattern's note goes out beyond its view, level with what it points at, on the side that is nearer.
  const notes: DrawingNote[] = [];
  for (const n of count ? patterns : []) {
    const v = sheet.views.find((x) => x.id === n.view);
    const model = v && viewOf(v.id);
    const t = model && resolve(targets(model), n.on);
    if (!v || !model || !t) continue;
    const s = viewScale(sheet, v);
    const p: V2 =
      t.kind === "edge" ? [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2] : t.kind === "round" ? t.c : [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2];
    const mid: V2 = [(model.box.min[0] + model.box.max[0]) / 2, (model.box.min[1] + model.box.max[1]) / 2];
    const half = ((model.box.max[0] - model.box.min[0]) / 2) * s;
    const right = p[0] >= mid[0];
    const x = right ? half + NOTE_GAP : -half - NOTE_GAP - textWidth(n.says, NOTE_TEXT);
    const at: V2 = [Math.round(x * 1e3) / 1e3 + 0, Math.round(((p[1] - mid[1]) * s + NOTE_TEXT) * 1e3) / 1e3 + 0];
    notes.push({ id: id("nt"), kind: "leader", text: n.says, on: n.on, at, auto: true });
  }
  const kept = (sheet.notes ?? []).filter((n) => !n.auto);
  const next: DrawingSheet = {
    ...sheet,
    marks: marks.length === sheet.marks.length ? sheet.marks : marks,
    ...(notes.length || kept.length !== (sheet.notes ?? []).length ? { notes: [...kept, ...notes] } : {}),
    dimensions: [...sheet.dimensions.filter((d) => !d.auto), ...added],
    auto: { recipe: o.recipe, datum: o.datum, density: o.density },
  };
  return { sheet: arrangeSheet(next, viewOf, decimals, { dimensions: (d) => !!d.auto }), count, total: list.length };
}

export const RECIPES: { id: AutoRecipe; label: string; how: string }[] = [
  { id: "baseline", label: "Baseline", how: "Every position from one corner." },
  { id: "chain", label: "Chain", how: "Each position from the one before." },
  { id: "centre-baseline", label: "Baseline with centre marks", how: "From one corner, with every hole marked." },
  { id: "centre-chain", label: "Chain with centre marks", how: "One after another, with every hole marked." },
];
export const DATUMS: { id: DatumCorner; label: string }[] = [
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "centre", label: "Centre" },
];
