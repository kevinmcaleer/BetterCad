import type { TopoDS_Shape, TopoDS_Edge, TopoDS_Face, NCollection_List_TopoDS_Shape, gp_Pnt } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { KernelError, mm } from "../errors";
import { toWorld, type Frame, type Vec2 } from "@bettercad/sketch";
import type { EllipseSeg, SplineSeg, LoftSpec, PrismSpec, ProfileSeg, RevolveSpec, SweepSpec } from "../extrude";
import { holeSection, type HoleSpec } from "../holes";
import type { CopyMove, Plane } from "../pattern";

/**
 * Making and changing solids with OpenCascade. Every function takes the loaded OC instance and returns a new shape;
 * none of them touches its inputs. Sizes in mm, angles in degrees, Z up. Primitives sit on the XY plane with x and y
 * centred on the origin, the same as the placeholder meshes in primitives.ts.
 */
export type ShapeKind = "solid" | "shell" | "face" | "edge" | "vertex";

export interface Size3 {
  x: number;
  y: number;
  z: number;
}

export interface Placement {
  position: Size3;
  /** Degrees about X, Y and Z: a point turns about X, then Y, then Z (the viewport's Euler order "ZYX"). */
  rotation?: Size3;
}

const DEG = Math.PI / 180;

/** What an OpenCascade maker says about where each input element went (#47). */
export interface History {
  Modified(s: TopoDS_Shape): NCollection_List_TopoDS_Shape;
  Generated(s: TopoDS_Shape): NCollection_List_TopoDS_Shape;
  IsDeleted(s: TopoDS_Shape): boolean;
}

/**
 * Watches the makers inside each operation so face names can follow them (#47, occt/naming.ts). Every function that
 * takes one calls it once per maker, after the maker has built.
 */
export interface Tracker {
  /** `out` was made from `inputs`. `made` names the faces a fillet, chamfer or shell makes from edges or walls. */
  step(mk: History, inputs: TopoDS_Shape[], out: TopoDS_Shape, made?: { word: string; offset?: boolean }): void;
  /** A sweep made `out` from a face whose edges are named. */
  sweep(mk: History & { FirstShape(): TopoDS_Shape; LastShape(): TopoDS_Shape }, out: TopoDS_Shape, edges: [TopoDS_Shape, string][]): void;
}

function positive(size: Size3, what: string): void {
  for (const a of ["x", "y", "z"] as const) {
    if (!(size[a] > 0)) throw new KernelError("invalid-size", `A ${what} needs a size above 0 mm on every side.`);
  }
}

/** Runs an OCCT call, turning its exceptions into one-line KernelErrors. */
export function guard<T>(oc: OC, code: KernelError["code"], message: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof KernelError) throw e;
    let detail = String(e);
    try {
      const W = WebAssembly as unknown as { Exception?: new () => object };
      if (W.Exception && e instanceof W.Exception) detail = oc.getExceptionMessage(e as Parameters<OC["getExceptionMessage"]>[0]).join(": ");
    } catch {
      // The message is only for bug reports.
    }
    throw new KernelError(code, message, detail);
  }
}

const progress = (oc: OC) => new oc.Message_ProgressRange();
/**
 * How far apart two surfaces can be and still count as one in a boolean (#379). Without it, a cut whose outline lies
 * on a body's curved face leaves a sliver face of no area between the two, which later steps fold into a face whose
 * mesh covers far more than the face, so an STL of the body comes out wrong.
 */
const FUZZY = 1e-6;
/** Looser tolerances a boolean tries again with when the result is not a valid solid. */
const RETRY_FUZZY = [FUZZY, 1e-5, 1e-4];

export function box(oc: OC, size: Size3): TopoDS_Shape {
  positive(size, "box");
  const corner = new oc.gp_Pnt(-size.x / 2, -size.y / 2, 0);
  const mk = new oc.BRepPrimAPI_MakeBox(corner, size.x, size.y, size.z);
  const s = mk.Shape();
  mk.delete();
  corner.delete();
  return s;
}

/** A cylinder standing on the XY plane; an elliptical one when x ≠ y (an ellipse pushed up). */
export function cylinder(oc: OC, size: Size3): TopoDS_Shape {
  positive(size, "cylinder");
  if (Math.abs(size.x - size.y) < 1e-9) {
    const ax = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1));
    const mk = new oc.BRepPrimAPI_MakeCylinder(ax, size.x / 2, size.z);
    const s = mk.Shape();
    mk.delete();
    return s;
  }
  // gp_Elips needs the major radius along its X direction.
  const major = Math.max(size.x, size.y) / 2;
  const minor = Math.min(size.x, size.y) / 2;
  const xDir = size.x >= size.y ? new oc.gp_Dir(1, 0, 0) : new oc.gp_Dir(0, 1, 0);
  const ax = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1), xDir);
  const elips = new oc.gp_Elips(ax, major, minor);
  const edge = new oc.BRepBuilderAPI_MakeEdge(elips).Edge();
  const wire = new oc.BRepBuilderAPI_MakeWire(edge).Wire();
  const face = new oc.BRepBuilderAPI_MakeFace(wire, true).Face();
  return prism(oc, face, [0, 0, size.z]);
}

/** A sphere resting on z = 0; a spheroid when z differs from the width (the depth follows the width). */
export function sphere(oc: OC, size: Size3): TopoDS_Shape {
  positive(size, "sphere");
  const r = size.x / 2;
  const rz = size.z / 2;
  if (Math.abs(r - rz) < 1e-9) {
    const mk = new oc.BRepPrimAPI_MakeSphere(new oc.gp_Pnt(0, 0, r), r);
    return mk.Shape();
  }
  // Revolve half an ellipse in the XZ plane about Z.
  const major = Math.max(r, rz);
  const minor = Math.min(r, rz);
  const xDir = r >= rz ? new oc.gp_Dir(1, 0, 0) : new oc.gp_Dir(0, 0, 1);
  const centre = new oc.gp_Pnt(0, 0, rz);
  const elips = new oc.gp_Elips(new oc.gp_Ax2(centre, new oc.gp_Dir(0, -1, 0), xDir), major, minor);
  const top = new oc.gp_Pnt(0, 0, 2 * rz);
  const bottom = new oc.gp_Pnt(0, 0, 0);
  const arc = new oc.GC_MakeArcOfEllipse(elips, bottom, top, true).Value();
  const arcEdge = new oc.BRepBuilderAPI_MakeEdge(arc).Edge();
  const axisEdge = new oc.BRepBuilderAPI_MakeEdge(top, bottom).Edge();
  const wire = new oc.BRepBuilderAPI_MakeWire(arcEdge, axisEdge).Wire();
  const face = new oc.BRepBuilderAPI_MakeFace(wire, true).Face();
  return revolve(oc, face, [0, 0, 0], [0, 0, 1], 360);
}

/** A cone (or a truncated one when the top diameter is above 0), as a revolved trapezium. */
export function cone(oc: OC, bottomDiameter: number, topDiameter: number, height: number): TopoDS_Shape {
  if (!(bottomDiameter >= 0 && topDiameter >= 0 && bottomDiameter + topDiameter > 0 && height > 0)) {
    throw new KernelError("invalid-size", "A cone needs a height above 0 mm and at least one end wider than 0 mm.");
  }
  const pts: [number, number][] = [
    [0, 0],
    [bottomDiameter / 2, 0],
    [topDiameter / 2, height],
    [0, height],
  ].filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1]) as [number, number][];
  const face = polygonFace(
    oc,
    pts.filter((p, i) => !(p[0] === 0 && i > 0 && i < pts.length - 1)).map(([x, z]) => [x, 0, z]),
  );
  return revolve(oc, face, [0, 0, 0], [0, 0, 1], 360);
}

export function torus(oc: OC, majorDiameter: number, tubeDiameter: number): TopoDS_Shape {
  if (!(tubeDiameter > 0 && majorDiameter > tubeDiameter)) {
    throw new KernelError("invalid-size", "A torus needs its ring wider than its tube.");
  }
  const ax = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, tubeDiameter / 2), new oc.gp_Dir(0, 0, 1));
  return new oc.BRepPrimAPI_MakeTorus(ax, majorDiameter / 2, tubeDiameter / 2).Shape();
}

/** A wedge: a right-angled triangle in XZ (width x, height z) pushed along Y. */
export function wedge(oc: OC, size: Size3): TopoDS_Shape {
  positive(size, "wedge");
  const face = polygonFace(oc, [
    [-size.x / 2, -size.y / 2, 0],
    [size.x / 2, -size.y / 2, 0],
    [-size.x / 2, -size.y / 2, size.z],
  ]);
  return prism(oc, face, [0, size.y, 0]);
}

/** A planar face from a closed polygon. */
export function polygonFace(oc: OC, points: [number, number, number][]): TopoDS_Face {
  const mkWire = new oc.BRepBuilderAPI_MakeWire();
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    mkWire.Add(new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Pnt(p[0], p[1], p[2]), new oc.gp_Pnt(q[0], q[1], q[2])).Edge());
  });
  const wire = mkWire.Wire();
  const mk = new oc.BRepBuilderAPI_MakeFace(wire, true);
  if (!mk.IsDone()) throw new KernelError("open-profile", "This outline is not flat and closed, so it cannot be filled.");
  return mk.Face();
}

/** Pushes a face (or wire, edge) along a vector: a face gives a solid. */
export function prism(oc: OC, profile: TopoDS_Shape, vector: [number, number, number]): TopoDS_Shape {
  return guard(oc, "failed", "That profile could not be extruded.", () => {
    const v = new oc.gp_Vec(vector[0], vector[1], vector[2]);
    const mk = new oc.BRepPrimAPI_MakePrism(profile, v, false, true);
    return mk.Shape();
  });
}

/**
 * An ellipse, or part of one (#401), as an edge. OCCT wants the major axis first, so a wider second axis turns the
 * frame a quarter and shifts the angles to match.
 */
function ellipseEdge(oc: OC, f: Frame, P: (p: Vec2) => gp_Pnt, g: EllipseSeg): TopoDS_Edge {
  const swap = g.r2 > g.r1;
  const rot = g.rot + (swap ? Math.PI / 2 : 0);
  const along = toWorld({ ...f, origin: [0, 0, 0] }, [Math.cos(rot), Math.sin(rot)]);
  const ax = new oc.gp_Ax2(P(g.c), new oc.gp_Dir(f.normal[0], f.normal[1], f.normal[2]), new oc.gp_Dir(along[0], along[1], along[2]));
  const el = new oc.gp_Elips(ax, Math.max(g.r1, g.r2), Math.min(g.r1, g.r2));
  if (!g.t) return new oc.BRepBuilderAPI_MakeEdge(el).Edge();
  const shift = swap ? -Math.PI / 2 : 0;
  const e = new oc.BRepBuilderAPI_MakeEdge(el, g.t[0] + shift, g.t[1] + shift).Edge();
  return (g.rev ? e.Reversed() : e) as TopoDS_Edge;
}

/**
 * A spline (#269) as one B-spline edge: its cubic pieces end to end, so the solid's edge is exactly the curve the
 * sketch draws. The joins are knots of full multiplicity, then thinned where the curve is smooth there (all of a fitted
 * spline's joins), which leaves a C2 curve that OCCT measures and offsets well.
 */
function splineEdge(oc: OC, P: (p: Vec2) => gp_Pnt, g: SplineSeg): TopoDS_Edge {
  const pieces = (g.poles.length - 1) / 3;
  const pts = new oc.NCollection_Array1_gp_Pnt(1, g.poles.length);
  g.poles.forEach((p, i) => pts.SetValue(i + 1, P(p)));
  const knots = new oc.NCollection_Array1_double(1, pieces + 1);
  const mults = new oc.NCollection_Array1_int(1, pieces + 1);
  for (let i = 0; i <= pieces; i++) {
    knots.SetValue(i + 1, g.knots[i]!);
    mults.SetValue(i + 1, i === 0 || i === pieces ? 4 : 3);
  }
  const curve = new oc.Geom_BSplineCurve(pts, knots, mults, 3, false);
  for (let i = pieces; i >= 2; i--) curve.RemoveKnot(i, 1, 1e-9);
  return new oc.BRepBuilderAPI_MakeEdge(curve).Edge();
}

/** A closed outline of lines and arcs on a sketch frame, as a wire in world space. */
function outlineWire(oc: OC, spec: { frame: Frame }, segs: ProfileSeg[], lift: number, named?: [TopoDS_Shape, string][], tag = ""): TopoDS_Shape {
  const f = spec.frame;
  const P = (p: Vec2) => {
    const w = toWorld(f, p);
    return new oc.gp_Pnt(w[0] + f.normal[0] * lift, w[1] + f.normal[1] * lift, w[2] + f.normal[2] * lift);
  };
  const mk = new oc.BRepBuilderAPI_MakeWire();
  segs.forEach((g, i) => {
    let e: TopoDS_Edge;
    if (g.kind === "line") e = new oc.BRepBuilderAPI_MakeEdge(P(g.a), P(g.b)).Edge();
    else if (g.kind === "arc") e = new oc.BRepBuilderAPI_MakeEdge(new oc.GC_MakeArcOfCircle(P(g.a), P(g.m), P(g.b)).Value()).Edge();
    else if (g.kind === "ellipse") e = ellipseEdge(oc, f, P, g);
    else if (g.kind === "spline") e = splineEdge(oc, P, g);
    else {
      const c = P(g.c);
      const circ = new oc.gp_Circ(new oc.gp_Ax2(c, new oc.gp_Dir(f.normal[0], f.normal[1], f.normal[2]), new oc.gp_Dir(f.x[0], f.x[1], f.x[2])), g.r);
      e = new oc.BRepBuilderAPI_MakeEdge(circ).Edge();
    }
    mk.Add(e);
    // The wire may join the ends with new vertices, which makes a new edge: name the one it kept.
    if (named) named.push([mk.Edge(), g.id ?? `${tag}${i}`]);
  });
  if (!mk.IsDone()) throw new KernelError("open-profile", "This shape's outline does not join up, so it cannot be extruded.");
  return mk.Wire();
}

/**
 * Extrude (#61): each profile's outline pushed from \`from\` to \`to\` along the frame's normal, its holes cut out, and
 * the profiles joined into one body.
 */
export function prismOf(oc: OC, spec: PrismSpec, t?: Tracker): TopoDS_Shape {
  const taper = spec.taper ?? 0;
  if (!taper) return straightPrism(oc, spec, t);
  if (!(Math.abs(taper) < 89)) throw new KernelError("invalid-size", "A taper needs an angle between -89° and 89°.");
  // The shape is full size at `base` and narrows (or widens) away from it on each side.
  const base = spec.base ?? spec.from;
  const [lo, hi] = [Math.min(spec.from, spec.to), Math.max(spec.from, spec.to)];
  const parts = [
    [base, lo],
    [base, hi],
  ].filter(([a, b]) => Math.abs(b! - a!) > 1e-9);
  const made = parts.map(([a, b]) => tapered(oc, { ...spec, from: a!, to: b! }, taper, t));
  return made.length === 1 ? made[0]! : boolean(oc, "join", made[0]!, made.slice(1), t);
}

/** A prism from `from` to `to` with its sides leaning in by `angle`° away from its start: Extrude's taper (#402). */
function tapered(oc: OC, spec: PrismSpec, angle: number, t?: Tracker): TopoDS_Shape {
  const solid = straightPrism(oc, spec, t);
  const n = spec.frame.normal;
  const s = Math.sign(spec.to - spec.from);
  const dir = new oc.gp_Dir(n[0] * s, n[1] * s, n[2] * s);
  const o = spec.frame.origin;
  const neutral = new oc.gp_Pln(new oc.gp_Pnt(o[0] + n[0] * spec.from, o[1] + n[1] * spec.from, o[2] + n[2] * spec.from), dir);
  return guard(oc, "failed", "That shape could not be tapered. Try a smaller angle, or a shape of lines and arcs.", () => {
    const mk = new oc.BRepOffsetAPI_DraftAngle(solid);
    for (const f of elements(oc, solid, "face")) {
      const face = oc.TopoDS.Face(f);
      const surf = new oc.BRepAdaptor_Surface(face, true);
      // The caps lie flat across the normal; every other face is a side.
      if (surf.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
        const a = surf.Plane().Axis().Direction();
        if (Math.abs(a.X() * n[0] + a.Y() * n[1] + a.Z() * n[2]) > 1 - 1e-9) continue;
      }
      mk.Add(face, dir, (angle * Math.PI) / 180, neutral, true);
      if (!mk.AddDone()) throw new KernelError("failed", "That shape could not be tapered. Try a smaller angle, or a shape of lines and arcs.");
    }
    mk.Build(new oc.Message_ProgressRange());
    if (!mk.IsDone()) throw new KernelError("failed", "That shape could not be tapered. Try a smaller angle.");
    const out = mk.Shape();
    t?.step(mk as never, [solid], out);
    return out;
  });
}

function straightPrism(oc: OC, spec: PrismSpec, t?: Tracker): TopoDS_Shape {
  const depth = spec.to - spec.from;
  if (!(Math.abs(depth) > 1e-9)) throw new KernelError("invalid-size", "An extrude needs a distance other than 0 mm.");
  const n = spec.frame.normal;
  const v: [number, number, number] = [n[0] * depth, n[1] * depth, n[2] * depth];
  const solidOf = (segs: ProfileSeg[], tag: string) =>
    guard(oc, "open-profile", "This shape could not be filled. Check it is closed and does not cross itself.", () => {
      const named: [TopoDS_Shape, string][] | undefined = t ? [] : undefined;
      const mk = new oc.BRepBuilderAPI_MakeFace(oc.TopoDS.Wire(outlineWire(oc, spec, segs, spec.from, named, tag)), true);
      if (!mk.IsDone()) throw new KernelError("open-profile", "This shape could not be filled. Check it is closed and does not cross itself.");
      if (!t) return prism(oc, mk.Face(), v);
      return guard(oc, "failed", "That profile could not be extruded.", () => {
        const pm = new oc.BRepPrimAPI_MakePrism(mk.Face(), new oc.gp_Vec(...v), false, true);
        const out = pm.Shape();
        t.sweep(pm, out, named!);
        return out;
      });
    });
  const bodies = spec.profiles.map((p, k) => {
    const outer = solidOf(p.outer, `p${k}.`);
    return p.holes.length
      ? boolean(
          oc,
          "cut",
          outer,
          p.holes.map((h, j) => solidOf(h, `p${k}h${j}.`)),
          t,
        )
      : outer;
  });
  if (!bodies.length) throw new KernelError("open-profile", "Pick at least one closed shape to extrude.");
  return bodies.length === 1 ? bodies[0]! : boolean(oc, "join", bodies[0]!, bodies.slice(1), t);
}

/**
 * Revolve (#62): each profile turned round an axis in its sketch plane, holes cut, profiles joined. A symmetric
 * revolve starts half its angle back.
 */
export function revolveOf(oc: OC, spec: RevolveSpec, t?: Tracker): TopoDS_Shape {
  if (!(spec.angle > 0 && spec.angle <= 360)) throw new KernelError("invalid-size", "A revolve needs an angle from 1° to 360°.");
  const f = spec.frame;
  // An axis above or below the plane (a construction axis or an edge) sits `offset` along the normal.
  const off = spec.axis.offset ?? 0;
  const lift = (p: [number, number, number]): [number, number, number] => [p[0] + f.normal[0] * off, p[1] + f.normal[1] * off, p[2] + f.normal[2] * off];
  const o = lift(toWorld(f, spec.axis.origin));
  const tip = lift(toWorld(f, [spec.axis.origin[0] + spec.axis.dir[0], spec.axis.origin[1] + spec.axis.dir[1]]));
  const dir: [number, number, number] = [tip[0] - o[0], tip[1] - o[1], tip[2] - o[2]];
  const solidOf = (segs: ProfileSeg[], tag: string) =>
    guard(oc, "open-profile", "This shape could not be filled. Check it is closed and does not cross itself.", () => {
      let named: [TopoDS_Shape, string][] | undefined = t ? [] : undefined;
      const mk = new oc.BRepBuilderAPI_MakeFace(oc.TopoDS.Wire(outlineWire(oc, spec, segs, 0, named, tag)), true);
      if (!mk.IsDone()) throw new KernelError("open-profile", "This shape could not be filled. Check it is closed and does not cross itself.");
      let face: TopoDS_Shape = mk.Face();
      if (spec.start) {
        const tr = new oc.gp_Trsf();
        tr.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(...o), new oc.gp_Dir(...dir)), spec.start * DEG);
        const mt = new oc.BRepBuilderAPI_Transform(face, tr, true, false);
        face = mt.Shape();
        // The turned copy's edges are new: follow each to it.
        named = named?.flatMap(([e, n]) => shapesOfList(oc, mt.Modified(e)).map((m): [TopoDS_Shape, string] => [m, n]));
      }
      if (!t) return revolve(oc, face, o, dir, spec.angle);
      return guard(oc, "failed", "That profile could not be revolved.", () => {
        const ax = new oc.gp_Ax1(new oc.gp_Pnt(...o), new oc.gp_Dir(...dir));
        const rm = new oc.BRepPrimAPI_MakeRevol(face, ax, spec.angle * DEG, true);
        const out = rm.Shape();
        t.sweep(rm, out, named!);
        return out;
      });
    });
  const bodies = spec.profiles.map((p, k) => {
    const outer = solidOf(p.outer, `p${k}.`);
    return p.holes.length
      ? boolean(
          oc,
          "cut",
          outer,
          p.holes.map((h, j) => solidOf(h, `p${k}h${j}.`)),
          t,
        )
      : outer;
  });
  if (!bodies.length) throw new KernelError("open-profile", "Pick at least one closed shape to revolve.");
  return bodies.length === 1 ? bodies[0]! : boolean(oc, "join", bodies[0]!, bodies.slice(1), t);
}

/**
 * Loft (#399): one solid through each section's outline in turn, smooth unless ruled. Holes are lofted the same way
 * and cut out, so every section needs as many holes as the first; they pair up in order.
 */
export function loftOf(oc: OC, spec: LoftSpec, t?: Tracker): TopoDS_Shape {
  const { sections } = spec;
  if (sections.length < 2) throw new KernelError("invalid-size", "A loft needs at least two shapes, each on its own plane.");
  const holes = sections[0]!.profile.holes.length;
  if (sections.some((s) => s.profile.holes.length !== holes))
    throw new KernelError("open-profile", "Every shape in a loft needs the same number of holes. Pick shapes that match, or draw the holes later.");
  const through = (pick: (k: number) => ProfileSeg[], tag: string) =>
    guard(oc, "failed", "Those shapes could not be lofted. Check they don't cross each other, and try Straight sides.", () => {
      const named: [TopoDS_Shape, string][] | undefined = t ? [] : undefined;
      const mk = new oc.BRepOffsetAPI_ThruSections(true, !!spec.ruled, 1e-6);
      // Lines and arcs, and shapes with different numbers of sides, are matched up and turned to line up.
      mk.CheckCompatibility(true);
      sections.forEach((sec, k) => mk.AddWire(oc.TopoDS.Wire(outlineWire(oc, sec, pick(k), 0, k === 0 ? named : undefined, tag))));
      const out = mk.Shape();
      if (!out || out.IsNull()) throw new KernelError("failed", "Those shapes could not be lofted.");
      t?.sweep(mk, out, named!);
      return out;
    });
  const outer = through((k) => sections[k]!.profile.outer, "p0.");
  if (!holes) return outer;
  const cuts = Array.from({ length: holes }, (_, j) => through((k) => sections[k]!.profile.holes[j]!, `p0h${j}.`));
  return boolean(oc, "cut", outer, cuts, t);
}

/**
 * Sweep (#400): each profile's outline pushed along the path, its holes swept the same way and cut out, the profiles
 * joined. The profile keeps its angle to the path as it bends (a corrected Frenet frame).
 */
export function sweepOf(oc: OC, spec: SweepSpec, t?: Tracker): TopoDS_Shape {
  if (!spec.path.segs.length) throw new KernelError("invalid-size", "Pick the lines and arcs of a path to sweep along.");
  const spine = guard(oc, "failed", "The path's lines and arcs don't join end to end.", () => oc.TopoDS.Wire(outlineWire(oc, spec.path, spec.path.segs, 0)));
  const along = (segs: ProfileSeg[], tag: string) =>
    guard(oc, "failed", "That shape could not be swept along the path. Check the path doesn't bend tighter than the shape is wide.", () => {
      const named: [TopoDS_Shape, string][] | undefined = t ? [] : undefined;
      const mk = new oc.BRepOffsetAPI_MakePipeShell(spine);
      mk.SetMode(true);
      mk.Add(outlineWire(oc, spec, segs, 0, named, tag), false, true);
      mk.Build();
      if (!mk.IsDone() || !mk.MakeSolid()) throw new KernelError("failed", "That shape could not be swept along the path.");
      const out = mk.Shape();
      t?.sweep(mk, out, named!);
      return out;
    });
  const bodies = spec.profiles.map((p, k) => {
    const outer = along(p.outer, `p${k}.`);
    return p.holes.length
      ? boolean(
          oc,
          "cut",
          outer,
          p.holes.map((h, j) => along(h, `p${k}h${j}.`)),
          t,
        )
      : outer;
  });
  if (!bodies.length) throw new KernelError("open-profile", "Pick at least one closed shape to sweep.");
  return bodies.length === 1 ? bodies[0]! : boolean(oc, "join", bodies[0]!, bodies.slice(1), t);
}

/**
 * Push/pull (#65): a flat face pushed along its outward normal by `distance`. Out joins the slab to the body; in
 * cuts it away, so a box grows or shrinks and a pocket fills or deepens.
 */
export function pushPull(oc: OC, shape: TopoDS_Shape, faceIndex: number, distance: number, t?: Tracker): TopoDS_Shape {
  if (!(Math.abs(distance) > 1e-9)) return shape;
  const f = elements(oc, shape, "face")[faceIndex];
  if (!f) throw new KernelError("reference-missing", "The face it pulls is not there any more. Pick it again.");
  const face = oc.TopoDS.Face(f);
  const surf = new oc.BRepAdaptor_Surface(face, true);
  if (surf.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) throw new KernelError("failed", "Push/pull works on flat faces.");
  const d = surf.Plane().Axis().Direction();
  const flip = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
  const n: [number, number, number] = [d.X() * flip, d.Y() * flip, d.Z() * flip];
  const slab = prism(oc, face, [n[0] * distance, n[1] * distance, n[2] * distance]);
  return boolean(oc, distance > 0 ? "join" : "cut", shape, [slab], t);
}

/** Cuts screw holes (#70) into a shape: each a revolved section along the face's inward normal. */
export function holes(oc: OC, shape: TopoDS_Shape, spec: HoleSpec, t?: Tracker): TopoDS_Shape {
  const n = spec.frame.normal;
  const a: [number, number, number] = [-n[0], -n[1], -n[2]];
  const u = spec.frame.x;
  let depth = spec.depth ?? 0;
  if (spec.depth === null) {
    // Through all: past the far side of the body, whichever way it faces.
    const { min, max } = measure(oc, shape).bbox;
    depth = 2 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) + 1;
  }
  const tools = spec.points.map((q) => {
    const p = toWorld(spec.frame, q);
    const pts = holeSection(spec, depth).map(
      ([r, t]) => [p[0] + u[0] * r + a[0] * t, p[1] + u[1] * r + a[1] * t, p[2] + u[2] * r + a[2] * t] as [number, number, number],
    );
    return revolve(oc, polygonFace(oc, pts), p as [number, number, number], a, 360);
  });
  return boolean(oc, "cut", shape, tools, t);
}

/** Turns a face round an axis through `origin` along `dir`, by `degrees`. */
export function revolve(oc: OC, profile: TopoDS_Shape, origin: [number, number, number], dir: [number, number, number], degrees: number): TopoDS_Shape {
  return guard(oc, "failed", "That profile could not be revolved.", () => {
    const ax = new oc.gp_Ax1(new oc.gp_Pnt(...origin), new oc.gp_Dir(...dir));
    const mk = new oc.BRepPrimAPI_MakeRevol(profile, ax, degrees * DEG, true);
    return mk.Shape();
  });
}

/** Undoes a placement: a world shape in the part's own coordinates. */
export function unplace(oc: OC, shape: TopoDS_Shape, p: Placement): TopoDS_Shape {
  const mk = new oc.BRepBuilderAPI_Transform(shape, placement(oc, p).Inverted(), true, false);
  return mk.Shape();
}

/** A mirrored, turned or moved copy of a shape (#69). A mirror flips the faces' sense; OCCT puts them right. */
export function copyShape(oc: OC, shape: TopoDS_Shape, by: CopyMove): TopoDS_Shape {
  const t = new oc.gp_Trsf();
  if ("move" in by) t.SetTranslation(new oc.gp_Vec(by.move.x, by.move.y, by.move.z));
  else if ("place" in by) {
    const m = by.place;
    t.SetValues(m[0]!, m[4]!, m[8]!, m[12]!, m[1]!, m[5]!, m[9]!, m[13]!, m[2]!, m[6]!, m[10]!, m[14]!);
  } else if ("mirror" in by) {
    const { origin: o, normal: n } = by.mirror;
    t.SetMirror(new oc.gp_Ax2(new oc.gp_Pnt(o.x, o.y, o.z), new oc.gp_Dir(n.x, n.y, n.z)));
  } else {
    const { origin: o, axis: a, deg } = by.turn;
    t.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(o.x, o.y, o.z), new oc.gp_Dir(a.x, a.y, a.z)), deg * DEG);
  }
  const mk = new oc.BRepBuilderAPI_Transform(shape, t, true, false);
  return mk.Shape();
}

/** Moves and turns a shape: turn about the origin (Z, then Y, then X), then move. */
export function place(oc: OC, shape: TopoDS_Shape, p: Placement): TopoDS_Shape {
  const mk = new oc.BRepBuilderAPI_Transform(shape, placement(oc, p), true, false);
  return mk.Shape();
}

function placement(oc: OC, p: Placement) {
  const r = p.rotation ?? { x: 0, y: 0, z: 0 };
  const trsf = new oc.gp_Trsf();
  const step = (axis: [number, number, number], deg: number) => {
    if (!deg) return;
    const t = new oc.gp_Trsf();
    t.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(...axis)), deg * DEG);
    // Applied after what is there already: trsf = t * trsf.
    trsf.PreMultiply(t);
  };
  // The viewport's Euler order "ZYX" is the matrix Rz · Ry · Rx: a point turns about X first, then Y, then Z.
  step([1, 0, 0], r.x);
  step([0, 1, 0], r.y);
  step([0, 0, 1], r.z);
  const move = new oc.gp_Trsf();
  move.SetTranslation(new oc.gp_Vec(p.position.x, p.position.y, p.position.z));
  trsf.PreMultiply(move);
  return trsf;
}

export type BooleanOp = "join" | "cut" | "intersect";

/** Join, cut or intersect: `tools` from `target`. Fails loudly when nothing is left. */
export function boolean(oc: OC, op: BooleanOp, target: TopoDS_Shape, tools: TopoDS_Shape[], t?: Tracker): TopoDS_Shape {
  let out = target;
  for (const tool of tools) {
    out = guard(
      oc,
      "boolean-failed",
      op === "join" ? "These bodies could not be joined." : op === "cut" ? "That cut could not be made." : "These bodies could not be intersected.",
      () => {
        // A boolean of two valid solids can still give an invalid one: a face whose edges miss each other by more
        // than 1e-6 mm, as where a cog stands flat on a face. Fillets and chamfers refuse an invalid body, so the
        // next one would fail on any edge. A looser tolerance joins those edges; the first valid result is kept.
        type Made = { mk: Parameters<Tracker["step"]>[0]; shape: TopoDS_Shape };
        let best: Made | null = null;
        for (const fuzzy of RETRY_FUZZY) {
          const mk = op === "join" ? new oc.BRepAlgoAPI_Fuse() : op === "cut" ? new oc.BRepAlgoAPI_Cut() : new oc.BRepAlgoAPI_Common();
          const args = new oc.NCollection_List_TopoDS_Shape();
          args.Append(out);
          const tools = new oc.NCollection_List_TopoDS_Shape();
          tools.Append(tool);
          mk.SetArguments(args);
          mk.SetTools(tools);
          mk.SetFuzzyValue(fuzzy);
          // Leave the inputs as they were, so a try that fails hasn't loosened their tolerances for the next one.
          mk.SetNonDestructive(true);
          mk.Build(progress(oc));
          if (!mk.IsDone()) {
            if (best) break;
            throw new KernelError("boolean-failed", "That operation could not be worked out. Try moving the bodies slightly.");
          }
          if (op === "join") mk.SimplifyResult(true, true, 1e-6);
          const shape = mk.Shape();
          if (valid(oc, shape)) {
            best = { mk, shape };
            break;
          }
          best ??= { mk, shape };
          // An invalid body stays invalid whatever the tolerance, so only valid inputs are tried again.
          if (fuzzy === FUZZY && !(valid(oc, out) && valid(oc, tool))) break;
        }
        t?.step(best!.mk, [out, tool], best!.shape);
        return best!.shape;
      },
    );
  }
  if (count(oc, out, "solid") === 0) {
    throw new KernelError(
      "empty-result",
      op === "cut" ? "Cutting left nothing behind." : op === "intersect" ? "These bodies do not overlap, so nothing is left." : "Joining left nothing.",
    );
  }
  return out;
}

/** Buckets for `elements`' shape hash. */
const HASH_BUCKETS = 1 << 30;

/**
 * Every sub-shape of a kind, each once, in a stable order (the face, edge and vertex numbering). This build cannot
 * make OCCT's shape maps, so shared edges and vertices are found by their position first, then IsSame. Faces, shells
 * and solids are bucketed by OCCT's shape hash (the one IsSame agrees with), so a mesh's thousands of triangle faces
 * aren't each checked against all the others.
 */
export function elements(oc: OC, shape: TopoDS_Shape, kind: ShapeKind): TopoDS_Shape[] {
  const out: TopoDS_Shape[] = [];
  const buckets = new Map<string | number, TopoDS_Shape[]>();
  const ex = new oc.TopExp_Explorer(shape, abs(oc, kind), oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) {
    const s = ex.Current();
    const key = kind === "edge" || kind === "vertex" ? spot(oc, s, kind) : oc.ReplicadShapeHasher.HashCode(s, HASH_BUCKETS);
    const bucket = buckets.get(key);
    if (bucket?.some((b) => b.IsSame(s))) continue;
    if (bucket) bucket.push(s);
    else buckets.set(key, [s]);
    out.push(s);
  }
  ex.delete();
  return out;
}

/** Finds an edge's number in `edges` (as `elements` lists them), or -1. Bucketed by where the edge's middle is. */
export function edgeNumbering(oc: OC, edges: TopoDS_Shape[]): (e: TopoDS_Shape) => number {
  const buckets = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = spot(oc, e, "edge");
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  });
  return (e) => buckets.get(spot(oc, e, "edge"))?.find((i) => edges[i]!.IsSame(e)) ?? -1;
}

const r6 = (n: number) => (Math.round(n * 1e5) / 1e5).toFixed(5);

/** Where an edge's middle or a vertex is, as a bucket key. */
function spot(oc: OC, s: TopoDS_Shape, kind: "edge" | "vertex"): string {
  if (kind === "vertex") {
    const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(s));
    return `${r6(p.X())},${r6(p.Y())},${r6(p.Z())}`;
  }
  const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(s));
  const p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
  const key = `${r6(p.X())},${r6(p.Y())},${r6(p.Z())}`;
  c.delete();
  return key;
}

/** Every shape in an OpenCascade list (this build can only walk one by taking the first off a copy). */
export function shapesOfList(oc: OC, list: NCollection_List_TopoDS_Shape): TopoDS_Shape[] {
  const l = new oc.NCollection_List_TopoDS_Shape();
  l.Assign(list);
  const out: TopoDS_Shape[] = [];
  while (l.Size() > 0) {
    out.push(l.First());
    l.RemoveFirst();
  }
  l.delete();
  return out;
}

export function count(oc: OC, shape: TopoDS_Shape, kind: ShapeKind): number {
  return elements(oc, shape, kind).length;
}

function abs(oc: OC, kind: ShapeKind) {
  const e = oc.TopAbs_ShapeEnum;
  return kind === "solid"
    ? e.TopAbs_SOLID
    : kind === "shell"
      ? e.TopAbs_SHELL
      : kind === "face"
        ? e.TopAbs_FACE
        : kind === "edge"
          ? e.TopAbs_EDGE
          : e.TopAbs_VERTEX;
}

/** Rounds edges. A radius that does not fit fails with the largest that does, found by halving (#48). */
export function fillet(oc: OC, shape: TopoDS_Shape, edgeIndices: number[], radius: number, t?: Tracker): TopoDS_Shape {
  return blend(oc, shape, edgeIndices, radius, "fillet", t);
}

export function chamfer(oc: OC, shape: TopoDS_Shape, edgeIndices: number[], distance: number, t?: Tracker): TopoDS_Shape {
  return blend(oc, shape, edgeIndices, distance, "chamfer", t);
}

function tryBlend(oc: OC, shape: TopoDS_Shape, edges: TopoDS_Edge[], r: number, kind: "fillet" | "chamfer", t?: Tracker): TopoDS_Shape | null {
  try {
    const mk = kind === "fillet" ? new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational) : new oc.BRepFilletAPI_MakeChamfer(shape);
    for (const e of edges) mk.Add(r, e);
    mk.Build(progress(oc));
    if (!mk.IsDone()) return null;
    const out = mk.Shape();
    if (!valid(oc, out)) return null;
    t?.step(mk, [shape], out, { word: kind });
    return out;
  } catch {
    return null;
  }
}

function blend(oc: OC, shape: TopoDS_Shape, edgeIndices: number[], r: number, kind: "fillet" | "chamfer", t?: Tracker): TopoDS_Shape {
  const word = kind === "fillet" ? "fillet" : "chamfer";
  if (!(r > 0)) throw new KernelError("invalid-size", `A ${word} needs a size above 0 mm.`);
  const all = elements(oc, shape, "edge");
  const edges = edgeIndices.map((i) => {
    const e = all[i];
    if (!e) throw new KernelError("reference-missing", `An edge picked for the ${word} is not there any more. Pick it again.`);
    return oc.TopoDS.Edge(e);
  });
  if (!edges.length) throw new KernelError("reference-missing", `Pick at least one edge for the ${word}.`);
  const out = tryBlend(oc, shape, edges, r, kind, t) ?? localBlend(oc, shape, edges, r, kind, t);
  if (out) return out;
  // Find the largest size that works, halving then bisecting (6 tries at most).
  let lo = 0;
  let hi = r;
  for (let i = 0; i < 6; i++) {
    const mid = i === 0 ? r / 2 : (lo + hi) / 2;
    if (tryBlend(oc, shape, edges, mid, kind)) lo = mid;
    else hi = mid;
  }
  const suggest = Math.floor(lo * 10) / 10;
  const a = kind === "fillet" ? "A" : "A";
  throw new KernelError(
    "fillet-too-large",
    suggest > 0
      ? `${a} ${mm(r)} ${word} does not fit here. Try ${mm(suggest)} or less.`
      : `${a} ${word} does not fit on ${edges.length === 1 ? "this edge" : "these edges"}.`,
  );
}

type V3 = [number, number, number];
const v3 = (p: { X(): number; Y(): number; Z(): number }): V3 => [p.X(), p.Y(), p.Z()];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** A face's surface, with which side of it the body is on. Only planes and cylinders, the faces extrudes make. */
type Side = { kind: "plane"; point: V3; out: V3 } | { kind: "cylinder"; point: V3; axis: V3; radius: number; inside: boolean };

function sideOf(oc: OC, face: TopoDS_Face): Side | null {
  const surf = new oc.BRepAdaptor_Surface(face, true);
  const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
  const type = surf.GetType();
  let side: Side | null = null;
  if (type === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
    const pl = surf.Plane();
    side = { kind: "plane", point: v3(pl.Location()), out: scale3(v3(pl.Axis().Direction()), reversed ? -1 : 1) };
  } else if (type === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
    const cyl = surf.Cylinder();
    const ax = cyl.Axis();
    // The surface's own normal points away from the axis on a right-handed cylinder; a reversed face, or a left-handed
    // one, faces the axis instead, so the body is outside it: a hole.
    const inside = reversed === !cyl.Position().Direct();
    side = { kind: "cylinder", point: v3(ax.Location()), axis: v3(ax.Direction()), radius: cyl.Radius(), inside };
  }
  surf.delete();
  return side;
}

/** How far a point is off a surface. */
function offSurface(s: Side, p: V3): number {
  const d = sub3(p, s.point);
  if (s.kind === "plane") return Math.abs(dot3(d, s.out));
  const along = dot3(d, s.axis);
  return Math.abs(len3(sub3(d, scale3(s.axis, along))) - s.radius);
}

const sameSide = (a: Side, b: Side) =>
  a.kind === b.kind &&
  offSurface(a, b.point) < 1e-7 &&
  (a.kind === "plane"
    ? Math.abs(dot3(a.out, (b as typeof a).out) - 1) < 1e-9
    : Math.abs(Math.abs(dot3(a.axis, (b as typeof a).axis)) - 1) < 1e-9 && Math.abs(a.radius - (b as typeof a).radius) < 1e-7);

/** A solid covering everything on the body's side of a surface, `reach` wide about `centre`. */
function halfSpace(oc: OC, s: Side, centre: V3, reach: number): TopoDS_Shape {
  if (s.kind === "plane") {
    const n = s.out;
    const seed: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = cross3(n, seed);
    const un = scale3(u, 1 / len3(u));
    const vn = cross3(n, un);
    const c = sub3(centre, scale3(n, dot3(sub3(centre, s.point), n)));
    const corner = (a: number, b: number) => add3(add3(c, scale3(un, a * reach)), scale3(vn, b * reach));
    return prism(oc, polygonFace(oc, [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]), scale3(n, -reach));
  }
  const d = sub3(centre, s.point);
  const base = add3(add3(s.point, scale3(s.axis, dot3(d, s.axis))), scale3(s.axis, -reach));
  const ax = new oc.gp_Ax2(new oc.gp_Pnt(...base), new oc.gp_Dir(...s.axis));
  const mk = new oc.BRepPrimAPI_MakeCylinder(ax, s.radius, 2 * reach);
  const cyl = mk.Shape();
  mk.delete();
  if (s.inside) return cyl;
  const big = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(centre[0] - reach, centre[1] - reach, centre[2] - reach), 2 * reach, 2 * reach, 2 * reach).Shape();
  return boolean(oc, "cut", big, [cyl]);
}

/**
 * Rounds or bevels edges OpenCascade's fillet cannot: it gives up where an edge ends at a corner it cannot close,
 * as at the end of a face pinched between other faces. Each picked edge lies between two faces; the part of the body
 * on both of their sides is carved off, rounded on its own (where the edge runs on, uninterrupted, as far as the two
 * surfaces meet: a whole circle on a rim), and put back. That is the round a ball rolling along the two faces would
 * leave, trimmed by the rest of the body, which is what other CAD tools draw. Null when the edges are not between
 * planes and cylinders or the round still fails.
 */
function localBlend(oc: OC, shape: TopoDS_Shape, edges: TopoDS_Edge[], r: number, kind: "fillet" | "chamfer", t?: Tracker): TopoDS_Shape | null {
  try {
    const faces = elements(oc, shape, "face");
    const sides = faces.map((f) => sideOf(oc, oc.TopoDS.Face(f)));
    // Group the picked edges by the pair of surfaces they lie between.
    const groups: [Side, Side][] = [];
    for (const e of edges) {
      const pair: Side[] = [];
      faces.forEach((f, i) => {
        const ex = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        for (; ex.More(); ex.Next()) {
          if (ex.Current().IsSame(e)) {
            const s = sides[i];
            if (s && !pair.some((p) => sameSide(p, s))) pair.push(s);
            break;
          }
        }
        ex.delete();
      });
      if (pair.length !== 2) return null;
      if (!groups.some(([a, b]) => (sameSide(a, pair[0]!) && sameSide(b, pair[1]!)) || (sameSide(a, pair[1]!) && sameSide(b, pair[0]!))))
        groups.push([pair[0]!, pair[1]!]);
    }
    const { bbox } = measure(oc, shape);
    const centre: V3 = [0, 1, 2].map((i) => (bbox.min[i]! + bbox.max[i]!) / 2) as V3;
    const reach = 2 * len3(sub3(bbox.max, bbox.min)) + 1;
    const tol = 1e-6 * reach;
    let out = shape;
    for (const [a, b] of groups) {
      const piece = boolean(oc, "intersect", out, [halfSpace(oc, a, centre, reach), halfSpace(oc, b, centre, reach)], t);
      // The edges of the piece along both surfaces: the picked edge, run on as far as it goes.
      const along = elements(oc, piece, "edge").filter((e) => {
        const edge = oc.TopoDS.Edge(e);
        if (oc.BRep_Tool.Degenerated(edge)) return false;
        const c = new oc.BRepAdaptor_Curve(edge);
        const p0 = c.FirstParameter();
        const p1 = c.LastParameter();
        const on = [p0, (p0 + p1) / 2, p1].every((u) => {
          const p = v3(c.EvalD0(u));
          return offSurface(a, p) < tol && offSurface(b, p) < tol;
        });
        c.delete();
        return on;
      });
      if (!along.length) return null;
      const rounded = tryBlend(
        oc,
        piece,
        along.map((e) => oc.TopoDS.Edge(e)),
        r,
        kind,
        t,
      );
      if (!rounded) return null;
      let rest: TopoDS_Shape | null;
      try {
        rest = boolean(oc, "cut", out, [piece], t);
      } catch (e) {
        if (!(e instanceof KernelError && e.code === "empty-result")) throw e;
        rest = null;
      }
      out = rest ? boolean(oc, "join", rest, [rounded], t) : rounded;
    }
    return valid(oc, out) ? out : null;
  } catch {
    return null;
  }
}

/** Hollows a solid to a wall `thickness`, leaving the faces given open. */
export function shell(oc: OC, shape: TopoDS_Shape, openFaces: number[], thickness: number, outside = false, t?: Tracker): TopoDS_Shape {
  if (!(thickness > 0)) throw new KernelError("invalid-size", "A shell needs a wall above 0 mm.");
  const faces = elements(oc, shape, "face");
  const list = new oc.NCollection_List_TopoDS_Shape();
  for (const i of openFaces) {
    const f = faces[i];
    if (!f) throw new KernelError("reference-missing", "A face picked to leave open is not there any more. Pick it again.");
    list.Append(f);
  }
  return guard(oc, "failed", `A ${mm(thickness)} wall does not fit inside this body. Try a thinner wall.`, () => {
    const mk = new oc.BRepOffsetAPI_MakeThickSolid();
    // Inside keeps the outer size; outside grows the body by the wall.
    mk.MakeThickSolidByJoin(shape, list, outside ? thickness : -thickness, 1e-3);
    mk.Build(progress(oc));
    if (!mk.IsDone()) throw new KernelError("failed", `A ${mm(thickness)} wall does not fit inside this body. Try a thinner wall.`);
    let out = mk.Shape();
    // With nothing left open, OCCT gives the offset solid alone: the sealed hollow is the space between the two.
    if (!openFaces.length) {
      const offset = count(oc, out, "solid") ? out : solidOfShell(oc, out);
      out = outside ? boolean(oc, "cut", offset, [shape], t) : boolean(oc, "cut", shape, [offset], t);
    } else t?.step(mk, [shape], out, { word: "shell", offset: true });
    if (!valid(oc, out)) throw new KernelError("non-manifold", `A ${mm(thickness)} wall does not fit inside this body. Try a thinner wall.`);
    return out;
  });
}

/**
 * A solid grown by `gap` on every side (#183), so a cut leaves room for a printed part to fit. Flat faces move out and
 * meet at sharp corners, so a 10 mm cube grown by 0.25 mm is a 10.5 mm cube.
 */
export function grow(oc: OC, shape: TopoDS_Shape, gap: number): TopoDS_Shape {
  if (!(gap > 0)) return shape;
  const why = `This body can't be grown by ${mm(gap)} for its fit. Try a smaller gap or a simpler shape.`;
  return guard(oc, "failed", why, () => {
    const mk = new oc.BRepOffsetAPI_MakeOffsetShape();
    mk.PerformByJoin(shape, gap, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false, progress(oc));
    if (!mk.IsDone()) throw new KernelError("failed", why);
    const out = mk.Shape();
    const solid = count(oc, out, "solid") ? out : solidOfShell(oc, out);
    if (!valid(oc, solid)) throw new KernelError("non-manifold", why);
    return solid;
  });
}

/**
 * The body shrunk by `d` on every side (#174): the core a slicer fills at the infill percentage. Null when the offset
 * can't be made or leaves nothing (a body thinner than twice `d`).
 */
export function inset(oc: OC, shape: TopoDS_Shape, d: number): TopoDS_Shape | null {
  try {
    const mk = new oc.BRepOffsetAPI_MakeOffsetShape();
    mk.PerformByJoin(shape, -d, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false, progress(oc));
    if (!mk.IsDone()) return null;
    const out = mk.Shape();
    const solid = count(oc, out, "solid") ? out : solidOfShell(oc, out);
    return valid(oc, solid) ? solid : null;
  } catch {
    return null;
  }
}

/** A closed shell (what a sealed offset comes back as) made into a solid. */
function solidOfShell(oc: OC, shape: TopoDS_Shape): TopoDS_Shape {
  const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  if (!ex.More()) throw new KernelError("failed", "That wall could not be made.");
  const mk = new oc.BRepBuilderAPI_MakeSolid(oc.TopoDS.Shell(ex.Current()));
  const solid = mk.Solid();
  ex.delete();
  // Make sure it faces outward, so the cut takes the inside away.
  const fix = new oc.ShapeFix_Solid(solid);
  fix.Perform(progress(oc));
  return fix.Solid();
}

/** Whether a shape is a valid solid; tries ShapeFix once if not. */
export function valid(oc: OC, shape: TopoDS_Shape): boolean {
  const check = new oc.BRepCheck_Analyzer(shape, true, false);
  const ok = check.IsValid();
  check.delete();
  return ok;
}

export interface Measure {
  volume: number;
  area: number;
  centroid: [number, number, number];
  /** Inertia about the centroid at unit density, mm⁵, as [ixx, iyy, izz, ixy, ixz, iyz] tensor entries (#174). */
  inertia: [number, number, number, number, number, number];
  bbox: { min: [number, number, number]; max: [number, number, number] };
  solids: number;
  faces: number;
  edges: number;
  vertices: number;
}

/** Exact properties from the B-rep, never from a mesh (#49). */
export function measure(oc: OC, shape: TopoDS_Shape): Measure {
  const props = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
  const c = props.CentreOfMass();
  const volume = props.Mass();
  const surf = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(shape, surf, false, false);
  // gp_Mat isn't bound, so the tensor comes from moments about six axes through the centre of mass: the three axes give
  // the diagonal, and the diagonals between two axes give the products, I(u) = (Iaa + Ibb)/2 + Iab for u = (a + b)/√2.
  const about = (x: number, y: number, z: number) => {
    const ax = new oc.gp_Ax1(c, new oc.gp_Dir(x, y, z));
    const v = props.MomentOfInertia(ax);
    ax.delete();
    return v;
  };
  const [ixx, iyy, izz] = [about(1, 0, 0), about(0, 1, 0), about(0, 0, 1)];
  const product = (a: number, b: number, u: number) => u - (a + b) / 2;
  const inertia: Measure["inertia"] = [ixx, iyy, izz, product(ixx, iyy, about(1, 1, 0)), product(ixx, izz, about(1, 0, 1)), product(iyy, izz, about(0, 1, 1))];
  const out: Measure = {
    volume,
    area: surf.Mass(),
    centroid: [c.X(), c.Y(), c.Z()],
    inertia,
    bbox: boundingBox(oc, shape),
    solids: count(oc, shape, "solid"),
    faces: count(oc, shape, "face"),
    edges: count(oc, shape, "edge"),
    vertices: count(oc, shape, "vertex"),
  };
  props.delete();
  surf.delete();
  return out;
}

/**
 * Everything of `shape` on the front of a plane (where its normal points), as a box that reaches past the shape on every
 * side: the tool a Split body (#406) cuts with or keeps. A shape wholly on one side gives an empty half, so it fails.
 */
export function frontOf(oc: OC, shape: TopoDS_Shape, plane: Plane): TopoDS_Shape {
  const { min, max } = boundingBox(oc, shape);
  const n = [plane.normal.x, plane.normal.y, plane.normal.z];
  const len = Math.hypot(n[0]!, n[1]!, n[2]!);
  if (len < 1e-9) throw new KernelError("failed", "The plane has no direction");
  const N = n.map((v) => v / len) as [number, number, number];
  const o = [plane.origin.x, plane.origin.y, plane.origin.z];
  const c = [0, 1, 2].map((i) => (min[i]! + max[i]!) / 2);
  const d = c.reduce((a, v, i) => a + (v - o[i]!) * N[i]!, 0);
  // The middle of the shape's box, dropped onto the plane: the box is centred there.
  const at = c.map((v, i) => v - d * N[i]!);
  const reach = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) + Math.abs(d) + 10;
  // Two directions in the plane, square to the normal and each other.
  const a = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const dotA = a[0]! * N[0] + a[1]! * N[1] + a[2]! * N[2];
  const xr = a.map((v, i) => v - dotA * N[i]!);
  const xl = Math.hypot(xr[0]!, xr[1]!, xr[2]!);
  const X = xr.map((v) => v / xl);
  const Y = [N[1] * X[2]! - N[2] * X[1]!, N[2] * X[0]! - N[0] * X[2]!, N[0] * X[1]! - N[1] * X[0]!];
  const mk = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(-reach, -reach, 0), 2 * reach, 2 * reach, reach);
  const local = mk.Shape();
  mk.delete();
  const t = new oc.gp_Trsf();
  t.SetValues(X[0]!, Y[0]!, N[0], at[0]!, X[1]!, Y[1]!, N[1], at[1]!, X[2]!, Y[2]!, N[2], at[2]!);
  const moved = new oc.BRepBuilderAPI_Transform(local, t, true, false).Shape();
  t.delete();
  return moved;
}

/** The box round a shape, tight to the exact geometry (the plain one adds tolerances and control points). */
export function boundingBox(oc: OC, shape: TopoDS_Shape): Measure["bbox"] {
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin();
  const hi = box.CornerMax();
  const out: Measure["bbox"] = { min: [lo.X(), lo.Y(), lo.Z()], max: [hi.X(), hi.Y(), hi.Z()] };
  box.delete();
  return out;
}

export type { TopoDS_Shape };
