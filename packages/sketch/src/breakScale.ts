import { SketchIndex, constraintRefs, curvePoints, newId, type Arc, type Id, type Line, type Sketch, type Spline, type Vec2 } from "./model";
import { add, scale, sub } from "./geom2d";
import { Draft } from "./draw";
import { pointAt, shapeOf, type EditResult } from "./edit";
import { cutsOn, trimPiece } from "./cut";
import { splineGeo } from "./spline";

/**
 * Break and Sketch scale, as in Fusion's Modify menu. Break splits a curve where other curves cross it, around the
 * piece under the pointer; Sketch scale grows or shrinks picked shapes about a base point. Both load with their tools
 * through "@bettercad/sketch/edits".
 */

const EPS = 1e-9;

/**
 * Where Break would split a curve at `at`: the piece between the crossings either side, and the crossings that bound
 * it (the curve's own ends are not breaks). Null when nothing crosses it there.
 */
export function breakPreview(sketch: Sketch, id: Id, at: Vec2): { pts: Vec2[]; breaks: Vec2[] } | null {
  const idx = new SketchIndex(sketch);
  const e = idx.get(id);
  if (!e || e.kind === "point" || e.kind === "ellipse") return null;
  const piece = trimPiece(sketch, id, at);
  if (!piece) return null;
  const sh = shapeOf(idx, e);
  const closed = sh.kind === "circle" || (sh.kind === "spline" && sh.g.closed);
  const ts = breakParams(sketch, id, piece.from, piece.to, closed, span(sh));
  if (!ts) return null;
  return { pts: piece.pts, breaks: ts.map((t) => at_(sh, t)) };
}

/** A point along a shape; a closed spline's parameter wraps round. */
const at_ = (sh: ReturnType<typeof shapeOf>, t: number) => {
  const n = sh.kind === "spline" ? sh.g.bez.length : 0;
  return pointAt(sh, sh.kind === "spline" && sh.g.closed ? ((t % n) + n) % n : t);
};

const span = (sh: ReturnType<typeof shapeOf>) => (sh.kind === "line" ? 1 : sh.kind === "arc" ? sh.w : sh.kind === "spline" ? sh.g.bez.length : 2 * Math.PI);

/** The parameters Break cuts at, or null when it can't: a closed curve needs two crossings, an open one one inside its ends. */
function breakParams(sketch: Sketch, id: Id, from: number, to: number, closed: boolean, len: number): number[] | null {
  if (closed) return cutsOn(sketch, id).length >= 2 ? [from, to] : null;
  const ts = [from, to].filter((t) => t > EPS && t < len - EPS);
  return ts.length ? ts : null;
}

/**
 * Breaks a curve into pieces where the curves crossing it either side of `at` meet it (Fusion's Break). The pieces
 * share their end points, so the outline stays joined; the curve keeps its id (and its constraints) on its first piece.
 * Straight pieces stay in line (Parallel to the one before, through the shared point); round ones keep one radius (Equal). A closed circle or spline needs two
 * crossings, and becomes two arcs or curves.
 */
export function breakAt(sketch: Sketch, id: Id, at: Vec2): EditResult {
  const idx = new SketchIndex(sketch);
  const e = idx.get(id);
  if (!e || e.kind === "point") return "Hover a line, arc, circle or spline";
  if (e.kind === "ellipse") return "Break can't split an ellipse";
  if (e.projectedFrom) return "Projected edges can't be broken";
  const sh = shapeOf(idx, e);
  const piece = trimPiece(sketch, id, at)!;
  const closed = sh.kind === "circle" || (sh.kind === "spline" && sh.g.closed);
  const ts = breakParams(sketch, id, piece.from, piece.to, closed, span(sh));
  if (!ts) return closed ? "Break needs two shapes crossing a closed curve" : "Nothing crosses it there to break it at";

  const d = new Draft(sketch);
  // A broken line's length no longer holds; an arc's radius does.
  d.dimensions = d.dimensions.filter((dm) => !(dm.refs.includes(id) && dm.kind === "length"));
  const cuts = ts.map((t) => d.point(at_(sh, t)));
  const flag = e.construction ? { construction: true as const } : {};

  if (e.kind === "circle") {
    // The piece runs anticlockwise from its start to its end; the rest carries on round to the start again.
    const [p1, p2] = cuts as [Id, Id];
    d.entities = d.entities.map((x) => (x.id === id ? ({ id, kind: "arc", c: e.c, a: p2, b: p1, r: e.r, ...flag } as Arc) : x));
    const twin = newId("a");
    d.entities.push({ id: twin, kind: "arc", c: e.c, a: p1, b: p2, r: e.r, ...flag });
    d.constrain({ type: "equal", a: id, b: twin });
    return d.done().sketch;
  }

  if (e.kind === "spline") return breakSpline(d, e, splineGeo(idx, e), ts, cuts);

  // A line or arc: the original keeps its start and ends at the first cut; each new piece runs on to the next.
  const old = e as Line | Arc;
  const ends = [old.a, ...cuts, old.b];
  d.entities = d.entities.map((x) => (x.id === id ? { ...old, b: ends[1]! } : x));
  let prev = id;
  for (let i = 1; i < ends.length - 1; i++) {
    const twin = newId(old.kind === "line" ? "l" : "a");
    d.entities.push({ ...old, id: twin, a: ends[i]!, b: ends[i + 1]! });
    d.constrain(old.kind === "line" ? { type: "parallel", a: prev, b: twin } : { type: "equal", a: id, b: twin });
    prev = twin;
  }
  return d.done().sketch;
}

/** Splits a spline at parameters `ts` (sorted), sharing the new cut points; fit points between cuts stay with their piece. */
function breakSpline(d: Draft, e: Spline, g: ReturnType<typeof splineGeo>, ts: number[], cuts: Id[]): EditResult {
  const n = g.bez.length;
  // Fit point i sits at parameter i.
  const between = (a: number, b: number) => [...e.pts, ...e.pts].filter((_, i) => i > a + EPS && i < b - EPS);
  const parts: Id[][] = [];
  if (e.closed) {
    const [from, to] = ts as [number, number];
    const [c1, c2] = cuts as [Id, Id];
    parts.push([c1, ...between(from, to), c2]);
    parts.push([c2, ...between(to, from + n), c1]);
  } else {
    const stops = [0, ...ts, n];
    const ids = [e.pts[0]!, ...cuts, e.pts[e.pts.length - 1]!];
    for (let i = 0; i < stops.length - 1; i++) parts.push([ids[i]!, ...between(stops[i]!, stops[i + 1]!), ids[i + 1]!]);
  }
  // Constraints on the old curve (tangents at its ends, points on it) don't carry over to the pieces.
  d.constraints = d.constraints.filter((c) => !constraintRefs(c).includes(e.id));
  d.dimensions = d.dimensions.filter((dm) => !dm.refs.includes(e.id));
  d.entities = d.entities.filter((x) => x.id !== e.id);
  parts.forEach((pts, i) => d.entities.push({ id: i === 0 ? e.id : newId("b"), kind: "spline", pts, ...(e.construction && { construction: true }) }));
  return d.done().sketch;
}

const SIZE_KINDS = new Set(["length", "distance", "distanceX", "distanceY", "radius", "diameter"]);

/** A size's expression times `k`: a plain number stays a plain number, a formula keeps its link. */
function scaledExpression(expr: string, value: number, k: number): string {
  const t = expr.trim();
  if (!t || /^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return String(+(value * k).toFixed(6));
  return `(${t}) * ${+k.toFixed(6)}`;
}

/**
 * Scales picked shapes about a base point by `k` (Fusion's Sketch scale). Their points move out from (or in toward)
 * the base, circles and arcs take the new radius, text grows with them, and sizes that measure only the picked shapes
 * are scaled too, so the solver keeps the new size. Projected edges stay where they are.
 */
export function scaleShapes(sketch: Sketch, ids: Id[], base: Vec2, k: number): EditResult {
  if (!(k > 0) || !Number.isFinite(k)) return "Type a scale above 0";
  const idx = new SketchIndex(sketch);
  const pick = new Set(ids);
  const curves = sketch.entities.filter((e) => pick.has(e.id) && e.kind !== "point" && !e.projectedFrom);
  const texts = (sketch.texts ?? []).filter((t) => pick.has(t.id));
  const lone = sketch.entities.filter((e) => pick.has(e.id) && e.kind === "point" && !e.projectedFrom);
  if (!curves.length && !texts.length && !lone.length) return "Pick the shapes to scale";
  const moved = new Set<Id>(lone.map((p) => p.id));
  const inPick = new Set<Id>([...curves.map((c) => c.id), ...texts.map((t) => t.id), ...moved]);
  for (const c of curves) {
    if (c.kind === "point") continue;
    for (const p of curvePoints(c)) moved.add(p);
    if (c.kind === "ellipse") {
      // An ellipse's size is its axes: they scale with it.
      for (const ax of [c.ax1, c.ax2]) {
        const l = idx.get(ax);
        if (l?.kind === "line") {
          moved.add(l.a).add(l.b);
          inPick.add(ax);
        }
      }
    }
  }
  for (const t of texts) moved.add(t.p);
  for (const p of moved) inPick.add(p);
  const to = (xy: Vec2) => add(base, scale(sub(xy, base), k));
  const entities = sketch.entities.map((e) => {
    if (e.kind === "point") return moved.has(e.id) ? { ...e, x: to([e.x, e.y])[0], y: to([e.x, e.y])[1] } : e;
    if ((e.kind === "circle" || e.kind === "arc") && inPick.has(e.id)) return { ...e, r: e.r * k };
    return e;
  });
  const dimensions = sketch.dimensions.map((dm) =>
    SIZE_KINDS.has(dm.kind) && dm.refs.length && dm.refs.every((r) => inPick.has(r))
      ? { ...dm, value: dm.value * k, expression: scaledExpression(dm.expression, dm.value, k), labelOffset: scale(dm.labelOffset, k) }
      : dm,
  );
  const pickedTexts = new Set(texts.map((t) => t.id));
  const out: Sketch = { ...sketch, entities, dimensions };
  if (sketch.texts)
    out.texts = sketch.texts.map((t) => (pickedTexts.has(t.id) ? { ...t, height: t.height * k, loops: t.loops.map((l) => l.map((p) => scale(p, k))) } : t));
  return out;
}
