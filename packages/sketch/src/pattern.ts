import {
  SketchIndex,
  constraintRefs,
  curvePoints,
  newId,
  type Curve,
  type Dimension,
  type Entity,
  type Id,
  type PatternRole,
  type Sketch,
  type SketchPattern,
  type SketchText,
  type Vec2,
} from "./model";

/**
 * Sketch patterns: copies of shapes in rows and columns, or round a point, as Fusion's sketch Rectangular and Circular
 * Pattern do. The pattern keeps its originals and its numbers (as named `pattern` sizes); the copies are ordinary
 * geometry, made again from the originals by `applyPatterns` on every solve, so they follow every change.
 */

export { connectedCurves } from "./chain";

export type PatternKind = SketchPattern["kind"];

export interface PatternValues {
  count1: number;
  spacing1: number;
  count2: number;
  spacing2: number;
  count: number;
  angle: number;
}

export const PATTERN_DEFAULTS: PatternValues = { count1: 3, spacing1: 10, count2: 1, spacing2: 10, count: 6, angle: 360 };

/** The most copies one pattern makes, so a typo can't fill the sketch. */
export const PATTERN_MAX = 200;

/** The roles each kind of pattern has sizes for. */
export const PATTERN_ROLES: Record<PatternKind, PatternRole[]> = {
  rect: ["count1", "spacing1", "count2", "spacing2"],
  circle: ["count", "angle"],
};

export const ROLE_LABEL: Record<PatternRole, string> = {
  count1: "Count",
  spacing1: "Spacing",
  count2: "Rows",
  spacing2: "Row spacing",
  count: "Count",
  angle: "Angle",
};

export const isCountRole = (r: PatternRole | undefined) => r === "count1" || r === "count2" || r === "count";

/** A pattern's size for one of its numbers, if it has one. */
export function patternSize(s: Sketch, id: Id, role: PatternRole): Dimension | undefined {
  return s.dimensions.find((d) => d.kind === "pattern" && d.refs[0] === id && d.role === role);
}

/** A pattern's numbers, from its sizes (defaults for any it lacks), counts rounded and kept in range. */
export function patternValues(s: Sketch, p: SketchPattern): PatternValues {
  const v = { ...PATTERN_DEFAULTS };
  for (const d of s.dimensions) if (d.kind === "pattern" && d.refs[0] === p.id && d.role && !d.suppressed) v[d.role] = d.value;
  for (const k of ["count1", "count2", "count"] as const) v[k] = Math.max(1, Math.min(PATTERN_MAX, Math.round(v[k]) || 1));
  v.angle = Math.max(1e-6, Math.min(360, v.angle));
  return v;
}

/** One copy's place: its number, how it moves a point, and how far it turns (degrees). */
interface Place {
  n: number;
  move: (p: Vec2) => Vec2;
  turn: number;
}

/** Where each copy goes, for a sketch whose points are where they are now. Empty when the pattern can't be laid out. */
function places(s: Sketch, idx: SketchIndex, p: SketchPattern): Place[] {
  const v = patternValues(s, p);
  const skip = new Set(p.skip ?? []);
  const out: Place[] = [];
  if (p.kind === "rect") {
    let u: Vec2 = p.alongY ? [0, 1] : [1, 0];
    const l = p.dir ? idx.get(p.dir) : undefined;
    if (l?.kind === "line") {
      const a = idx.xy(l.a);
      const b = idx.xy(l.b);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 1e-9) u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    }
    if (p.flip1) u = [-u[0], -u[1]];
    let w: Vec2 = [-u[1], u[0]];
    if (p.flip2) w = [-w[0], -w[1]];
    const rows = Math.min(v.count2, Math.floor(PATTERN_MAX / v.count1));
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < v.count1; i++) {
        const n = j * v.count1 + i;
        if (!n || skip.has(n)) continue;
        const dx = u[0] * i * v.spacing1 + w[0] * j * v.spacing2;
        const dy = u[1] * i * v.spacing1 + w[1] * j * v.spacing2;
        out.push({ n, move: (q) => [q[0] + dx, q[1] + dy], turn: 0 });
      }
    return out;
  }
  const c = p.centre ? idx.get(p.centre) : undefined;
  if (c?.kind !== "point") return [];
  const o: Vec2 = [c.x, c.y];
  // A full circle shares the turn out evenly; a part circle puts the last copy on the end of the angle (as the
  // feature Pattern does).
  const step = (v.angle >= 360 - 1e-9 ? 360 / v.count : v.count > 1 ? v.angle / (v.count - 1) : 0) * (p.flip1 ? -1 : 1);
  for (let n = 1; n < v.count; n++) {
    if (skip.has(n)) continue;
    const t = (n * step * Math.PI) / 180;
    const [cs, sn] = [Math.cos(t), Math.sin(t)];
    out.push({
      n,
      move: (q) => [o[0] + (q[0] - o[0]) * cs - (q[1] - o[1]) * sn, o[1] + (q[0] - o[0]) * sn + (q[1] - o[1]) * cs],
      turn: n * step,
    });
  }
  return out;
}

const copyId = (p: Id, n: number, of: Id) => `${p}:${n}:${of}`;

/** What a pattern copies: its picked shapes, the points they use, and an ellipse's axes. Its own copies never count. */
function sources(idx: SketchIndex, s: Sketch, p: SketchPattern): { entities: Entity[]; texts: SketchText[] } {
  const ids = new Set<Id>();
  const texts: SketchText[] = [];
  const add = (id: Id) => {
    const e = idx.get(id);
    if (!e || e.copy?.pattern === p.id || ids.has(id)) return;
    ids.add(id);
    if (e.kind === "ellipse") [e.ax1, e.ax2].forEach(add);
    if (e.kind !== "point") curvePoints(e).forEach(add);
  };
  for (const id of p.of) {
    const t = s.texts?.find((x) => x.id === id);
    if (t) {
      if (t.copy?.pattern !== p.id) {
        texts.push(t);
        add(t.p);
      }
    } else add(id);
  }
  // Points first, so every curve's copy finds its points' copies.
  const entities = s.entities.filter((e) => ids.has(e.id)).sort((a, b) => (a.kind === "point" ? 0 : 1) - (b.kind === "point" ? 0 : 1));
  return { entities, texts };
}

/** The copy of one shape in one place. Copies keep construction, and drop anything projected. */
function copyOf(e: Entity, p: Id, at: Place, map: (id: Id) => Id): Entity {
  const base = { id: copyId(p, at.n, e.id), copy: { pattern: p, n: at.n }, ...(e.construction && { construction: true }) };
  switch (e.kind) {
    case "point": {
      const [x, y] = at.move([e.x, e.y]);
      return { ...base, kind: "point", x, y };
    }
    case "line":
      return { ...base, kind: "line", a: map(e.a), b: map(e.b) };
    case "circle":
      return { ...base, kind: "circle", c: map(e.c), r: e.r };
    case "arc":
      return { ...base, kind: "arc", c: map(e.c), a: map(e.a), b: map(e.b), r: e.r };
    case "ellipse":
      return { ...base, kind: "ellipse", c: map(e.c), ax1: map(e.ax1), ax2: map(e.ax2) };
    case "spline":
      return { ...base, kind: "spline", pts: e.pts.map(map), ...(e.closed && { closed: true }) };
  }
}

/**
 * Makes every pattern's copies again from where its originals are now. Patterns whose originals are all gone go,
 * with their sizes; constraints and sizes on copies that no longer exist go too. Unchanged without patterns.
 */
export function applyPatterns(sketch: Sketch): Sketch {
  const had = sketch.patterns ?? [];
  if (!had.length && !sketch.entities.some((e) => e.copy) && !sketch.texts?.some((t) => t.copy)) return sketch;
  const ids = new Set([...sketch.entities.map((e) => e.id), ...(sketch.texts ?? []).map((t) => t.id)]);
  // Patterns still to make: the ones with originals left (and a centre, for a circle).
  const patterns: SketchPattern[] = [];
  for (const p of had) {
    const of = p.of.filter((id) => ids.has(id));
    if (!of.length || (p.kind === "circle" && !(p.centre && ids.has(p.centre)))) continue;
    const q: SketchPattern = { ...p, of };
    if (q.dir && !ids.has(q.dir)) delete q.dir;
    patterns.push(q);
  }
  const live = new Set(patterns.map((p) => p.id));
  let entities = sketch.entities.filter((e) => !e.copy);
  let texts = (sketch.texts ?? []).filter((t) => !t.copy);
  for (const p of patterns) {
    // Each pattern sees the copies the ones before it made, so a pattern can copy another's copies.
    const s: Sketch = { ...sketch, entities, texts };
    const idx = new SketchIndex(s);
    const src = sources(idx, s, p);
    const made: Entity[] = [];
    const madeTexts: SketchText[] = [];
    for (const at of places(s, idx, p)) {
      const map = (id: Id) => copyId(p.id, at.n, id);
      for (const e of src.entities) made.push(copyOf(e, p.id, at, map));
      for (const t of src.texts) madeTexts.push({ ...t, id: map(t.id), p: map(t.p), angle: t.angle + at.turn, copy: { pattern: p.id, n: at.n } });
    }
    entities = [...entities, ...made];
    texts = [...texts, ...madeTexts];
  }
  const exists = new Set([...entities.map((e) => e.id), ...texts.map((t) => t.id)]);
  const constraints = sketch.constraints.filter((c) => constraintRefs(c).every((r) => exists.has(r)));
  const dimensions = sketch.dimensions.filter((d) => (d.kind === "pattern" ? live.has(d.refs[0]!) : d.refs.every((r) => exists.has(r))));
  const out: Sketch = { ...sketch, entities, constraints, dimensions };
  if (sketch.texts || texts.length) out.texts = texts;
  if (patterns.length) out.patterns = patterns;
  else delete out.patterns;
  return out;
}

/**
 * After a delete: each pattern copy that was in `before` and is gone from `after` leaves its place in the pattern empty,
 * as the next solve would only make it again otherwise.
 */
export function skipDeleted(before: Sketch, after: Sketch): Sketch {
  const kept = new Set([...after.entities.map((e) => e.id), ...(after.texts ?? []).map((t) => t.id)]);
  const skips = new Map<Id, Set<number>>();
  for (const x of [...before.entities, ...(before.texts ?? [])])
    if (x.copy && !kept.has(x.id)) skips.set(x.copy.pattern, (skips.get(x.copy.pattern) ?? new Set()).add(x.copy.n));
  if (!skips.size || !after.patterns) return after;
  return {
    ...after,
    patterns: after.patterns.map((p) => {
      const more = skips.get(p.id);
      return more ? { ...p, skip: [...new Set([...(p.skip ?? []), ...more])].sort((a, b) => a - b) } : p;
    }),
  };
}

/** The pattern that made a copy, or that copies an original. */
export function patternOf(s: Sketch, id: Id): SketchPattern | undefined {
  const e = s.entities.find((x) => x.id === id) ?? s.texts?.find((x) => x.id === id);
  if (e?.copy) return s.patterns?.find((p) => p.id === e.copy!.pattern);
  return s.patterns?.find((p) => p.of.includes(id));
}

/** Curves, points and texts a pattern can copy from a pick: copies of the same pattern and the origin are left out. */
export function patternable(s: Sketch, ids: Id[], self?: Id): Id[] {
  const idx = new SketchIndex(s);
  return ids.filter((id) => {
    const e = idx.get(id);
    if (e) return e.copy?.pattern !== self || !self;
    const t = s.texts?.find((x) => x.id === id);
    return !!t && (!self || t.copy?.pattern !== self);
  });
}

/** A rough size for the picked shapes, so a new pattern's spacing starts clear of the original. */
function spanOf(s: Sketch, of: Id[]): Vec2 {
  const idx = new SketchIndex(s);
  const xs: number[] = [];
  const ys: number[] = [];
  const put = (id: Id) => {
    const e = idx.get(id);
    if (!e) return;
    if (e.kind === "point") {
      xs.push(e.x);
      ys.push(e.y);
      return;
    }
    const c = e as Curve;
    for (const q of curvePoints(c)) {
      const [x, y] = idx.xy(q);
      const r = c.kind === "circle" ? c.r : 0;
      xs.push(x - r, x + r);
      ys.push(y - r, y + r);
    }
    if (c.kind === "ellipse") [c.ax1, c.ax2].forEach(put);
  };
  of.forEach(put);
  for (const t of s.texts ?? [])
    if (of.includes(t.id)) {
      const [x, y] = idx.xy(t.p);
      xs.push(x, x + t.height * Math.max(1, t.text.length) * 0.6);
      ys.push(y, y + t.height);
    }
  if (!xs.length) return [0, 0];
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

/** A size for one of a pattern's numbers. */
function sizeFor(p: Id, role: PatternRole, value: number): Dimension {
  return { id: newId("d"), kind: "pattern", role, refs: [p], value, expression: `${Math.round(value * 1000) / 1000}`, driving: true, labelOffset: [0, 0] };
}

/** Starts a pattern of `of`, with sizes for its numbers. Spacing starts a little wider than the shapes. */
export function addSketchPattern(
  sketch: Sketch,
  kind: PatternKind,
  of: Id[],
  opts: Partial<Omit<SketchPattern, "id" | "kind" | "of">> = {},
  id = newId("q"),
): { sketch: Sketch; id: Id } | string {
  const picked = patternable(sketch, of);
  if (!picked.length) return "Pick the shapes to copy first";
  const [w, h] = spanOf(sketch, picked);
  const nice = (v: number) => Math.max(1, Math.ceil(v + 2));
  const p: SketchPattern = { id, kind, of: picked, ...opts };
  const v = { ...PATTERN_DEFAULTS, spacing1: nice(w), spacing2: nice(h) };
  const sizes = PATTERN_ROLES[kind].map((r) => sizeFor(id, r, v[r]));
  return { sketch: { ...sketch, patterns: [...(sketch.patterns ?? []), p], dimensions: [...sketch.dimensions, ...sizes] }, id };
}

/**
 * Switches a pattern between rows and round a point. It keeps only the new kind's sizes (so Parameters lists only
 * numbers that do something), starting them at the defaults, with the spacing a little wider than the shapes.
 */
export function setPatternKind(sketch: Sketch, id: Id, kind: PatternKind, opts: Partial<Omit<SketchPattern, "id" | "kind" | "of">> = {}): Sketch {
  const p = sketch.patterns?.find((x) => x.id === id);
  if (!p) return sketch;
  if (p.kind === kind) return updateSketchPattern(sketch, id, opts);
  const [w, h] = spanOf(sketch, p.of);
  const v = { ...PATTERN_DEFAULTS, spacing1: Math.max(1, Math.ceil(w + 2)), spacing2: Math.max(1, Math.ceil(h + 2)) };
  const roles = PATTERN_ROLES[kind];
  const kept = sketch.dimensions.filter((d) => !(d.kind === "pattern" && d.refs[0] === id && !roles.includes(d.role!)));
  const missing = roles.filter((r) => !kept.some((d) => d.kind === "pattern" && d.refs[0] === id && d.role === r));
  return updateSketchPattern({ ...sketch, dimensions: [...kept, ...missing.map((r) => sizeFor(id, r, v[r]))] }, id, { kind, ...opts });
}

/** Changes a pattern's picks or settings (not its numbers, which are sizes). */
export function updateSketchPattern(sketch: Sketch, id: Id, change: Partial<Omit<SketchPattern, "id">>): Sketch {
  return {
    ...sketch,
    patterns: (sketch.patterns ?? []).map((p) => {
      if (p.id !== id) return p;
      const q = { ...p, ...change };
      for (const [k, v] of Object.entries(change)) if (v === undefined) delete q[k as keyof SketchPattern];
      return q;
    }),
  };
}

/** Sets one of a pattern's numbers (adding its size if it lacks one). */
export function setPatternValue(sketch: Sketch, id: Id, role: PatternRole, value: number, expression?: string): Sketch {
  const v = isCountRole(role) ? Math.max(1, Math.min(PATTERN_MAX, Math.round(value))) : value;
  const expr = expression?.trim() || `${Math.round(v * 1000) / 1000}`;
  const had = patternSize(sketch, id, role);
  if (!had) return { ...sketch, dimensions: [...sketch.dimensions, { ...sizeFor(id, role, v), expression: expr }] };
  return { ...sketch, dimensions: sketch.dimensions.map((d) => (d === had ? { ...d, value: v, expression: expr, driving: true } : d)) };
}

/** Takes a pattern away: its copies and sizes go, the originals stay. */
export function removeSketchPattern(sketch: Sketch, id: Id): Sketch {
  return applyPatterns({ ...sketch, patterns: (sketch.patterns ?? []).filter((p) => p.id !== id) });
}

/** "3 × 2 copies, 10 mm apart" and so on, for the panel and the timeline. */
export function describePattern(s: Sketch, p: SketchPattern): string {
  const v = patternValues(s, p);
  const n = (x: number) => `${Math.round(x * 100) / 100}`;
  if (p.kind === "rect")
    return v.count2 > 1 ? `${v.count1} by ${v.count2}, ${n(v.spacing1)} mm and ${n(v.spacing2)} mm apart` : `${v.count1} in a row, ${n(v.spacing1)} mm apart`;
  return `${v.count} round a point${v.angle < 360 ? ` over ${n(v.angle)}°` : ""}`;
}
