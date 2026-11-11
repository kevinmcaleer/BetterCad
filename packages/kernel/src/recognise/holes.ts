import { SCREWS } from "../screws";
import { add, cross, dot, len, mul, sub, type Facets, type V3, type Welded } from "./mesh";
import { basis, solve3 } from "./surfaces";

/**
 * Hole recognition (#443). A hole starts at a round rim cut in a flat face. From the rim the wall is followed down
 * its profile (straight for a bore, sloping for a countersink or a drill point), across any shelf to the next wall,
 * until it comes out on another face, reaches a floor or closes to a point. Only the corners are trusted, which sit
 * on the true surface however the wall was cut into triangles.
 */
export interface Plug {
  /** A cylinder from `origin` along `axis`, mm: what fills the hole before a Hole step cuts it again. */
  origin: V3;
  axis: V3;
  radius: number;
  length: number;
}

export interface FoundHole {
  /** The hole's centre on the face it starts from, and that face's normal, out of the body. */
  origin: V3;
  normal: V3;
  diameter: number;
  /** mm below the face, or null when it goes right through. */
  depth: number | null;
  head?: { kind: "counterbore" | "countersink"; diameter: number; depth: number; angle?: number };
  /** Its bottom comes to a point, as a drill leaves it. A Hole step makes it flat. */
  pointed?: boolean;
  /** It can become a Hole step. When it can't, `note` says why. */
  step: boolean;
  note?: string;
  /** A screw it suits, e.g. "M3 clearance". */
  match?: string;
  plugs: Plug[];
}

/** How much wider than the hole its plug is, mm: enough that the plug's wall is well inside the body. */
export const PLUG_GROW = 0.01;

/** A round rim: a closed loop round a flat facet whose corners sit on a circle. */
export interface Ring {
  facet: number;
  centre: V3;
  /** The facet's normal. */
  axis: V3;
  radius: number;
  /** The facet lies outside the circle (a hole in it), not inside (a disc). */
  inner: boolean;
  /** The triangles on the other side of the rim. */
  wall: number[];
}

/** A round wall between two rims: straight (a cylinder) or sloping (a cone). Heights are along the walk's axis. */
export interface Piece {
  h0: number;
  r0: number;
  h1: number;
  r1: number;
  tris: number[];
  concave: boolean;
}

export type WalkEnd = { kind: "open"; facet: number } | { kind: "floor"; facet: number } | { kind: "point" } | { kind: "other" };

export interface Chain {
  ring: Ring;
  pieces: Piece[];
  end: WalkEnd;
}

const SQUARE = Math.cos((0.5 * Math.PI) / 180);

/** The screw a diameter suits, or undefined. */
export function screwMatch(diameter: number): string | undefined {
  for (const s of SCREWS) {
    for (const [d, what] of [
      [s.printed, "clearance for printing"],
      [s.normal, "clearance"],
      [s.close, "close fit"],
      [s.tap, "tap"],
    ] as const)
      if (Math.abs(d - diameter) <= 0.025) return `${s.label} ${what}`;
  }
  return undefined;
}

/** Every round rim on a flat facet: eight corners or more, evenly round a circle. */
export function ringsOf(m: Welded, fs: Facets, tol: number): Ring[] {
  const P = (v: number): V3 => [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!];
  const rings: Ring[] = [];
  fs.facets.forEach((f, id) => {
    // The facet's rim: sides whose other triangle is in another facet.
    const sides: { a: number; b: number; tri: number; out: number }[] = [];
    for (const i of f.tris)
      for (let k = 0; k < 3; k++) {
        const j = m.across[i * 3 + k]!;
        if (j >= 0 && fs.of[j] === id) continue;
        sides.push({ a: m.tris[i * 3 + k]!, b: m.tris[i * 3 + ((k + 1) % 3)]!, tri: i, out: j });
      }
    if (sides.length < 8) return;
    const from = new Map<number, number[]>();
    sides.forEach((s, i) => (from.get(s.a) ?? from.set(s.a, []).get(s.a)!).push(i));
    const used = new Uint8Array(sides.length);
    const [u, w] = basis(f.normal);
    for (let start = 0; start < sides.length; start++) {
      if (used[start]) continue;
      const loop: number[] = [];
      let at = start;
      for (;;) {
        used[at] = 1;
        loop.push(at);
        const next = (from.get(sides[at]!.b) ?? []).find((i) => !used[i]);
        if (next === undefined) break;
        at = next;
      }
      if (loop.length < 8 || sides[loop[loop.length - 1]!]!.b !== sides[loop[0]!]!.a) continue;
      // A circle through the loop's corners, in the facet's plane.
      const base = P(sides[loop[0]!]!.a);
      const all = loop.map((i) => {
        const d = sub(P(sides[i]!.a), base);
        return [dot(d, u), dot(d, w)] as [number, number];
      });
      // Only where the rim turns: a corner part way along a straight side says nothing about the circle.
      const pts = all.filter((p, i) => {
        const a = all[(i + all.length - 1) % all.length]!;
        const b = all[(i + 1) % all.length]!;
        const [x0, y0, x1, y1] = [p[0] - a[0], p[1] - a[1], b[0] - p[0], b[1] - p[1]];
        return Math.abs(x0 * y1 - y0 * x1) > 1e-4 * Math.hypot(x0, y0) * Math.hypot(x1, y1);
      });
      if (pts.length < 8) continue;
      const A = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      const B = [0, 0, 0];
      for (const [x, y] of pts) {
        const row = [x, y, 1];
        const z = -(x * x + y * y);
        for (let i = 0; i < 3; i++) {
          B[i]! += row[i]! * z;
          for (let j = 0; j < 3; j++) A[i]![j]! += row[i]! * row[j]!;
        }
      }
      const s = solve3(A, B);
      if (!s) continue;
      const cx = -s[0] / 2;
      const cy = -s[1] / 2;
      const r2 = cx * cx + cy * cy - s[2];
      if (!(r2 > 0)) continue;
      const radius = Math.sqrt(r2);
      if (pts.some(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - radius) > tol)) continue;
      // Evenly round: no gap between corners wider than 50°, so a hexagon is not a circle.
      const angles = pts.map(([x, y]) => Math.atan2(y - cy, x - cx)).sort((a, b) => a - b);
      let gap = angles[0]! + 2 * Math.PI - angles[angles.length - 1]!;
      for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i]! - angles[i - 1]!);
      if (gap > (50 * Math.PI) / 180) continue;
      const centre = add(base, add(mul(u, cx), mul(w, cy)));
      // Which side of the circle the facet is on: its triangles' third corners say.
      let outside = 0;
      for (const i of loop) {
        const t = sides[i]!.tri;
        for (let c = 0; c < 3; c++) {
          const v = m.tris[t * 3 + c]!;
          if (v === sides[i]!.a || v === sides[i]!.b) continue;
          outside += len(sub(P(v), centre)) > radius ? 1 : -1;
        }
      }
      const wall = [...new Set(loop.map((i) => sides[i]!.out).filter((j) => j >= 0))];
      if (wall.length) rings.push({ facet: id, centre, axis: f.normal, radius, inner: outside > 0, wall });
    }
  });
  return rings;
}

/** Follows round walls from a rim until they end. Heights are along `axis` from `centre`. */
export function follow(m: Welded, fs: Facets, byFacet: Map<number, Ring[]>, ring: Ring, tol: number): Chain {
  const P = (v: number): V3 => [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!];
  const c = ring.centre;
  const a = ring.axis;
  const hr = (v: number): [number, number] => {
    const d = sub(P(v), c);
    const h = dot(d, a);
    return [h, len(sub(d, mul(a, h)))];
  };
  const seen = new Set<number>();
  const walk = (start: number[], h0: number, r0: number): { piece: Piece; beyond: number[] } | null => {
    // The wall's slope, from the corner furthest from the rim.
    let far: [number, number] | null = null;
    for (const t of start)
      for (let k = 0; k < 3; k++) {
        const p = hr(m.tris[t * 3 + k]!);
        if (Math.abs(p[0] - h0) > tol && (!far || Math.abs(p[0] - h0) > Math.abs(far[0] - h0))) far = p;
      }
    if (!far) return null;
    const dir = Math.sign(far[0] - h0);
    const slope = (far[1] - r0) / (far[0] - h0);
    const scale = Math.sqrt(1 + slope * slope);
    const on = (v: number) => {
      const [h, r] = hr(v);
      return (h - h0) * dir >= -tol && Math.abs(r - (r0 + slope * (h - h0))) / scale <= tol;
    };
    // A wall triangle has every corner on the profile and stands along the axis: a floor fanned between corners of
    // its own rim has every corner on the profile too, but lies flat.
    const onIt = (t: number) => {
      const v = [m.tris[t * 3]!, m.tris[t * 3 + 1]!, m.tris[t * 3 + 2]!];
      if (!v.every(on)) return false;
      const hs = v.map((x) => hr(x)[0]);
      return Math.max(...hs) - Math.min(...hs) > tol;
    };
    if (!start.every(onIt) || start.some((t) => seen.has(t))) return null;
    const tris = [...start];
    const inWall = new Set(tris);
    for (let at = 0; at < tris.length; at++)
      for (let k = 0; k < 3; k++) {
        const j = m.across[tris[at]! * 3 + k]!;
        if (j < 0 || inWall.has(j) || seen.has(j) || !onIt(j)) continue;
        inWall.add(j);
        tris.push(j);
      }
    let reach = 0;
    let lean = 0;
    for (const t of tris) {
      let mid: V3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const v = m.tris[t * 3 + k]!;
        reach = Math.max(reach, (hr(v)[0] - h0) * dir);
        mid = add(mid, mul(P(v), 1 / 3));
      }
      const d = sub(mid, c);
      const radial = sub(d, mul(a, dot(d, a)));
      lean += m.areas[t]! * dot(radial, [m.normals[t * 3]!, m.normals[t * 3 + 1]!, m.normals[t * 3 + 2]!]);
    }
    const h1 = h0 + dir * reach;
    const r1 = Math.max(0, r0 + slope * (h1 - h0));
    for (const t of tris) seen.add(t);
    // What lies past the far rim.
    const beyond = new Set<number>();
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        const j = m.across[t * 3 + k]!;
        if (j < 0 || inWall.has(j)) continue;
        const e0 = hr(m.tris[t * 3 + k]!)[0];
        const e1 = hr(m.tris[t * 3 + ((k + 1) % 3)]!)[0];
        if (Math.abs(e0 - h1) <= tol && Math.abs(e1 - h1) <= tol) beyond.add(j);
      }
    return { piece: { h0, r0, h1, r1, tris: tris.sort((x, y) => x - y), concave: lean < 0 }, beyond: [...beyond] };
  };
  const pieces: Piece[] = [];
  let start = ring.wall;
  let h = 0;
  let r = ring.radius;
  for (let step = 0; step < 12; step++) {
    const w = walk(start, h, r);
    if (!w) return { ring, pieces, end: { kind: "other" } };
    pieces.push(w.piece);
    h = w.piece.h1;
    r = w.piece.r1;
    if (r <= tol) return { ring, pieces, end: { kind: "point" } };
    if (!w.beyond.length) return { ring, pieces, end: { kind: "other" } };
    const next = new Set(w.beyond.map((t) => fs.of[t]!));
    const g = next.size === 1 ? [...next][0]! : -1;
    const flat = g >= 0 && Math.abs(dot(fs.facets[g]!.normal, a)) >= SQUARE && Math.abs(dot(sub(fs.facets[g]!.centre, c), a) - h) <= tol;
    if (!flat) {
      // A crease: the next wall starts where this one ended.
      start = w.beyond;
      continue;
    }
    // A flat face square to the axis: a shelf to the next wall, the face the hole comes out on, or its floor. It
    // reaches past the rim when the triangles just past the rim do.
    const outward = w.beyond.some((t) => [0, 1, 2].some((k) => hr(m.tris[t * 3 + k]!)[1] > r + tol));
    const coaxial = (byFacet.get(g) ?? []).filter(
      (x) => Math.abs(x.radius - r) > tol && len(sub(sub(x.centre, c), mul(a, dot(sub(x.centre, c), a)))) <= tol * 2,
    );
    // The next wall must carry on the same way. One that turns back is the outside of a tube, or a pin standing on
    // the floor.
    const dir = Math.sign(w.piece.h1 - w.piece.h0);
    const onward = (x: Ring) => {
      let far = 0;
      for (const t of x.wall) for (let k = 0; k < 3; k++) far += hr(m.tris[t * 3 + k]!)[0] - h;
      return Math.sign(far) === dir;
    };
    if (outward) {
      // A shelf's outer rim bounds the face; the face a hole comes out on carries on past any rim.
      const outer = coaxial.find((x) => x.radius > r && !x.inner);
      if (!outer || !onward(outer)) return { ring, pieces, end: { kind: "open", facet: g } };
      start = outer.wall;
      r = outer.radius;
    } else {
      const inner = coaxial.find((x) => x.radius < r);
      if (!inner) return { ring, pieces, end: { kind: "floor", facet: g } };
      if (!onward(inner)) return { ring, pieces, end: { kind: "other" } };
      start = inner.wall;
      r = inner.radius;
    }
  }
  return { ring, pieces, end: { kind: "other" } };
}

/** Every chain of round walls in the mesh, each wall in one chain only. Holes are followed first, from the face in. */
export function chainsOf(m: Welded, fs: Facets, rings: Ring[], tol: number): Chain[] {
  const taken = new Set<number>();
  const chains: Chain[] = [];
  const byFacet = new Map<number, Ring[]>();
  for (const r of rings) (byFacet.get(r.facet) ?? byFacet.set(r.facet, []).get(r.facet)!).push(r);
  // Rims cut into a face first (a hole's way in), then discs, so a hole is read from its opening.
  const order = [...rings].sort((x, y) => Number(y.inner) - Number(x.inner));
  for (const ring of order) {
    if (ring.wall.some((t) => taken.has(t))) continue;
    const chain = follow(m, fs, byFacet, ring, tol);
    if (!chain.pieces.length || chain.pieces.some((p) => p.tris.some((t) => taken.has(t)))) continue;
    for (const p of chain.pieces) for (const t of p.tris) taken.add(t);
    chains.push(chain);
  }
  return chains;
}

/** The holes among the chains, read as a Hole step's settings. */
export function holesOf(chains: Chain[], tol: number): FoundHole[] {
  const holes: FoundHole[] = [];
  for (const chain of chains) {
    const { ring, pieces, end } = chain;
    // A hole starts in a face, goes into the body, and every wall of it faces inward.
    if (!ring.inner || !pieces.every((p) => p.concave) || pieces[0]!.h1 > 0) continue;
    const cyls = pieces.filter((p) => Math.abs(p.r1 - p.r0) <= tol);
    if (!cyls.length) continue;
    const main = cyls.reduce((x, y) => (y.r0 < x.r0 - 1e-9 ? y : x));
    const diameter = 2 * main.r0;
    const match = screwMatch(diameter);
    const fail = (note: string): FoundHole => ({
      origin: ring.centre,
      normal: ring.axis,
      diameter,
      depth: null,
      step: false,
      note,
      ...(match ? { match } : {}),
      plugs: [],
    });
    if (end.kind === "other") {
      holes.push(fail("It ends on a curved or sloping face, or has something standing in it"));
      continue;
    }
    // Measured down from the face it starts on. A hole right through starts from the end with a head, else the end
    // that faces most upward (then most +Y, then +X), whichever end it was found from.
    let seq = pieces.map((p) => ({ from: -p.h0, to: -p.h1, rFrom: p.r0, rTo: p.r1, p }));
    let origin = ring.centre;
    let inward = mul(ring.axis, -1);
    const through = end.kind === "open";
    if (through) {
      const headHere = pieces[0] !== main;
      const headThere = pieces[pieces.length - 1] !== main;
      if (headHere && headThere) {
        holes.push(fail("It has a wider part at both ends"));
        continue;
      }
      const n = ring.axis;
      const up = n[2] > 1e-6 || (Math.abs(n[2]) <= 1e-6 && (n[1] > 1e-6 || (Math.abs(n[1]) <= 1e-6 && n[0] > 0)));
      if (headThere || (!headHere && !up)) {
        const total = seq[seq.length - 1]!.to;
        origin = add(ring.centre, mul(inward, total));
        inward = mul(inward, -1);
        seq = seq.map((s) => ({ from: total - s.to, to: total - s.from, rFrom: s.rTo, rTo: s.rFrom, p: s.p })).reverse();
      }
    }
    const at = seq.findIndex((s) => s.p === main);
    const before = seq.slice(0, at);
    const after = seq.slice(at + 1);
    let head: FoundHole["head"];
    let note: string | undefined;
    if (before.length > 1) note = "It has more than one step";
    else if (before.length === 1) {
      const b = before[0]!;
      if (Math.abs(b.rFrom - b.rTo) <= tol) head = { kind: "counterbore", diameter: 2 * b.rFrom, depth: b.to };
      else if (b.rFrom > b.rTo && Math.abs(b.rTo - main.r0) <= tol * 2)
        head = { kind: "countersink", diameter: 2 * b.rFrom, depth: b.to, angle: (2 * Math.atan2(b.rFrom - b.rTo, b.to - b.from) * 180) / Math.PI };
      else note = "Its opening is an unusual shape";
    }
    let pointed = false;
    if (after.length > 1) note = "It has more than one step";
    else if (after.length === 1) {
      if (end.kind === "point") pointed = true;
      else note = "It has more than one step";
    }
    const hole: FoundHole = {
      origin,
      normal: mul(inward, -1),
      diameter,
      depth: through ? null : seq[at]!.to,
      ...(head ? { head } : {}),
      ...(pointed ? { pointed } : {}),
      step: !note,
      ...(note ? { note } : {}),
      ...(match ? { match } : {}),
      plugs: [],
    };
    if (hole.step) {
      // Each piece is filled from the face down to its far end, a little wide, so nothing of the old wall is left. A
      // blind hole's plug goes a little past its floor too.
      seq.forEach((s, i) => {
        const last = i === seq.length - 1;
        hole.plugs.push({ origin, axis: inward, radius: Math.max(s.rFrom, s.rTo) + PLUG_GROW, length: s.to + (last && !through ? PLUG_GROW : 0) });
      });
    }
    holes.push(hole);
  }
  // In a steady order: by the way they face, then by place.
  const key = (h: FoundHole) => [...h.normal.map((v) => -v), ...h.origin].map((v) => Math.round(v * 1e4));
  return holes.sort((x, y) => {
    const kx = key(x);
    const ky = key(y);
    for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i]! - ky[i]!;
    return 0;
  });
}

/** Holes that one Hole step would make: the same face, size, depth and head. */
export interface HoleGroup {
  /** The face's plane: origin on it, x along it, normal out of the body. */
  frame: { origin: V3; x: V3; normal: V3 };
  points: [number, number][];
  diameter: number;
  depth: number | null;
  head?: FoundHole["head"];
  match?: string;
  /** Which of the found holes are in it. */
  holes: number[];
}

export function groupHoles(holes: FoundHole[]): HoleGroup[] {
  const groups: HoleGroup[] = [];
  const same = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? a == b : Math.abs(a - b) <= 0.01);
  holes.forEach((h, i) => {
    if (!h.step) return;
    let g = groups.find(
      (g) =>
        dot(g.frame.normal, h.normal) > 1 - 1e-6 &&
        Math.abs(dot(sub(h.origin, g.frame.origin), g.frame.normal)) <= 1e-3 &&
        same(g.diameter, h.diameter) &&
        same(g.depth, h.depth) &&
        g.head?.kind === h.head?.kind &&
        same(g.head?.diameter, h.head?.diameter) &&
        same(g.head?.depth, h.head?.depth),
    );
    if (!g) {
      // x along a world axis where the face allows, so the points read as the part's own measurements.
      const n = h.normal;
      let x = basis(n)[0];
      for (const w of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as V3[]) {
        if (Math.abs(dot(w, n)) < 1e-6) {
          x = w;
          break;
        }
      }
      g = {
        frame: { origin: h.origin, x, normal: n },
        points: [],
        diameter: h.diameter,
        depth: h.depth,
        ...(h.head ? { head: h.head } : {}),
        ...(h.match ? { match: h.match } : {}),
        holes: [],
      };
      groups.push(g);
    }
    const d = sub(h.origin, g.frame.origin);
    const y = cross(g.frame.normal, g.frame.x);
    g.points.push([dot(d, g.frame.x), dot(d, y)]);
    g.holes.push(i);
  });
  return groups;
}
