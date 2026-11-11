import { add, cross, dot, len, mul, sub, unit, type Facet, type Facets, type V3, type Welded } from "./mesh";

/**
 * Surface fitting (#441): flat facets gathered into the round faces they were cut from. A cylinder is fitted to the
 * facets' corners, which sit on the true surface (a strip's middle sits inside the curve, and would read a hole
 * small), and grown strip by strip while its neighbours stay on it.
 */
export interface Surface {
  id: number;
  kind: "plane" | "cylinder" | "freeform";
  facets: number[];
  area: number;
  /** A plane's normal, or a cylinder's axis. */
  axis: V3;
  /** A point on the plane, or on a cylinder's axis. */
  origin: V3;
  /** A cylinder's radius, mm. */
  radius?: number;
  /** The solid is outside the curve: a hole's wall, not a boss. */
  concave?: boolean;
  /** It goes all the way round. */
  full?: boolean;
  /** Where it starts and ends along its axis from `origin`, mm. */
  range?: [number, number];
  /** How many strips it was read from. */
  strips?: number;
  /** The furthest a corner sits from the fitted surface, mm. */
  error: number;
}

export interface Surfaces {
  surfaces: Surface[];
  /** The surface each facet is in. */
  of: Int32Array;
}

export interface FitOptions {
  /** How far a corner may sit from a fitted surface, mm. */
  tol: number;
  /** Strips join across sides bent by up to this, radians: an 8-sided hole is round, a 6-sided one is not. */
  soft: number;
}

/** The eigenvectors of a symmetric 3×3 matrix (Jacobi), smallest eigenvalue first. */
export function eigen3(m: number[][]): { values: number[]; vectors: V3[] } {
  const a = m.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0]![1]!) + Math.abs(a[0]![2]!) + Math.abs(a[1]![2]!);
    if (off < 1e-18) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      if (Math.abs(a[p]![q]!) < 1e-300) continue;
      const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const kp = a[k]![p]!;
        const kq = a[k]![q]!;
        a[k]![p] = c * kp - s * kq;
        a[k]![q] = s * kp + c * kq;
      }
      for (let k = 0; k < 3; k++) {
        const pk = a[p]![k]!;
        const qk = a[q]![k]!;
        a[p]![k] = c * pk - s * qk;
        a[q]![k] = s * pk + c * qk;
      }
      for (let k = 0; k < 3; k++) {
        const kp = v[k]![p]!;
        const kq = v[k]![q]!;
        v[k]![p] = c * kp - s * kq;
        v[k]![q] = s * kp + c * kq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i]![i]! - a[j]![j]!);
  return { values: order.map((i) => a[i]![i]!), vectors: order.map((i) => [v[0]![i]!, v[1]![i]!, v[2]![i]!] as V3) };
}

/** Solves a 3×3 system, or null when it has no one answer. */
export function solve3(m: number[][], b: number[]): V3 | null {
  const a = m.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    if (Math.abs(a[p]![c]!) < 1e-12) return null;
    [a[c], a[p]] = [a[p]!, a[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let k = c; k < 4; k++) a[r]![k]! -= f * a[c]![k]!;
    }
  }
  return [a[0]![3]! / a[0]![0]!, a[1]![3]! / a[1]![1]!, a[2]![3]! / a[2]![2]!];
}

/** Two directions square to `a` and to each other. */
export function basis(a: V3): [V3, V3] {
  const h: V3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(a, h));
  return [u, cross(a, u)];
}

interface Fit {
  kind: "cylinder";
  axis: V3;
  origin: V3;
  radius: number;
  error: number;
}

/** A cylinder or cone through these facets, or null when their normals don't turn round one axis. */
function fit(m: Welded, facets: Facet[]): Fit | null {
  // Every strip's normal makes the same angle with the axis, so the normals' tips lie in a plane square to it.
  let mean: V3 = [0, 0, 0];
  let total = 0;
  for (const f of facets) {
    mean = add(mean, mul(f.normal, f.area));
    total += f.area;
  }
  mean = mul(mean, 1 / total);
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const f of facets) {
    const d = sub(f.normal, mean);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i]![j]! += f.area * d[i]! * d[j]!;
  }
  const e = eigen3(cov);
  // Normals that barely turn (two strips, or a flat run) give no axis.
  if (e.values[1]! < 1e-9 * total) return null;
  let axis = e.vectors[0]!;
  let lean = 0;
  for (const f of facets) lean += (f.area / total) * dot(f.normal, axis);
  if (lean < 0) {
    axis = mul(axis, -1);
    lean = -lean;
  }
  const P = (v: number): V3 => [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!];
  const corners = [...new Set(facets.flatMap((f) => f.corners))];
  // Strips that lean along the axis are a cone or a dome: those are read from their rims (rings.ts), not from strips.
  if (Math.abs(lean) >= Math.sin((0.5 * Math.PI) / 180)) return null;
  {
    // A cylinder: a circle through the corners, seen along the axis.
    const [u, w] = basis(axis);
    const base = P(corners[0]!);
    const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const B = [0, 0, 0];
    const pts = corners.map((c) => {
      const d = sub(P(c), base);
      return [dot(d, u), dot(d, w)] as [number, number];
    });
    for (const [x, y] of pts) {
      const row = [x, y, 1];
      const z = -(x * x + y * y);
      for (let i = 0; i < 3; i++) {
        B[i]! += row[i]! * z;
        for (let j = 0; j < 3; j++) A[i]![j]! += row[i]! * row[j]!;
      }
    }
    const s = solve3(A, B);
    if (!s) return null;
    const cx = -s[0] / 2;
    const cy = -s[1] / 2;
    const r2 = cx * cx + cy * cy - s[2];
    if (!(r2 > 0)) return null;
    const radius = Math.sqrt(r2);
    let error = 0;
    for (const [x, y] of pts) error = Math.max(error, Math.abs(Math.hypot(x - cx, y - cy) - radius));
    return { kind: "cylinder", axis, origin: add(base, add(mul(u, cx), mul(w, cy))), radius, error };
  }
  return null;
}

/** How far a point is from a fitted surface, mm. */
function off(f: Fit, p: V3): number {
  const d = sub(p, f.origin);
  const h = dot(d, f.axis);
  const rho = len(sub(d, mul(f.axis, h)));
  return Math.abs(rho - f.radius!);
}

/** Gathers facets into planes, cylinders and cones. Facets that fit nothing and aren't a flat face stay freeform. */
export function surfacesOf(m: Welded, fs: Facets, opts: FitOptions, taken?: Uint8Array): Surfaces {
  const { facets } = fs;
  // Facets already read as round walls from their rims (`taken`, by triangle) are left out.
  const of = new Int32Array(facets.length).fill(-1);
  if (taken) facets.forEach((f, i) => f.tris.some((t) => taken[t]) && (of[i] = -2));
  const surfaces: Surface[] = [];
  const P = (v: number): V3 => [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!];
  const softLinks = (i: number) => [...facets[i]!.links].filter(([, l]) => l.angle <= opts.soft).map(([j]) => j);
  const lean = Math.sin((1.5 * Math.PI) / 180);
  /** Does this facet lie on the fitted surface, facing the same way? */
  const onIt = (f: Fit, i: number, inward: boolean): boolean => {
    const g = facets[i]!;
    if (Math.abs(dot(g.normal, f.axis)) > lean) return false;
    for (const c of g.corners) if (off(f, P(c)) > opts.tol) return false;
    return isInward(f, g) === inward;
  };
  const isInward = (f: Fit, g: Facet): boolean => {
    const d = sub(g.centre, f.origin);
    const radial = sub(d, mul(f.axis, dot(d, f.axis)));
    return dot(radial, g.normal) < 0;
  };
  // Seeds: three strips in a row, the smallest facets first so strips are tried before the big faces round them.
  const seeds = Array.from({ length: facets.length }, (_, i) => i).sort((a, b) => facets[a]!.area - facets[b]!.area || a - b);
  for (const mid of seeds) {
    if (of[mid] !== -1) continue;
    const near = softLinks(mid).filter((j) => of[j] === -1);
    let made = false;
    // A strip has a handful of neighbours; a facet with dozens is a big face, and trying every pair would crawl.
    let tries = 0;
    for (let x = 0; x < near.length && !made && tries < 60; x++) {
      for (let y = x + 1; y < near.length && !made && tries < 60; y++) {
        tries++;
        let members = [near[x]!, mid, near[y]!];
        let f = fit(
          m,
          members.map((i) => facets[i]!),
        );
        if (!f || f.error > opts.tol) continue;
        const inward = isInward(f, facets[mid]!);
        if (!members.every((i) => onIt(f!, i, inward))) continue;
        // Grow strip by strip, refitting as it grows, until nothing more joins.
        for (let pass = 0; pass < 4; pass++) {
          const inSet = new Set(members);
          const queue = [...members];
          for (let at = 0; at < queue.length; at++) {
            for (const j of softLinks(queue[at]!)) {
              if (inSet.has(j) || of[j] !== -1 || !onIt(f!, j, inward)) continue;
              inSet.add(j);
              queue.push(j);
            }
          }
          const grown = queue.length > members.length;
          members = queue;
          const again = fit(
            m,
            members.map((i) => facets[i]!),
          );
          if (!again || again.error > opts.tol) break;
          f = again;
          if (!grown) break;
        }
        const final = fit(
          m,
          members.map((i) => facets[i]!),
        );
        if (!final || final.error > opts.tol || members.length < 3) continue;
        // It must turn: strips that are nearly parallel fit a huge circle, and are a slope, not a round face.
        const n0 = facets[members[0]!]!.normal;
        let turn = 1;
        for (const i of members) turn = Math.min(turn, dot(n0, facets[i]!.normal));
        if (turn > Math.cos((10 * Math.PI) / 180)) continue;
        members.sort((a, b) => a - b);
        const id = surfaces.length;
        for (const i of members) of[i] = id;
        surfaces.push(describe(m, facets, members, final, id, inward));
        made = true;
      }
    }
  }
  // What's left: a facet with more than one triangle, or with no softly bent side, is a flat face in its own right.
  for (let i = 0; i < facets.length; i++) {
    if (of[i] !== -1) continue;
    const g = facets[i]!;
    const lone = softLinks(i).some((j) => of[j] === -1 || (of[j]! >= 0 && surfaces[of[j]!]!.kind === "freeform"));
    const id = surfaces.length;
    of[i] = id;
    surfaces.push({
      id,
      kind: g.tris.length === 1 && lone ? "freeform" : "plane",
      facets: [i],
      area: g.area,
      axis: g.normal,
      origin: g.centre,
      error: 0,
    });
  }
  return { surfaces, of };
}

function describe(m: Welded, facets: Facet[], members: number[], f: Fit, id: number, inward: boolean): Surface {
  const P = (v: number): V3 => [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!];
  const [u, w] = basis(f.axis);
  let lo = Infinity;
  let hi = -Infinity;
  let area = 0;
  const angles: number[] = [];
  for (const i of members) {
    const g = facets[i]!;
    area += g.area;
    const d = sub(g.centre, f.origin);
    angles.push(Math.atan2(dot(d, w), dot(d, u)));
    for (const c of g.corners) {
      const h = dot(sub(P(c), f.origin), f.axis);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  // All the way round when no gap between strips is much wider than the usual step.
  angles.sort((a, b) => a - b);
  const gaps = angles.map((a, i) => (i + 1 < angles.length ? angles[i + 1]! - a : angles[0]! + 2 * Math.PI - a));
  const sorted = [...gaps].sort((a, b) => a - b);
  const step = sorted[Math.floor(sorted.length / 2)]!;
  const full = Math.max(...gaps) < Math.max(step * 2.5, 0.01) && Math.max(...gaps) < Math.PI / 2 + 0.01;
  const strips = gaps.filter((g) => g > 1e-6).length;
  return {
    id,
    kind: f.kind,
    facets: members,
    area,
    axis: f.axis,
    origin: f.origin,
    radius: f.radius,
    concave: inward,
    full,
    range: [lo, hi],
    strips,
    error: f.error,
  };
}
