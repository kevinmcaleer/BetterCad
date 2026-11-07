/**
 * Orientation suggestions (#103): which way down to print. Candidates are the large flat faces and the faces of the
 * convex hull (what the model would rest on); each is scored by how much touches the bed, how much overhangs and how
 * tall it stands. A heuristic: the UI calls them suggestions, never the best. Pure maths, run in the kernel worker.
 */
import type { CheckMesh } from "./checks";

export type M3 = [[number, number, number], [number, number, number], [number, number, number]];
type V3 = [number, number, number];

export interface OrientMesh extends CheckMesh {
  /** The kernel's faces: face i owns triangles faceTris[i] .. faceTris[i + 1] - 1. */
  faceTris?: Uint32Array;
}

export interface OrientWeights {
  contact: number;
  overhang: number;
  height: number;
}
export const ORIENT_WEIGHTS: OrientWeights = { contact: 0.4, overhang: 0.4, height: 0.2 };

export interface Orientation {
  /** The model's direction that ends up pointing down (its unit normal before the turn). */
  down: V3;
  /** The turn that puts it down, row major: world point p goes to turn · p. */
  turn: M3;
  /** mm² flat on the bed. */
  contact: number;
  /** mm² facing down steeper than the overhang limit, off the bed. */
  overhang: number;
  /** mm, standing on the bed. */
  height: number;
  /** 0 to 1, higher is better. */
  score: number;
  /** It already lies this way. */
  current: boolean;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** The turn that takes the unit direction `n` to −Z, the shortest way round. */
export function turnDown(n: V3): M3 {
  const c = -n[2];
  if (c > 1 - 1e-9) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }
  // Facing straight up: over on its back, about X.
  if (c < -1 + 1e-9) {
    return [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
    ];
  }
  // Rodrigues: v = n × (−Z), R = I + [v]× + [v]×² / (1 + c).
  const v: V3 = [-n[1], n[0], 0];
  const k = 1 / (1 + c);
  const vx: M3 = [
    [0, -v[2], v[1]],
    [v[2], 0, -v[0]],
    [-v[1], v[0], 0],
  ];
  const r = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => (i === j ? 1 : 0) + vx[i]![j]! + k * (vx[i]![0]! * vx[0]![j]! + vx[i]![1]! * vx[1]![j]! + vx[i]![2]! * vx[2]![j]!)),
  );
  return r as M3;
}

const DEG = Math.PI / 180;

/** A part's `rotation` as a matrix: Rz · Ry · Rx, degrees. */
export function eulerMatrix(r: { x: number; y: number; z: number }): M3 {
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

/** Back from a matrix to the Rz · Ry · Rx angles, degrees, rounded off to 1e-6. */
export function matrixEuler(m: M3): { x: number; y: number; z: number } {
  const sy = Math.max(-1, Math.min(1, -m[2][0]));
  const y = Math.asin(sy);
  let x: number;
  let z: number;
  if (Math.abs(sy) < 1 - 1e-9) {
    x = Math.atan2(m[2][1], m[2][2]);
    z = Math.atan2(m[1][0], m[0][0]);
  } else {
    // Gimbal lock: only x − z (or x + z) is fixed; put it all in z.
    x = 0;
    z = Math.atan2(-m[0][1], m[1][1]);
  }
  const tidy = (rad: number) => {
    const d = Math.round((rad / DEG) * 1e6) / 1e6;
    return d === 0 ? 0 : d;
  };
  return { x: tidy(x), y: tidy(y), z: tidy(z) };
}

export function mul(a: M3, b: M3): M3 {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!)) as M3;
}
export function apply(m: M3, p: V3): V3 {
  return [dot(m[0], p), dot(m[1], p), dot(m[2], p)];
}

/** A part's placement turned about the world origin by `turn`. */
export function turnPlacement(place: { position: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number } }, turn: M3) {
  const p = apply(turn, [place.position.x, place.position.y, place.position.z]);
  return { position: { x: p[0], y: p[1], z: p[2] }, rotation: matrixEuler(mul(turn, eulerMatrix(place.rotation ?? { x: 0, y: 0, z: 0 }))) };
}

// ------------------------------------------------------------------ convex hull (quickhull)

interface HullFace {
  v: [number, number, number];
  n: V3;
  d: number;
  out: number[];
  alive: boolean;
}

/**
 * The convex hull's triangles of a point set, by quickhull: start from a tetrahedron of extreme points, then keep
 * adding the farthest point outside a face, replacing the faces it sees. Each point waits on one face it is outside.
 */
export function convexHull(points: V3[]): { a: V3; b: V3; c: V3; n: V3; area: number }[] {
  if (points.length < 4) return [];
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  points.forEach((p, i) => {
    for (let k = 0; k < 3; k++) {
      if (p[k]! < points[lo[k]!]![k]!) lo[k] = i;
      if (p[k]! > points[hi[k]!]![k]!) hi[k] = i;
    }
  });
  const span = [0, 1, 2].map((k) => points[hi[k]!]![k]! - points[lo[k]!]![k]!);
  // Loose enough that float32 tessellations of curves don't fold the hull; a point this close counts as on it.
  const eps = 1e-6 * Math.max(1, ...span);
  const axis = span.indexOf(Math.max(...span));
  const i0 = lo[axis]!;
  const i1 = hi[axis]!;
  if (i0 === i1) return [];
  // The point farthest from the line i0–i1, then the one farthest from that plane.
  const line = unit(sub(points[i1]!, points[i0]!));
  let i2 = -1;
  let best = eps;
  points.forEach((p, i) => {
    const w = sub(p, points[i0]!);
    const c = cross(w, line);
    const d = Math.hypot(c[0], c[1], c[2]);
    if (d > best) [best, i2] = [d, i];
  });
  if (i2 < 0) return [];
  const pn = unit(cross(sub(points[i1]!, points[i0]!), sub(points[i2]!, points[i0]!)));
  let i3 = -1;
  best = eps;
  points.forEach((p, i) => {
    const d = Math.abs(dot(sub(p, points[i0]!), pn));
    if (d > best) [best, i3] = [d, i];
  });
  if (i3 < 0) return [];

  const faces: HullFace[] = [];
  const edges = new Map<number, number>();
  const n = points.length;
  const key = (a: number, b: number) => a * n + b;
  const make = (a: number, b: number, c: number): number => {
    const nn = unit(cross(sub(points[b]!, points[a]!), sub(points[c]!, points[a]!)));
    faces.push({ v: [a, b, c], n: nn, d: dot(nn, points[a]!), out: [], alive: true });
    const f = faces.length - 1;
    edges.set(key(a, b), f);
    edges.set(key(b, c), f);
    edges.set(key(c, a), f);
    return f;
  };
  const dist = (f: HullFace, p: V3) => dot(f.n, p) - f.d;

  // The tetrahedron, wound so each face's normal points away from the fourth corner.
  const tet = [i0, i1, i2, i3];
  const centre: V3 = [0, 1, 2].map((k) => tet.reduce((s, i) => s + points[i]![k]!, 0) / 4) as V3;
  const first: number[] = [];
  for (const [a, b, c] of [
    [i0, i1, i2],
    [i0, i3, i1],
    [i1, i3, i2],
    [i2, i3, i0],
  ] as const) {
    const nn = cross(sub(points[b]!, points[a]!), sub(points[c]!, points[a]!));
    first.push(dot(nn, sub(centre, points[a]!)) > 0 ? make(a, c, b) : make(a, b, c));
  }
  const assign = (ids: Iterable<number>, to: number[]) => {
    for (const i of ids) {
      for (const f of to) {
        if (dist(faces[f]!, points[i]!) > eps) {
          faces[f]!.out.push(i);
          break;
        }
      }
    }
  };
  const skip = new Set(tet);
  assign(
    (function* () {
      for (let i = 0; i < n; i++) if (!skip.has(i)) yield i;
    })(),
    first,
  );

  const todo = [...first];
  // Each round adds one point to the hull, so there are at most n rounds.
  let rounds = 0;
  while (todo.length && rounds <= n) {
    const fi = todo.pop()!;
    const f = faces[fi]!;
    if (!f.alive || !f.out.length) continue;
    rounds++;
    let eye = f.out[0]!;
    let far = -Infinity;
    for (const i of f.out) {
      const d = dist(f, points[i]!);
      if (d > far) [far, eye] = [d, i];
    }
    const p = points[eye]!;
    // The faces the eye sees, and the horizon around them.
    const seen = new Set<number>([fi]);
    const stack = [fi];
    const horizon: [number, number][] = [];
    while (stack.length) {
      const g = faces[stack.pop()!]!;
      for (let k = 0; k < 3; k++) {
        const a = g.v[k]!;
        const b = g.v[(k + 1) % 3]!;
        const t = edges.get(key(b, a));
        if (t === undefined) continue;
        if (seen.has(t)) continue;
        if (dist(faces[t]!, p) > eps) {
          seen.add(t);
          stack.push(t);
        } else horizon.push([a, b]);
      }
    }
    const orphans: number[] = [];
    for (const s of seen) {
      const g = faces[s]!;
      g.alive = false;
      for (const i of g.out) if (i !== eye) orphans.push(i);
      g.out = [];
      for (let k = 0; k < 3; k++) {
        const e = key(g.v[k]!, g.v[(k + 1) % 3]!);
        if (edges.get(e) === s) edges.delete(e);
      }
    }
    const made = horizon.map(([a, b]) => make(a, b, eye));
    assign(orphans, made);
    todo.push(...made);
  }

  return faces
    .filter((f) => f.alive)
    .map((f) => {
      const [a, b, c] = f.v.map((i) => points[i]!) as [V3, V3, V3];
      const cr = cross(sub(b, a), sub(c, a));
      return { a, b, c, n: f.n, area: Math.hypot(cr[0], cr[1], cr[2]) / 2 };
    });
}

// ------------------------------------------------------------------ candidates and scores

/** Directions within about 1° are one candidate. */
const SAME = Math.cos(1 * DEG);

function addDirection(list: { n: V3; area: number }[], n: V3, area: number) {
  const hit = list.find((c) => dot(c.n, n) > SAME);
  if (hit) {
    // Area weighted, so the merged normal stays the face's own.
    const w = hit.area + area;
    hit.n = unit([(hit.n[0] * hit.area + n[0] * area) / w, (hit.n[1] * hit.area + n[1] * area) / w, (hit.n[2] * hit.area + n[2] * area) / w]);
    hit.area = w;
  } else list.push({ n, area });
}

/**
 * Up to `count` orientations for the bodies (in world space), best scored first. `limit` is the overhang angle (°)
 * the overhang check uses.
 */
export function suggestOrientations(bodies: OrientMesh[], opts: { limit?: number; weights?: OrientWeights; count?: number } = {}): Orientation[] {
  const limit = Math.sin((opts.limit ?? 45) * DEG);
  const w = opts.weights ?? ORIENT_WEIGHTS;
  const count = opts.count ?? 3;

  // Every triangle once: a corner, its unit normal and area.
  let total = 0;
  for (const b of bodies) total += b.indices.length / 3;
  if (!total) return [];
  const tn = new Float64Array(total * 3);
  const ta = new Float64Array(total);
  const corners: Float64Array[] = [];
  const pts: V3[] = [];
  const seenPt = new Set<string>();
  let surface = 0;
  let t = 0;
  const flat: { n: V3; area: number }[] = [];
  for (const b of bodies) {
    const P = b.positions;
    const I = b.indices;
    const c = new Float64Array((I.length / 3) * 9);
    const base = t;
    for (let i = 0; i < I.length / 3; i++, t++) {
      const v = [I[i * 3]!, I[i * 3 + 1]!, I[i * 3 + 2]!];
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) c[i * 9 + k * 3 + j] = P[v[k]! * 3 + j]!;
      const a: V3 = [c[i * 9]!, c[i * 9 + 1]!, c[i * 9 + 2]!];
      const n = cross(sub([c[i * 9 + 3]!, c[i * 9 + 4]!, c[i * 9 + 5]!], a), sub([c[i * 9 + 6]!, c[i * 9 + 7]!, c[i * 9 + 8]!], a));
      const len = Math.hypot(n[0], n[1], n[2]);
      ta[t] = len / 2;
      surface += len / 2;
      if (len) tn.set([n[0] / len, n[1] / len, n[2] / len], t * 3);
    }
    corners.push(c);
    for (let i = 0; i < P.length / 3; i++) {
      const k = `${Math.round(P[i * 3]! * 1e3)},${Math.round(P[i * 3 + 1]! * 1e3)},${Math.round(P[i * 3 + 2]! * 1e3)}`;
      if (seenPt.has(k)) continue;
      seenPt.add(k);
      pts.push([P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!]);
    }
    // Flat kernel faces: every triangle within 1° of the face's mean normal.
    const F = b.faceTris;
    if (F) {
      for (let f = 0; f + 1 < F.length; f++) {
        let s: V3 = [0, 0, 0];
        let area = 0;
        for (let i = F[f]!; i < F[f + 1]!; i++) {
          const a = ta[base + i]!;
          s = [s[0] + tn[(base + i) * 3]! * a, s[1] + tn[(base + i) * 3 + 1]! * a, s[2] + tn[(base + i) * 3 + 2]! * a];
          area += a;
        }
        const mean = unit(s);
        let planar = area > 0;
        for (let i = F[f]!; planar && i < F[f + 1]!; i++) {
          if (tn[(base + i) * 3]! * mean[0] + tn[(base + i) * 3 + 1]! * mean[1] + tn[(base + i) * 3 + 2]! * mean[2] < SAME) planar = false;
        }
        if (planar) flat.push({ n: mean, area });
      }
    }
  }

  const candidates: { n: V3; area: number }[] = [];
  for (const f of flat) if (f.area > surface * 0.05) addDirection(candidates, f.n, f.area);
  // The hull's faces: what a curved or open model rests on.
  // Hull triangles that face the same way (to about 1°) are one face of it: binned, as a curved body has thousands.
  const bins = new Map<string, { s: V3; area: number }>();
  let hullArea = 0;
  for (const h of convexHull(pts)) {
    const k = `${Math.round(h.n[0] * 60)},${Math.round(h.n[1] * 60)},${Math.round(h.n[2] * 60)}`;
    const b = bins.get(k) ?? { s: [0, 0, 0] as V3, area: 0 };
    b.s = [b.s[0] + h.n[0] * h.area, b.s[1] + h.n[1] * h.area, b.s[2] + h.n[2] * h.area];
    b.area += h.area;
    hullArea += h.area;
    bins.set(k, b);
  }
  const hull = [...bins.values()].map((b) => ({ n: unit(b.s), area: b.area }));
  for (const h of hull.sort((a, b) => b.area - a.area).slice(0, 40)) if (h.area > hullArea * 0.02) addDirection(candidates, h.n, 0);
  if (!candidates.some((c) => -c.n[2] > SAME)) candidates.push({ n: [0, 0, -1], area: 0 });

  const raw = candidates.map(({ n }) => {
    // Height along the candidate: down is +n, so the bed is at the largest n · p.
    let top = Infinity;
    let bed = -Infinity;
    for (const c of corners) {
      for (let i = 0; i < c.length; i += 3) {
        const d = c[i]! * n[0] + c[i + 1]! * n[1] + c[i + 2]! * n[2];
        if (d > bed) bed = d;
        if (d < top) top = d;
      }
    }
    let contact = 0;
    let overhang = 0;
    let k = 0;
    for (const c of corners) {
      for (let i = 0; i < c.length; i += 9, k++) {
        const facing = tn[k * 3]! * n[0] + tn[k * 3 + 1]! * n[1] + tn[k * 3 + 2]! * n[2];
        if (facing <= limit + 1e-6) continue;
        const d0 = c[i]! * n[0] + c[i + 1]! * n[1] + c[i + 2]! * n[2];
        const d1 = c[i + 3]! * n[0] + c[i + 4]! * n[1] + c[i + 5]! * n[2];
        const d2 = c[i + 6]! * n[0] + c[i + 7]! * n[1] + c[i + 8]! * n[2];
        if (facing > SAME && Math.min(d0, d1, d2) > bed - 0.05) contact += ta[k]!;
        else if (Math.min(d0, d1, d2) < bed - 0.2) overhang += ta[k]!;
      }
    }
    return { n, contact, overhang, height: bed - top };
  });

  const maxC = Math.max(...raw.map((r) => r.contact), 1e-9);
  const maxO = Math.max(...raw.map((r) => r.overhang), 1e-9);
  const maxH = Math.max(...raw.map((r) => r.height), 1e-9);
  const sum = w.contact + w.overhang + w.height || 1;
  return raw
    .map((r) => ({
      down: r.n,
      turn: turnDown(r.n),
      contact: r.contact,
      overhang: r.overhang,
      height: r.height,
      score: (w.contact * (r.contact / maxC) + w.overhang * (1 - r.overhang / maxO) + w.height * (1 - r.height / maxH)) / sum,
      current: -r.n[2] > SAME,
    }))
    .sort((a, b) => b.score - a.score || b.contact - a.contact)
    .slice(0, count);
}

/** "Contact 400 mm², overhang 12 mm², height 30 mm". */
export function orientationFacts(o: Pick<Orientation, "contact" | "overhang" | "height">): string {
  const r = (n: number) => Math.round(n).toLocaleString("en-GB");
  return `Contact ${r(o.contact)} mm², overhang ${r(o.overhang)} mm², height ${Math.round(o.height * 10) / 10} mm`;
}
