import { SketchIndex, ellipseAngle, ellipseGeo, ellipsePoint, sampleEllipse, type EllipseGeo, type Id, type Sketch, type Vec2 } from "./model";
import { circleSide, curveEllipse, ellipseSide, lineEllipse } from "./ellipse";
import { textsOf } from "./text";
import { angleOf, insidePolygon, perp, polar, polygonArea, sampleArc, sub, sweep, wrap, norm, add, scale, mid } from "./geom2d";

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
  /**
   * When only part of the curve bounds the loop (it is cut where other curves cross it): where that part starts and
   * ends, in the curve's own direction (anticlockwise on arcs and circles). Missing when the whole curve is used.
   */
  span?: [Vec2, Vec2];
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

/** How close two points may be and still be one, mm: crossings, touches and ends within it meet. */
const TOL = 1e-5;
const TAU = 2 * Math.PI;

/**
 * A curve, or a piece of one: a line from a to b, or an anticlockwise arc about c from angle s through sweep w. An
 * ellipse (#401) is an arc squashed to `k` times as wide across its first axis, which is turned by `rot`; its angles
 * are eccentric angles.
 */
type Geo = { kind: "line"; a: Vec2; b: Vec2 } | { kind: "arc"; c: Vec2; r: number; s: number; w: number; k?: number; rot?: number };
type ArcGeo = Extract<Geo, { kind: "arc" }>;

const ell = (g: ArcGeo): EllipseGeo | null => (g.k === undefined ? null : { c: g.c, r1: g.r, r2: g.r * g.k, rot: g.rot ?? 0 });
const pointOn = (g: ArcGeo, t: number): Vec2 => {
  const e = ell(g);
  return e ? ellipsePoint(e, t) : polar(g.c, g.r, t);
};
/** The way an arc runs at angle t, radians. */
const heading = (g: ArcGeo, t: number): number => {
  if (g.k === undefined) return t + Math.PI / 2;
  const rot = g.rot ?? 0;
  const [x, y] = [-g.r * Math.sin(t), g.r * g.k * Math.cos(t)];
  return Math.atan2(x * Math.sin(rot) + y * Math.cos(rot), x * Math.cos(rot) - y * Math.sin(rot));
};
/** How hard an arc bends at angle t. */
const curvature = (g: ArcGeo, t: number): number => {
  if (g.k === undefined) return 1 / g.r;
  const [a, b] = [g.r, g.r * g.k];
  return (a * b) / Math.pow(a * a * Math.sin(t) ** 2 + b * b * Math.cos(t) ** 2, 1.5);
};

/** Where along a curve a point is: 0..1 along a line, radians from the start round an arc. Null when it is off it. */
function along(g: Geo, p: Vec2, closed: boolean): number | null {
  if (g.kind === "line") {
    const d = sub(g.b, g.a);
    const l2 = d[0] ** 2 + d[1] ** 2;
    const t = ((p[0] - g.a[0]) * d[0] + (p[1] - g.a[1]) * d[1]) / l2;
    const q = add(g.a, scale(d, t));
    const tol = TOL / Math.sqrt(l2);
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > TOL || t < -tol || t > 1 + tol) return null;
    return Math.max(0, Math.min(1, t));
  }
  const e = ell(g);
  if (e) {
    const q = ellipsePoint(e, ellipseAngle(e, p));
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > TOL) return null;
  } else if (Math.abs(Math.hypot(p[0] - g.c[0], p[1] - g.c[1]) - g.r) > TOL) return null;
  let t = wrap((e ? ellipseAngle(e, p) : angleOf(sub(p, g.c))) - g.s);
  const tol = TOL / g.r;
  if (t > TAU - tol) t = 0;
  if (closed) return t;
  if (t > g.w + tol) return null;
  return Math.min(t, g.w);
}

/** Where two curves meet, touches included, before checking the points are on both. */
function meet(g: Geo, h: Geo): Vec2[] {
  const eg = g.kind === "arc" ? ell(g) : null;
  const eh = h.kind === "arc" ? ell(h) : null;
  if (eg || eh) {
    const [e, o] = (eg ? [eg, h] : [eh, g]) as [EllipseGeo, Geo];
    if (o.kind === "line") return lineEllipse(o.a, o.b, e);
    const oe = ell(o);
    return curveEllipse(oe ? ellipseSide(oe) : circleSide(o.c, o.r), e);
  }
  if (g.kind === "line" && h.kind === "line") {
    const r = sub(g.b, g.a);
    const s = sub(h.b, h.a);
    const d = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(d) < 1e-12 * (Math.hypot(...r) * Math.hypot(...s) || 1)) return [];
    const q = sub(h.a, g.a);
    const t = (q[0] * s[1] - q[1] * s[0]) / d;
    return [add(g.a, scale(r, t))];
  }
  if (g.kind === "arc" && h.kind === "line") return meet(h, g);
  if (g.kind === "line" && h.kind === "arc") {
    const d = norm(sub(g.b, g.a));
    const t = (h.c[0] - g.a[0]) * d[0] + (h.c[1] - g.a[1]) * d[1];
    const foot = add(g.a, scale(d, t));
    const off = Math.hypot(foot[0] - h.c[0], foot[1] - h.c[1]);
    if (off > h.r + TOL) return [];
    if (off > h.r - TOL) return [foot];
    const k = Math.sqrt(h.r * h.r - off * off);
    return [add(foot, scale(d, -k)), add(foot, scale(d, k))];
  }
  const a = g as Extract<Geo, { kind: "arc" }>;
  const b = h as Extract<Geo, { kind: "arc" }>;
  const v = sub(b.c, a.c);
  const dd = Math.hypot(v[0], v[1]);
  if (dd < TOL) return [];
  const u = scale(v, 1 / dd);
  if (Math.abs(dd - (a.r + b.r)) < TOL) return [add(a.c, scale(u, a.r))];
  if (Math.abs(dd - Math.abs(a.r - b.r)) < TOL) return [add(a.c, scale(u, a.r >= b.r ? a.r : -a.r))];
  if (dd > a.r + b.r || dd < Math.abs(a.r - b.r)) return [];
  const x = (a.r * a.r - b.r * b.r + dd * dd) / (2 * dd);
  const y = Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const m = add(a.c, scale(u, x));
  return [add(m, scale(perp(u), y)), sub(m, scale(perp(u), y))];
}

interface Half {
  piece: Piece;
  to: number;
  reversed: boolean;
  /** Direction it leaves its start, radians. */
  out: number;
  /** Signed curvature leaving (left turns positive), to order pieces that leave the same way (a tangent touch). */
  bend: number;
  twin?: Half;
  used?: boolean;
}

interface Piece {
  id: Id;
  from: number;
  to: number;
  geo: Geo;
  /** The whole curve, uncut. */
  whole: boolean;
}

export function profiles(sketch: Sketch): Profiles {
  return nest(sketch, false, false);
}

/**
 * Every closed region a click can pick (#61): each loop less the loops directly inside it. Unlike `profiles`, a
 * circle inside a rectangle gives two regions, the ring and the disc, as in Fusion. With `split`, curves are also cut
 * where they cross or touch, so a circle over a rectangle gives the parts of each, and edges projected from the model
 * bound regions too; a region's holes are then the outlines of the separate shapes inside it.
 */
export function regions(sketch: Sketch, opts: { split?: boolean } = {}): Profile[] {
  return nest(sketch, true, !!opts.split).profiles;
}

type L = Loop & { inner: Vec2; comp: string };

function nest(sketch: Sketch, all: boolean, split: boolean): Profiles {
  const idx = new SketchIndex(sketch);
  const cls = pointClasses(sketch);
  const xy = (id: Id) => idx.xy(cls(id));

  // Points: by coincident class, and when splitting also merged when they are within TOL.
  const verts: Vec2[] = [];
  const byClass = new Map<Id, number>();
  const at = (p: Vec2): number => {
    const i = split ? verts.findIndex((q) => Math.abs(q[0] - p[0]) < TOL && Math.abs(q[1] - p[1]) < TOL) : -1;
    if (i >= 0) return i;
    verts.push(p);
    return verts.length - 1;
  };
  const vtx = (id: Id): number => {
    const k = cls(id);
    if (!byClass.has(k)) byClass.set(k, at(xy(k)));
    return byClass.get(k)!;
  };

  interface Src {
    id: Id;
    geo: Geo;
    closed: boolean;
    cuts: { t: number; v: number }[];
    ends: Id[];
  }
  const srcs: Src[] = [];
  const loops: L[] = [];
  for (const e of sketch.entities) {
    if (e.kind === "point" || (e.construction && !(split && e.projectedFrom))) continue;
    if (e.kind === "line") {
      const [va, vb] = [vtx(e.a), vtx(e.b)];
      if (va !== vb)
        srcs.push({
          id: e.id,
          geo: { kind: "line", a: verts[va]!, b: verts[vb]! },
          closed: false,
          cuts: [
            { t: 0, v: va },
            { t: 1, v: vb },
          ],
          ends: [e.a, e.b],
        });
      continue;
    }
    if (e.kind === "ellipse") {
      const g = ellipseGeo(idx, e);
      srcs.push({ id: e.id, geo: { kind: "arc", c: xy(e.c), r: g.r1, s: 0, w: TAU, k: g.r2 / g.r1, rot: g.rot }, closed: true, cuts: [], ends: [] });
      continue;
    }
    const c = xy(e.c);
    const [va, vb] = e.kind === "arc" ? [vtx(e.a), vtx(e.b)] : [0, 0];
    if (e.kind === "circle" || va === vb) {
      srcs.push({ id: e.id, geo: { kind: "arc", c, r: e.r, s: 0, w: TAU }, closed: true, cuts: [], ends: [] });
      continue;
    }
    const s = angleOf(sub(verts[va]!, c));
    const w = sweep(s, angleOf(sub(verts[vb]!, c)));
    srcs.push({
      id: e.id,
      geo: { kind: "arc", c, r: e.r, s, w },
      closed: false,
      cuts: [
        { t: 0, v: va },
        { t: w, v: vb },
      ],
      ends: [e.a, e.b],
    });
  }

  if (split) {
    // Cut each curve where others cross or touch it, and where other curves end on it.
    const cut = (x: Src, v: number) => {
      const t = along(x.geo, verts[v]!, x.closed);
      if (t !== null) x.cuts.push({ t, v });
    };
    srcs.forEach((x, i) =>
      srcs.slice(i + 1).forEach((y) => {
        for (const p of meet(x.geo, y.geo)) {
          if (along(x.geo, p, x.closed) === null || along(y.geo, p, y.closed) === null) continue;
          const v = at(p);
          cut(x, v);
          cut(y, v);
        }
      }),
    );
    const ends = new Set(srcs.flatMap((x) => (x.closed ? [] : [x.cuts[0]!.v, x.cuts[1]!.v])));
    for (const x of srcs) for (const v of ends) if (!x.cuts.some((c) => c.v === v)) cut(x, v);
  }

  // The pieces between cuts; when splitting, the same piece twice (curves drawn over each other) counts once.
  const pieces: Piece[] = [];
  const seen = new Set<string>();
  const addPiece = (id: Id, from: number, to: number, geo: Geo, whole: boolean) => {
    if (split) {
      const m = geo.kind === "line" ? mid(geo.a, geo.b) : pointOn(geo, geo.s + geo.w / 2);
      const key = `${Math.min(from, to)} ${Math.max(from, to)} ${Math.round(m[0] * 1e4)} ${Math.round(m[1] * 1e4)}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    pieces.push({ id, from, to, geo, whole });
  };
  for (const x of srcs) {
    const cuts = [...x.cuts].sort((p, q) => p.t - q.t).filter((c, i, l) => i === 0 || c.v !== l[i - 1]!.v);
    const g = x.geo;
    if (x.closed) {
      if (cuts.length > 1 && cuts[cuts.length - 1]!.v === cuts[0]!.v) cuts.pop();
      if (g.kind !== "arc") continue;
      if (!cuts.length) loops.push({ ...circleLoop(x.id, g), comp: `c${x.id}` });
      cuts.forEach((c, i) => {
        const n = cuts[(i + 1) % cuts.length]!;
        addPiece(x.id, c.v, n.v, { ...g, s: c.t, w: wrap(n.t - c.t) || TAU }, false);
      });
      continue;
    }
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [c, n] = [cuts[i]!, cuts[i + 1]!];
      const whole = cuts.length === 2;
      addPiece(x.id, c.v, n.v, g.kind === "line" ? { kind: "line", a: verts[c.v]!, b: verts[n.v]! } : { ...g, s: g.s + c.t, w: n.t - c.t }, whole);
    }
  }

  // Degrees, then prune dangling chains so they do not split faces.
  const degree = new Map<number, number>();
  for (const p of pieces) for (const v of [p.from, p.to]) degree.set(v, (degree.get(v) ?? 0) + 1);
  const openEnds = new Set<Id>();
  for (const x of srcs) for (const p of x.ends) if (degree.get(vtx(p)) === 1) openEnds.add(p);
  let live = pieces;
  for (;;) {
    const next = live.filter((p) => degree.get(p.from)! > 1 && degree.get(p.to)! > 1);
    if (next.length === live.length) break;
    for (const p of live) if (!next.includes(p)) for (const v of [p.from, p.to]) degree.set(v, degree.get(v)! - 1);
    live = next;
  }

  // Which pieces join up: one outline round the outside of each joined-up set.
  const comp = new Map<number, number>();
  const root = (v: number): number => {
    while (comp.has(v) && comp.get(v) !== v) v = comp.get(v)!;
    return v;
  };
  for (const p of live) comp.set(root(p.from), root(p.to));

  // Half-edges and the faces they bound.
  const outgoing = new Map<number, Half[]>();
  for (const p of live) {
    const g = p.geo;
    const out = (rev: boolean) => (g.kind === "line" ? angleOf(rev ? sub(g.a, g.b) : sub(g.b, g.a)) : rev ? heading(g, g.s + g.w) + Math.PI : heading(g, g.s));
    const bend = (rev: boolean) => (g.kind === "line" ? 0 : rev ? -curvature(g, g.s + g.w) : curvature(g, g.s));
    const fwd: Half = { piece: p, to: p.to, reversed: false, out: out(false), bend: bend(false) };
    const back: Half = { piece: p, to: p.from, reversed: true, out: out(true), bend: bend(true), twin: fwd };
    fwd.twin = back;
    for (const [v, h] of [
      [p.from, fwd],
      [p.to, back],
    ] as const) {
      if (!outgoing.has(v)) outgoing.set(v, []);
      outgoing.get(v)!.push(h);
    }
  }
  const key = (h: Half) => {
    const a = wrap(h.out);
    return a > TAU - 1e-9 ? 0 : a;
  };
  // Pieces leaving the same way (a tangent touch) go in order of how hard they turn left.
  for (const list of outgoing.values()) list.sort((a, b) => (Math.abs(key(a) - key(b)) > 1e-7 ? key(a) - key(b) : a.bend - b.bend));
  // Arriving along h, leave by the first edge clockwise from the way back: the sharpest left turn, so bounded faces
  // come out anticlockwise.
  const next = (h: Half): Half => {
    const list = outgoing.get(h.to)!;
    const i = list.indexOf(h.twin!);
    return list[(i - 1 + list.length) % list.length]!;
  };
  const trace = (h: Half): Vec2[] => {
    const g = h.piece.geo;
    let pts: Vec2[] = [];
    if (g.kind === "line") pts = [g.a, g.b];
    else {
      const e = ell(g);
      pts = e ? sampleEllipse(e, g.s, g.s + g.w) : sampleArc(g.c, g.r, g.s, g.s + g.w);
      // Pin the ends to the points themselves so consecutive edges meet exactly.
      pts[0] = verts[h.piece.from]!;
      pts[pts.length - 1] = verts[h.piece.to]!;
    }
    return h.reversed ? pts.reverse() : pts;
  };
  const edgeOf = ({ piece: p, reversed }: Half): LoopEdge => (p.whole ? { id: p.id, reversed } : { id: p.id, reversed, span: [verts[p.from]!, verts[p.to]!] });

  const outlines: L[] = [];
  for (const list of outgoing.values())
    for (const start of list) {
      if (start.used) continue;
      const face: Half[] = [];
      let h = start;
      while (!h.used) {
        h.used = true;
        face.push(h);
        h = next(h);
      }
      const points = face.flatMap((f) => trace(f).slice(0, -1));
      const area = polygonArea(points);
      const c = `g${root(start.piece.from)}`;
      const edges = face.map(edgeOf);
      if (area > 1e-9) loops.push({ edges, points, area, inner: innerPoint(points), comp: c });
      else if (area < -1e-9) {
        // The outside of a joined-up set, turned anticlockwise: a hole in whatever region it sits in.
        const pts = [...points].reverse();
        const rev = [...edges].reverse().map((e) => ({ ...e, reversed: !e.reversed }));
        outlines.push({ edges: rev, points: pts, area: -area, inner: innerPoint(pts), comp: c });
      }
    }

  // Text outlines are loops of their own, anticlockwise like the rest.
  for (const { text, loops: outs } of textsOf(sketch)) {
    if (text.construction) continue;
    outs.forEach((pts, i) => {
      const points = polygonArea(pts) < 0 ? [...pts].reverse() : pts;
      const area = Math.abs(polygonArea(points));
      if (area > 1e-9) loops.push({ edges: [{ id: text.id, reversed: false, loop: i }], points, area, inner: innerPoint(points), comp: `t${text.id} ${i}` });
    });
  }

  // The smallest loop around a point, leaving out the loops of one joined-up set.
  const around = (o: L, skip: string) => {
    let best = -1;
    loops.forEach((l, j) => {
      if (l !== o && l.comp !== skip && l.area > o.area && insidePolygon(o.inner, l.points) && (best < 0 || l.area < loops[best]!.area)) best = j;
    });
    return best;
  };
  const strip = (l: Loop): Loop => ({ edges: l.edges, points: l.points, area: l.area });

  if (split) {
    // Loops on their own (circles, letters) are their own outline.
    for (const l of loops) if (!l.comp.startsWith("g")) outlines.push(l);
    const out = loops.map((l): Profile => ({ ...strip(l), holes: [] }));
    for (const o of outlines) out[around(o, o.comp)]?.holes.push(strip(o));
    return { profiles: out, openEnds: [...openEnds] };
  }

  // Nesting: each loop's parent is the smallest loop around it. Loops inside loops alternate.
  const parent = loops.map((l) => around(l, ""));
  const depth = (i: number): number => (parent[i]! < 0 ? 0 : 1 + depth(parent[i]!));
  const out: Profile[] = [];
  const byLoop = new Map<number, Profile>();
  loops.forEach((l, i) => {
    if (all || depth(i) % 2 === 0) {
      const p: Profile = { ...strip(l), holes: [] };
      byLoop.set(i, p);
      out.push(p);
    }
  });
  loops.forEach((l, i) => {
    if (all || depth(i) % 2 === 1) byLoop.get(parent[i]!)?.holes.push(strip(l));
  });
  return { profiles: out, openEnds: [...openEnds] };
}

function circleLoop(id: Id, g: ArcGeo): Loop & { inner: Vec2 } {
  const e = ell(g);
  const points = (e ? sampleEllipse(e) : sampleArc(g.c, g.r, 0, 2 * Math.PI, 72)).slice(0, -1);
  return { edges: [{ id, reversed: false }], points, area: Math.PI * g.r * g.r * (g.k ?? 1), inner: g.c };
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
