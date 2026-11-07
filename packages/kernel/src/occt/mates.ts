import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { elements } from "./shapes";

/**
 * Mating faces (#184): where two printed bodies meet closely enough that the gap decides whether they fit. Two kinds:
 * a pin in a hole (coaxial cylinders, one round the other) and two flat faces facing each other a short way apart.
 */
type V3 = [number, number, number];
export interface Box {
  min: V3;
  max: V3;
}

export interface Mate {
  kind: "pin" | "faces";
  /** For a pin, `a` is the body with the hole and `b` the pin. For faces, either way round. */
  a: string;
  b: string;
  /** The face on each body, numbered as the kernel numbers the built body's faces. */
  faceA: number;
  faceB: number;
  /** The gap on each side, mm. Below 0 they overlap. */
  gap: number;
  /** Where they meet, for Show. */
  box: Box;
}

interface PlaneFace {
  kind: "plane";
  index: number;
  point: V3;
  normal: V3;
  box: Box;
}
interface CylFace {
  kind: "cyl";
  index: number;
  point: V3;
  axis: V3;
  radius: number;
  /** A hole: the surface faces the axis. */
  inner: boolean;
  box: Box;
}
type Face = PlaneFace | CylFace;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const pnt = (p: { X(): number; Y(): number; Z(): number }): V3 => [p.X(), p.Y(), p.Z()];

function boxOf(oc: OC, s: TopoDS_Shape): Box {
  const b = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(s, b, false, false);
  const out = { min: pnt(b.CornerMin()), max: pnt(b.CornerMax()) };
  b.delete();
  return out;
}

const grown = (b: Box, by: number): Box => ({ min: b.min.map((v) => v - by) as V3, max: b.max.map((v) => v + by) as V3 });
const overlap = (a: Box, b: Box): Box | null => {
  const min = a.min.map((v, i) => Math.max(v, b.min[i]!)) as V3;
  const max = a.max.map((v, i) => Math.min(v, b.max[i]!)) as V3;
  return min.every((v, i) => v <= max[i]! + 1e-9) ? { min, max } : null;
};

function facesOf(oc: OC, shape: TopoDS_Shape): Face[] {
  const out: Face[] = [];
  elements(oc, shape, "face").forEach((s, index) => {
    const face = oc.TopoDS.Face(s);
    const surf = new oc.BRepAdaptor_Surface(face, true);
    const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const type = surf.GetType();
    if (type === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
      const pl = surf.Plane();
      const d = pnt(pl.Axis().Direction());
      const f = reversed ? -1 : 1;
      out.push({ kind: "plane", index, point: pnt(pl.Location()), normal: [d[0] * f, d[1] * f, d[2] * f], box: boxOf(oc, s) });
    } else if (type === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      const cyl = surf.Cylinder();
      const ax = cyl.Axis();
      // The surface's own normal points away from the axis on a right-handed cylinder; a reversed face, or a
      // left-handed one, faces the axis instead: a hole.
      const inner = reversed !== !cyl.Position().Direct();
      out.push({ kind: "cyl", index, point: pnt(ax.Location()), axis: pnt(ax.Direction()), radius: cyl.Radius(), inner, box: boxOf(oc, s) });
    }
    surf.delete();
  });
  return out;
}

/** The span of a box along a direction. */
function span(b: Box, d: V3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) {
        const v = dot([x, y, z], d);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  return [lo, hi];
}

function pin(a: string, hole: CylFace, b: string, peg: CylFace, limit: number): Mate | null {
  if (!hole.inner || peg.inner) return null;
  if (len(cross(hole.axis, peg.axis)) > 1e-3) return null;
  // Coaxial: the pin's axis passes through the hole's.
  const off = sub(peg.point, hole.point);
  const across = len(cross(off, hole.axis));
  if (across > 0.05) return null;
  const gap = hole.radius - peg.radius;
  if (gap > limit || gap < -limit) return null;
  const [h0, h1] = span(hole.box, hole.axis);
  const [p0, p1] = span(peg.box, hole.axis);
  if (Math.min(h1, p1) - Math.max(h0, p0) < 0.01) return null;
  const box = overlap(grown(hole.box, 0.01), grown(peg.box, 0.01)) ?? hole.box;
  return { kind: "pin", a, b, faceA: hole.index, faceB: peg.index, gap, box };
}

function faces(a: string, fa: PlaneFace, b: string, fb: PlaneFace, limit: number): Mate | null {
  if (dot(fa.normal, fb.normal) > -0.9999) return null;
  // How far b's face stands out in front of a's.
  const gap = dot(sub(fb.point, fa.point), fa.normal);
  if (gap < -1e-6 || gap > limit) return null;
  const box = overlap(grown(fa.box, gap + 1e-6), grown(fb.box, gap + 1e-6));
  if (!box) return null;
  // They must share some area across the faces, not just touch along an edge.
  const sizes = [0, 1, 2].map((i) => box.max[i]! - box.min[i]!).sort((x, y) => y - x);
  if (sizes[1]! < 0.05) return null;
  return { kind: "faces", a, b, faceA: fa.index, faceB: fb.index, gap: Math.max(0, gap), box };
}

/**
 * Pins in holes and facing flat faces between different bodies, with gaps up to `limit` mm. Bodies far apart are
 * skipped by their boxes first, so a big model stays quick.
 */
export function findMates(oc: OC, bodies: { id: string; shape: TopoDS_Shape }[], limit = 1): Mate[] {
  const info = bodies.map((b) => ({ id: b.id, box: boxOf(oc, b.shape), faces: null as Face[] | null, shape: b.shape }));
  const facesFor = (i: (typeof info)[number]) => (i.faces ??= facesOf(oc, i.shape));
  const out: Mate[] = [];
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const A = info[i]!;
      const B = info[j]!;
      if (!overlap(grown(A.box, limit), B.box)) continue;
      const fa = facesFor(A);
      const fb = facesFor(B);
      for (const x of fa) {
        for (const y of fb) {
          if (!overlap(grown(x.box, limit), y.box)) continue;
          let m: Mate | null = null;
          if (x.kind === "cyl" && y.kind === "cyl") m = x.inner ? pin(A.id, x, B.id, y, limit) : pin(B.id, y, A.id, x, limit);
          else if (x.kind === "plane" && y.kind === "plane") m = faces(A.id, x, B.id, y, limit);
          if (m) out.push(m);
        }
      }
    }
  }
  return out.sort((p, q) => p.gap - q.gap);
}
