import { faceFrame, type Frame } from "@bettercad/sketch";
import { fromPartLocal, toPartLocal } from "./extrude";

/**
 * Construction geometry, as Fusion's Construct menu makes it: planes, axes and points worked out from what was picked
 * (faces, edges, vertices, the origin, or other construction geometry). Each is a timeline step. Planes can be
 * sketched on and mirrored across.
 *
 * A pick on a body is kept in that body's own coordinates, so it follows the body when an earlier step moves or turns
 * it, and, for a box, cylinder or other primitive, when it is resized. Picks of the origin or of other construction
 * steps are looked up as they stand when the model builds, so a plane offset from a plane follows it. No kernel call is
 * needed: this is all frame maths.
 */

type V3 = [number, number, number];
type Size = { x: number; y: number; z: number };
type Placed = { position: Size; rotation?: Size; size: Size; kind: string };

export type ConstructWhat = "plane" | "axis" | "point";

export type ConstructKind =
  | "offset"
  | "angle"
  | "tangent"
  | "midplane"
  | "perpendicular"
  | "twoEdges"
  | "threePoints"
  | "planeAlong"
  | "cylinder"
  | "normal"
  | "twoPlanes"
  | "twoPoints"
  | "edge"
  | "vertex"
  | "edgesPoint"
  | "threePlanes"
  | "centre"
  | "edgePlane"
  | "pointAlong";

/**
 * Geometry as picked: a flat face or plane (with the face's X), a straight edge or axis (from its start, with its
 * length when it has ends), a round edge or face (`round`: a face, whose `start` is the point picked on it; an edge
 * starts at `start` and runs `sweep` degrees round its axis), or a point.
 */
export type Geo =
  | { t: "plane"; origin: V3; normal: V3; x?: V3 }
  | { t: "line"; origin: V3; dir: V3; length?: number }
  | { t: "circle"; centre: V3; axis: V3; radius: number; start?: V3; sweep?: number; round?: boolean }
  | { t: "point"; at: V3 };

/** The origin's planes, axes and point. */
export type OriginRef = "XY" | "XZ" | "YZ" | "X" | "Y" | "Z" | "O";

/** One input of a construction step. */
export type ConstructRef =
  | { origin: OriginRef }
  | { step: string }
  | {
      body: string;
      kind: "face" | "edge" | "vertex";
      index: number;
      /** The picked geometry in the body's own coordinates. */
      geo: Geo;
      /** The body's size when picked: a primitive's picks scale with it. */
      size?: Size;
    };

/** What an input slot takes. */
export type Accept = "plane" | "line" | "path" | "round" | "point";

export const ACCEPT_TEXT: Record<Accept, string> = {
  plane: "a flat face or a plane",
  line: "a straight edge or an axis",
  path: "an edge or an axis",
  round: "a round face or a round edge",
  point: "a vertex, a point or a round edge's centre",
};

/** A step's built geometry. */
export type ConstructGeo = { what: "plane"; frame: Frame } | { what: "axis"; origin: V3; dir: V3 } | { what: "point"; at: V3 };

export interface ConstructKindInfo {
  id: ConstructKind;
  what: ConstructWhat;
  label: string;
  title: string;
  /** What each pick takes, in order. */
  inputs: Accept[];
  /** The one value it takes, if any, its unit and starting value. */
  value?: { label: string; unit: "mm" | "°" | "%"; start: number };
}

/** The Construct menu, in Fusion's order: planes, then axes, then points. */
export const CONSTRUCT_KINDS: ConstructKindInfo[] = [
  {
    id: "offset",
    what: "plane",
    label: "Offset plane",
    title: "A plane a distance from a face or plane",
    inputs: ["plane"],
    value: { label: "Distance", unit: "mm", start: 10 },
  },
  {
    id: "angle",
    what: "plane",
    label: "Plane at angle",
    title: "A plane through an edge or axis, turned by an angle",
    inputs: ["line"],
    value: { label: "Angle", unit: "°", start: 45 },
  },
  {
    id: "tangent",
    what: "plane",
    label: "Tangent plane",
    title: "A plane touching a round face where you click it",
    inputs: ["round"],
    value: { label: "Angle", unit: "°", start: 0 },
  },
  { id: "midplane", what: "plane", label: "Midplane", title: "A plane halfway between two faces or planes", inputs: ["plane", "plane"] },
  {
    id: "perpendicular",
    what: "plane",
    label: "Perpendicular plane",
    title: "A plane square to an edge or axis",
    inputs: ["line"],
    value: { label: "Distance", unit: "mm", start: 0 },
  },
  { id: "twoEdges", what: "plane", label: "Plane through two edges", title: "A plane through two straight edges or axes", inputs: ["line", "line"] },
  { id: "threePoints", what: "plane", label: "Plane through three points", title: "A plane through three points", inputs: ["point", "point", "point"] },
  {
    id: "planeAlong",
    what: "plane",
    label: "Plane along path",
    title: "A plane square to an edge, part of the way along it",
    inputs: ["path"],
    value: { label: "Along", unit: "%", start: 50 },
  },
  { id: "cylinder", what: "axis", label: "Axis through cylinder", title: "The axis of a cylinder, cone, torus or round edge", inputs: ["round"] },
  { id: "normal", what: "axis", label: "Axis perpendicular to face", title: "An axis square to a face, where you click it", inputs: ["plane"] },
  { id: "twoPlanes", what: "axis", label: "Axis through two planes", title: "The line where two planes meet", inputs: ["plane", "plane"] },
  { id: "twoPoints", what: "axis", label: "Axis through two points", title: "An axis through two points", inputs: ["point", "point"] },
  { id: "edge", what: "axis", label: "Axis through edge", title: "An axis along a straight edge", inputs: ["line"] },
  { id: "vertex", what: "point", label: "Point at vertex", title: "A point on a vertex", inputs: ["point"] },
  { id: "edgesPoint", what: "point", label: "Point through two edges", title: "Where two edges or axes meet", inputs: ["line", "line"] },
  { id: "threePlanes", what: "point", label: "Point through three planes", title: "Where three planes meet", inputs: ["plane", "plane", "plane"] },
  { id: "centre", what: "point", label: "Point at centre", title: "The centre of a circle, sphere or torus", inputs: ["round"] },
  { id: "edgePlane", what: "point", label: "Point at edge and plane", title: "Where an edge or axis crosses a plane", inputs: ["line", "plane"] },
  {
    id: "pointAlong",
    what: "point",
    label: "Point along path",
    title: "A point part of the way along an edge",
    inputs: ["path"],
    value: { label: "Along", unit: "%", start: 50 },
  },
];

export const constructKind = (k: ConstructKind): ConstructKindInfo => CONSTRUCT_KINDS.find((x) => x.id === k)!;

/** A step's name on the timeline: "Plane 1", "Axis 2", "Point 1". */
export const CONSTRUCT_BASE: Record<ConstructWhat, string> = { plane: "Plane", axis: "Axis", point: "Point" };

// ------------------------------------------------------------------ vector maths

const EPS = 1e-9;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 | null => {
  const l = len(a);
  return l > EPS ? scale(a, 1 / l) : null;
};
const tidy = (a: V3): V3 => a.map((v) => Math.round(v * 1e6) / 1e6 + 0) as V3;
const DEG = Math.PI / 180;

/** `v` turned `deg` degrees about the unit axis `a` (right-handed). */
function turn(v: V3, a: V3, deg: number): V3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return add(add(scale(v, c), scale(cross(a, v), s)), scale(a, dot(a, v) * (1 - c)));
}

/** Any unit direction square to `n`. */
function square(n: V3): V3 {
  return unit(Math.abs(n[2]) < 0.9 ? cross([0, 0, 1], n) : cross(n, [0, 1, 0]))!;
}

const frameOf = (origin: V3, normal: V3, x?: V3): Frame => {
  const f = faceFrame(origin, normal, x ?? square(normal));
  return { origin: tidy(f.origin), x: tidy(f.x), normal: tidy(f.normal) };
};

// ------------------------------------------------------------------ the origin, and picks on bodies

const ORIGIN_GEO: Record<OriginRef, Geo> = {
  XY: { t: "plane", origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] },
  XZ: { t: "plane", origin: [0, 0, 0], normal: [0, -1, 0], x: [1, 0, 0] },
  YZ: { t: "plane", origin: [0, 0, 0], normal: [1, 0, 0], x: [0, 1, 0] },
  X: { t: "line", origin: [0, 0, 0], dir: [1, 0, 0] },
  Y: { t: "line", origin: [0, 0, 0], dir: [0, 1, 0] },
  Z: { t: "line", origin: [0, 0, 0], dir: [0, 0, 1] },
  O: { t: "point", at: [0, 0, 0] },
};

export const ORIGIN_NAME: Record<OriginRef, string> = {
  XY: "the XY plane",
  XZ: "the XZ plane",
  YZ: "the YZ plane",
  X: "the X axis",
  Y: "the Y axis",
  Z: "the Z axis",
  O: "the origin point",
};

/** Maps a geometry's points and directions; normals take `normal` (they scale the other way). */
function mapGeo(g: Geo, point: (p: V3) => V3, dir: (d: V3) => V3, normal: (n: V3) => V3, radius: (r: number, axis: V3) => number): Geo {
  switch (g.t) {
    case "plane":
      return { t: "plane", origin: point(g.origin), normal: normal(g.normal), ...(g.x && { x: dir(g.x) }) };
    case "line": {
      const end = g.length !== undefined ? point(add(g.origin, scale(g.dir, g.length))) : undefined;
      const origin = point(g.origin);
      return { t: "line", origin, dir: dir(g.dir), ...(end && { length: len(sub(end, origin)) }) };
    }
    case "circle":
      return {
        ...g,
        centre: point(g.centre),
        axis: dir(g.axis),
        radius: radius(g.radius, g.axis),
        ...(g.start && { start: point(g.start) }),
      };
    case "point":
      return { t: "point", at: point(g.at) };
  }
}

const isPrimitive = (p: Placed) => p.kind !== "solid";

/** A world pick on `part`, kept in the part's own coordinates (and its size, for a primitive). */
export function bodyRef(part: Placed & { id: string }, kind: "face" | "edge" | "vertex", index: number, world: Geo): ConstructRef {
  const t = (v: V3) => tidy(toPartLocal(v, part));
  const d = (v: V3) => tidy(unit(toPartLocal(v, part, true)) ?? v);
  const geo = mapGeo(world, t, d, d, (r) => r);
  return { body: part.id, kind, index, geo, ...(isPrimitive(part) && { size: { ...part.size } }) };
}

/** A body pick where the body stands now: moved, turned and (for a primitive) scaled with it. */
export function bodyGeo(ref: Extract<ConstructRef, { body: string }>, part: Placed): Geo {
  const k: V3 =
    ref.size && isPrimitive(part)
      ? ([part.size.x / (ref.size.x || 1), part.size.y / (ref.size.y || 1), part.size.z / (ref.size.z || 1)].map((v) =>
          Number.isFinite(v) && v > EPS ? v : 1,
        ) as V3)
      : [1, 1, 1];
  const S = (v: V3): V3 => [v[0] * k[0], v[1] * k[1], v[2] * k[2]];
  const Sinv = (v: V3): V3 => [v[0] / k[0], v[1] / k[1], v[2] / k[2]];
  const point = (p: V3) => tidy(fromPartLocal(S(p), part));
  const dir = (v: V3) => tidy(unit(fromPartLocal(S(v), part, true)) ?? v);
  const normal = (v: V3) => tidy(unit(fromPartLocal(Sinv(v), part, true)) ?? v);
  const radius = (r: number, axis: V3) => r * len(S(square(axis)));
  return mapGeo(ref.geo, point, dir, normal, radius);
}

/** Built construction geometry as an input for another step. */
export function geoOf(c: ConstructGeo): Geo {
  if (c.what === "plane") return { t: "plane", origin: c.frame.origin, normal: c.frame.normal, x: c.frame.x };
  if (c.what === "axis") return { t: "line", origin: c.origin, dir: c.dir };
  return { t: "point", at: c.at };
}

export const originGeo = (o: OriginRef): Geo => ORIGIN_GEO[o];

/** Whether a picked geometry can go in a slot. */
export function accepts(a: Accept, g: Geo): boolean {
  switch (a) {
    case "plane":
      return g.t === "plane";
    case "line":
      return g.t === "line";
    case "path":
      return g.t === "line" || (g.t === "circle" && !g.round);
    case "round":
      return g.t === "circle";
    case "point":
      return g.t === "point" || (g.t === "circle" && !g.round);
  }
}

// ------------------------------------------------------------------ the constructions

const planeIn = (g: Geo) => g as Extract<Geo, { t: "plane" }>;
const lineIn = (g: Geo) => g as Extract<Geo, { t: "line" }>;
const circleIn = (g: Geo) => g as Extract<Geo, { t: "circle" }>;
const pointIn = (g: Geo): V3 => (g.t === "point" ? g.at : (g as Extract<Geo, { t: "circle" }>).centre);
const lineMiddle = (l: Extract<Geo, { t: "line" }>): V3 => (l.length ? add(l.origin, scale(l.dir, l.length / 2)) : l.origin);

/** Where two planes meet: a point on the line and its direction, or null when they are parallel. */
export function planesMeet(a: { origin: V3; normal: V3 }, b: { origin: V3; normal: V3 }): { origin: V3; dir: V3 } | null {
  const dir = unit(cross(a.normal, b.normal));
  if (!dir || len(cross(a.normal, b.normal)) < 1e-6) return null;
  // The point on the line nearest the world origin: solve n1·p = d1, n2·p = d2, dir·p = 0.
  const p = solve3([a.normal, b.normal, dir], [dot(a.normal, a.origin), dot(b.normal, b.origin), 0]);
  return p && { origin: p, dir };
}

/** Solves rows · p = rhs, or null when the rows don't fix a single point. */
function solve3(rows: [V3, V3, V3], rhs: [number, number, number]): V3 | null {
  const [a, b, c] = rows;
  const det = dot(a, cross(b, c));
  if (Math.abs(det) < 1e-9) return null;
  // Cramer's rule, written with cross products: p = (d1 (b×c) + d2 (c×a) + d3 (a×b)) / det.
  return scale(add(add(scale(cross(b, c), rhs[0]), scale(cross(c, a), rhs[1])), scale(cross(a, b), rhs[2])), 1 / det);
}

/** A point and the direction of travel part of the way along a path (a fraction from 0 to 1). */
function along(g: Geo, f: number): { at: V3; dir: V3 } {
  if (g.t === "line") return { at: add(g.origin, scale(g.dir, (g.length ?? 0) * f)), dir: g.dir };
  const c = circleIn(g);
  const a = unit(c.axis)!;
  const r0 = c.start ? (unit(sub(sub(c.start, c.centre), scale(a, dot(sub(c.start, c.centre), a)))) ?? square(a)) : square(a);
  const radial = turn(r0, a, (c.sweep ?? 360) * f);
  return { at: add(c.centre, scale(radial, c.radius)), dir: unit(cross(a, radial))! };
}

/**
 * Works out a step's geometry from its inputs (already in the world) and its value, or says why it can't. Plane at
 * angle starts (0°) from the plane through the line that is nearest level, or for an upright line, the front (XZ) plane,
 * and turns about the line. Tangent plane starts where the face was clicked and turns round the axis.
 */
export function construct(kind: ConstructKind, inputs: Geo[], value = 0): ConstructGeo | string {
  const info = constructKind(kind);
  for (let i = 0; i < info.inputs.length; i++) {
    const g = inputs[i];
    if (!g) return `Pick ${ACCEPT_TEXT[info.inputs[i]!]}`;
    if (!accepts(info.inputs[i]!, g)) return `That isn't ${ACCEPT_TEXT[info.inputs[i]!]}`;
  }
  const [g0, g1, g2] = inputs as [Geo, Geo, Geo];
  const plane = (origin: V3, normal: V3, x?: V3): ConstructGeo => ({ what: "plane", frame: frameOf(origin, normal, x) });
  const axis = (origin: V3, dir: V3): ConstructGeo => ({ what: "axis", origin: tidy(origin), dir: tidy(dir) });
  const point = (at: V3): ConstructGeo => ({ what: "point", at: tidy(at) });
  switch (kind) {
    case "offset": {
      const p = planeIn(g0);
      const n = unit(p.normal)!;
      return plane(add(p.origin, scale(n, value)), n, p.x);
    }
    case "angle": {
      const l = lineIn(g0);
      const d = unit(l.dir)!;
      const flat = sub([0, 0, 1], scale(d, d[2]));
      const n0 = unit(flat) ?? unit(sub([0, -1, 0], scale(d, -d[1])))!;
      return plane(lineMiddle(l), turn(n0, d, value), d);
    }
    case "tangent": {
      const c = circleIn(g0);
      if (!c.round) return "Pick a round face";
      const a = unit(c.axis)!;
      const at = c.start ?? add(c.centre, scale(square(a), c.radius));
      const h = dot(sub(at, c.centre), a);
      const u0 = unit(sub(sub(at, c.centre), scale(a, h))) ?? square(a);
      const u = turn(u0, a, value);
      return plane(add(add(c.centre, scale(a, h)), scale(u, c.radius)), u, a);
    }
    case "midplane": {
      const [p, q] = [planeIn(g0), planeIn(g1)];
      const [n1, n2] = [unit(p.normal)!, unit(q.normal)!];
      const mid = scale(add(p.origin, q.origin), 0.5);
      if (len(cross(n1, n2)) < 1e-6) {
        const d = (dot(n1, p.origin) + dot(n1, q.origin)) / 2;
        return plane(add(mid, scale(n1, d - dot(n1, mid))), n1, p.x);
      }
      // Two planes that meet: the plane through their line that is the same distance from both, inside them.
      const n = unit(sub(n1, n2))!;
      const line = planesMeet(p, q)!;
      return plane(add(line.origin, scale(line.dir, dot(sub(mid, line.origin), line.dir))), n, line.dir);
    }
    case "perpendicular": {
      const l = lineIn(g0);
      const d = unit(l.dir)!;
      return plane(add(l.origin, scale(d, value)), d);
    }
    case "twoEdges": {
      const [a, b] = [lineIn(g0), lineIn(g1)];
      const [d1, d2] = [unit(a.dir)!, unit(b.dir)!];
      const gap = sub(b.origin, a.origin);
      const parallel = len(cross(d1, d2)) < 1e-6;
      const n = unit(parallel ? cross(d1, gap) : cross(d1, d2));
      if (!n) return "The two edges are on one line, so they don't make a plane";
      if (Math.abs(dot(gap, n)) > 1e-4 * Math.max(1, len(gap))) return "The two edges don't lie in one plane";
      return plane(lineMiddle(a), n, d1);
    }
    case "threePoints": {
      const [a, b, c] = [pointIn(g0), pointIn(g1), pointIn(g2)];
      const n = unit(cross(sub(b, a), sub(c, a)));
      if (!n || len(cross(sub(b, a), sub(c, a))) < 1e-6) return "The three points are on one line, so they don't make a plane";
      return plane(scale(add(add(a, b), c), 1 / 3), n, sub(b, a));
    }
    case "planeAlong": {
      const { at, dir } = along(g0, value / 100);
      return plane(at, dir, g0.t === "circle" ? sub(at, g0.centre) : undefined);
    }
    case "cylinder": {
      // Centred where the face was clicked, so the axis is drawn through the hole or pin, not off along its line.
      const c = circleIn(g0);
      const a = unit(c.axis)!;
      return axis(c.start ? add(c.centre, scale(a, dot(sub(c.start, c.centre), a))) : c.centre, a);
    }
    case "normal": {
      const p = planeIn(g0);
      return axis(p.origin, unit(p.normal)!);
    }
    case "twoPlanes": {
      const line = planesMeet(planeIn(g0), planeIn(g1));
      if (!line) return "The planes are parallel, so they don't meet";
      return axis(line.origin, line.dir);
    }
    case "twoPoints": {
      const [a, b] = [pointIn(g0), pointIn(g1)];
      const d = unit(sub(b, a));
      if (!d || len(sub(b, a)) < 1e-6) return "Pick two different points";
      return axis(a, d);
    }
    case "edge": {
      const l = lineIn(g0);
      return axis(l.origin, unit(l.dir)!);
    }
    case "vertex":
      return point(pointIn(g0));
    case "edgesPoint": {
      const [a, b] = [lineIn(g0), lineIn(g1)];
      const [d1, d2] = [unit(a.dir)!, unit(b.dir)!];
      const n = cross(d1, d2);
      if (len(n) < 1e-6) return "The edges are parallel, so they don't meet";
      // The nearest points on the two lines; where they cross, these are the same point.
      const w = sub(a.origin, b.origin);
      const [bb, d, e] = [dot(d1, d2), dot(d1, w), dot(d2, w)];
      const den = 1 - bb * bb;
      const s = (bb * e - d) / den;
      const t = (e - bb * d) / den;
      const p1 = add(a.origin, scale(d1, s));
      const p2 = add(b.origin, scale(d2, t));
      if (len(sub(p1, p2)) > 1e-3 * Math.max(1, len(w))) return "The edges don't meet";
      return point(scale(add(p1, p2), 0.5));
    }
    case "threePlanes": {
      const ps = [planeIn(g0), planeIn(g1), planeIn(g2)];
      const ns = ps.map((p) => unit(p.normal)!) as [V3, V3, V3];
      const at = solve3(ns, ps.map((p, i) => dot(ns[i]!, p.origin)) as [number, number, number]);
      if (!at) return "Two of the planes are parallel, so they don't meet at a point";
      return point(at);
    }
    case "centre":
      return point(circleIn(g0).centre);
    case "edgePlane": {
      const l = lineIn(g0);
      const p = planeIn(g1);
      const d = unit(l.dir)!;
      const n = unit(p.normal)!;
      const k = dot(d, n);
      if (Math.abs(k) < 1e-9) return "The edge runs along the plane, so it doesn't cross it";
      return point(add(l.origin, scale(d, dot(sub(p.origin, l.origin), n) / k)));
    }
    case "pointAlong":
      return point(along(g0, value / 100).at);
  }
}

/** The step's summary on its tile: "Offset plane, 10 mm from a face of Box 1". */
export function constructSummary(kind: ConstructKind, refs: ConstructRef[], value: number, nameOf: (ref: ConstructRef) => string): string {
  const k = constructKind(kind);
  const from = refs.map(nameOf);
  const list = from.length > 1 ? `${from.slice(0, -1).join(", ")} and ${from[from.length - 1]}` : (from[0] ?? "nothing yet");
  const v = k.value ? `${Math.round(value * 100) / 100}${k.value.unit === "mm" ? " mm" : k.value.unit}` : "";
  switch (kind) {
    case "offset":
      return `${k.label}, ${v} from ${list}`;
    case "angle":
    case "tangent":
      return `${k.label}, ${v} on ${list}`;
    case "perpendicular":
      return `${k.label}, ${v} along ${list}`;
    case "planeAlong":
    case "pointAlong":
      return `${k.label}, ${v} along ${list}`;
    default:
      return `${k.label}: ${list}`;
  }
}

/** What a pick is, in words, for the tile and the tool's bar: "a face of Box 1", "the XY plane", "Plane 2". */
export function refText(ref: ConstructRef, nameOf: (id: string) => string | undefined): string {
  if ("origin" in ref) return ORIGIN_NAME[ref.origin];
  if ("step" in ref) return nameOf(ref.step) ?? "a gone step";
  return `${ref.kind === "face" ? "a face" : ref.kind === "edge" ? "an edge" : "a vertex"} of ${nameOf(ref.body) ?? "a gone body"}`;
}
