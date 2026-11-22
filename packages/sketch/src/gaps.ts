/**
 * Find open ends: why a sketch has no closed shape. Ends of lines, arcs and splines that meet nothing, each with the
 * nearest thing it could join (another open end, or a curve it stops short of or runs past) and the size of the gap,
 * and lines that partly overlap. Fixes join two ends (coincident), put an end on a curve, or bridge a gap with a line.
 * Loaded on first use (`@bettercad/sketch/gaps`).
 */
import { SketchIndex, curvePoints, ellipseGeo, newId, sampleEllipse, splineEnds, type Constraint, type Curve, type Id, type Sketch, type Vec2 } from "./model";
import { angleOf, closestOnSegment, dist, polar, sub, wrap } from "./geom2d";
import { sampleSpline, splineGeo } from "./spline";
import { openEndsOf, regions } from "./profiles";

export type Gap =
  /** Two open ends near each other. */
  | { kind: "ends"; a: Id; b: Id; from: Vec2; to: Vec2; size: number; join: boolean }
  /** An open end that stops short of a curve, or runs past it. */
  | { kind: "curve"; a: Id; curve: Id; from: Vec2; to: Vec2; size: number; join: boolean }
  /** An open end with nothing near it. */
  | { kind: "open"; a: Id; from: Vec2 }
  /** Two ends on the same spot that aren't joined: they meet now, but come apart if one is dragged. */
  | { kind: "touch"; a: Id; b: Id; from: Vec2 }
  /** Two lines lying partly along each other: `from`..`to` is where they overlap. */
  | { kind: "overlap"; curves: [Id, Id]; from: Vec2; to: Vec2 };

export interface GapReport {
  gaps: Gap[];
  /** How many open ends there are (a gap between two ends counts two). */
  openEnds: number;
  /** How far apart ends may be and still be joined in place, mm. */
  joinTol: number;
  /** How many closed shapes Extrude can pick. */
  shapes: number;
}

/** The widest gap Join closes: 2 mm, or 3% of the sketch's size on a big sketch. */
export function joinTolerance(extent: number): number {
  return Math.max(2, extent * 0.03);
}

const cache = new WeakMap<Sketch, GapReport>();

/** The open ends, gaps and overlaps in a sketch, nearest pairs first. Cached per sketch. */
export function findGaps(s: Sketch): GapReport {
  const hit = cache.get(s);
  if (hit) return hit;
  const r = analyse(s);
  cache.set(s, r);
  return r;
}

function analyse(s: Sketch): GapReport {
  const idx = new SketchIndex(s);
  const counts = (e: Curve) => !e.construction || !!e.projectedFrom;
  const curves = s.entities.filter((e): e is Curve => e.kind !== "point" && counts(e));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of s.entities)
    if (e.kind === "point") {
      xs.push(e.x);
      ys.push(e.y);
    }
  const extent = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
  const joinTol = joinTolerance(extent);
  // An end farther than this from anything is just open: pairing it with something across the sketch says nothing.
  const reach = Math.max(joinTol * 5, extent * 0.25);

  const open = [...new Set(openEndsOf(s))].filter((id) => !!idx.get(id));
  const owner = new Map<Id, Curve>();
  for (const c of curves) for (const p of endsOf(c)) if (!owner.has(p)) owner.set(p, c);
  // Curves already meeting at an end don't count as somewhere it could go.
  const at = (id: Id) => idx.xy(id);
  const meets = (p: Id) => new Set(curves.filter((c) => curvePoints(c).includes(p) || dist(endPoint(idx, c, p), at(p)) < 1e-6).map((c) => c.id));

  type Near = { kind: "ends"; b: Id; to: Vec2; size: number } | { kind: "curve"; curve: Id; to: Vec2; size: number };
  const nearest = new Map<Id, Near | null>();
  for (const a of open) {
    const pa = at(a);
    const own = owner.get(a);
    const touching = meets(a);
    let best: Near | null = null;
    for (const b of open) {
      if (b === a || owner.get(b) === own) continue;
      const size = dist(pa, at(b));
      if (size <= reach && (!best || size < best.size)) best = { kind: "ends", b, to: at(b), size };
    }
    for (const c of curves) {
      if (c === own || touching.has(c.id)) continue;
      const q = closestOn(idx, c, pa);
      if (!q) continue;
      const size = dist(pa, q);
      // An end of that curve is better met as an end, so a curve only wins when clearly closer than its ends.
      if (size <= reach && (!best || size < best.size - 1e-9)) best = { kind: "curve", curve: c.id, to: q, size };
    }
    nearest.set(a, best);
  }

  const gaps: Gap[] = [];
  const done = new Set<Id>();
  for (const a of open) {
    if (done.has(a)) continue;
    const n = nearest.get(a);
    const from = at(a);
    if (!n) {
      gaps.push({ kind: "open", a, from });
      done.add(a);
      continue;
    }
    if (n.kind === "ends") {
      if (done.has(n.b)) {
        // Its nearest end is already paired with another: it stands alone unless something else is near.
        gaps.push({ kind: "open", a, from });
        done.add(a);
        continue;
      }
      gaps.push({ kind: "ends", a, b: n.b, from, to: n.to, size: n.size, join: n.size <= joinTol });
      done.add(a).add(n.b);
      continue;
    }
    gaps.push({ kind: "curve", a, curve: n.curve, from, to: n.to, size: n.size, join: n.size <= joinTol });
    done.add(a);
  }
  gaps.push(...overlaps(idx, curves), ...touching(s, idx, curves));
  const size = (g: Gap) => (g.kind === "ends" || g.kind === "curve" ? g.size : g.kind === "overlap" ? -1 : g.kind === "touch" ? 1e9 : Infinity);
  gaps.sort((x, y) => size(x) - size(y));
  return { gaps, openEnds: open.length, joinTol, shapes: regions(s, { split: true }).length };
}

/** Ends of different curves that sit on the same spot but aren't the same point or tied by a coincident constraint. */
function touching(s: Sketch, idx: SketchIndex, curves: Curve[]): Gap[] {
  const parent = new Map<Id, Id>();
  const find = (id: Id): Id => {
    while (parent.has(id) && parent.get(id) !== id) id = parent.get(id)!;
    return id;
  };
  for (const c of s.constraints) if (c.type === "coincident" && !c.suppressed) parent.set(find(c.a), find(c.b));
  const ends: { id: Id; at: Vec2; curve: Id }[] = [];
  for (const c of curves) for (const p of endsOf(c)) ends.push({ id: p, at: idx.xy(p), curve: c.id });
  const out: Gap[] = [];
  const paired = new Set<string>();
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const [e, f] = [ends[i]!, ends[j]!];
      if (e.curve === f.curve || dist(e.at, f.at) > 1e-4) continue;
      const [x, y] = [find(e.id), find(f.id)];
      if (x === y) continue;
      const key = [x, y].sort().join("|");
      if (paired.has(key)) continue;
      paired.add(key);
      parent.set(x, y);
      out.push({ kind: "touch", a: e.id, b: f.id, from: e.at });
    }
  return out;
}

/** The points a curve can end at. */
function endsOf(c: Curve): Id[] {
  if (c.kind === "line" || c.kind === "arc") return [c.a, c.b];
  return splineEnds(c) ?? [];
}

function endPoint(idx: SketchIndex, c: Curve, p: Id): Vec2 {
  const q = closestOn(idx, c, idx.xy(p));
  return q ?? [Infinity, Infinity];
}

/** The point on a curve nearest p. */
function closestOn(idx: SketchIndex, c: Curve, p: Vec2): Vec2 | null {
  switch (c.kind) {
    case "line":
      return closestOnSegment(p, idx.xy(c.a), idx.xy(c.b)).p;
    case "circle": {
      const o = idx.xy(c.c);
      return polar(o, c.r, angleOf(sub(p, o)));
    }
    case "arc": {
      const o = idx.xy(c.c);
      const [a, b] = [idx.xy(c.a), idx.xy(c.b)];
      const s = angleOf(sub(a, o));
      const w = wrap(angleOf(sub(b, o)) - s) || 2 * Math.PI;
      const t = wrap(angleOf(sub(p, o)) - s);
      if (t <= w) return polar(o, c.r, s + t);
      return dist(p, a) < dist(p, b) ? a : b;
    }
    case "ellipse":
      return onPolyline(sampleEllipse(ellipseGeo(idx, c), 0, 2 * Math.PI, 144), p);
    case "spline":
      return onPolyline(sampleSpline(splineGeo(idx, c)), p);
  }
}

function onPolyline(pts: Vec2[], p: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const q = closestOnSegment(p, pts[i - 1]!, pts[i]!).p;
    const k = dist(p, q);
    if (k < d) [best, d] = [q, k];
  }
  return best;
}

/** Lines that lie partly along each other. Ones wholly on top of another are for Remove duplicates, so they count too. */
function overlaps(idx: SketchIndex, curves: Curve[]): Gap[] {
  const lines = curves.filter((c): c is Extract<Curve, { kind: "line" }> => c.kind === "line");
  const out: Gap[] = [];
  const TOL = 1e-4;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const [p, q] = [lines[i]!, lines[j]!];
      const [a, b, c, d] = [idx.xy(p.a), idx.xy(p.b), idx.xy(q.a), idx.xy(q.b)];
      const l = dist(a, b);
      if (l < TOL || dist(c, d) < TOL) continue;
      const u: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      const off = (x: Vec2) => Math.abs((x[0] - a[0]) * u[1] - (x[1] - a[1]) * u[0]);
      if (off(c) > TOL || off(d) > TOL) continue;
      const t = (x: Vec2) => (x[0] - a[0]) * u[0] + (x[1] - a[1]) * u[1];
      const lo = Math.max(0, Math.min(t(c), t(d)));
      const hi = Math.min(l, Math.max(t(c), t(d)));
      if (hi - lo <= TOL) continue;
      out.push({ kind: "overlap", curves: [p.id, q.id], from: [a[0] + u[0] * lo, a[1] + u[1] * lo], to: [a[0] + u[0] * hi, a[1] + u[1] * hi] });
    }
  return out;
}

/** The sketch with a gap closed: two ends made one (coincident) or an end put on the curve (point on). */
export function joinGap(s: Sketch, g: Gap): Sketch {
  return joinAll(s, [g]);
}

/** The sketch with every gap in `gaps` that can be joined in place joined, in one go. */
export function joinAll(s: Sketch, gaps: Gap[]): Sketch {
  const add: Constraint[] = [];
  for (const g of gaps) {
    if (g.kind === "ends" || g.kind === "touch") add.push({ id: newId("k"), type: "coincident", a: g.a, b: g.b });
    else if (g.kind === "curve") add.push({ id: newId("k"), type: "pointOn", p: g.a, e: g.curve });
  }
  return add.length ? { ...s, constraints: [...s.constraints, ...add] } : s;
}

/** The sketch with a line drawn across the gap between two ends, which leaves both where they are. */
export function bridgeGap(s: Sketch, g: Extract<Gap, { kind: "ends" }>): Sketch {
  return { ...s, entities: [...s.entities, { id: newId("e"), kind: "line", a: g.a, b: g.b }] };
}

/** How a gap reads in the palette and on its marker. */
export function gapLabel(g: Gap): string {
  const mm = (v: number) => `${v < 0.01 ? "under 0.01" : v < 10 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10} mm`;
  switch (g.kind) {
    case "ends":
      return `${mm(g.size)} gap between ends`;
    case "curve":
      return `End ${mm(g.size)} off a curve`;
    case "open":
      return "Open end";
    case "overlap":
      return "Lines overlap";
    case "touch":
      return "Ends touch but aren't joined";
  }
}

/** The palette's one-line summary. */
export function gapSummary(r: GapReport): string {
  const overlapping = r.gaps.filter((g) => g.kind === "overlap").length;
  const loose = r.gaps.filter((g) => g.kind === "touch").length;
  const parts = [
    r.openEnds ? `${r.openEnds} open ${r.openEnds === 1 ? "end" : "ends"}` : "",
    overlapping ? `${overlapping} ${overlapping === 1 ? "overlap" : "overlaps"}` : "",
    loose ? `${loose} loose ${loose === 1 ? "join" : "joins"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" and ").replace(/^./, (c) => c.toUpperCase()) : "No open ends";
}
