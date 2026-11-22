import { connectedCurves } from "./chain";
import { Draft, type NewConstraint } from "./draw";
import { SketchIndex, constraintRefs, type Constraint, type Id, type Sketch, type Vec2 } from "./model";

/**
 * AutoConstrain and the Polygon constraint, as in Fusion: constraints that already (nearly) hold are found and added,
 * keeping only the ones that take away a degree of freedom, so nothing repeats what is already held. Loads when one
 * of them is first used.
 */

/** What a solve says about a sketch: enough to tell whether a constraint helped. */
export interface Solved {
  status: "ok" | "conflicting" | "redundant" | "failed";
  dof: number;
}

/**
 * Adds each candidate in turn, keeping it only when the sketch still solves and has fewer degrees of freedom with it.
 * A candidate that only repeats what is held (or fights it) is left out.
 */
export function keepUseful(solve: (s: Sketch) => Solved, base: Sketch, candidates: NewConstraint[]): { sketch: Sketch; added: Constraint[] } {
  const d = new Draft(base);
  const added: Constraint[] = [];
  let dof = solve(base).dof;
  for (const c of candidates) {
    const id = d.constrain(c);
    const r = solve(d.done().sketch);
    if ((r.status === "ok" || r.status === "redundant") && r.dof < dof) {
      dof = r.dof;
      added.push(d.constraints[d.constraints.length - 1]!);
    } else d.constraints = d.constraints.filter((x) => x.id !== id);
  }
  return { sketch: d.done().sketch, added };
}

/**
 * Polygon: the closed outline of lines through `line` becomes a regular polygon. Its corners go on a new construction
 * circle and its sides are made equal. The sketch with the circle, and the constraints to try, or why it can't.
 */
export function polygonCandidates(sketch: Sketch, line: Id): { sketch: Sketch; candidates: NewConstraint[] } | string {
  const idx = new SketchIndex(sketch);
  const lines = connectedCurves(sketch, line).map((id) => idx.get(id)!);
  if (lines.length < 3 || lines.some((e) => e.kind !== "line")) return "Pick a side of a closed outline of three or more lines";
  // Corners: ends tied by being the same point or by a coincident constraint count once, and each meets two sides.
  const tied = new Map<Id, Id>();
  const root = (p: Id): Id => (tied.has(p) ? root(tied.get(p)!) : p);
  for (const c of sketch.constraints) if (c.type === "coincident" && !c.suppressed && root(c.a) !== root(c.b)) tied.set(root(c.a), root(c.b));
  const corners = new Map<Id, { p: Id; n: number }>();
  for (const e of lines) {
    if (e.kind !== "line") continue;
    for (const p of [e.a, e.b]) {
      const k = root(p);
      const had = corners.get(k);
      corners.set(k, { p: had?.p ?? p, n: (had?.n ?? 0) + 1 });
    }
  }
  if ([...corners.values()].some((c) => c.n !== 2)) return "Pick a side of a closed outline of three or more lines";
  const pts = [...corners.values()].map((c) => idx.xy(c.p));
  const c: Vec2 = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const r = pts.reduce((s, p) => s + Math.hypot(p[0] - c[0], p[1] - c[1]), 0) / pts.length;
  const d = new Draft(sketch);
  const ring = d.circle(d.point(c, true), r, true);
  return {
    sketch: d.done().sketch,
    candidates: [
      ...[...corners.values()].map((k): NewConstraint => ({ type: "pointOn", p: k.p, e: ring })),
      ...lines.slice(1).map((e): NewConstraint => ({ type: "equal", a: lines[0]!.id, b: e.id })),
    ],
  };
}

/** The most pairs AutoConstrain compares, so a huge imported sketch stays quick. */
const MAX_CURVES = 120;

/**
 * AutoConstrain: constraints that already nearly hold in the sketch (or among `only`, when given): ends that meet,
 * lines nearly level or upright, parallel, square or the same length, circles and arcs on one centre or of one size,
 * and lines that meet arcs smoothly. Best first; `keepUseful` keeps the ones that help.
 */
export function autoCandidates(sketch: Sketch, only: Id[] = []): NewConstraint[] {
  const idx = new SketchIndex(sketch);
  const pick = new Set(only);
  const live = sketch.constraints.filter((c) => !c.suppressed);
  const has = (type: Constraint["type"], a: Id, b?: Id) =>
    live.some((c) => {
      if (c.type !== type) return false;
      const refs = constraintRefs(c);
      return refs.includes(a) && (b === undefined || refs.includes(b));
    });
  const curves = sketch.entities.filter((e) => e.kind !== "point" && !e.projectedFrom && (!pick.size || pick.has(e.id))).slice(0, MAX_CURVES);
  const lines = curves.filter((e) => e.kind === "line");
  const rounds = curves.filter((e) => e.kind === "circle" || e.kind === "arc");
  // How near counts as on: a ten-thousandth of the sketch's size, at least 0.001 mm; half a degree for angles.
  const all = sketch.entities.flatMap((e) => (e.kind === "point" ? [[e.x, e.y] as Vec2] : []));
  const span = all.length ? Math.max(...all.map((p) => Math.abs(p[0])), ...all.map((p) => Math.abs(p[1])), 1) : 1;
  const tol = Math.max(1e-3, span * 1e-4);
  const angTol = (0.5 * Math.PI) / 180;
  const vec = (l: (typeof lines)[number]): Vec2 => {
    if (l.kind !== "line") return [0, 0];
    const [a, b] = [idx.xy(l.a), idx.xy(l.b)];
    return [b[0] - a[0], b[1] - a[1]];
  };
  const len = (v: Vec2) => Math.hypot(v[0], v[1]);
  const sin = (u: Vec2, v: Vec2) => Math.abs(u[0] * v[1] - u[1] * v[0]) / (len(u) * len(v) || 1);
  const cos = (u: Vec2, v: Vec2) => Math.abs(u[0] * v[0] + u[1] * v[1]) / (len(u) * len(v) || 1);
  const out: NewConstraint[] = [];

  // Ends that meet but are not joined.
  const ends = [...new Set(curves.flatMap((e) => (e.kind === "line" ? [e.a, e.b] : e.kind === "arc" ? [e.a, e.b] : [])))];
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const [p, q] = [idx.xy(ends[i]!), idx.xy(ends[j]!)];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol && !has("coincident", ends[i]!, ends[j]!)) out.push({ type: "coincident", a: ends[i]!, b: ends[j]! });
    }
  // Level and upright lines.
  for (const l of lines) {
    const v = vec(l);
    if (has("horizontal", l.id) || has("vertical", l.id)) continue;
    if (sin(v, [1, 0]) <= angTol) out.push({ type: "horizontal", e: l.id });
    else if (sin(v, [0, 1]) <= angTol) out.push({ type: "vertical", e: l.id });
  }
  // Lines meeting arcs smoothly at a shared end.
  for (const a of rounds) {
    if (a.kind !== "arc") continue;
    for (const l of lines) {
      if (l.kind !== "line") continue;
      const p = [l.a, l.b].find((x) => x === a.a || x === a.b);
      if (!p || has("tangent", a.id, l.id)) continue;
      const c = idx.xy(a.c);
      const at = idx.xy(p);
      if (cos(vec(l), [at[0] - c[0], at[1] - c[1]]) <= angTol) out.push({ type: "tangent", a: l.id, b: a.id });
    }
  }
  // Circles and arcs on one centre, then of one size.
  for (let i = 0; i < rounds.length; i++)
    for (let j = i + 1; j < rounds.length; j++) {
      const [a, b] = [rounds[i]!, rounds[j]!];
      if ((a.kind !== "circle" && a.kind !== "arc") || (b.kind !== "circle" && b.kind !== "arc")) continue;
      const [p, q] = [idx.xy(a.c), idx.xy(b.c)];
      if (a.c !== b.c && Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol && !has("concentric", a.id, b.id)) out.push({ type: "concentric", a: a.id, b: b.id });
    }
  for (let i = 0; i < rounds.length; i++)
    for (let j = i + 1; j < rounds.length; j++) {
      const [a, b] = [rounds[i]!, rounds[j]!];
      if ((a.kind === "circle" || a.kind === "arc") && (b.kind === "circle" || b.kind === "arc") && Math.abs(a.r - b.r) <= tol && !has("equal", a.id, b.id))
        out.push({ type: "equal", a: a.id, b: b.id });
    }
  // Lines square to, parallel with, or as long as one another.
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const [a, b] = [lines[i]!, lines[j]!];
      const [u, v] = [vec(a), vec(b)];
      if (sin(u, v) <= angTol && !has("parallel", a.id, b.id) && !has("collinear", a.id, b.id)) out.push({ type: "parallel", a: a.id, b: b.id });
      else if (cos(u, v) <= angTol && !has("perpendicular", a.id, b.id)) out.push({ type: "perpendicular", a: a.id, b: b.id });
    }
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const [a, b] = [lines[i]!, lines[j]!];
      if (Math.abs(len(vec(a)) - len(vec(b))) <= tol && !has("equal", a.id, b.id)) out.push({ type: "equal", a: a.id, b: b.id });
    }
  return out;
}

/** What AutoConstrain added, for the status line: "Added 6 constraints: 2 horizontal, 4 equal". */
export function describeAdded(added: Constraint[]): string {
  if (!added.length) return "Nothing to add: what lines up is already held";
  const counts = new Map<string, number>();
  for (const c of added) {
    const k = c.type === "pointOn" ? "on" : c.type;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const list = [...counts].map(([k, n]) => `${n} ${k}`).join(", ");
  return `Added ${added.length} constraint${added.length === 1 ? "" : "s"}: ${list}`;
}
