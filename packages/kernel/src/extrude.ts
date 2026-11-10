import {
  SketchIndex,
  angleOf,
  insidePolygon,
  polar,
  regions,
  solidLoops,
  sub,
  textsOf,
  sweep,
  type Frame,
  type Loop,
  type Profile,
  type Sketch,
  type Vec2,
  type Vec3,
} from "@bettercad/sketch";
import type { ConstructRef } from "./construct";

/**
 * Extrude's geometry, without OCCT (#61): which closed shapes of a sketch were picked, what they are as lines and
 * arcs, and how far along the sketch's normal they go. The document resolves an Extrude step into a PrismSpec each
 * time the timeline is built, so editing the sketch reshapes the body.
 */
/** One curve of a profile's outline; `id` is the sketch curve it came from, which names the face it sweeps (#47). */
export type ProfileSeg = ({ kind: "line"; a: Vec2; b: Vec2 } | { kind: "arc"; a: Vec2; m: Vec2; b: Vec2 } | { kind: "circle"; c: Vec2; r: number }) & {
  id?: string;
};

export interface ProfileShape {
  outer: ProfileSeg[];
  holes: ProfileSeg[][];
  /** For quick checks and the props panel. */
  area: number;
}

export interface PrismSpec {
  frame: Frame;
  profiles: ProfileShape[];
  /** Where the solid starts and ends along the frame's normal, mm. */
  from: number;
  to: number;
}

/** Revolve's geometry (#62): profiles turned round a line in their sketch plane. */
export interface RevolveSpec {
  frame: Frame;
  profiles: ProfileShape[];
  /**
   * The axis, in sketch coordinates. It runs along the sketch plane, `offset` mm off it along the normal when it is a
   * construction axis or edge that lies above or below the plane.
   */
  axis: SketchAxis;
  /** Degrees turned, 1 to 360. */
  angle: number;
  /** Degrees to start from (minus half the angle for a symmetric revolve). */
  start?: number;
}

/** A revolve's axis in its sketch's coordinates: a line along the plane, `offset` mm off it along the normal. */
export interface SketchAxis {
  origin: Vec2;
  dir: Vec2;
  offset?: number;
}

/**
 * What a revolve turns round: the sketch's own X or Y axis, one of its lines, or something picked in the view (`ref`):
 * an origin axis, a construction axis or a straight edge of a body, read the way construction steps read their picks.
 */
export type AxisRef = { kind: "x" } | { kind: "y" } | { kind: "line"; id: string } | { kind: "ref"; ref: ConstructRef };

/**
 * A world line as a revolve axis in a sketch's coordinates, or why it can't be one: it has to run along the plane
 * (parallel to it), not through it.
 */
export function axisInSketch(f: Frame, origin: Vec3, dir: Vec3): SketchAxis | string {
  const y: Vec3 = [f.normal[1] * f.x[2] - f.normal[2] * f.x[1], f.normal[2] * f.x[0] - f.normal[0] * f.x[2], f.normal[0] * f.x[1] - f.normal[1] * f.x[0]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = Math.hypot(...dir);
  if (!(len > 1e-9)) return "Pick a straight edge, a line or an axis to turn it round";
  const d: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
  if (Math.abs(dot(d, f.normal)) > 1e-4) return "The axis has to run along the sketch's plane. Pick one that lies flat with the sketch.";
  const rel: Vec3 = [origin[0] - f.origin[0], origin[1] - f.origin[1], origin[2] - f.origin[2]];
  const [du, dv] = [dot(d, f.x), dot(d, y)];
  const k = Math.hypot(du, dv);
  const offset = dot(rel, f.normal);
  const tidy = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { origin: [tidy(dot(rel, f.x)), tidy(dot(rel, y))], dir: [tidy(du / k), tidy(dv / k)], ...(Math.abs(offset) > 1e-9 ? { offset } : {}) };
}

/** An axis in sketch coordinates, or null when its line is gone. A picked axis (`ref`) is resolved by the document. */
export function axisOf(sketch: Sketch, ref: AxisRef): SketchAxis | null {
  if (ref.kind === "ref") return null;
  if (ref.kind === "x") return { origin: [0, 0], dir: [1, 0] };
  if (ref.kind === "y") return { origin: [0, 0], dir: [0, 1] };
  const idx = new SketchIndex(sketch);
  const e = idx.get(ref.id);
  if (!e || e.kind !== "line") return null;
  const [a, b] = [idx.xy(e.a), idx.xy(e.b)];
  const d = sub(b, a);
  const len = Math.hypot(d[0], d[1]);
  return len > 1e-9 ? { origin: a, dir: [d[0] / len, d[1] / len] } : null;
}

/** Whether any picked shape lies on both sides of the axis (touching it along a line is fine). */
export function crossesAxis(list: Profile[], axis: { origin: Vec2; dir: Vec2 }): boolean {
  return list.some((pr) => {
    const side = pr.points.map((p) => (p[0] - axis.origin[0]) * axis.dir[1] - (p[1] - axis.origin[1]) * axis.dir[0]);
    return side.some((v) => v > 1e-6) && side.some((v) => v < -1e-6);
  });
}

export type ExtrudeDirection = "one" | "symmetric" | "two";
export type ExtrudeOperation = "new" | "join" | "cut" | "intersect";
/**
 * How far an extrude goes: a set distance, through everything in its way (Cut and Intersect only), or up to a face,
 * edge or point picked in the view ("To object").
 */
export type ExtrudeExtent = "distance" | "all" | "to";

/**
 * Where a "To object" extrude ends, kept in the picked body's own coordinates so it follows the body when the body is
 * moved. A flat face keeps its plane (`normal`), so the extrude ends where the plane crosses it; an edge, a point or a
 * curved face keeps one point, and the extrude ends level with it.
 */
export interface ExtrudeUpTo {
  body: string;
  kind: "face" | "edge" | "vertex";
  point: Vec3;
  normal?: Vec3;
}

/** How far "through all" reaches each way, mm: well past any printer's bed, so every body in its way is cut. */
export const THROUGH_ALL = 10_000;

/** Whether an operation can go through all. Join and New body need an end, so they keep a distance. */
export const throughAllAllowed = (op: ExtrudeOperation) => op === "cut" || op === "intersect";

/** The bodies a profile step changes: its `targets`, or its single `target` in older files. */
export function targetsOf(f: { operation: ExtrudeOperation; target?: string; targets?: string[] }): string[] {
  if (f.operation === "new") return [];
  if (f.targets?.length) return f.operation === "join" ? f.targets.slice(0, 1) : [...new Set(f.targets)];
  return f.target ? [f.target] : [];
}

/** The extent along the normal for a distance and direction. */
export function extent(direction: ExtrudeDirection, distance: number, distance2 = 0, all = false): { from: number; to: number } {
  // Through all: the distance's sign still picks the side for one side; symmetric and two sides go both ways.
  if (all)
    return direction === "one" ? (distance >= 0 ? { from: 0, to: THROUGH_ALL } : { from: -THROUGH_ALL, to: 0 }) : { from: -THROUGH_ALL, to: THROUGH_ALL };
  if (direction === "symmetric") return { from: -Math.abs(distance) / 2, to: Math.abs(distance) / 2 };
  if (direction === "two") return { from: -Math.abs(distance2), to: Math.abs(distance) };
  return distance >= 0 ? { from: 0, to: distance } : { from: distance, to: 0 };
}

/** The profile a point sits in: inside its outline and outside its holes; the smallest when profiles nest. */
export function profileAt(list: Profile[], p: Vec2): Profile | null {
  let best: Profile | null = null;
  for (const pr of list) {
    if (!insidePolygon(p, pr.points) || pr.holes.some((h) => insidePolygon(p, h.points))) continue;
    if (!best || pr.area < best.area) best = pr;
  }
  return best;
}

/**
 * The profile a stored seed picks: the one it lands in, or, for a seed that sits on an outline (older steps could
 * store a corner of the shape), the one shape whose outline it is on. A seed on the line between two shapes stays
 * unresolved, as there's no telling which was meant.
 */
export function seedProfile(list: Profile[], p: Vec2): Profile | null {
  const inside = profileAt(list, p);
  if (inside) return inside;
  const near = (pts: Vec2[]) =>
    pts.some((a, i) => {
      const b = pts[(i + 1) % pts.length]!;
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) < 1e-4;
    });
  const on = list.filter((pr) => near(pr.points) || pr.holes.some((h) => near(h.points)));
  return on.length === 1 ? on[0]! : null;
}

/** A point well inside a profile, to remember the pick by (it survives the sketch being edited a little). */
export function seedOf(pr: Profile): Vec2 {
  // Try the middle of the outline's bounding box, then points along a grid, until one is inside and out of holes.
  const xs = pr.points.map((p) => p[0]);
  const ys = pr.points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let n = 1; n <= 16; n *= 2) {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const p: Vec2 = [x0 + ((i + 0.5) / n) * (x1 - x0), y0 + ((j + 0.5) / n) * (y1 - y0)];
        if (profileAt([pr], p)) return p;
      }
  }
  return pr.points[0]!;
}

function segsOf(sketch: Sketch, loop: Loop): ProfileSeg[] {
  // A text outline is its own polygon.
  if (loop.edges[0]?.loop !== undefined) return loop.points.map((a, i): ProfileSeg => ({ kind: "line", a, b: loop.points[(i + 1) % loop.points.length]! }));
  const idx = new SketchIndex(sketch);
  return loop.edges.map(({ id, reversed, span }) => {
    const e = idx.get(id)!;
    // Part of a curve, cut where others cross it: a line between the two points, or the arc between them.
    if (span) {
      const [a, b] = span;
      if (e.kind === "line") return reversed ? { kind: "line", a: b, b: a, id } : { kind: "line", a, b, id };
      if (e.kind === "point") throw new Error(`${id} is not a curve`);
      const c = idx.xy(e.c);
      if (Math.hypot(...sub(a, b)) < 1e-9) return { kind: "circle", c, r: e.r, id };
      const s = angleOf(sub(a, c));
      const m = polar(c, e.r, s + sweep(s, angleOf(sub(b, c))) / 2);
      return reversed ? { kind: "arc", a: b, m, b: a, id } : { kind: "arc", a, m, b, id };
    }
    if (e.kind === "circle") return { kind: "circle", c: idx.xy(e.c), r: e.r, id };
    if (e.kind === "line") {
      const [a, b] = [idx.xy(e.a), idx.xy(e.b)];
      return reversed ? { kind: "line", a: b, b: a, id } : { kind: "line", a, b, id };
    }
    if (e.kind !== "arc") throw new Error(`${id} is not a curve`);
    const c = idx.xy(e.c);
    const s = angleOf(sub(idx.xy(e.a), c));
    const en = angleOf(sub(idx.xy(e.b), c));
    // An arc whose ends meet is a whole circle.
    if (e.a === e.b || Math.hypot(...sub(idx.xy(e.a), idx.xy(e.b))) < 1e-9) return { kind: "circle", c, r: e.r, id };
    const m = polar(c, e.r, s + sweep(s, en) / 2);
    const [a, b] = [idx.xy(e.a), idx.xy(e.b)];
    return reversed ? { kind: "arc", a: b, m, b: a, id } : { kind: "arc", a, m, b, id };
  });
}

/**
 * The solid letters of a text, as regions: those whose outline is one of the text's own and is not the hole in a
 * letter. Picked by the text's id, so they follow the text when its words change.
 */
export function textProfiles(sketch: Sketch, textId: string, all: Profile[] = regions(sketch)): Profile[] {
  const placed = textsOf(sketch).find((t) => t.text.id === textId);
  if (!placed) return [];
  const solid = solidLoops(placed.loops);
  return all.filter((pr) => pr.edges.length === 1 && pr.edges[0]!.id === textId && solid.has(pr.edges[0]!.loop ?? -1));
}

/**
 * The picked profiles as lines and arcs: those under the seeds, and every letter of the picked texts. Seeds that no
 * longer land in a profile, and texts that are gone, are reported. `split` cuts the sketch's curves where they cross,
 * as steps made since that came in do (older steps keep whole shapes, so they build as they always did).
 */
export function pickProfiles(sketch: Sketch, seeds: Vec2[], texts: string[] = [], split = false): { shapes: ProfileShape[]; lost: number; picked: Profile[] } {
  const all = regions(sketch, { split });
  const shapes: ProfileShape[] = [];
  const seen = new Set<Profile>();
  let lost = 0;
  const take = (pr: Profile) => {
    if (seen.has(pr)) return;
    seen.add(pr);
    shapes.push({ outer: segsOf(sketch, pr), holes: pr.holes.map((h) => segsOf(sketch, h)), area: pr.area - pr.holes.reduce((a, h) => a + h.area, 0) });
  };
  for (const s of seeds) {
    const pr = seedProfile(all, s);
    if (pr) take(pr);
    else lost++;
  }
  for (const id of texts) {
    const list = textProfiles(sketch, id, all);
    if (list.length) list.forEach(take);
    else lost++;
  }
  return { shapes, lost, picked: [...seen] };
}

// ------------------------------------------------------------------ placement maths (no three.js here)

const DEG = Math.PI / 180;
type M3 = [Vec3, Vec3, Vec3];

/** The rotation a part's `rotation` stands for: Rz · Ry · Rx (a point turns about X, then Y, then Z). */
function rotation(r: { x: number; y: number; z: number }): M3 {
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(r.x * DEG),
    Math.sin(r.x * DEG),
    Math.cos(r.y * DEG),
    Math.sin(r.y * DEG),
    Math.cos(r.z * DEG),
    Math.sin(r.z * DEG),
  ];
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

const mulT = (m: M3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];

const mul = (m: M3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

type Place = { position: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number } };

/** A world point or direction in a part's own coordinates (a direction ignores the move). */
export function toPartLocal(v: Vec3, place: Place, direction = false): Vec3 {
  const p = place.position;
  const o: Vec3 = direction ? v : [v[0] - p.x, v[1] - p.y, v[2] - p.z];
  return mulT(rotation(place.rotation ?? { x: 0, y: 0, z: 0 }), o);
}

/** A part's own point or direction in the world. */
export function fromPartLocal(v: Vec3, place: Place, direction = false): Vec3 {
  const w = mul(rotation(place.rotation ?? { x: 0, y: 0, z: 0 }), v);
  const p = place.position;
  return direction ? w : [w[0] + p.x, w[1] + p.y, w[2] + p.z];
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The middle of the picked shapes' box, on the sketch's plane, in sketch mm. */
export function profilesMiddle(picked: { points: Vec2[] }[]): Vec2 {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const pr of picked)
    for (const [x, y] of pr.points) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  return Number.isFinite(x0) ? [(x0 + x1) / 2, (y0 + y1) / 2] : [0, 0];
}

/**
 * How far along the sketch's normal a "To object" extrude goes (signed), from the middle of its shapes (in sketch mm),
 * to a point or plane in the world. A string says why it can't: the plane runs along the extrude, or the object sits
 * on the sketch's own plane.
 */
export function upToDistance(frame: Frame, middle: Vec2, at: { point: Vec3; normal?: Vec3 }): number | string {
  const n = frame.normal;
  const y: Vec3 = [n[1] * frame.x[2] - n[2] * frame.x[1], n[2] * frame.x[0] - n[0] * frame.x[2], n[0] * frame.x[1] - n[1] * frame.x[0]];
  const c: Vec3 = [0, 1, 2].map((i) => frame.origin[i]! + frame.x[i]! * middle[0] + y[i]! * middle[1]) as Vec3;
  const d: Vec3 = [at.point[0] - c[0], at.point[1] - c[1], at.point[2] - c[2]];
  let t: number;
  if (at.normal) {
    const along = dot3(n, at.normal);
    if (Math.abs(along) < 1e-6) return "That face runs alongside the extrude, so it never reaches it. Pick another.";
    t = dot3(d, at.normal) / along;
  } else t = dot3(d, n);
  if (Math.abs(t) < 1e-6) return "That is on the sketch's own plane. Pick something in front of or behind it.";
  return Math.round(t * 1e6) / 1e6;
}

/**
 * A world frame in a part's own coordinates (before its move and turn), so a cut made into the part moves with it
 * when the part is moved later on the timeline.
 */
export function frameToLocal(frame: Frame, place: Place): Frame {
  const r = rotation(place.rotation ?? { x: 0, y: 0, z: 0 });
  const p = place.position;
  const o: Vec3 = [frame.origin[0] - p.x, frame.origin[1] - p.y, frame.origin[2] - p.z];
  return { origin: mulT(r, o), x: mulT(r, frame.x), normal: mulT(r, frame.normal) };
}
