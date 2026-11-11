/**
 * Snaps on an imported mesh (STL, 3MF): its triangles have no real faces or round edges, so the face under the pointer
 * grows into the flat run of triangles it sits in, or the smooth curved run (a peg's side, a ring's wall). A flat run
 * gives its middle, corners, edge middles and hole centres; a curved one the centres of the round rims it ends in.
 * Pure, so it can be tested without a view.
 */
import { faceSnaps, type SnapPoint, type V3 } from "./snapPoints";

export interface TriMesh {
  /** x, y, z per vertex, in the body's own space. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Face i owns triangles faceTris[i] .. faceTris[i + 1] - 1. */
  faceTris: Uint32Array;
}

/** Neighbouring triangles further apart than this are two faces of a curved run, not one smooth surface. */
const SMOOTH = Math.cos((40 * Math.PI) / 180);
/** Coplanar: normals this close… */
const FLAT = Math.cos((0.5 * Math.PI) / 180);
/** A turn along a run's outline sharper than this is a corner. */
const CORNER = Math.cos((35 * Math.PI) / 180);

interface Topo {
  /** World points per welded vertex. */
  pts: Float64Array;
  /** Welded vertex ids, three per triangle. */
  tri: Uint32Array;
  /** Unit normal and area per triangle. */
  n: Float64Array;
  area: Float64Array;
  /** The triangle across each triangle's k-th edge (v[k] to v[k+1]), or -1. */
  nbr: Int32Array;
  faceOf: Uint32Array;
}

const cache = new WeakMap<object, { key: string; topo: Topo }>();

/** Welds the mesh's corners by position and finds each triangle's neighbours, in world space (`m`: 4×4, column-major). */
function topology(mesh: TriMesh, m: ArrayLike<number>): Topo {
  const key = Array.from(m).join();
  const hit = cache.get(mesh);
  if (hit?.key === key) return hit.topo;
  const p = mesh.positions;
  const ids = new Map<string, number>();
  const weld = new Uint32Array(p.length / 3);
  const pts: number[] = [];
  for (let v = 0; v < weld.length; v++) {
    const [x, y, z] = [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!];
    const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = pts.length / 3;
      ids.set(k, id);
      pts.push(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
    }
    weld[v] = id;
  }
  const count = mesh.indices.length / 3;
  const tri = new Uint32Array(count * 3);
  for (let i = 0; i < tri.length; i++) tri[i] = weld[mesh.indices[i]!]!;
  const P = Float64Array.from(pts);
  const n = new Float64Array(count * 3);
  const area = new Float64Array(count);
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [tri[t * 3]! * 3, tri[t * 3 + 1]! * 3, tri[t * 3 + 2]! * 3];
    const u = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!];
    const w = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!];
    const x = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const l = Math.hypot(x[0]!, x[1]!, x[2]!);
    area[t] = l / 2;
    if (l > 0) for (let k = 0; k < 3; k++) n[t * 3 + k] = x[k]! / l;
  }
  // Each edge's triangles, by its two welded ends; an edge with more than two (a pinch) joins none.
  const edges = new Map<number, number[]>();
  const nv = pts.length / 3;
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [tri[t * 3 + k]!, tri[t * 3 + ((k + 1) % 3)]!];
      if (a === b) continue;
      const e = Math.min(a, b) * nv + Math.max(a, b);
      const list = edges.get(e);
      if (list) list.push(t * 3 + k);
      else edges.set(e, [t * 3 + k]);
    }
  }
  const nbr = new Int32Array(count * 3).fill(-1);
  for (const list of edges.values()) {
    if (list.length !== 2) continue;
    nbr[list[0]!] = Math.floor(list[1]! / 3);
    nbr[list[1]!] = Math.floor(list[0]! / 3);
  }
  const faceOf = new Uint32Array(count);
  for (let f = 0; f + 1 < mesh.faceTris.length; f++) faceOf.fill(f, mesh.faceTris[f]!, mesh.faceTris[f + 1]!);
  const topo = { pts: P, tri, n, area, nbr, faceOf };
  cache.set(mesh, { key, topo });
  return topo;
}

const nDot = (T: Topo, a: number, b: number) => T.n[a * 3]! * T.n[b * 3]! + T.n[a * 3 + 1]! * T.n[b * 3 + 1]! + T.n[a * 3 + 2]! * T.n[b * 3 + 2]!;
const pt = (T: Topo, v: number): V3 => [T.pts[v * 3]!, T.pts[v * 3 + 1]!, T.pts[v * 3 + 2]!];

/** The triangles reached from `seed` across edges `ok` allows. */
function grow(T: Topo, seed: number[], ok: (from: number, to: number) => boolean): Set<number> {
  const out = new Set(seed);
  const todo = [...seed];
  while (todo.length) {
    const t = todo.pop()!;
    for (let k = 0; k < 3; k++) {
      const o = T.nbr[t * 3 + k]!;
      if (o >= 0 && !out.has(o) && ok(t, o)) {
        out.add(o);
        todo.push(o);
      }
    }
  }
  return out;
}

/** A run's outlines, each a closed list of welded vertices (first not repeated). */
function outlines(T: Topo, run: Set<number>): number[][] {
  const next = new Map<number, number[]>();
  for (const t of run) {
    for (let k = 0; k < 3; k++) {
      const o = T.nbr[t * 3 + k]!;
      if (o >= 0 && run.has(o)) continue;
      const [a, b] = [T.tri[t * 3 + k]!, T.tri[t * 3 + ((k + 1) % 3)]!];
      if (a === b) continue;
      const l = next.get(a);
      if (l) l.push(b);
      else next.set(a, [b]);
    }
  }
  const loops: number[][] = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop = [start];
      let at = next.get(start)!.pop()!;
      while (at !== start && loop.length <= run.size * 3) {
        loop.push(at);
        const l = next.get(at);
        if (!l?.length) break;
        at = l.pop()!;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * An outline cut at its corners into edges, the way a CAD face's edges run: a round hole stays one closed edge; a
 * slot's outline gives two straight edges and two arcs.
 */
export function splitOutline(loop: V3[]): V3[][] {
  const pts = loop.filter((p, i) => len(sub(p, loop[(i + 1) % loop.length]!)) > 1e-6);
  const n = pts.length;
  if (n < 3) return [];
  const corner = pts.map((p, i) => {
    const a = sub(p, pts[(i + n - 1) % n]!);
    const b = sub(pts[(i + 1) % n]!, p);
    return dot(a, b) / (len(a) * len(b)) < CORNER;
  });
  const first = corner.indexOf(true);
  if (first < 0) return [[...pts, pts[0]!]];
  const out: V3[][] = [];
  let run: V3[] = [pts[first]!];
  for (let s = 1; s <= n; s++) {
    const i = (first + s) % n;
    run.push(pts[i]!);
    if (corner[i]) {
      out.push(run);
      run = [pts[i]!];
    }
  }
  return out;
}

/**
 * The snaps on the run of triangles round face `face` of an imported mesh (`matrix` places it in the world), with the
 * run's outline to draw and the faces it covers. `towards` points at the viewer. A flat run gives the face snaps of a
 * CAD face; a curved run (most of it not one flat face) gives the centres of its round rims, facing out of it.
 */
export function meshSnaps(
  mesh: TriMesh,
  matrix: ArrayLike<number>,
  face: number,
  towards: V3,
): { snaps: SnapPoint[]; ghosts: [V3, V3][]; faces: Set<number> } | null {
  const [t0, t1] = [mesh.faceTris[face], mesh.faceTris[face + 1]];
  if (t0 === undefined || t1 === undefined || t1 <= t0) return null;
  const T = topology(mesh, matrix);
  const seed = Array.from({ length: t1 - t0 }, (_, i) => t0 + i).filter((t) => T.area[t]! > 0);
  if (!seed.length) return null;
  const s0 = seed.reduce((a, b) => (T.area[b]! > T.area[a]! ? b : a));
  const at0 = pt(T, T.tri[s0 * 3]!);
  const n0: V3 = [T.n[s0 * 3]!, T.n[s0 * 3 + 1]!, T.n[s0 * 3 + 2]!];
  const flat = grow(T, seed, (_, o) => nDot(T, s0, o) > FLAT && Math.abs(dot(sub(pt(T, T.tri[o * 3]!), at0), n0)) < 1e-3);
  const smooth = grow(T, [...flat], (a, o) => T.area[o]! === 0 || nDot(T, a, o) > SMOOTH);
  const sum = (run: Set<number>) => [...run].reduce((s, t) => s + T.area[t]!, 0);
  const shape = (run: Set<number>, isFlat: boolean) => {
    const loops = outlines(T, run).map((l) => l.map((v) => pt(T, v)));
    const c: V3 = [0, 0, 0];
    let a = 0;
    for (const t of run) {
      const w = T.area[t]!;
      for (let k = 0; k < 3; k++) {
        const p = pt(T, T.tri[t * 3 + k]!);
        for (let j = 0; j < 3; j++) c[j] += (p[j]! * w) / 3;
      }
      a += w;
    }
    let edge: V3 = [1, 0, 0];
    let best = -1;
    const ghosts: [V3, V3][] = [];
    for (const l of loops)
      l.forEach((p, i) => {
        const q = l[(i + 1) % l.length]!;
        ghosts.push([p, q]);
        if (len(sub(q, p)) > best) [best, edge] = [len(sub(q, p)), sub(q, p)];
      });
    const centroid: V3 = a > 0 ? [c[0] / a, c[1] / a, c[2] / a] : at0;
    const snaps = faceSnaps({ flat: isFlat, normal: n0, centroid, edge }, loops.flatMap(splitOutline), towards);
    const faces = new Set([...run].map((t) => T.faceOf[t]!));
    return { snaps, ghosts, faces };
  };
  // A flat run that is most of its smooth surroundings is a face in its own right (a box's side with rounded edges).
  if (smooth.size > flat.size && sum(flat) < 0.25 * sum(smooth)) {
    const curved = shape(smooth, false);
    if (curved.snaps.length) return curved;
  }
  return shape(flat, true);
}
