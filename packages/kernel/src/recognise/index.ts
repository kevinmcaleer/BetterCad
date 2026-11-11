import { add, dot, mul, sub, facetsOf, weld, type V3 } from "./mesh";
import { surfacesOf } from "./surfaces";
import { chainsOf, groupHoles, holesOf, ringsOf, type FoundHole, type HoleGroup } from "./holes";

export type { V3 } from "./mesh";
export type { Surface } from "./surfaces";
export type { FoundHole, HoleGroup, Plug } from "./holes";
export { groupHoles, screwMatch, PLUG_GROW } from "./holes";

/**
 * Recognising the shapes a mesh was made from (#437): flat faces, round faces, round edges and holes, from an STL's or
 * 3MF's triangles. No OCCT and no DOM. The same triangles and options always give the same answer in the same order.
 */
export interface RecogniseOptions {
  /** How far a corner may sit from a fitted face, mm. Left out, it follows the part's size. */
  tol?: number;
  /** Triangles within this many degrees of each other are one flat face. Raise it for a rough or noisy mesh. */
  flat?: number;
  /** How rough the mesh is, when `tol` and `flat` are left out: 0 clean (as CAD exports it), 1 rough, 2 very rough. */
  rough?: number;
}

/** What each roughness loosens: the tolerance, times this, and the flat angle, degrees. */
const ROUGH: [number, number][] = [
  [1, 0.5],
  [4, 3],
  [10, 6],
];

/** A round face as the app shows and picks it. */
export interface RoundFace {
  kind: "cylinder" | "cone";
  /** A point on the axis at the face's start, and the axis towards its end. */
  origin: V3;
  axis: V3;
  length: number;
  /** Radius at the start and at the end, mm (the same for a cylinder). */
  radius: [number, number];
  /** A hole's wall, not a boss. */
  concave: boolean;
  full: boolean;
}

/** A round edge: where a round face ends. */
export interface RoundEdge {
  centre: V3;
  axis: V3;
  radius: number;
  full: boolean;
}

export interface Recognition {
  triangles: number;
  /** Gaps in the mesh (sides with one triangle), and sides where more than two triangles meet. */
  openEdges: number;
  manyEdges: number;
  /** The mesh's diagonal and the tolerance used, mm. */
  size: number;
  tol: number;
  /** How many flat faces, and how many triangles fit nothing. */
  planes: number;
  freeform: number;
  /** The share of the surface that is a recognised flat or round face, 0 to 1. */
  coverage: number;
  faces: RoundFace[];
  edges: RoundEdge[];
  holes: FoundHole[];
  groups: HoleGroup[];
}

/** The tolerance a part of this size gets when none is given: 0.005 mm, or a five-thousandth of its diagonal. */
export const defaultTol = (size: number) => Math.max(0.005, size * 2e-4);

/** Flat facets, round rims and the walls that run from them, then whatever round faces are left. For tests too. */
export function analyse(t: Float32Array, opts: RecogniseOptions = {}) {
  const mesh = weld(t);
  const [loose, angle] = ROUGH[Math.max(0, Math.min(2, Math.round(opts.rough ?? 0)))]!;
  const tol = opts.tol ?? defaultTol(mesh.size) * loose;
  const facets = facetsOf(mesh, ((opts.flat ?? angle) * Math.PI) / 180, tol);
  const rings = ringsOf(mesh, facets, tol);
  const chains = chainsOf(mesh, facets, rings, tol);
  // Triangles on a recognised face: 1 flat, 2 round.
  const known = new Uint8Array(mesh.areas.length);
  for (const c of chains) for (const p of c.pieces) for (const i of p.tris) known[i] = 2;
  const surfaces = surfacesOf(mesh, facets, { tol, soft: (50 * Math.PI) / 180 }, known);
  return { mesh, facets, rings, chains, surfaces, known, tol };
}

export function recognise(t: Float32Array, opts: RecogniseOptions = {}): Recognition {
  const { mesh, facets, rings, chains, surfaces, known, tol } = analyse(t, opts);
  const holes = holesOf(chains, tol);
  const faces: RoundFace[] = [];
  const edges: RoundEdge[] = [];
  const ring = (centre: V3, axis: V3, radius: number, full: boolean) => {
    if (radius <= tol) return;
    const twin = edges.find((e) => Math.abs(e.radius - radius) <= tol && Math.hypot(...sub(e.centre, centre)) <= tol && Math.abs(dot(e.axis, axis)) > 0.9999);
    if (twin) twin.full ||= full;
    else edges.push({ centre, axis, radius, full });
  };
  for (const r of rings) ring(r.centre, r.axis, r.radius, true);
  for (const c of chains)
    for (const p of c.pieces) {
      const dir = Math.sign(p.h1 - p.h0) || 1;
      const axis = mul(c.ring.axis, dir);
      const origin = add(c.ring.centre, mul(c.ring.axis, p.h0));
      const length = Math.abs(p.h1 - p.h0);
      faces.push({ kind: Math.abs(p.r1 - p.r0) <= tol ? "cylinder" : "cone", origin, axis, length, radius: [p.r0, p.r1], concave: p.concave, full: true });
      ring(origin, axis, p.r0, true);
      ring(add(origin, mul(axis, length)), axis, p.r1, true);
    }
  let planes = 0;
  for (const s of surfaces.surfaces) {
    const tris = s.facets.flatMap((i) => facets.facets[i]!.tris);
    if (s.kind === "freeform") continue;
    if (s.kind === "plane") {
      planes++;
      for (const i of tris) known[i] = 1;
      continue;
    }
    // A round face no rim led to: part of a turn (a rounded corner, a fillet), or a wall between sloping faces.
    for (const i of tris) known[i] = 2;
    const [lo, hi] = s.range!;
    const origin = add(s.origin, mul(s.axis, lo));
    faces.push({ kind: "cylinder", origin, axis: s.axis, length: hi - lo, radius: [s.radius!, s.radius!], concave: !!s.concave, full: !!s.full });
    ring(origin, s.axis, s.radius!, !!s.full);
    ring(add(origin, mul(s.axis, hi - lo)), s.axis, s.radius!, !!s.full);
  }
  let total = 0;
  let fitted = 0;
  let freeform = 0;
  for (let i = 0; i < known.length; i++) {
    total += mesh.areas[i]!;
    if (known[i]) fitted += mesh.areas[i]!;
    else freeform++;
  }
  return {
    triangles: mesh.areas.length,
    openEdges: mesh.openEdges,
    manyEdges: mesh.manyEdges,
    size: mesh.size,
    tol,
    planes,
    freeform,
    coverage: total > 0 ? fitted / total : 0,
    faces,
    edges,
    holes,
    groups: groupHoles(holes),
  };
}

/** The same findings somewhere else: every point through `point`, every direction through `dir`. */
export function moved(r: Recognition, point: (v: V3) => V3, dir: (v: V3) => V3): Recognition {
  return {
    ...r,
    faces: r.faces.map((f) => ({ ...f, origin: point(f.origin), axis: dir(f.axis) })),
    edges: r.edges.map((e) => ({ ...e, centre: point(e.centre), axis: dir(e.axis) })),
    holes: r.holes.map((h) => ({
      ...h,
      origin: point(h.origin),
      normal: dir(h.normal),
      plugs: h.plugs.map((p) => ({ ...p, origin: point(p.origin), axis: dir(p.axis) })),
    })),
    groups: r.groups.map((g) => ({ ...g, frame: { origin: point(g.frame.origin), x: dir(g.frame.x), normal: dir(g.frame.normal) } })),
  };
}
