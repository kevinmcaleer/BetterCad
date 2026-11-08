/**
 * The section cut for the Render view: the path tracer has no clipping planes, so the mesh itself is cut. Triangles
 * are clipped to the side the modelling view keeps, and the hole the plane leaves is filled with a flat cap, so the
 * render shows the same cut-open model as the section tool.
 */
import { ShapeUtils, Vector2 } from "three";
import type { BodyMesh } from "@bettercad/kernel";

export type Triangles = Pick<BodyMesh, "positions" | "normals" | "indices">;
type V3 = [number, number, number];

/** A cutting plane: the model on the side `normal` points to is cut away, as in the modelling view. */
export interface CutPlane {
  point: V3;
  normal: V3;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Cuts `mesh` (millimetres, in the same space as the plane) and caps the cut. Returns the mesh as it was when the plane misses it. */
export function cutMesh(mesh: Triangles, plane: CutPlane): Triangles {
  const n = unit(plane.normal);
  const d0 = dot(n, plane.point);
  const P = mesh.positions,
    N = mesh.normals,
    I = mesh.indices;
  const vert = (i: number): V3 => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const norm = (i: number): V3 => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
  /** Signed distance past the plane: over 0 is cut away. */
  const side = new Float64Array(P.length / 3);
  let any = false;
  for (let i = 0; i < side.length; i++) {
    side[i] = dot(n, vert(i)) - d0;
    if (side[i] > 0) any = true;
  }
  if (!any) return mesh;

  const pos: number[] = [],
    nrm: number[] = [],
    idx: number[] = [];
  const add = (p: V3, q: V3) => {
    pos.push(p[0], p[1], p[2]);
    nrm.push(q[0], q[1], q[2]);
    return pos.length / 3 - 1;
  };
  // Original vertices that survive keep one copy each.
  const kept = new Map<number, number>();
  const keep = (i: number) => {
    let k = kept.get(i);
    if (k === undefined) kept.set(i, (k = add(vert(i), norm(i))));
    return k;
  };
  const segments: [V3, V3][] = [];

  for (let t = 0; t < I.length; t += 3) {
    const tri = [I[t], I[t + 1], I[t + 2]];
    const s = tri.map((i) => side[i]);
    if (s.every((x) => x <= 0)) {
      idx.push(keep(tri[0]), keep(tri[1]), keep(tri[2]));
      continue;
    }
    if (s.every((x) => x > 0)) continue;
    // Clip the triangle to the kept side, walking its edges in order.
    const poly: number[] = [];
    const cuts: V3[] = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e],
        b = tri[(e + 1) % 3];
      const sa = side[a],
        sb = side[b];
      if (sa <= 0) poly.push(keep(a));
      if (sa <= 0 !== sb <= 0) {
        const f = sa / (sa - sb);
        const p = lerp(vert(a), vert(b), f);
        poly.push(add(p, unit(lerp(norm(a), norm(b), f))));
        cuts.push(p);
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) idx.push(poly[0], poly[k], poly[k + 1]);
    if (cuts.length === 2) segments.push([cuts[0], cuts[1]]);
  }

  capCut(segments, n, d0, add, idx);
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

/** Joins the cut's segments into closed loops and fills them, outlines with their holes, facing along the normal. */
function capCut(segments: [V3, V3][], n: V3, d0: number, add: (p: V3, q: V3) => number, idx: number[]): void {
  if (!segments.length) return;
  // A basis in the plane, so the loops can be filled in 2D.
  const u = unit(Math.abs(n[0]) < 0.9 ? [0, -n[2], n[1]] : [-n[2], 0, n[0]]);
  const v: V3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const to2 = (p: V3) => new Vector2(dot(p, u), dot(p, v));
  const to3 = (q: Vector2): V3 => [u[0] * q.x + v[0] * q.y + n[0] * d0, u[1] * q.x + v[1] * q.y + n[1] * d0, u[2] * q.x + v[2] * q.y + n[2] * d0];

  // Weld segment ends that meet, then walk the loops.
  const key = (q: Vector2) => `${Math.round(q.x * 1e4)},${Math.round(q.y * 1e4)}`;
  const points = new Map<string, Vector2>();
  const next = new Map<string, string[]>();
  for (const [a, b] of segments) {
    const pa = to2(a),
      pb = to2(b);
    const ka = key(pa),
      kb = key(pb);
    if (ka === kb) continue;
    points.set(ka, pa);
    points.set(kb, pb);
    for (const [x, y] of [
      [ka, kb],
      [kb, ka],
    ]) {
      const l = next.get(x) ?? [];
      l.push(y);
      next.set(x, l);
    }
  }
  const used = new Set<string>();
  const edge = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const loops: Vector2[][] = [];
  for (const start of next.keys()) {
    for (const first of next.get(start)!) {
      if (used.has(edge(start, first))) continue;
      const loop = [points.get(start)!];
      let prev = start,
        at = first;
      used.add(edge(start, first));
      while (at !== start) {
        loop.push(points.get(at)!);
        const go = next.get(at)!.find((x) => x !== prev && !used.has(edge(at, x))) ?? next.get(at)!.find((x) => !used.has(edge(at, x)));
        if (!go) break;
        used.add(edge(at, go));
        prev = at;
        at = go;
      }
      if (at === start && loop.length >= 3) loops.push(loop);
    }
  }

  // A loop inside an odd number of others is a hole in the one just round it.
  const inside = (p: Vector2, loop: Vector2[]) => {
    let c = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i],
        b = loop[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const area = loops.map((l) => Math.abs(ShapeUtils.area(l)));
  const parents = loops.map((l, i) => loops.map((o, j) => (j !== i && area[j] > area[i] && inside(l[0], o) ? j : -1)).filter((j) => j >= 0));
  for (let i = 0; i < loops.length; i++) {
    if (parents[i].length % 2) continue;
    const outer = ShapeUtils.isClockWise(loops[i]) ? [...loops[i]].reverse() : loops[i];
    const holes = loops
      .map((l, j) => ({ l, j }))
      .filter(({ j }) => parents[j].length === parents[i].length + 1 && parents[j].includes(i))
      .map(({ l }) => (ShapeUtils.isClockWise(l) ? l : [...l].reverse()));
    const all = [outer, ...holes].flat();
    const base = all.map((q) => add(to3(q), n));
    for (const [a, b, c] of ShapeUtils.triangulateShape(outer, holes)) idx.push(base[a], base[b], base[c]);
  }
}
