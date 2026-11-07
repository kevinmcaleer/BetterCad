import {
  SketchIndex,
  angleOf,
  insidePolygon,
  polar,
  regions,
  sub,
  sweep,
  type Frame,
  type Loop,
  type Profile,
  type Sketch,
  type Vec2,
  type Vec3,
} from "@bettercad/sketch";

/**
 * Extrude's geometry, without OCCT (#61): which closed shapes of a sketch were picked, what they are as lines and
 * arcs, and how far along the sketch's normal they go. The document resolves an Extrude step into a PrismSpec each
 * time the timeline is built, so editing the sketch reshapes the body.
 */
export type ProfileSeg = { kind: "line"; a: Vec2; b: Vec2 } | { kind: "arc"; a: Vec2; m: Vec2; b: Vec2 } | { kind: "circle"; c: Vec2; r: number };

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

export type ExtrudeDirection = "one" | "symmetric" | "two";
export type ExtrudeOperation = "new" | "join" | "cut" | "intersect";

/** The extent along the normal for a distance and direction. */
export function extent(direction: ExtrudeDirection, distance: number, distance2 = 0): { from: number; to: number } {
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
  const idx = new SketchIndex(sketch);
  return loop.edges.map(({ id, reversed }) => {
    const e = idx.get(id)!;
    if (e.kind === "circle") return { kind: "circle", c: idx.xy(e.c), r: e.r };
    if (e.kind === "line") {
      const [a, b] = [idx.xy(e.a), idx.xy(e.b)];
      return reversed ? { kind: "line", a: b, b: a } : { kind: "line", a, b };
    }
    if (e.kind !== "arc") throw new Error(`${id} is not a curve`);
    const c = idx.xy(e.c);
    const s = angleOf(sub(idx.xy(e.a), c));
    const en = angleOf(sub(idx.xy(e.b), c));
    // An arc whose ends meet is a whole circle.
    if (e.a === e.b || Math.hypot(...sub(idx.xy(e.a), idx.xy(e.b))) < 1e-9) return { kind: "circle", c, r: e.r };
    const m = polar(c, e.r, s + sweep(s, en) / 2);
    const [a, b] = [idx.xy(e.a), idx.xy(e.b)];
    return reversed ? { kind: "arc", a: b, m, b: a } : { kind: "arc", a, m, b };
  });
}

/** The picked profiles as lines and arcs. Seeds that no longer land in a profile are reported. */
export function pickProfiles(sketch: Sketch, seeds: Vec2[]): { shapes: ProfileShape[]; lost: number } {
  const all = regions(sketch);
  const shapes: ProfileShape[] = [];
  const seen = new Set<Profile>();
  let lost = 0;
  for (const s of seeds) {
    const pr = profileAt(all, s);
    if (!pr) {
      lost++;
      continue;
    }
    if (seen.has(pr)) continue;
    seen.add(pr);
    shapes.push({ outer: segsOf(sketch, pr), holes: pr.holes.map((h) => segsOf(sketch, h)), area: pr.area - pr.holes.reduce((a, h) => a + h.area, 0) });
  }
  return { shapes, lost };
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

/**
 * A world frame in a part's own coordinates (before its move and turn), so a cut made into the part moves with it
 * when the part is moved later on the timeline.
 */
export function frameToLocal(frame: Frame, place: { position: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number } }): Frame {
  const r = rotation(place.rotation ?? { x: 0, y: 0, z: 0 });
  const p = place.position;
  const o: Vec3 = [frame.origin[0] - p.x, frame.origin[1] - p.y, frame.origin[2] - p.z];
  return { origin: mulT(r, o), x: mulT(r, frame.x), normal: mulT(r, frame.normal) };
}
