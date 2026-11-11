/**
 * Mesh regions (#440): an STL's loose triangles welded into one mesh with neighbours, then gathered into flat facets.
 * Plain arrays and maths, no OCCT and no DOM, so it runs in the worker or in Node and the same file always gives the
 * same facets in the same order.
 */
export type V3 = [number, number, number];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};

export interface Welded {
  /** Corner positions, three numbers each. */
  positions: Float64Array;
  /** Three corners per triangle. */
  tris: Uint32Array;
  /** The triangle across each side (corner i to i+1), or -1 where the mesh is open or more than two meet. */
  across: Int32Array;
  /** Unit normals and areas, per triangle. */
  normals: Float64Array;
  areas: Float64Array;
  /** Sides with one triangle (a gap) and with more than two. */
  openEdges: number;
  manyEdges: number;
  /** The mesh's diagonal, mm. */
  size: number;
  /** Its triangles were wound inside out, and have been read the other way round. */
  flipped: boolean;
}

/** Welds corners that share a place and finds each triangle's neighbours. Slivers are dropped. */
export function weld(t: Float32Array): Welded {
  const n = Math.floor(t.length / 9);
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 9; i++) {
    const k = i % 3;
    const v = t[i]!;
    if (v < lo[k]!) lo[k] = v;
    if (v > hi[k]!) hi[k] = v;
  }
  const size = n ? len(sub(hi, lo)) : 0;
  // Corners closer than a millionth of the part are one corner.
  const q = Math.max(size * 1e-6, 1e-9);
  let cap = 16;
  while (cap < n * 6) cap *= 2;
  const table = new Int32Array(cap).fill(-1);
  const keys = new Int32Array(n * 9);
  const pos = new Float64Array(n * 9);
  let nv = 0;
  const corner = (o: number): number => {
    const x = Math.round((t[o]! - lo[0]) / q);
    const y = Math.round((t[o + 1]! - lo[1]) / q);
    const z = Math.round((t[o + 2]! - lo[2]) / q);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (cap - 1);
    for (;;) {
      const v = table[h]!;
      if (v < 0) break;
      if (keys[v * 3] === x && keys[v * 3 + 1] === y && keys[v * 3 + 2] === z) return v;
      h = (h + 1) & (cap - 1);
    }
    table[h] = nv;
    keys.set([x, y, z], nv * 3);
    pos.set([t[o]!, t[o + 1]!, t[o + 2]!], nv * 3);
    return nv++;
  };
  const tris = new Uint32Array(n * 3);
  let nt = 0;
  for (let i = 0; i < n; i++) {
    const a = corner(i * 9);
    const b = corner(i * 9 + 3);
    const c = corner(i * 9 + 6);
    if (a === b || b === c || c === a) continue;
    tris.set([a, b, c], nt * 3);
    nt++;
  }
  const positions = pos.slice(0, nv * 3);
  const T = tris.slice(0, nt * 3);
  const normals = new Float64Array(nt * 3);
  const areas = new Float64Array(nt);
  let volume = 0;
  const P = (v: number): V3 => [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
  for (let i = 0; i < nt; i++) {
    const a = P(T[i * 3]!);
    const b = P(T[i * 3 + 1]!);
    const c = P(T[i * 3 + 2]!);
    const x = cross(sub(b, a), sub(c, a));
    const l = len(x);
    areas[i] = l / 2;
    if (l > 0) normals.set([x[0] / l, x[1] / l, x[2] / l], i * 3);
    volume += dot(sub(a, lo), cross(sub(b, lo), sub(c, lo)));
  }
  const flipped = volume < 0;
  if (flipped) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i]!;
  // Neighbours: each side is shared by the two triangles that use its corners.
  const across = new Int32Array(nt * 3).fill(-1);
  const sides = new Map<number, number>();
  const count = new Map<number, number>();
  let manyEdges = 0;
  for (let i = 0; i < nt; i++) {
    for (let k = 0; k < 3; k++) {
      const a = T[i * 3 + k]!;
      const b = T[i * 3 + ((k + 1) % 3)]!;
      const key = a < b ? a * nv + b : b * nv + a;
      const slot = i * 3 + k;
      const c = (count.get(key) ?? 0) + 1;
      count.set(key, c);
      if (c === 1) sides.set(key, slot);
      else if (c === 2) {
        const other = sides.get(key)!;
        across[slot] = Math.floor(other / 3);
        across[other] = i;
      } else {
        // Three or more on one side: nobody is anybody's neighbour there.
        if (c === 3) {
          manyEdges++;
          const other = sides.get(key)!;
          const o2 = across[other]!;
          for (let j = 0; j < 3; j++) if (o2 >= 0 && across[o2 * 3 + j] === Math.floor(other / 3)) across[o2 * 3 + j] = -1;
          across[other] = -1;
        }
      }
    }
  }
  let openEdges = 0;
  for (const c of count.values()) if (c === 1) openEdges++;
  return { positions, tris: T, across, normals, areas, openEdges, manyEdges, size, flipped };
}

/** A flat run of triangles. */
export interface Facet {
  tris: number[];
  area: number;
  normal: V3;
  /** A point on it (its area-weighted middle). */
  centre: V3;
  /** Its distinct corners. */
  corners: number[];
  /** Neighbouring facets by index, each with the angle between them (radians) and the corners of one shared side. */
  links: Map<number, { angle: number; a: number; b: number; length: number }>;
}

export interface Facets {
  facets: Facet[];
  /** The facet each triangle is in. */
  of: Int32Array;
}

/**
 * Gathers triangles into flat facets: neighbours join while they stay within `flat` radians of the facet's first
 * triangle and `tol` mm of its plane. The biggest triangles seed first, so a facet's plane is its best-known one.
 */
export function facetsOf(m: Welded, flat: number, tol: number): Facets {
  const nt = m.areas.length;
  const of = new Int32Array(nt).fill(-1);
  const order = Array.from({ length: nt }, (_, i) => i).sort((a, b) => m.areas[b]! - m.areas[a]! || a - b);
  const cosFlat = Math.cos(flat);
  const facets: Facet[] = [];
  const N = (i: number): V3 => [m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!];
  const P = (v: number): V3 => [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!];
  for (const seed of order) {
    if (of[seed]! >= 0 || m.areas[seed] === 0) continue;
    const id = facets.length;
    const n0 = N(seed);
    const p0 = P(m.tris[seed * 3]!);
    const list = [seed];
    of[seed] = id;
    for (let at = 0; at < list.length; at++) {
      const i = list[at]!;
      for (let k = 0; k < 3; k++) {
        const j = m.across[i * 3 + k]!;
        if (j < 0 || of[j]! >= 0 || m.areas[j] === 0) continue;
        let on = true;
        for (let c = 0; c < 3 && on; c++) on = Math.abs(dot(sub(P(m.tris[j * 3 + c]!), p0), n0)) <= tol;
        if (!on) continue;
        if (dot(N(j), n0) < cosFlat) {
          // A sliver's normal means little: corners within the tolerance can tilt it by the tolerance over its width.
          const a = P(m.tris[j * 3]!);
          const b = P(m.tris[j * 3 + 1]!);
          const c = P(m.tris[j * 3 + 2]!);
          const longest = Math.max(len(sub(a, b)), len(sub(b, c)), len(sub(c, a)));
          const width = (2 * m.areas[j]!) / longest;
          if (dot(N(j), n0) < Math.cos(Math.min(Math.PI / 3, (2 * tol) / width))) continue;
        }
        of[j] = id;
        list.push(j);
      }
    }
    list.sort((a, b) => a - b);
    let area = 0;
    let normal: V3 = [0, 0, 0];
    let centre: V3 = [0, 0, 0];
    const corners = new Set<number>();
    for (const i of list) {
      const w = m.areas[i]!;
      area += w;
      normal = add(normal, mul(N(i), w));
      for (let c = 0; c < 3; c++) {
        const v = m.tris[i * 3 + c]!;
        corners.add(v);
        centre = add(centre, mul(P(v), w / 3));
      }
    }
    facets.push({ tris: list, area, normal: unit(normal), centre: mul(centre, 1 / area), corners: [...corners], links: new Map() });
  }
  // Which facets touch, and at what angle.
  for (let i = 0; i < nt; i++) {
    const f = of[i]!;
    if (f < 0) continue;
    for (let k = 0; k < 3; k++) {
      const j = m.across[i * 3 + k]!;
      if (j < 0) continue;
      const g = of[j]!;
      if (g < 0 || g === f) continue;
      const a = m.tris[i * 3 + k]!;
      const b = m.tris[i * 3 + ((k + 1) % 3)]!;
      const length = len(sub(P(a), P(b)));
      const link = facets[f]!.links.get(g);
      if (link) {
        if (length > link.length) Object.assign(link, { a, b, length });
      } else {
        const c = Math.max(-1, Math.min(1, dot(facets[f]!.normal, facets[g]!.normal)));
        facets[f]!.links.set(g, { angle: Math.acos(c), a, b, length });
      }
    }
  }
  return { facets, of };
}
