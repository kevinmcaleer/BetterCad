import {
  newId,
  type Arc,
  type Circle,
  type Constraint,
  type Dimension,
  type DimensionKind,
  type Id,
  type Line,
  type Point,
  type Sketch,
  type Vec2,
} from "./model";
import { angleOf, arcFrom3, dist, polygonPoints, sub } from "./geom2d";
import { measureDimension } from "./measure";

/**
 * What each drawing tool adds to a sketch (#53), as pure functions: the entities, the automatic constraints
 * (horizontal and vertical lines, shared corners) and, when sizes were typed, driving dimensions. The tools in the app
 * call these on commit, so one call is one undo step.
 */
export interface Drawn {
  sketch: Sketch;
  /** The new entities' ids, in drawing order. */
  ids: Id[];
}

/** A constraint before it has an id. */
export type NewConstraint = Constraint extends infer C ? (C extends Constraint ? Omit<C, "id"> & { id?: Id } : never) : never;

/** Lines within this many degrees of an axis are made horizontal or vertical. */
export const AXIS_SNAP_DEG = 3;

export class Draft {
  entities: Sketch["entities"];
  constraints: Constraint[];
  dimensions: Dimension[];
  ids: Id[] = [];
  constructor(private base: Sketch) {
    this.entities = [...base.entities];
    this.constraints = [...base.constraints];
    this.dimensions = [...base.dimensions];
  }
  point(p: Vec2 | Id, construction = false): Id {
    if (typeof p === "string") return p;
    const e: Point = { id: newId("p"), kind: "point", x: p[0], y: p[1], ...(construction && { construction }) };
    this.entities.push(e);
    return e.id;
  }
  xy(id: Id): Vec2 {
    const p = this.entities.find((e) => e.id === id);
    if (p?.kind !== "point") throw new Error(`No point ${id}`);
    return [p.x, p.y];
  }
  line(a: Vec2 | Id, b: Vec2 | Id, { construction = false, auto = true } = {}): Id {
    const l: Line = { id: newId("l"), kind: "line", a: this.point(a), b: this.point(b), ...(construction && { construction }) };
    this.entities.push(l);
    this.ids.push(l.id);
    if (auto) {
      const d = sub(this.xy(l.b), this.xy(l.a));
      const deg = Math.abs((angleOf(d) * 180) / Math.PI) % 180;
      if (deg < AXIS_SNAP_DEG || deg > 180 - AXIS_SNAP_DEG) this.constrain({ type: "horizontal", e: l.id });
      else if (Math.abs(deg - 90) < AXIS_SNAP_DEG) this.constrain({ type: "vertical", e: l.id });
    }
    return l.id;
  }
  circle(c: Vec2 | Id, r: number, construction = false): Id {
    const e: Circle = { id: newId("c"), kind: "circle", c: this.point(c), r, ...(construction && { construction }) };
    this.entities.push(e);
    this.ids.push(e.id);
    return e.id;
  }
  /** An anticlockwise arc from a to b about c. */
  arc(c: Vec2 | Id, a: Vec2 | Id, b: Vec2 | Id, construction = false): Id {
    const ci = this.point(c);
    const ai = this.point(a);
    const e: Arc = { id: newId("a"), kind: "arc", c: ci, a: ai, b: this.point(b), r: dist(this.xy(ci), this.xy(ai)), ...(construction && { construction }) };
    this.entities.push(e);
    this.ids.push(e.id);
    return e.id;
  }
  constrain(c: NewConstraint): Id {
    const id = c.id ?? newId("k");
    this.constraints.push({ ...c, id } as Constraint);
    return id;
  }
  dimension(kind: DimensionKind, refs: Id[], value?: number, extra: Partial<Dimension> = {}): Id {
    const d: Dimension = { id: newId("d"), kind, refs, value: 0, expression: "", driving: true, labelOffset: [0, 0], ...extra };
    d.value = value ?? measureDimension(this.done().sketch, d);
    d.expression ||= `${Math.round(d.value * 1000) / 1000}`;
    this.dimensions.push(d);
    return d.id;
  }
  done(): Drawn {
    return { sketch: { ...this.base, entities: this.entities, constraints: this.constraints, dimensions: this.dimensions }, ids: this.ids };
  }
}

export function drawLine(s: Sketch, a: Vec2 | Id, b: Vec2 | Id, opts?: { construction?: boolean; length?: number }): Drawn {
  const d = new Draft(s);
  const l = d.line(a, b, { construction: opts?.construction });
  if (opts?.length !== undefined) d.dimension("length", [l], opts.length);
  return d.done();
}

/** Lines through the points in order; `close` joins the last back to the first. Shared corners are one point. */
export function drawPolyline(s: Sketch, pts: (Vec2 | Id)[], close = false): Drawn {
  const d = new Draft(s);
  const ids = pts.map((p) => d.point(p));
  for (let i = 0; i + 1 < ids.length; i++) d.line(ids[i]!, ids[i + 1]!);
  if (close && ids.length > 2) d.line(ids[ids.length - 1]!, ids[0]!);
  return d.done();
}

/**
 * A rectangle by two corners: 4 lines, 4 shared corners, 2 horizontal and 2 vertical constraints, and, when typed,
 * width and height dimensions.
 */
export function drawRectangle(s: Sketch, p1: Vec2, p2: Vec2, size?: { width?: number; height?: number }): Drawn {
  const d = new Draft(s);
  const [x0, x1] = [Math.min(p1[0], p2[0]), Math.max(p1[0], p2[0])];
  const [y0, y1] = [Math.min(p1[1], p2[1]), Math.max(p1[1], p2[1])];
  const c = [d.point([x0, y0]), d.point([x1, y0]), d.point([x1, y1]), d.point([x0, y1])];
  const bottom = d.line(c[0]!, c[1]!, { auto: false });
  const right = d.line(c[1]!, c[2]!, { auto: false });
  const top = d.line(c[2]!, c[3]!, { auto: false });
  const left = d.line(c[3]!, c[0]!, { auto: false });
  d.constrain({ type: "horizontal", e: bottom });
  d.constrain({ type: "horizontal", e: top });
  d.constrain({ type: "vertical", e: right });
  d.constrain({ type: "vertical", e: left });
  if (size?.width !== undefined) d.dimension("length", [bottom], size.width);
  if (size?.height !== undefined) d.dimension("length", [right], size.height);
  return d.done();
}

/** A rectangle about its centre: adds a construction centre point and diagonals so it stays centred. */
export function drawCentreRectangle(s: Sketch, centre: Vec2, corner: Vec2, size?: { width?: number; height?: number }): Drawn {
  const w = Math.abs(corner[0] - centre[0]);
  const h = Math.abs(corner[1] - centre[1]);
  const r = drawRectangle(s, [centre[0] - w, centre[1] - h], [centre[0] + w, centre[1] + h], size);
  const d = new Draft(r.sketch);
  d.ids = [...r.ids];
  const lines = r.ids.map((id) => r.sketch.entities.find((e) => e.id === id) as Line);
  const cp = d.point(centre, true);
  const diag = d.line(lines[0]!.a, lines[2]!.a, { construction: true, auto: false });
  d.constrain({ type: "midpoint", p: cp, line: diag });
  return d.done();
}

/** A circle by centre and radius; a typed size is a diameter dimension. */
export function drawCircle(s: Sketch, c: Vec2 | Id, r: number, diameter?: number): Drawn {
  const d = new Draft(s);
  const id = d.circle(c, diameter !== undefined ? diameter / 2 : r);
  if (diameter !== undefined) d.dimension("diameter", [id], diameter);
  return d.done();
}

/** An arc through three points (start, a point on it, end). */
export function drawArc3(s: Sketch, start: Vec2 | Id, through: Vec2, end: Vec2 | Id): Drawn | null {
  const d = new Draft(s);
  const a = d.point(start);
  const b = d.point(end);
  const fit = arcFrom3(d.xy(a), through, d.xy(b));
  if (!fit) return null;
  // Arcs run anticlockwise, so a clockwise one swaps its ends.
  d.arc(fit.c, fit.ccw ? a : b, fit.ccw ? b : a);
  return d.done();
}

/** An arc by centre, start and end (anticlockwise); the end is pulled onto the circle. */
export function drawArcCentre(s: Sketch, c: Vec2, start: Vec2 | Id, end: Vec2): Drawn {
  const d = new Draft(s);
  const a = d.point(start);
  const r = dist(c, d.xy(a));
  const ang = angleOf(sub(end, c));
  d.arc(c, a, [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
  return d.done();
}

/**
 * A slot (#403): two half-round ends about centres `a` and `b`, joined by straight sides tangent to both, the ends equal.
 * A construction line joins the centres. A typed `length` (centre to centre) and `width` become dimensions.
 */
export function drawSlot(s: Sketch, a: Vec2 | Id, b: Vec2 | Id, width: number, size?: { length?: number; width?: number }): Drawn | null {
  const d = new Draft(s);
  const ca = d.point(a, true);
  const cb = d.point(b, true);
  const [pa, pb] = [d.xy(ca), d.xy(cb)];
  const len = dist(pa, pb);
  const r = width / 2;
  if (!(len > 1e-6) || !(r > 1e-6)) return null;
  const u: Vec2 = [(pb[0] - pa[0]) / len, (pb[1] - pa[1]) / len];
  const n: Vec2 = [-u[1] * r, u[0] * r];
  const at = (p: Vec2, k: number): Vec2 => [p[0] + n[0] * k, p[1] + n[1] * k];
  const [a1, b1, b2, a2] = [d.point(at(pa, 1)), d.point(at(pb, 1)), d.point(at(pb, -1)), d.point(at(pa, -1))];
  const centre = d.line(ca, cb, { construction: true });
  const side1 = d.line(a1, b1, { auto: false });
  // Arcs run anticlockwise: round the far end from the lower side to the upper, round the near end back down.
  const endB = d.arc(cb, b2, b1);
  const side2 = d.line(b2, a2, { auto: false });
  const endA = d.arc(ca, a1, a2);
  for (const [l, c] of [
    [side1, endA],
    [side1, endB],
    [side2, endA],
    [side2, endB],
  ] as const)
    d.constrain({ type: "tangent", a: l, b: c });
  d.constrain({ type: "equal", a: endA, b: endB });
  // The centre line's level or upright constraint (when drawn so) keeps the sides that way too.
  if (size?.length !== undefined) d.dimension("length", [centre], size.length);
  if (size?.width !== undefined) d.dimension("diameter", [endA], size.width);
  d.ids = [side1, endB, side2, endA, centre];
  return d.done();
}

/**
 * A regular polygon (3 to 12 sides) by centre and corner radius: equal sides, shared corners, and a construction
 * circle through the corners so one dimension sizes it.
 */
export function drawPolygon(s: Sketch, c: Vec2, r: number, sides: number, angle = Math.PI / 2): Drawn {
  const n = Math.max(3, Math.min(12, Math.round(sides)));
  const d = new Draft(s);
  const centre = d.point(c, true);
  const ring = d.circle(centre, r, true);
  const pts = polygonPoints(c, r, n, angle).map((p) => d.point(p));
  const lines = pts.map((p, i) => d.line(p, pts[(i + 1) % n]!, { auto: false }));
  for (const p of pts) d.constrain({ type: "pointOn", p, e: ring });
  for (let i = 1; i < n; i++) d.constrain({ type: "equal", a: lines[0]!, b: lines[i]! });
  d.ids = [ring, ...lines];
  return d.done();
}
