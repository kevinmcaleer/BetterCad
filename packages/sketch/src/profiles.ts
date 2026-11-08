import { SketchIndex, type Arc, type Curve, type Id, type Sketch, type Vec2 } from "./model";
import { textsOf } from "./text";
import { angleOf, insidePolygon, perp, polygonArea, sampleArc, sub, wrap, norm, add, scale, mid } from "./geom2d";

/**
 * Closed shapes in a sketch (#51), for extrude (#6). Lines and arcs that share end points (or are tied by coincident
 * constraints) form a graph; walking its faces gives the loops. Circles are loops of their own. Loops inside loops
 * alternate: a loop in a profile is a hole, a loop in a hole is a new profile. Construction geometry is ignored.
 */
export interface LoopEdge {
  id: Id;
  /** Walked from its second point to its first. */
  reversed: boolean;
  /** For text: which of its outlines this loop is (the loop's points are the outline itself). */
  loop?: number;
}

export interface Loop {
  edges: LoopEdge[];
  /** The outline, anticlockwise, with arcs sampled. */
  points: Vec2[];
  /** Enclosed area, mm² (always positive). */
  area: number;
}

export interface Profile extends Loop {
  holes: Loop[];
}

export interface Profiles {
  profiles: Profile[];
  /** Points where a line or arc ends without meeting another: the gaps an open shape has. */
  openEnds: Id[];
}

/** Points tied by coincident constraints, merged. */
function pointClasses(s: Sketch): (id: Id) => Id {
  const parent = new Map<Id, Id>();
  const find = (id: Id): Id => {
    let r = id;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let x = id;
    while (x !== r) {
      const n = parent.get(x)!;
      parent.set(x, r);
      x = n;
    }
    return r;
  };
  for (const c of s.constraints) if (c.type === "coincident" && !c.suppressed) parent.set(find(c.a), find(c.b));
  return find;
}

interface Half {
  edge: Curve;
  from: Id;
  to: Id;
  reversed: boolean;
  /** Direction it leaves `from`, radians. */
  out: number;
  twin?: Half;
  used?: boolean;
}

export function profiles(sketch: Sketch): Profiles {
  return nest(sketch, false);
}

/**
 * Every closed region a click can pick (#61): each loop less the loops directly inside it. Unlike `profiles`, a
 * circle inside a rectangle gives two regions, the ring and the disc, as in Fusion.
 */
export function regions(sketch: Sketch): Profile[] {
  return nest(sketch, true).profiles;
}

function nest(sketch: Sketch, all: boolean): Profiles {
  const idx = new SketchIndex(sketch);
  const cls = pointClasses(sketch);
  const xy = (id: Id) => idx.xy(id);
  const loops: (Loop & { inner: Vec2 })[] = [];

  const curves = sketch.entities.filter((e): e is Curve => e.kind !== "point" && !e.construction);
  const edges: Curve[] = [];
  for (const e of curves) {
    if (e.kind === "circle") loops.push(circleLoop(e.id, xy(e.c), e.r));
    else if (e.kind === "arc" && cls(e.a) === cls(e.b)) loops.push(circleLoop(e.id, xy(e.c), e.r));
    else if (!(e.kind === "line" && cls(e.a) === cls(e.b))) edges.push(e);
  }

  // Text outlines are loops of their own, anticlockwise like the rest.
  for (const { text, loops: outlines } of textsOf(sketch)) {
    if (text.construction) continue;
    outlines.forEach((pts, i) => {
      const points = polygonArea(pts) < 0 ? [...pts].reverse() : pts;
      const area = Math.abs(polygonArea(points));
      if (area > 1e-9) loops.push({ edges: [{ id: text.id, reversed: false, loop: i }], points, area, inner: innerPoint(points) });
    });
  }

  // Degrees, then prune dangling chains so they do not split faces.
  const ends = (e: Curve & { a: Id; b: Id }) => [cls(e.a), cls(e.b)] as const;
  const degree = new Map<Id, number>();
  for (const e of edges as (Curve & { a: Id; b: Id })[]) for (const v of ends(e)) degree.set(v, (degree.get(v) ?? 0) + 1);
  const openEnds = new Set<Id>();
  for (const e of edges as (Curve & { a: Id; b: Id })[]) for (const p of [e.a, e.b]) if (degree.get(cls(p)) === 1) openEnds.add(p);
  let live = edges as (Curve & { a: Id; b: Id })[];
  for (;;) {
    const next = live.filter((e) => ends(e).every((v) => (degree.get(v) ?? 0) > 1));
    if (next.length === live.length) break;
    for (const e of live) if (!next.includes(e)) for (const v of ends(e)) degree.set(v, degree.get(v)! - 1);
    live = next;
  }

  // Half-edges and the faces they bound.
  const outgoing = new Map<Id, Half[]>();
  for (const e of live) {
    const [u, v] = ends(e);
    const fwd: Half = { edge: e, from: u, to: v, reversed: false, out: leave(e, false, xy) };
    const back: Half = { edge: e, from: v, to: u, reversed: true, out: leave(e, true, xy) };
    fwd.twin = back;
    back.twin = fwd;
    for (const h of [fwd, back]) {
      if (!outgoing.has(h.from)) outgoing.set(h.from, []);
      outgoing.get(h.from)!.push(h);
    }
  }
  for (const list of outgoing.values()) list.sort((a, b) => wrap(a.out) - wrap(b.out));
  // Arriving along h, leave by the first edge clockwise from the way back: the sharpest left turn, so bounded faces
  // come out anticlockwise.
  const next = (h: Half): Half => {
    const list = outgoing.get(h.to)!;
    const i = list.indexOf(h.twin!);
    return list[(i - 1 + list.length) % list.length]!;
  };
  for (const list of outgoing.values()) {
    for (const start of list) {
      if (start.used) continue;
      const face: Half[] = [];
      let h = start;
      while (!h.used) {
        h.used = true;
        face.push(h);
        h = next(h);
      }
      const points = face.flatMap((f) => trace(f, xy).slice(0, -1));
      const area = polygonArea(points);
      if (area > 1e-9) loops.push({ edges: face.map((f) => ({ id: f.edge.id, reversed: f.reversed })), points, area, inner: innerPoint(points) });
    }
  }

  // Nesting: each loop's parent is the smallest loop around it.
  const parent = loops.map((l, i) => {
    let best = -1;
    loops.forEach((o, j) => {
      if (j !== i && o.area > l.area && insidePolygon(l.inner, o.points) && (best < 0 || o.area < loops[best]!.area)) best = j;
    });
    return best;
  });
  const depth = (i: number): number => (parent[i]! < 0 ? 0 : 1 + depth(parent[i]!));
  const out: Profile[] = [];
  const byLoop = new Map<number, Profile>();
  loops.forEach((l, i) => {
    if (all || depth(i) % 2 === 0) {
      const p: Profile = { edges: l.edges, points: l.points, area: l.area, holes: [] };
      byLoop.set(i, p);
      out.push(p);
    }
  });
  loops.forEach((l, i) => {
    if (all || depth(i) % 2 === 1) byLoop.get(parent[i]!)?.holes.push({ edges: l.edges, points: l.points, area: l.area });
  });
  return { profiles: out, openEnds: [...openEnds] };
}

function circleLoop(id: Id, c: Vec2, r: number): Loop & { inner: Vec2 } {
  const points = sampleArc(c, r, 0, 2 * Math.PI, 72).slice(0, -1);
  return { edges: [{ id, reversed: false }], points, area: Math.PI * r * r, inner: c };
}

/** The direction a curve leaves its start (or, reversed, its end). */
function leave(e: Curve, reversed: boolean, xy: (id: Id) => Vec2): number {
  if (e.kind === "line") return angleOf(reversed ? sub(xy(e.a), xy(e.b)) : sub(xy(e.b), xy(e.a)));
  const a = e as Arc;
  const c = xy(a.c);
  // Anticlockwise tangent at the start; clockwise at the end when walked backwards.
  if (!reversed) return angleOf(perp(sub(xy(a.a), c)));
  const t = perp(sub(xy(a.b), c));
  return angleOf([-t[0], -t[1]]);
}

/** A half-edge's points from its start to its end. */
function trace(h: Half, xy: (id: Id) => Vec2): Vec2[] {
  const e = h.edge;
  if (e.kind === "line") return h.reversed ? [xy(e.b), xy(e.a)] : [xy(e.a), xy(e.b)];
  const a = e as Arc;
  const c = xy(a.c);
  const pts = sampleArc(c, a.r, angleOf(sub(xy(a.a), c)), angleOf(sub(xy(a.b), c)));
  // Pin the ends to the points themselves so consecutive edges meet exactly.
  pts[0] = xy(a.a);
  pts[pts.length - 1] = xy(a.b);
  return h.reversed ? pts.reverse() : pts;
}

/** A point just inside an anticlockwise outline: off the middle of its longest side, to the left. */
function innerPoint(points: Vec2[]): Vec2 {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < points.length; i++) {
    const d = sub(points[(i + 1) % points.length]!, points[i]!);
    const l = Math.hypot(d[0], d[1]);
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  }
  const a = points[best]!;
  const b = points[(best + 1) % points.length]!;
  return add(mid(a, b), scale(perp(norm(sub(b, a))), Math.max(1e-6, bestLen * 1e-4)));
}
