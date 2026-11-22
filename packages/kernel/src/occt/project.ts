import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { elements } from "./shapes";

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
export type V2 = [number, number];
export type V3 = [number, number, number];

/** Where the eye is and which way is up on the sheet. */
export interface ViewFrame {
  /** From the model towards the eye. Front is [0, -1, 0]: Z is up, so the front of a model faces -Y. */
  toEye: V3;
  /** What points up the sheet. */
  up: V3;
}

/** The six standard views and an isometric, for a model with Z up and its front facing -Y. */
export const VIEWS = {
  front: { toEye: [0, -1, 0], up: [0, 0, 1] },
  back: { toEye: [0, 1, 0], up: [0, 0, 1] },
  left: { toEye: [-1, 0, 0], up: [0, 0, 1] },
  right: { toEye: [1, 0, 0], up: [0, 0, 1] },
  top: { toEye: [0, 0, 1], up: [0, 1, 0] },
  bottom: { toEye: [0, 0, -1], up: [0, -1, 0] },
  iso: { toEye: [1, -1, 1], up: [0, 0, 1] },
} as const satisfies Record<string, ViewFrame>;

/** A flat curve. Angles are in radians, anticlockwise from +x; an arc runs anticlockwise from `from` to `to`. */
export type ViewCurve =
  | { kind: "line"; a: V2; b: V2 }
  | { kind: "circle"; c: V2; r: number }
  | { kind: "arc"; c: V2; r: number; from: number; to: number }
  /** `turn` is the angle of the long axis; `from` and `to` are the ellipse's own parameter, missing for a whole one. */
  | { kind: "ellipse"; c: V2; rx: number; ry: number; turn: number; from?: number; to?: number }
  /** Anything else (a spline, the outline of a torus), traced finely. */
  | { kind: "poly"; pts: V2[] };

/** `sharp`: a corner between two faces. `smooth`: a tangent edge, where a fillet meets a flat. `outline`: the limb of a round face. */
export type ViewEdgeType = "sharp" | "smooth" | "outline";

export interface ViewEdge {
  curve: ViewCurve;
  visible: boolean;
  type: ViewEdgeType;
  /** Which of the shapes given it came from, and its edge (or, for an outline, its face) in `elements` order. */
  from?: { body: number; edge?: number; face?: number };
}

export interface ProjectOptions {
  /** Work out hidden edges too. On by default. */
  hidden?: boolean;
  /** Keep tangent edges. On by default. */
  smooth?: boolean;
  /** Trace each curve back to the model. On by default; off is quicker, for a preview. */
  trace?: boolean;
}

export interface ProjectedView {
  edges: ViewEdge[];
  /** The view's box on the view plane. */
  box: { min: V2; max: V2 };
  /** Time spent, in ms: OpenCascade's hidden-line pass, reading the curves out, and tracing them back. */
  ms: { hide: number; read: number; trace: number };
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  // Adding 0 turns -0 into 0.
  return [a[0] / l + 0, a[1] / l + 0, a[2] / l + 0];
};
const TAU = Math.PI * 2;
const turn = (a: number) => ((a % TAU) + TAU) % TAU;

/** The view's axes in the world: x to the right on the sheet, y up it, z towards the eye. */
export function viewAxes(frame: ViewFrame): { x: V3; y: V3; z: V3 } {
  const z = unit(frame.toEye);
  const x = unit(cross(frame.up, z));
  return { x, y: unit(cross(z, x)), z };
}

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

/** Points along a curve at fractions of its length (near enough), for tracing and tests: by default its middle and near its quarters. */
export function pointsOn(curve: ViewCurve, fr: number[] = [0.5, 0.23, 0.77]): V2[] {
  switch (curve.kind) {
    case "line":
      return fr.map((f) => [curve.a[0] + (curve.b[0] - curve.a[0]) * f, curve.a[1] + (curve.b[1] - curve.a[1]) * f]);
    case "circle":
      return fr.map((f) => [curve.c[0] + curve.r * Math.cos(f * TAU), curve.c[1] + curve.r * Math.sin(f * TAU)]);
    case "arc": {
      const sweep = turn(curve.to - curve.from) || TAU;
      return fr.map((f) => [curve.c[0] + curve.r * Math.cos(curve.from + sweep * f), curve.c[1] + curve.r * Math.sin(curve.from + sweep * f)]);
    }
    case "ellipse": {
      const from = curve.from ?? 0;
      const sweep = curve.from === undefined ? TAU : turn(curve.to! - curve.from) || TAU;
      const [cs, sn] = [Math.cos(curve.turn), Math.sin(curve.turn)];
      return fr.map((f) => {
        const [u, v] = [curve.rx * Math.cos(from + sweep * f), curve.ry * Math.sin(from + sweep * f)];
        return [curve.c[0] + u * cs - v * sn, curve.c[1] + u * sn + v * cs];
      });
    }
    case "poly":
      return fr.map((f) => curve.pts[Math.min(curve.pts.length - 1, Math.round((curve.pts.length - 1) * f))]!);
  }
}

/** A point's place round an ellipse or circle, as the curve's own parameter. */
function paramAt(curve: Extract<ViewCurve, { kind: "circle" | "arc" | "ellipse" }>, p: V2): number {
  if (curve.kind !== "ellipse") return turn(Math.atan2(p[1] - curve.c[1], p[0] - curve.c[0]));
  const [cs, sn] = [Math.cos(curve.turn), Math.sin(curve.turn)];
  const [dx, dy] = [p[0] - curve.c[0], p[1] - curve.c[1]];
  return turn(Math.atan2((-dx * sn + dy * cs) / curve.ry, (dx * cs + dy * sn) / curve.rx));
}

/** How far a point is from a curve, mm. Near enough for telling whether it lies on it. */
export function distanceTo(curve: ViewCurve, p: V2): number {
  const toSeg = (a: V2, b: V2) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
  };
  switch (curve.kind) {
    case "line":
      return toSeg(curve.a, curve.b);
    case "poly": {
      let best = Infinity;
      for (let i = 1; i < curve.pts.length; i++) best = Math.min(best, toSeg(curve.pts[i - 1]!, curve.pts[i]!));
      return best;
    }
    case "circle":
      return Math.abs(Math.hypot(p[0] - curve.c[0], p[1] - curve.c[1]) - curve.r);
    default: {
      const t = paramAt(curve, p);
      const whole = curve.from === undefined;
      const sweep = whole ? TAU : turn(curve.to! - curve.from!) || TAU;
      const inside = whole || turn(t - curve.from!) <= sweep + 1e-9;
      const on = (u: number): V2 => {
        if (curve.kind === "arc") return [curve.c[0] + curve.r * Math.cos(u), curve.c[1] + curve.r * Math.sin(u)];
        const [cs, sn] = [Math.cos(curve.turn), Math.sin(curve.turn)];
        const [x, y] = [curve.rx * Math.cos(u), curve.ry * Math.sin(u)];
        return [curve.c[0] + x * cs - y * sn, curve.c[1] + x * sn + y * cs];
      };
      const d = (q: V2) => Math.hypot(q[0] - p[0], q[1] - p[1]);
      return inside ? d(on(t)) : Math.min(d(on(curve.from!)), d(on(curve.to!)));
    }
  }
}

/** The ends of an open curve. */
function endsOf(curve: ViewCurve): V2[] {
  if (curve.kind === "line") return [curve.a, curve.b];
  if (curve.kind === "poly") return [curve.pts[0]!, curve.pts.at(-1)!];
  return [];
}

/** A curve's box, a little generous for round ones. */
function boxOf(curve: ViewCurve): { min: V2; max: V2 } {
  const pts: V2[] =
    curve.kind === "line"
      ? [curve.a, curve.b]
      : curve.kind === "poly"
        ? curve.pts
        : ((r) => [[curve.c[0] - r, curve.c[1] - r] as V2, [curve.c[0] + r, curve.c[1] + r] as V2])(curve.kind === "ellipse" ? curve.rx : curve.r);
  const out = { min: [Infinity, Infinity] as V2, max: [-Infinity, -Infinity] as V2 };
  for (const p of pts) {
    out.min = [Math.min(out.min[0], p[0]), Math.min(out.min[1], p[1])];
    out.max = [Math.max(out.max[0], p[0]), Math.max(out.max[1], p[1])];
  }
  return out;
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
  private faces: { body: number; face: number; shape: TopoDS_Shape; min: V2; max: V2 }[] = [];
  /** Seams, where a round face meets itself, and the face each is on. Not edges anyone drew. */
  private seams = new Map<string, number>();

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
        const flat = s.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane;
        s.delete();
        if (flat) return;
        const box = new oc.Bnd_Box();
        oc.BRepBndLib.Add(f, box, false);
        const [lo, hi] = [box.CornerMin(), box.CornerMax()];
        const min: V2 = [Infinity, Infinity];
        const max: V2 = [-Infinity, -Infinity];
        for (let k = 0; k < 8; k++) {
          const w: V3 = [k & 1 ? hi.X() : lo.X(), k & 2 ? hi.Y() : lo.Y(), k & 4 ? hi.Z() : lo.Z()];
          const [x, y] = [dot(w, ax.x), dot(w, ax.y)];
          min[0] = Math.min(min[0], x);
          min[1] = Math.min(min[1], y);
          max[0] = Math.max(max[0], x);
          max[1] = Math.max(max[1], y);
        }
        lo.delete();
        hi.delete();
        box.delete();
        this.faces.push({ body, face, shape: f, min, max });
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
    const [a, b] = [at(-1e5), at(1e5)];
    const mk = new oc.BRepBuilderAPI_MakeEdge(a, b);
    const ray = mk.Edge();
    let best: { body: number; face: number; depth: number } | undefined;
    for (const f of this.faces) {
      if (p[0] < f.min[0] - NEAR || p[0] > f.max[0] + NEAR || p[1] < f.min[1] - NEAR || p[1] > f.max[1] + NEAR) continue;
      const d = new oc.BRepExtrema_DistShapeShape(ray, f.shape);
      if (d.IsDone() && d.Value() < NEAR) {
        const q = d.PointOnShape2(1);
        const depth = q.X() * z[0] + q.Y() * z[1] + q.Z() * z[2];
        q.delete();
        if (!best || depth > best.depth) best = { body: f.body, face: f.face, depth };
      }
      d.delete();
    }
    mk.delete();
    a.delete();
    b.delete();
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
  return { edges, box, ms: { hide: t1 - t0, read: t2 - t1, trace: t3 - t2 } };
}
