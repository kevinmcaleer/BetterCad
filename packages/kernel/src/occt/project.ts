import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { elements } from "./shapes";
import {
  boxOf,
  distanceTo,
  dot,
  endsOf,
  pointsOn,
  TAU,
  turn,
  viewAxes,
  type ProjectedView,
  type ProjectOptions,
  type V2,
  type V3,
  type ViewCurve,
  type ViewEdge,
  type ViewEdgeType,
  type ViewFrame,
  type ViewRound,
} from "../view";

/**
 * Flat views for drawings (#555, spike #556): bodies seen from a direction, as 2D curves split into visible and hidden
 * edges, each traced back to the model edge or face it came from.
 *
 * OpenCascade's exact hidden-line removal does the work (`HLRBRep_Algo`, read out with `HLRBRep_HLRToShape`). It hands
 * back loose edges on the view plane with no word on where they came from, so each one is traced by where it lies: a
 * point of the flat curve is a line of sight through the model, and the model edge that line touches (the nearest the
 * eye for a visible curve) is its source. Outlines of round faces are traced to the face the line of sight grazes.
 *
 * Millimetres on the view plane: x to the right, y up, the eye looking down the view's own z.
 */

export * from "../view";

/** How far a traced polyline may stray from its curve, mm. */
const CHORD = 0.01;
/** How near a line of sight must pass a model edge to count as touching it, mm. */
const NEAR = 0.05;

/** A flat edge as a line, circle, arc, ellipse or traced polyline. */
function readCurve(oc: OC, edge: TopoDS_Shape): ViewCurve | null {
  const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(edge));
  try {
    const [t0, t1] = [c.FirstParameter(), c.LastParameter()];
    if (!(Math.abs(t1 - t0) > 1e-12)) return null;
    const at = (t: number): V2 => {
      const p = c.Value(t);
      const out: V2 = [p.X(), p.Y()];
      p.delete();
      return out;
    };
    const type = c.GetType();
    const T = oc.GeomAbs_CurveType;
    if (type === T.GeomAbs_Line) {
      const [a, b] = [at(t0), at(t1)];
      return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7 ? null : { kind: "line", a, b };
    }
    if (type === T.GeomAbs_Circle || type === T.GeomAbs_Ellipse) {
      const round = type === T.GeomAbs_Circle;
      const g = round ? c.Circle() : c.Ellipse();
      const o = g.Location();
      const ax = g.XAxis().Direction();
      // A conic lying face down on the sheet runs clockwise as we see it.
      const down = g.Axis().Direction().Z() < 0;
      const centre: V2 = [o.X(), o.Y()];
      const spin = Math.atan2(ax.Y(), ax.X());
      const whole = Math.abs(t1 - t0) > TAU - 1e-9;
      const [from, to] = down ? [-t1, -t0] : [t0, t1];
      let out: ViewCurve;
      if (round) {
        const r = (g as ReturnType<typeof c.Circle>).Radius();
        out = whole ? { kind: "circle", c: centre, r } : { kind: "arc", c: centre, r, from: turn(spin + from), to: turn(spin + to) };
      } else {
        const e = g as ReturnType<typeof c.Ellipse>;
        out = { kind: "ellipse", c: centre, rx: e.MajorRadius(), ry: e.MinorRadius(), turn: turn(spin) };
        // Seen from below, the ellipse's own parameter runs the other way round, so mirror it about the long axis.
        if (!whole) Object.assign(out, { from: turn(from), to: turn(to) });
      }
      o.delete();
      ax.delete();
      g.delete();
      return out;
    }
    const sampler = new oc.GCPnts_TangentialDeflection(c, t0, t1, 0.1, CHORD, 2, 1e-9, 0);
    const pts: V2[] = [];
    for (let i = 1; i <= sampler.NbPoints(); i++) {
      const p = sampler.Value(i);
      pts.push([p.X(), p.Y()]);
      p.delete();
    }
    sampler.delete();
    if (pts.length < 2) return null;
    return straightOf(pts) ?? roundOf(pts) ?? { kind: "poly", pts };
  } finally {
    c.delete();
  }
}

/** A traced curve that is really straight (a circle seen edge on comes back as a curve), or null. */
function straightOf(pts: V2[]): ViewCurve | null {
  // Its ends are the two points furthest apart: a circle seen edge on runs out and back along its line.
  let [a, b] = [pts[0]!, pts[0]!];
  const along = (p: V2, d: V2) => p[0] * d[0] + p[1] * d[1];
  const far = pts.reduce((f, p) => (Math.hypot(p[0] - pts[0]![0], p[1] - pts[0]![1]) > Math.hypot(f[0] - pts[0]![0], f[1] - pts[0]![1]) ? p : f), pts[0]!);
  const len = Math.hypot(far[0] - pts[0]![0], far[1] - pts[0]![1]);
  if (len < 1e-7) return null;
  const d: V2 = [(far[0] - pts[0]![0]) / len, (far[1] - pts[0]![1]) / len];
  for (const p of pts) {
    if (Math.abs((p[0] - pts[0]![0]) * d[1] - (p[1] - pts[0]![1]) * d[0]) > 1e-6) return null;
    if (along(p, d) < along(a, d)) a = p;
    if (along(p, d) > along(b, d)) b = p;
  }
  return { kind: "line", a, b };
}

/** How far a traced curve may stray from a circle and still be one, mm. OpenCascade's fillet edges are splines a few microns off round. */
const ROUND = 0.005;

/** A traced curve that is really part of a circle (OpenCascade hands some round outlines back as splines), or null. */
function roundOf(pts: V2[]): ViewCurve | null {
  if (pts.length < 5) return null;
  // The circle through the first, middle and last points; a closed curve takes thirds.
  const closed = Math.hypot(pts[0]![0] - pts.at(-1)![0], pts[0]![1] - pts.at(-1)![1]) < 1e-6;
  const pick = closed ? [0, Math.floor(pts.length / 3), Math.floor((2 * pts.length) / 3)] : [0, pts.length >> 1, pts.length - 1];
  const [a, b, d] = pick.map((i) => pts[i]!) as [V2, V2, V2];
  const den = 2 * (a[0] * (b[1] - d[1]) + b[0] * (d[1] - a[1]) + d[0] * (a[1] - b[1]));
  if (Math.abs(den) < 1e-9) return null;
  const sq = (p: V2) => p[0] * p[0] + p[1] * p[1];
  const c: V2 = [
    (sq(a) * (b[1] - d[1]) + sq(b) * (d[1] - a[1]) + sq(d) * (a[1] - b[1])) / den,
    (sq(a) * (d[0] - b[0]) + sq(b) * (a[0] - d[0]) + sq(d) * (b[0] - a[0])) / den,
  ];
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  if (r > 1e5 || pts.some((p) => Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - r) > ROUND)) return null;
  if (closed) return { kind: "circle", c, r };
  const ang = (p: V2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const [s, m, e] = [ang(a), ang(b), ang(d)];
  // A short, nearly straight piece fits a huge circle just as well: only a real bend counts.
  if (Math.min(turn(e - s), turn(s - e)) < 0.2) return null;
  // Anticlockwise from start to end if the middle lies on the way.
  return turn(m - s) < turn(e - s) ? { kind: "arc", c, r, from: turn(s), to: turn(e) } : { kind: "arc", c, r, from: turn(e), to: turn(s) };
}

const r4 = (n: number) => (Math.round(n * 1e4) / 1e4 || 0).toFixed(4);

/**
 * Joins the pieces OpenCascade cuts a curve into (it splits an edge wherever another crosses it in the view), so a
 * hole is one circle again and a long edge one line. Only pieces of the same model edge, kind and visibility join.
 */
function joined(edges: ViewEdge[]): ViewEdge[] {
  const groups = new Map<string, ViewEdge[]>();
  const out: ViewEdge[] = [];
  for (const e of edges) {
    const c = e.curve;
    let geo: string;
    if (c.kind === "line") {
      // The line it lies on: its direction (pointing right, or up) and how far it passes from the origin.
      let d: V2 = [c.b[0] - c.a[0], c.b[1] - c.a[1]];
      const l = Math.hypot(...d);
      d = [d[0] / l, d[1] / l];
      if (d[0] < -1e-9 || (Math.abs(d[0]) <= 1e-9 && d[1] < 0)) d = [-d[0], -d[1]];
      geo = `l ${r4(d[0])} ${r4(d[1])} ${r4(c.a[0] * d[1] - c.a[1] * d[0])}`;
    } else if (c.kind === "arc") geo = `c ${r4(c.c[0])} ${r4(c.c[1])} ${r4(c.r)}`;
    else if (c.kind === "ellipse" && c.from !== undefined) geo = `e ${r4(c.c[0])} ${r4(c.c[1])} ${r4(c.rx)} ${r4(c.ry)} ${r4(c.turn)}`;
    else {
      out.push(e);
      continue;
    }
    const key = `${e.visible} ${e.type} ${JSON.stringify(e.from ?? null)} ${geo}`;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }
  for (const g of groups.values()) {
    const first = g[0]!;
    if (first.curve.kind === "line") {
      const { a, b } = first.curve;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const d: V2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      const t = (p: V2) => (p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1];
      const spans = g
        .map((e) => [t((e.curve as { a: V2 }).a), t((e.curve as { b: V2 }).b)].sort((x, y) => x - y) as [number, number])
        .sort((x, y) => x[0] - y[0]);
      const runs: [number, number][] = [];
      for (const s of spans) {
        const last = runs.at(-1);
        if (last && s[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], s[1]);
        else runs.push([...s]);
      }
      const at = (u: number): V2 => [a[0] + d[0] * u, a[1] + d[1] * u];
      for (const [u, v] of runs) out.push({ ...first, curve: { kind: "line", a: at(u), b: at(v) } });
      continue;
    }
    // Round pieces: spans of angle, joined where one ends as the next begins, and closed up if they go all the way round.
    const spans = g.map((e) => {
      const c = e.curve as { from: number; to: number };
      return [c.from, c.from + (turn(c.to - c.from) || TAU)] as [number, number];
    });
    spans.sort((x, y) => x[0] - y[0]);
    const runs: [number, number][] = [];
    for (const s of spans) {
      const last = runs.at(-1);
      if (last && s[0] <= last[1] + 1e-7) last[1] = Math.max(last[1], s[1]);
      else runs.push([...s]);
    }
    if (runs.length > 1 && runs.at(-1)![1] >= runs[0]![0] + TAU - 1e-7) {
      const tail = runs.pop()!;
      runs[0] = [tail[0] - TAU, runs[0]![1]];
    }
    for (const [u, v] of runs) {
      const c = first.curve;
      const whole = v - u >= TAU - 1e-7;
      if (c.kind === "arc") out.push({ ...first, curve: whole ? { kind: "circle", c: c.c, r: c.r } : { ...c, from: turn(u), to: turn(v) } });
      else if (c.kind === "ellipse")
        out.push({ ...first, curve: whole ? { kind: "ellipse", c: c.c, rx: c.rx, ry: c.ry, turn: c.turn } : { ...c, from: turn(u), to: turn(v) } });
    }
  }
  return out;
}

/** How near two curves must lie to count as one on top of the other, mm. */
const SAME = 1e-3;
/** Where along a curve to look when asking whether others cover it. Uneven, so curves that only cross it don't line up with them. */
const COVER = [0.03, 0.11, 0.23, 0.37, 0.5, 0.61, 0.77, 0.89, 0.97];

/**
 * Drops curves that lie wholly on others: a hidden edge straight behind a visible one, or the far rim of a hole seen
 * end on. Visible beats hidden, then a sharp edge beats an outline beats a tangent edge, then the longer curve wins.
 */
function uncovered(edges: ViewEdge[]): ViewEdge[] {
  const rank = (e: ViewEdge) => (e.visible ? 0 : 3) + (e.type === "sharp" ? 0 : e.type === "outline" ? 1 : 2);
  const size = (b: { min: V2; max: V2 }) => b.max[0] - b.min[0] + b.max[1] - b.min[1];
  const items = edges.map((e) => ({ e, box: boxOf(e.curve), pts: [...pointsOn(e.curve, COVER), ...endsOf(e.curve)] }));
  items.sort((p, q) => rank(p.e) - rank(q.e) || size(q.box) - size(p.box));
  const kept: typeof items = [];
  for (const it of items) {
    // It may take several to cover it: a long hidden edge behind two visible ones that meet end to end.
    const near = kept.filter(
      (k) =>
        it.box.min[0] <= k.box.max[0] + SAME &&
        it.box.max[0] >= k.box.min[0] - SAME &&
        it.box.min[1] <= k.box.max[1] + SAME &&
        it.box.max[1] >= k.box.min[1] - SAME,
    );
    const under = it.pts.every((p) => near.some((k) => distanceTo(k.e.curve, p) < SAME));
    if (!under) kept.push(it);
  }
  return kept.map((k) => k.e);
}

/** The model's edges, traced and laid on the view plane with their depth, in a grid for finding what a point lies on. */
class Tracer {
  private cell: number;
  private grid = new Map<string, number[]>();
  /** Segments: x0, y0, depth0, x1, y1, depth1, then the body and edge. */
  private seg: number[] = [];
  /**
   * Round faces: each one's box on the view plane and its depths, and for a cylinder or ball where its outline must
   * lie (`limb`: a point on the view plane, the outline's direction or null for a ball, and how far out it is).
   */
  private faces: {
    body: number;
    face: number;
    shape: TopoDS_Shape;
    min: V2;
    max: V2;
    depth: [number, number];
    limb?: { at: V2; along: V2 | null; r: number };
  }[] = [];
  /** Seams, where a round face meets itself, and the face each is on. Not edges anyone drew. */
  private seams = new Map<string, number>();
  rounds: ViewRound[] = [];

  constructor(
    private oc: OC,
    shapes: TopoDS_Shape[],
    private ax: { x: V3; y: V3; z: V3 },
    size: number,
  ) {
    this.cell = Math.max(0.5, size / 64);
    shapes.forEach((shape, body) => {
      elements(oc, shape, "edge").forEach((e, edge) => {
        const ed = oc.TopoDS.Edge(e);
        if (oc.BRep_Tool.Degenerated(ed)) return;
        const c = new oc.BRepAdaptor_Curve(ed);
        const sampler = new oc.GCPnts_TangentialDeflection(c, c.FirstParameter(), c.LastParameter(), 0.1, CHORD, 2, 1e-9, 0);
        let last: V3 | null = null;
        for (let i = 1; i <= sampler.NbPoints(); i++) {
          const p = sampler.Value(i);
          const w: V3 = [p.X(), p.Y(), p.Z()];
          p.delete();
          const v: V3 = [dot(w, ax.x), dot(w, ax.y), dot(w, ax.z)];
          if (last) this.add(last, v, body, edge);
          last = v;
        }
        sampler.delete();
        c.delete();
      });
      const edgeList = elements(oc, shape, "edge");
      elements(oc, shape, "face").forEach((f, face) => {
        const ex = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        for (; ex.More(); ex.Next()) {
          const e = ex.Current();
          if (!oc.BRep_Tool.IsClosed(oc.TopoDS.Edge(e), oc.TopoDS.Face(f))) continue;
          const i = edgeList.findIndex((x) => x.IsSame(e));
          if (i >= 0) this.seams.set(`${body}/${i}`, face);
        }
        ex.delete();
        const s = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true);
        const type = s.GetType();
        const S = oc.GeomAbs_SurfaceType;
        if (type === S.GeomAbs_Plane) {
          s.delete();
          return;
        }
        let limb: { at: V2; along: V2 | null; r: number } | undefined;
        let endOn = false;
        if (type === S.GeomAbs_Cylinder) {
          const cyl = s.Cylinder();
          const [o, d] = [cyl.Location(), cyl.Axis().Direction()];
          const dir: V3 = [d.X(), d.Y(), d.Z()];
          const along: V2 = [dot(dir, ax.x), dot(dir, ax.y)];
          const l = Math.hypot(...along);
          const centre: V3 = [o.X(), o.Y(), o.Z()];
          const flat = (w: V3): V2 => [dot(w, ax.x), dot(w, ax.y)];
          const round = {
            body,
            face,
            r: cyl.Radius(),
            hole: f.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED,
            sweep: Math.min(TAU, s.LastUParameter() - s.FirstUParameter()),
          };
          if (l < 1e-6) this.rounds.push({ ...round, seen: "end", c: flat(centre) });
          else if (Math.abs(dot(dir, ax.z)) < 1e-6) {
            const end = (v: number): V3 => [centre[0] + dir[0] * v, centre[1] + dir[1] * v, centre[2] + dir[2] * v];
            this.rounds.push({ ...round, seen: "side", a: flat(end(s.FirstVParameter())), b: flat(end(s.LastVParameter())) });
          }
          // Seen end on a cylinder has no outline: its rims are all there is.
          if (l < 1e-6) endOn = true;
          else
            limb = {
              at: [o.X() * ax.x[0] + o.Y() * ax.x[1] + o.Z() * ax.x[2], o.X() * ax.y[0] + o.Y() * ax.y[1] + o.Z() * ax.y[2]],
              along: [along[0] / l, along[1] / l],
              r: cyl.Radius(),
            };
          o.delete();
          d.delete();
          cyl.delete();
        } else if (type === S.GeomAbs_Sphere) {
          const ball = s.Sphere();
          const o = ball.Location();
          limb = {
            at: [o.X() * ax.x[0] + o.Y() * ax.x[1] + o.Z() * ax.x[2], o.X() * ax.y[0] + o.Y() * ax.y[1] + o.Z() * ax.y[2]],
            along: null,
            r: ball.Radius(),
          };
          o.delete();
          ball.delete();
        }
        s.delete();
        if (endOn) return;
        const box = new oc.Bnd_Box();
        oc.BRepBndLib.Add(f, box, false);
        const [lo, hi] = [box.CornerMin(), box.CornerMax()];
        const min: V2 = [Infinity, Infinity];
        const max: V2 = [-Infinity, -Infinity];
        const depth: [number, number] = [Infinity, -Infinity];
        for (let k = 0; k < 8; k++) {
          const w: V3 = [k & 1 ? hi.X() : lo.X(), k & 2 ? hi.Y() : lo.Y(), k & 4 ? hi.Z() : lo.Z()];
          const [x, y] = [dot(w, ax.x), dot(w, ax.y)];
          depth[0] = Math.min(depth[0], dot(w, ax.z));
          depth[1] = Math.max(depth[1], dot(w, ax.z));
          min[0] = Math.min(min[0], x);
          min[1] = Math.min(min[1], y);
          max[0] = Math.max(max[0], x);
          max[1] = Math.max(max[1], y);
        }
        lo.delete();
        hi.delete();
        box.delete();
        this.faces.push({ body, face, shape: f, min, max, depth, limb });
      });
    });
  }

  private add(a: V3, b: V3, body: number, edge: number) {
    const at = this.seg.length / 8;
    this.seg.push(a[0], a[1], a[2], b[0], b[1], b[2], body, edge);
    const c = this.cell;
    const [x0, x1] = [Math.floor((Math.min(a[0], b[0]) - NEAR) / c), Math.floor((Math.max(a[0], b[0]) + NEAR) / c)];
    const [y0, y1] = [Math.floor((Math.min(a[1], b[1]) - NEAR) / c), Math.floor((Math.max(a[1], b[1]) + NEAR) / c)];
    // A long edge covers many cells; only those its box touches, and never more than a strip of the grid.
    for (let i = x0; i <= x1; i++)
      for (let j = y0; j <= y1; j++) {
        const k = `${i},${j}`;
        const g = this.grid.get(k);
        if (g) g.push(at);
        else this.grid.set(k, [at]);
      }
  }

  /** The model edges a line of sight through `p` touches, with how near the eye each is there. */
  private touching(p: V2): Map<string, { body: number; edge: number; depth: number }> {
    const out = new Map<string, { body: number; edge: number; depth: number }>();
    const s = this.seg;
    for (const at of this.grid.get(`${Math.floor(p[0] / this.cell)},${Math.floor(p[1] / this.cell)}`) ?? []) {
      const i = at * 8;
      const [dx, dy] = [s[i + 3]! - s[i]!, s[i + 4]! - s[i + 1]!];
      const len2 = dx * dx + dy * dy;
      // An edge seen end on is a dot, not a line: it lies under corners, never along a curve.
      if (len2 < 1e-10) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - s[i]!) * dx + (p[1] - s[i + 1]!) * dy) / len2));
      if (Math.hypot(s[i]! + dx * t - p[0], s[i + 1]! + dy * t - p[1]) > NEAR) continue;
      const depth = s[i + 2]! + (s[i + 5]! - s[i + 2]!) * t;
      const key = `${s[i + 6]}/${s[i + 7]}`;
      const had = out.get(key);
      if (!had || depth > had.depth) out.set(key, { body: s[i + 6]!, edge: s[i + 7]!, depth });
    }
    return out;
  }

  /**
   * The model edge a flat curve came from: the one every sampled line of sight touches, nearest the eye. `not` rules
   * edges out: a hidden curve is not the edge that shows in front of it.
   */
  edge(curve: ViewCurve, not?: (body: number, edge: number) => boolean): ViewEdge["from"] {
    const [first, ...rest] = pointsOn(curve).map((p) => this.touching(p));
    let best: { body: number; edge: number; depth: number } | undefined;
    for (const [key, hit] of first!) {
      if (!rest.every((m) => m.has(key)) || not?.(hit.body, hit.edge)) continue;
      if (!best || hit.depth > best.depth + 1e-6) best = hit;
    }
    return best && { body: best.body, edge: best.edge };
  }

  /** The face a traced edge is the seam of, if it is one. */
  seamOf(from: ViewEdge["from"]): number | undefined {
    return from?.edge === undefined ? undefined : this.seams.get(`${from.body}/${from.edge}`);
  }

  /** The round face whose limb a flat curve is: the one the line of sight through the curve's middle grazes. */
  face(curve: ViewCurve): ViewEdge["from"] {
    const oc = this.oc;
    const [p] = pointsOn(curve) as [V2];
    const { x, y, z } = this.ax;
    const at = (d: number) => new oc.gp_Pnt(p[0] * x[0] + p[1] * y[0] + d * z[0], p[0] * x[1] + p[1] * y[1] + d * z[1], p[0] * x[2] + p[1] * y[2] + d * z[2]);
    let best: { body: number; face: number; depth: number } | undefined;
    for (const f of this.faces) {
      if (p[0] < f.min[0] - NEAR || p[0] > f.max[0] + NEAR || p[1] < f.min[1] - NEAR || p[1] > f.max[1] + NEAR) continue;
      if (f.limb) {
        // A cylinder's outline runs along its axis one radius out, and a ball's is a circle of its radius: sums, no search.
        const [dx, dy] = [p[0] - f.limb.at[0], p[1] - f.limb.at[1]];
        const out = f.limb.along ? Math.abs(dx * f.limb.along[1] - dy * f.limb.along[0]) : Math.hypot(dx, dy);
        if (Math.abs(out - f.limb.r) > NEAR) continue;
      }
      // The line of sight, only as long as the face is deep: the exact distance is slow on a long line.
      const [a, b] = [at(f.depth[0] - 1), at(f.depth[1] + 1)];
      const mk = new oc.BRepBuilderAPI_MakeEdge(a, b);
      const d = new oc.BRepExtrema_DistShapeShape(mk.Edge(), f.shape);
      if (d.IsDone() && d.Value() < NEAR) {
        const q = d.PointOnShape2(1);
        const depth = q.X() * z[0] + q.Y() * z[1] + q.Z() * z[2];
        q.delete();
        if (!best || depth > best.depth) best = { body: f.body, face: f.face, depth };
      }
      d.delete();
      mk.delete();
      a.delete();
      b.delete();
    }
    return best && { body: best.body, face: best.face };
  }
}

/**
 * Bodies seen from a direction, as flat curves. Give the shapes as they stand in the world (posed, if the model is).
 * Curves that fall on top of each other are given once, a visible one winning over a hidden one.
 */
export function projectView(oc: OC, shapes: TopoDS_Shape[], frame: ViewFrame, opts: ProjectOptions = {}): ProjectedView {
  const { hidden = true, smooth = true, trace = true } = opts;
  const ax = viewAxes(frame);
  const t0 = performance.now();

  const origin = new oc.gp_Pnt(0, 0, 0);
  const n = new oc.gp_Dir(...ax.z);
  const vx = new oc.gp_Dir(...ax.x);
  const cs = new oc.gp_Ax2(origin, n, vx);
  const projector = new oc.HLRAlgo_Projector(cs);
  const algo = new oc.HLRBRep_Algo();
  for (const s of shapes) algo.Add(s, 0);
  algo.Projector(projector);
  algo.Update();
  algo.Hide();
  const t1 = performance.now();

  const to = new oc.HLRBRep_HLRToShape(algo);
  const groups: [TopoDS_Shape, boolean, ViewEdgeType][] = [
    [to.VCompound(), true, "sharp"],
    [to.OutLineVCompound(), true, "outline"],
  ];
  if (smooth) groups.push([to.Rg1LineVCompound(), true, "smooth"]);
  if (hidden) {
    groups.push([to.HCompound(), false, "sharp"], [to.OutLineHCompound(), false, "outline"]);
    if (smooth) groups.push([to.Rg1LineHCompound(), false, "smooth"]);
  }
  let edges: ViewEdge[] = [];
  let rounds: ViewRound[] = [];
  for (const [compound, visible, type] of groups) {
    // Nothing of a kind comes back as a null shape.
    if (compound.IsNull()) continue;
    oc.BRepLib.BuildCurves3d(compound);
    const ex = new oc.TopExp_Explorer(compound, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const curve = readCurve(oc, ex.Current());
      if (curve) edges.push({ curve, visible, type });
    }
    ex.delete();
  }
  const t2 = performance.now();

  if (trace && edges.length) {
    const all = edges.map((e) => boxOf(e.curve));
    const size = Math.max(...all.map((b) => b.max[0]), ...all.map((b) => b.max[1])) - Math.min(...all.map((b) => b.min[0]), ...all.map((b) => b.min[1]));
    const tracer = new Tracer(oc, shapes, ax, size);
    rounds = tracer.rounds;
    // Visible curves first: a hidden curve straight behind one came from a different edge.
    const shown = edges.filter((e) => e.visible && e.type !== "outline");
    for (const e of shown) e.from = tracer.edge(e.curve);
    for (const e of edges) {
      if (e.type === "outline") e.from = tracer.face(e.curve);
      else if (!e.visible) {
        const [mid] = pointsOn(e.curve) as [V2];
        const inFront = shown.filter((v) => v.from && distanceTo(v.curve, mid) < SAME).map((v) => `${v.from!.body}/${v.from!.edge}`);
        e.from = tracer.edge(e.curve, (body, edge) => inFront.includes(`${body}/${edge}`));
      }
    }
    // OpenCascade gives a round face's seam in place of its outline when the two fall together: it is the outline.
    for (const e of edges) {
      const face = tracer.seamOf(e.from);
      if (face !== undefined) Object.assign(e, { type: "outline", from: { body: e.from!.body, face } });
    }
  }
  edges = uncovered(joined(edges));
  const box = { min: [Infinity, Infinity] as V2, max: [-Infinity, -Infinity] as V2 };
  for (const e of edges) {
    const b =
      e.curve.kind === "arc" || (e.curve.kind === "ellipse" && e.curve.from !== undefined) ? boxOf({ kind: "poly", pts: pointsOn(e.curve) }) : boxOf(e.curve);
    box.min = [Math.min(box.min[0], b.min[0]), Math.min(box.min[1], b.min[1])];
    box.max = [Math.max(box.max[0], b.max[0]), Math.max(box.max[1], b.max[1])];
  }
  const t3 = performance.now();

  for (const d of [to, algo, projector, cs, vx, n, origin]) d.delete();
  return { edges, box, rounds, ms: { hide: t1 - t0, read: t2 - t1, trace: t3 - t2 } };
}
