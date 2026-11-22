/**
 * Remove duplicates: curves and points that sit on top of each other, within a tight tolerance, go down to one. Points
 * merge into one (the curves on them then share it), identical lines, circles, arcs, splines and ellipses go down to one,
 * and a line lying wholly along another line goes. The one kept is the one holding constraints or sizes, and what was on
 * the others moves over to it. Projected geometry is never removed, and normal and construction geometry are never
 * duplicates of each other. Loaded on first use (`@bettercad/sketch/dedupe`).
 */
import { SketchIndex, constraintRefs, curvePoints, type Constraint, type Curve, type Dimension, type Entity, type Id, type Sketch } from "./model";

/** How close two points or radii must be to count as the same, mm. */
export const DUPLICATE_TOL = 0.001;

export interface DedupeResult {
  sketch: Sketch;
  /** Curves and lone points removed. */
  removed: number;
  /** Curve ends that sat on the same spot and now share one point. */
  joined: number;
}

/**
 * Removes duplicates of `scope` (ids of picked curves and points; a curve brings its points): anything sitting on
 * top of one of them, picked or not. With `scope` empty or missing, across the whole sketch.
 */
export function removeDuplicates(s: Sketch, scope?: Id[], tol = DUPLICATE_TOL): DedupeResult {
  const idx = new SketchIndex(s);
  const inScope = scopeOf(s, idx, scope);
  const uses = refCounts(s);
  const curveUsers = new Map<Id, Curve[]>();
  for (const e of s.entities) if (e.kind !== "point") for (const p of curvePoints(e)) curveUsers.set(p, [...(curveUsers.get(p) ?? []), e]);
  const order = new Map(s.entities.map((e, i) => [e.id, i]));
  // Projected first, then what holds the most constraints and sizes, then (points) what curves use; ties go to the
  // earlier one, as the sorts below are stable.
  const score = (e: Entity) => (e.projectedFrom ? 1e6 : 0) + (uses.get(e.id) ?? 0) + Math.min(curveUsers.get(e.id)?.length ?? 0, 9) / 10;

  // ---- points: group those within `tol`, and merge each group into its best point.
  const merge = new Map<Id, Id>();
  const pts = s.entities.filter((e): e is Extract<Entity, { kind: "point" }> => e.kind === "point");
  const cell = (v: number) => Math.floor(v / tol);
  const grid = new Map<string, typeof pts>();
  for (const p of pts) {
    const k = `${cell(p.x)},${cell(p.y)}`;
    grid.set(k, [...(grid.get(k) ?? []), p]);
  }
  const seen = new Set<Id>();
  for (const p of pts) {
    if (seen.has(p.id)) continue;
    const group: typeof pts = [];
    const stack = [p];
    seen.add(p.id);
    while (stack.length) {
      const q = stack.pop()!;
      group.push(q);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const o of grid.get(`${cell(q.x) + i},${cell(q.y) + j}`) ?? [])
            if (!seen.has(o.id) && Math.hypot(o.x - q.x, o.y - q.y) <= tol) {
              seen.add(o.id);
              stack.push(o);
            }
    }
    if (group.length < 2 || !group.some((q) => inScope.has(q.id))) continue;
    group.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    group.sort((a, b) => score(b) - score(a));
    const keep = group[0]!;
    // Points already joined into the kept one, to stop a curve's own two ends merging (that would leave it with none).
    const into = new Set<Id>([keep.id]);
    for (const q of group.slice(1)) {
      if (q.projectedFrom) continue;
      const own = curveUsers.get(q.id) ?? [];
      if (own.some((c) => curvePoints(c).some((x) => into.has(x)))) continue;
      merge.set(q.id, keep.id);
      into.add(q.id);
    }
  }
  const mp = (id: Id) => merge.get(id) ?? id;
  let joined = 0;
  let removed = 0;
  for (const id of merge.keys()) {
    if (curveUsers.has(id)) joined++;
    else removed++;
  }

  // ---- curves, their points now shared: identical ones go down to one.
  const entities = s.entities.filter((e) => !merge.has(e.id)).map((e) => remapEntity(e, mp));
  const after = new SketchIndex({ ...s, entities });
  const drop = new Map<Id, Id>();
  /** Lines removed that ran the other way to the one kept, for angle sizes. */
  const reversed = new Set<Id>();
  const curves = entities.filter((e): e is Curve => e.kind !== "point");
  const pass = (list: Curve[]) => {
    const groups = new Map<string, Curve[]>();
    for (const c of list) {
      const k = keyOf(c, (id) => drop.get(id) ?? id);
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    for (const g of groups.values())
      for (const run of byRadius(g, tol)) {
        if (run.length < 2 || !run.some((c) => inScope.has(c.id))) continue;
        run.sort((a, b) => score(b) - score(a));
        const keep = run[0]!;
        for (const c of run.slice(1)) {
          if (c.projectedFrom) continue;
          drop.set(c.id, keep.id);
          if (c.kind === "line" && keep.kind === "line" && c.a === keep.b) reversed.add(c.id);
        }
      }
  };
  pass(curves.filter((c) => c.kind !== "ellipse"));
  // Ellipses after lines, as they are known by their axis lines.
  pass(curves.filter((c) => c.kind === "ellipse"));

  // ---- a line lying wholly along another goes too, unless it carries a size of its own.
  const onLine: Constraint[] = [];
  const lines = curves.filter((c): c is Extract<Curve, { kind: "line" }> => c.kind === "line" && !drop.has(c.id));
  const dimmed = new Set(s.dimensions.flatMap((d) => d.refs));
  const axes = new Set(entities.flatMap((e) => (e.kind === "ellipse" ? [e.ax1, e.ax2] : [])));
  /** Lines removed for lying along a longer one, rather than for being the same line. */
  const along = new Set<Id>();
  for (const b of lines) {
    if (b.projectedFrom || dimmed.has(b.id) || axes.has(b.id) || drop.has(b.id)) continue;
    const pb = [after.xy(b.a), after.xy(b.b)] as const;
    const host = lines.find(
      (a) => a !== b && !drop.has(a.id) && !axes.has(a.id) && !!a.construction === !!b.construction && longer(after, a, b) && pb.every((p) => onSegment(p, after.xy(a.a), after.xy(a.b), tol)),
    );
    if (!host || !(inScope.has(b.id) || inScope.has(host.id))) continue;
    drop.set(b.id, host.id);
    along.add(b.id);
    const [ha, hb] = [after.xy(host.a), after.xy(host.b)];
    const [ba, bb] = pb;
    if ((bb[0] - ba[0]) * (hb[0] - ha[0]) + (bb[1] - ba[1]) * (hb[1] - ha[1]) < 0) reversed.add(b.id);
    // Its ends stay on the line they lay along, if anything else holds them.
    for (const p of [b.a, b.b]) {
      if (p === host.a || p === host.b) continue;
      const held = entities.some((e) => e.kind !== "point" && e.id !== b.id && curvePoints(e).includes(p)) || (uses.get(p) ?? 0) > 0;
      if (held) onLine.push({ id: `${b.id}-on-${p}`, type: "pointOn", p, e: host.id });
    }
  }
  removed += drop.size;

  const re = (id: Id) => drop.get(id) ?? mp(id);
  const kept = entities.filter((e) => !drop.has(e.id)).map((e) => remapEntity(e, re));
  // Points left with no curve, size, constraint or text on them, that a removed curve brought, go with it.
  const goneCurves = new Set(drop.keys());
  const orphan = new Set<Id>();
  for (const id of goneCurves) {
    const c = idx.get(id);
    if (!c || c.kind === "point") continue;
    for (const p of curvePoints(c)) {
      const q = mp(p);
      const stillUsed = kept.some((e) => e.kind !== "point" && curvePoints(e).includes(q)) || (uses.get(q) ?? 0) > 0 || onLine.some((k) => k.type === "pointOn" && k.p === q);
      if (!stillUsed) orphan.add(q);
    }
  }
  const finalEntities = kept.filter((e) => !orphan.has(e.id));
  const fin = new SketchIndex({ ...s, entities: finalEntities });

  const constraints = cleanConstraints(
    [...s.constraints.map((c) => remapConstraint(c, re, along)), ...onLine].filter((c): c is Constraint => !!c),
    fin,
  );
  const dimensions = cleanDimensions(
    s.dimensions.map((d) => remapDimension(d, re, reversed)),
    (id) => !!fin.get(id),
  );
  const texts = s.texts?.map((t) => (merge.has(t.p) ? { ...t, p: mp(t.p) } : t));
  return { sketch: { ...s, entities: finalEntities, constraints, dimensions, ...(texts ? { texts } : {}) }, removed, joined };
}

function scopeOf(s: Sketch, idx: SketchIndex, scope?: Id[]): Set<Id> {
  if (!scope?.length) return new Set(s.entities.map((e) => e.id));
  const out = new Set<Id>();
  const add = (id: Id) => {
    const e = idx.get(id);
    if (!e || out.has(id)) return;
    out.add(id);
    if (e.kind === "point") return;
    for (const p of curvePoints(e)) out.add(p);
    if (e.kind === "ellipse") [e.ax1, e.ax2].forEach(add);
  };
  scope.forEach(add);
  return out;
}

/** How many constraints, sizes and texts hold each entity. */
function refCounts(s: Sketch): Map<Id, number> {
  const out = new Map<Id, number>();
  const bump = (id: Id) => out.set(id, (out.get(id) ?? 0) + 1);
  for (const c of s.constraints) constraintRefs(c).forEach(bump);
  for (const d of s.dimensions) d.refs.forEach(bump);
  for (const t of s.texts ?? []) bump(t.p);
  return out;
}

function remapEntity(e: Entity, f: (id: Id) => Id): Entity {
  switch (e.kind) {
    case "point":
      return e;
    case "line":
      return { ...e, a: f(e.a), b: f(e.b) };
    case "circle":
      return { ...e, c: f(e.c) };
    case "arc":
      return { ...e, c: f(e.c), a: f(e.a), b: f(e.b) };
    case "ellipse":
      return { ...e, c: f(e.c), ax1: f(e.ax1), ax2: f(e.ax2) };
    case "spline":
      return { ...e, pts: e.pts.map(f) };
  }
}

/** Curves with the same key are the same shape, bar a circle's or arc's radius. */
function keyOf(c: Curve, f: (id: Id) => Id): string {
  const con = c.construction ? "c" : "n";
  switch (c.kind) {
    case "line":
      return ["line", con, ...[c.a, c.b].sort()].join("|");
    case "circle":
      return ["circle", con, c.c].join("|");
    case "arc":
      // An arc runs anticlockwise from a to b, so the same ends the other way round is the rest of the circle.
      return ["arc", con, c.c, c.a, c.b].join("|");
    case "ellipse":
      return ["ellipse", con, c.c, ...[f(c.ax1), f(c.ax2)].sort()].join("|");
    case "spline": {
      const fwd = c.pts.join(",");
      const back = [...c.pts].reverse().join(",");
      return ["spline", con, c.closed ? "o" : "-", fwd < back ? fwd : back].join("|");
    }
  }
}

/** A group split into runs of radii within `tol` of the next; curves without a radius stay as one run. */
function byRadius(g: Curve[], tol: number): Curve[][] {
  const r = (c: Curve) => (c.kind === "circle" || c.kind === "arc" ? c.r : 0);
  const sorted = [...g].sort((a, b) => r(a) - r(b));
  const runs: Curve[][] = [];
  for (const c of sorted) {
    const last = runs[runs.length - 1];
    if (last && r(c) - r(last[last.length - 1]!) <= tol) last.push(c);
    else runs.push([c]);
  }
  // Back in sketch order, so ties go to the earlier curve.
  return runs.map((run) => g.filter((c) => run.includes(c)));
}

const len = (idx: SketchIndex, l: { a: Id; b: Id }) => {
  const [a, b] = [idx.xy(l.a), idx.xy(l.b)];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
};
/** `a` is longer than `b`, or as long with the earlier id, so of two the same only one gives way. */
const longer = (idx: SketchIndex, a: { id: Id; a: Id; b: Id }, b: { id: Id; a: Id; b: Id }) => {
  const d = len(idx, a) - len(idx, b);
  return d > 1e-12 || (Math.abs(d) <= 1e-12 && a.id < b.id);
};

function onSegment(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number], tol: number): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < tol * tol) return false;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  const l = Math.sqrt(l2);
  if (t < -tol / l || t > 1 + tol / l) return false;
  const tc = Math.min(1, Math.max(0, t));
  return Math.hypot(a[0] + dx * tc - p[0], a[1] + dy * tc - p[1]) <= tol;
}

/**
 * The constraint on what was kept. Equal and Midpoint on a line that only lay along a longer one would not hold for
 * that line, so they are dropped.
 */
function remapConstraint(c: Constraint, f: (id: Id) => Id, along: Set<Id>): Constraint | null {
  if ((c.type === "equal" && (along.has(c.a) || along.has(c.b))) || (c.type === "midpoint" && along.has(c.line))) return null;
  switch (c.type) {
    case "coincident":
    case "parallel":
    case "perpendicular":
    case "tangent":
    case "equal":
    case "concentric":
      return { ...c, a: f(c.a), b: f(c.b) };
    case "pointOn":
      return { ...c, p: f(c.p), e: f(c.e) };
    case "horizontal":
    case "vertical":
      return c.b ? { ...c, e: f(c.e), b: f(c.b) } : { ...c, e: f(c.e) };
    case "midpoint":
      return { ...c, p: f(c.p), line: f(c.line) };
    case "fix":
      return { ...c, p: f(c.p) };
    case "symmetric":
      return { ...c, a: f(c.a), b: f(c.b), line: f(c.line) };
  }
}

/** Drops constraints that now name the same thing twice, hold a curve's own end on it, or repeat another. */
function cleanConstraints(list: Constraint[], idx: SketchIndex): Constraint[] {
  const seen = new Set<string>();
  const out: Constraint[] = [];
  const ends = (id: Id) => {
    const e = idx.get(id);
    return e && e.kind !== "point" ? curvePoints(e) : [];
  };
  const exists = (id: Id) => !!idx.get(id);
  for (const c of list) {
    if (!constraintRefs(c).every(exists)) continue;
    let key: string;
    switch (c.type) {
      case "coincident":
      case "parallel":
      case "perpendicular":
      case "tangent":
      case "equal":
      case "concentric": {
        if (c.a === c.b) continue;
        if (c.type === "concentric") {
          const [a, b] = [idx.get(c.a), idx.get(c.b)];
          if (a && b && "c" in a && "c" in b && a.c === b.c) continue;
        }
        key = [c.type, ...[c.a, c.b].sort()].join("|");
        break;
      }
      case "pointOn":
        if (ends(c.e).includes(c.p)) continue;
        key = ["pointOn", c.p, c.e].join("|");
        break;
      case "midpoint":
        if (ends(c.line).includes(c.p)) continue;
        key = ["midpoint", c.p, c.line].join("|");
        break;
      case "horizontal":
      case "vertical":
        if (c.b && c.b === c.e) continue;
        key = [c.type, ...(c.b ? [c.e, c.b].sort() : [c.e])].join("|");
        break;
      case "fix":
        key = ["fix", c.p].join("|");
        break;
      case "symmetric":
        if (c.a === c.b) continue;
        key = ["symmetric", ...[c.a, c.b].sort(), c.line].join("|");
        break;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function remapDimension(d: Dimension, f: (id: Id) => Id, reversed: Set<Id>): Dimension {
  const refs = d.refs.map(f);
  if (d.kind !== "angle" || !d.refs.some((r) => reversed.has(r))) return { ...d, refs };
  const arms = (d.arms ?? [1, 1]).map((s, i) => (reversed.has(d.refs[i]!) ? -s : s)) as [1 | -1, 1 | -1];
  return { ...d, refs, arms };
}

/** Drops sizes that now measure a thing against itself, or repeat another. */
function cleanDimensions(list: Dimension[], exists: (id: Id) => boolean): Dimension[] {
  const seen = new Set<string>();
  return list.filter((d) => {
    if (!d.refs.every(exists)) return false;
    if (new Set(d.refs).size < d.refs.length) return false;
    const refs = d.kind === "angle" ? d.refs : [...d.refs].sort();
    const key = [d.kind, d.edges ? "e" : "", ...refs, d.kind === "angle" ? (d.arms ?? [1, 1]).join(",") : ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Remove duplicates as the sketch's menu runs it: the new sketch (none if there was nothing to remove), what went,
 * and what to tell you.
 */
export function tidy(s: Sketch, picked: Id[]): { sketch: Sketch | null; gone: Set<Id>; message: string } {
  const r = removeDuplicates(s, picked);
  if (!r.removed && !r.joined) return { sketch: null, gone: new Set(), message: `No duplicates ${picked.length ? "in the selection" : "in this sketch"}.` };
  const left = new Set([...r.sketch.entities.map((e) => e.id), ...(r.sketch.texts ?? []).map((t) => t.id)]);
  const gone = new Set([...s.entities.map((e) => e.id), ...(s.texts ?? []).map((t) => t.id)].filter((id) => !left.has(id)));
  const ends = r.joined === 1 ? "joined 1 pair of ends" : `joined ${r.joined} pairs of ends`;
  const message = r.removed
    ? `Removed ${r.removed} ${r.removed === 1 ? "duplicate" : "duplicates"}${r.joined ? ` and ${ends}` : ""}.`
    : `No duplicate curves, but ${ends} that sat on top of each other.`;
  return { sketch: r.sketch, gone, message };
}
