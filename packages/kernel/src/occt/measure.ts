import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { KernelError } from "../errors";
import { elements, measure } from "./shapes";

/**
 * The Measure tool's numbers (#71), from the exact B-rep: one pick gives what it is (a point, an edge's length and
 * radius, a face's area, a body's volume); two picks give the gap between them and, where it means something, the angle.
 */
export type V3 = [number, number, number];
export interface TopoRef {
  body: string;
  kind: "body" | "face" | "edge" | "vertex";
  index: number;
}

export type Single =
  | { kind: "vertex"; point: V3 }
  | { kind: "edge"; length: number; circle?: { radius: number; centre: V3; axis?: V3 }; ends: [V3, V3]; line?: V3 }
  | { kind: "face"; area: number; perimeter: number; normal?: V3; centre: V3; circle?: { radius: number; centre: V3; axis: V3 } }
  | { kind: "body"; volume: number; area: number; bbox: { min: V3; max: V3 } };

export interface Pair {
  /** The shortest distance between the two picks, and where it runs. */
  distance: number;
  from: V3;
  to: V3;
  delta: V3;
  /** Between two circular edges (or round faces): centre to centre. */
  centres?: number;
  /** Between two flat faces or two straight edges, degrees from 0 to 90 (lines) or 0 to 180 (faces). */
  angle?: number;
}

export interface MeasureResult {
  items: Single[];
  pair?: Pair;
}

const pnt = (p: { X(): number; Y(): number; Z(): number }): V3 => [p.X(), p.Y(), p.Z()];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const deg = (r: number) => (r * 180) / Math.PI;

export function subShape(oc: OC, shape: TopoDS_Shape, ref: TopoRef): TopoDS_Shape {
  if (ref.kind === "body") return shape;
  const s = elements(oc, shape, ref.kind)[ref.index];
  if (!s) throw new KernelError("reference-missing", "What you picked is not there any more. Pick it again.");
  return s;
}

export function describe(oc: OC, shape: TopoDS_Shape, ref: TopoRef): Single {
  const s = subShape(oc, shape, ref);
  if (ref.kind === "vertex") return { kind: "vertex", point: pnt(oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(s))) };
  if (ref.kind === "edge") {
    const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(s));
    const props = new oc.GProp_GProps();
    oc.BRepGProp.LinearProperties(s, props, false, false);
    const ends: [V3, V3] = [pnt(c.EvalD0(c.FirstParameter())), pnt(c.EvalD0(c.LastParameter()))];
    const out: Single = { kind: "edge", length: props.Mass(), ends };
    const type = c.GetType();
    if (type === oc.GeomAbs_CurveType.GeomAbs_Circle) {
      const circ = c.Circle();
      out.circle = { radius: circ.Radius(), centre: pnt(circ.Location()), axis: pnt(circ.Axis().Direction()) };
    } else if (type === oc.GeomAbs_CurveType.GeomAbs_Line) {
      const d = sub(ends[1], ends[0]);
      const l = len(d);
      if (l > 1e-12) out.line = [d[0] / l, d[1] / l, d[2] / l];
    }
    props.delete();
    return out;
  }
  if (ref.kind === "face") {
    const face = oc.TopoDS.Face(s);
    const area = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(s, area, false, false);
    const edges = new oc.GProp_GProps();
    oc.BRepGProp.LinearProperties(s, edges, false, false);
    const out: Single = { kind: "face", area: area.Mass(), perimeter: edges.Mass(), centre: pnt(area.CentreOfMass()) };
    const surf = new oc.BRepAdaptor_Surface(face, true);
    const flip = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
    const type = surf.GetType();
    if (type === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
      const d = surf.Plane().Axis().Direction();
      out.normal = [d.X() * flip, d.Y() * flip, d.Z() * flip];
    } else if (type === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      const cyl = surf.Cylinder();
      const ax = cyl.Axis();
      out.circle = { radius: cyl.Radius(), centre: pnt(ax.Location()), axis: pnt(ax.Direction()) };
    }
    area.delete();
    edges.delete();
    return out;
  }
  const m = measure(oc, shape);
  return { kind: "body", volume: m.volume, area: m.area, bbox: m.bbox };
}

export function between(oc: OC, a: TopoDS_Shape, b: TopoDS_Shape, da: Single, db: Single): Pair {
  const ext = new oc.BRepExtrema_DistShapeShape(a, b);
  if (!ext.IsDone() || ext.NbSolution() < 1) throw new KernelError("failed", "The distance between those could not be worked out.");
  const from = pnt(ext.PointOnShape1(1));
  const to = pnt(ext.PointOnShape2(1));
  const out: Pair = { distance: ext.Value(), from, to, delta: sub(to, from) };
  ext.delete();
  const centre = (d: Single) => (d.kind === "edge" || d.kind === "face" ? d.circle?.centre : undefined);
  const ca = centre(da);
  const cb = centre(db);
  if (ca && cb) out.centres = len(sub(cb, ca));
  if (da.kind === "face" && db.kind === "face" && da.normal && db.normal) {
    out.angle = deg(Math.acos(Math.max(-1, Math.min(1, dot(da.normal, db.normal)))));
  } else if (da.kind === "edge" && db.kind === "edge" && da.line && db.line) {
    out.angle = deg(Math.acos(Math.min(1, Math.abs(dot(da.line, db.line)))));
  }
  return out;
}
