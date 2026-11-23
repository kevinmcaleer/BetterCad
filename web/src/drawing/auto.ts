import {
  frameOf,
  type AutoRecipe,
  type DatumCorner,
  type DrawingDimension,
  type DrawingMark,
  type DrawingRef,
  type DrawingSheet,
} from "@bettercad/kernel/drawing";
import { viewAxes, type ModelView, type V2 } from "@bettercad/kernel/view";
import { arrangeSheet } from "./arrange";
import { isIso, pickKey } from "./dimensions";
import { autoMarks, offered, refTo, targets, type Target } from "./marks";

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

const EPS = 1e-6;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
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

/** The sizes one view offers, for a recipe and datum, unranked. */
function viewCandidates(viewId: string, model: ModelView, toEye: readonly number[], frame: ReturnType<typeof frameOf>, o: AutoOptions): Candidate[] {
  if (isIso(toEye)) return [];
  const all = offered(targets(model));
  const seen = new Set(
    model.edges.filter((e) => e.visible && e.source).map((e) => `${e.source!.body}|${e.source!.kind}|${e.source!.name ?? `#${e.source!.index}`}`),
  );
  const keyOf = (t: Target) => `${t.source.body}|${t.source.kind}|${t.source.name ?? `#${t.source.index}`}`;
  const points: { p: V2; ref: DrawingRef; hole: boolean }[] = [];
  for (const t of all) {
    if (t.kind === "edge" && seen.has(keyOf(t))) {
      points.push({ p: t.a, ref: { ...refTo(viewId, t), at: "start" }, hole: false }, { p: t.b, ref: { ...refTo(viewId, t), at: "end" }, hole: false });
    } else if (t.kind === "round" && t.whole && t.source.kind === "face") points.push({ p: t.c, ref: { ...refTo(viewId, t), at: "centre" }, hole: true });
  }
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
    const list = places(points, axis, low);
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
      if (list.length > 2) for (let i = 0; i + 1 < list.length; i++) add(list[i]!, list[i + 1]!, rankOf(list[i]!, list[i + 1]!));
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

  // One diameter for each size of hole or circle, and one radius for each size of arc.
  const sizes = new Set<string>();
  for (const t of all) {
    if (t.kind !== "round") continue;
    const key = `${t.whole ? "dia" : "rad"}|${r4(t.r)}`;
    if (sizes.has(key)) continue;
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
      key: `ang|${viewId}|${keyOf(t)}|${slope}`,
      dim: { view: viewId, kind: "angle", refs: [refTo(viewId, to), refTo(viewId, t)], auto: true },
    });
  }
  return out;
}

/**
 * Every size Auto dimension could add to a sheet, best first: overall sizes, hole positions, hole sizes, big steps,
 * small steps, then radii and angles. A size seen in two views is offered once, in the first; one already put on by
 * hand is not offered at all.
 */
export function candidates(sheet: DrawingSheet, viewOf: (id: string) => ModelView | undefined, o: AutoOptions): Candidate[] {
  const found: Candidate[] = [];
  const known = new Map<number, Set<number>>();
  for (const v of sheet.views) {
    const model = viewOf(v.id);
    if (!model) continue;
    const frame = frameOf(v.direction);
    const mine = viewCandidates(v.id, model, frame.toEye, frame, o);
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
  return out;
}

/** How many of the ranked sizes a density keeps: the overall sizes at least, all of them at 1. */
export function keep(list: Candidate[], density: number): number {
  const least = Math.min(list.length, Math.max(1, list.filter((c) => c.rank === 0).length));
  const d = Math.max(0, Math.min(1, density));
  return list.length ? Math.round(least + (list.length - least) * d) : 0;
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
  id: (kind: "dm" | "mk") => string,
): AutoResult {
  const list = candidates(sheet, viewOf, o);
  const count = keep(list, o.density);
  const marks: DrawingMark[] = [...sheet.marks];
  if (o.recipe === "centre-baseline" || o.recipe === "centre-chain") {
    for (const v of sheet.views) {
      const model = viewOf(v.id);
      if (model && !isIso(frameOf(v.direction).toEye)) marks.push(...autoMarks(model, v.id, marks, () => id("mk")));
    }
  }
  const added: DrawingDimension[] = list.slice(0, count).map((c) => ({ ...c.dim, id: id("dm"), at: [0, 0] }));
  const next: DrawingSheet = {
    ...sheet,
    marks: marks.length === sheet.marks.length ? sheet.marks : marks,
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
