/**
 * The sketch model (#51): points, lines, arcs and circles with stable ids, the constraints and dimensions on them, and
 * the plane they sit on. Everything is plain JSON in the sketch's own 2D frame, millimetres. Lines and arcs refer to
 * their end points by id, so geometry that meets shares a point (or is tied by a coincident constraint).
 */
export type Id = string;
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

interface EntityBase {
  id: Id;
  /** Construction geometry guides the sketch but is never part of a profile. */
  construction?: boolean;
  /** Projected from a body's face (#54): fixed in place, and re-projected when the body changes. */
  projectedFrom?: TopoRef;
}
export interface Point extends EntityBase {
  kind: "point";
  x: number;
  y: number;
}
export interface Line extends EntityBase {
  kind: "line";
  a: Id;
  b: Id;
}
export interface Circle extends EntityBase {
  kind: "circle";
  c: Id;
  r: number;
}
/** Runs anticlockwise from `a` to `b` around `c`. */
export interface Arc extends EntityBase {
  kind: "arc";
  c: Id;
  a: Id;
  b: Id;
  r: number;
}
export type Entity = Point | Line | Circle | Arc;
export type Curve = Line | Circle | Arc;
export type EntityKind = Entity["kind"];

interface ConstraintBase {
  id: Id;
  /** Turned off from the constraints list: kept, but not solved. */
  suppressed?: boolean;
}
export type Constraint = ConstraintBase &
  (
    | { type: "coincident"; a: Id; b: Id }
    /** A point on a line, circle or arc. */
    | { type: "pointOn"; p: Id; e: Id }
    /** A line level or upright; with `b`, `e` and `b` are two points lined up across (same y) or up (same x). */
    | { type: "horizontal"; e: Id; b?: Id }
    | { type: "vertical"; e: Id; b?: Id }
    | { type: "parallel"; a: Id; b: Id }
    | { type: "perpendicular"; a: Id; b: Id }
    | { type: "tangent"; a: Id; b: Id }
    /** Equal lengths (two lines) or radii (circles and arcs). */
    | { type: "equal"; a: Id; b: Id }
    | { type: "concentric"; a: Id; b: Id }
    | { type: "midpoint"; p: Id; line: Id }
    | { type: "fix"; p: Id }
    | { type: "symmetric"; a: Id; b: Id; line: Id }
  );
export type ConstraintType = Constraint["type"];

export type DimensionKind = "length" | "distance" | "distanceX" | "distanceY" | "radius" | "diameter" | "angle";

/** A constraint with a number. Driving dimensions move geometry; driven ones only report. */
export interface Dimension {
  id: Id;
  kind: DimensionKind;
  /** length: [line]; distance*: [point, point] or [point, line]; radius/diameter: [circle|arc]; angle: [line, line]. */
  refs: Id[];
  /** What the user typed ("45", "width/2"). */
  expression: string;
  /** The last evaluated value: mm, or degrees for angles. */
  value: number;
  driving: boolean;
  /** Where the label sits, relative to the measured geometry, in sketch mm. */
  labelOffset: Vec2;
  suppressed?: boolean;
}

export type WorldPlane = "XY" | "XZ" | "YZ";

/** A face of a body, named so it can be found again after a rebuild (#47). */
export interface TopoRef {
  body: Id;
  face: number;
}

/** The sketch frame in world space: origin, X direction and normal (Y = normal × X). */
export interface Frame {
  origin: Vec3;
  x: Vec3;
  normal: Vec3;
}

export type PlaneRef = { kind: "world"; plane: WorldPlane; offset: number } | { kind: "face"; face: TopoRef; offset: number; frame: Frame };

export interface Sketch {
  id: Id;
  name: string;
  plane: PlaneRef;
  entities: Entity[];
  constraints: Constraint[];
  dimensions: Dimension[];
}

export const WORLD_FRAMES: Record<WorldPlane, Frame> = {
  XY: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] },
  // Looking from the front (-Y): X right, Z up, so the normal points to -Y.
  XZ: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] },
  // Looking from the right (+X): Y right, Z up.
  YZ: { origin: [0, 0, 0], x: [0, 1, 0], normal: [1, 0, 0] },
};

export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The plane's frame, with any offset applied along the normal. */
export function planeFrame(p: PlaneRef): Frame {
  const f = p.kind === "world" ? WORLD_FRAMES[p.plane] : p.frame;
  const n = norm3(f.normal);
  return { origin: [f.origin[0] + n[0] * p.offset, f.origin[1] + n[1] * p.offset, f.origin[2] + n[2] * p.offset], x: norm3(f.x), normal: n };
}

/**
 * A frame for a flat face: origin at its centroid, X along its longest edge projected into the plane, so the same face
 * gives the same frame after a rebuild. Right-handed: X × Y = normal.
 */
export function faceFrame(centroid: Vec3, normal: Vec3, longestEdge: Vec3): Frame {
  const n = norm3(normal);
  let x: Vec3 = [longestEdge[0], longestEdge[1], longestEdge[2]];
  const d = dot3(x, n);
  x = [x[0] - n[0] * d, x[1] - n[1] * d, x[2] - n[2] * d];
  if (Math.hypot(...x) < 1e-9) x = Math.abs(n[2]) < 0.9 ? cross3([0, 0, 1], n) : cross3(n, [0, 1, 0]);
  return { origin: centroid, x: norm3(x), normal: n };
}

export const frameY = (f: Frame): Vec3 => cross3(f.normal, f.x);

/** A sketch point in world space. */
export function toWorld(f: Frame, p: Vec2): Vec3 {
  const y = frameY(f);
  return [f.origin[0] + f.x[0] * p[0] + y[0] * p[1], f.origin[1] + f.x[1] * p[0] + y[1] * p[1], f.origin[2] + f.x[2] * p[0] + y[2] * p[1]];
}

/** A world point projected into the sketch frame. */
export function toSketch(f: Frame, p: Vec3): Vec2 {
  const d: Vec3 = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  return [dot3(d, f.x), dot3(d, frameY(f))];
}

// ------------------------------------------------------------------ building and reading

let seq = 0;
export function newId(prefix = "e"): Id {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

export function newSketch(plane: PlaneRef = { kind: "world", plane: "XY", offset: 0 }, name = "Sketch 1", id = newId("s")): Sketch {
  return { id, name, plane, entities: [], constraints: [], dimensions: [] };
}

/** Looks entities up by id. Build one per read; sketches are small. */
export class SketchIndex {
  readonly byId = new Map<Id, Entity>();
  constructor(readonly sketch: Sketch) {
    for (const e of sketch.entities) this.byId.set(e.id, e);
  }
  get(id: Id): Entity | undefined {
    return this.byId.get(id);
  }
  point(id: Id): Point {
    const e = this.byId.get(id);
    if (!e || e.kind !== "point") throw new Error(`No point ${id}`);
    return e;
  }
  xy(id: Id): Vec2 {
    const p = this.point(id);
    return [p.x, p.y];
  }
  /** Lines, arcs and circles that use a point. */
  users(pointId: Id): Curve[] {
    return this.sketch.entities.filter(
      (e): e is Curve =>
        (e.kind === "line" && (e.a === pointId || e.b === pointId)) ||
        (e.kind === "arc" && (e.a === pointId || e.b === pointId || e.c === pointId)) ||
        (e.kind === "circle" && e.c === pointId),
    );
  }
}

/** Every entity, constraint and dimension a removal takes with it: curves take their points, if nothing else uses them. */
export function removeEntities(s: Sketch, ids: Id[]): Sketch {
  const gone = new Set(ids);
  const idx = new SketchIndex(s);
  for (const id of ids) {
    const e = idx.get(id);
    if (!e || e.kind === "point") continue;
    const pts = e.kind === "line" ? [e.a, e.b] : e.kind === "arc" ? [e.a, e.b, e.c] : [e.c];
    for (const p of pts) if (idx.users(p).every((u) => gone.has(u.id))) gone.add(p);
  }
  // A point going takes the curves on it.
  for (const e of s.entities) if (e.kind !== "point" && curvePoints(e).some((p) => gone.has(p))) gone.add(e.id);
  const refs = (c: Constraint) => constraintRefs(c).some((r) => gone.has(r));
  return {
    ...s,
    entities: s.entities.filter((e) => !gone.has(e.id)),
    constraints: s.constraints.filter((c) => !refs(c)),
    dimensions: s.dimensions.filter((d) => !d.refs.some((r) => gone.has(r))),
  };
}

export const curvePoints = (e: Curve): Id[] => (e.kind === "line" ? [e.a, e.b] : e.kind === "arc" ? [e.c, e.a, e.b] : [e.c]);

export function constraintRefs(c: Constraint): Id[] {
  switch (c.type) {
    case "horizontal":
    case "vertical":
      return c.b ? [c.e, c.b] : [c.e];
    case "pointOn":
      return [c.p, c.e];
    case "midpoint":
      return [c.p, c.line];
    case "fix":
      return [c.p];
    case "symmetric":
      return [c.a, c.b, c.line];
    default:
      return [c.a, c.b];
  }
}

export const CONSTRAINT_LABEL: Record<ConstraintType, string> = {
  coincident: "Coincident",
  pointOn: "On",
  horizontal: "Horizontal",
  vertical: "Vertical",
  parallel: "Parallel",
  perpendicular: "Perpendicular",
  tangent: "Tangent",
  equal: "Equal",
  concentric: "Concentric",
  midpoint: "Midpoint",
  fix: "Fix",
  symmetric: "Symmetric",
};

/** Dimension labels: "45 mm", "⌀ 8 mm", "R 2 mm", "30°"; driven ones in brackets. */
export function formatDimension(d: Pick<Dimension, "kind" | "value" | "driving">): string {
  const n = (v: number) => `${Math.round(v * 100) / 100}`;
  const text =
    d.kind === "angle" ? `${n(d.value)}°` : d.kind === "diameter" ? `⌀ ${n(d.value)} mm` : d.kind === "radius" ? `R ${n(d.value)} mm` : `${n(d.value)} mm`;
  return d.driving ? text : `(${text})`;
}

/** Parses and checks a sketch read from a file. */
export function parseSketch(value: unknown): Sketch {
  const s = value as Sketch;
  if (!s || typeof s !== "object" || !Array.isArray(s.entities) || !Array.isArray(s.constraints) || !Array.isArray(s.dimensions) || !s.plane) {
    throw new Error("This is not a sketch.");
  }
  const ids = new Set(s.entities.map((e) => e.id));
  for (const e of s.entities)
    if (e.kind !== "point" && curvePoints(e).some((p) => !ids.has(p))) throw new Error(`Sketch entity ${e.id} refers to a missing point.`);
  return s;
}
