import type { TopoDS_Shape, TopoDS_Edge, TopoDS_Face } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { KernelError, mm } from "../errors";
import { toWorld, type Frame, type Vec2 } from "@bettercad/sketch";
import type { PrismSpec, ProfileSeg, RevolveSpec } from "../extrude";
import { holeSection, type HoleSpec } from "../holes";
import type { CopyMove } from "../pattern";

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

/** A closed outline of lines and arcs on a sketch frame, as a wire in world space. */
function outlineWire(oc: OC, spec: { frame: Frame }, segs: ProfileSeg[], lift: number): TopoDS_Shape {
  const f = spec.frame;
  const P = (p: Vec2) => {
    const w = toWorld(f, p);
    return new oc.gp_Pnt(w[0] + f.normal[0] * lift, w[1] + f.normal[1] * lift, w[2] + f.normal[2] * lift);
  };
  const mk = new oc.BRepBuilderAPI_MakeWire();
  for (const g of segs) {
    if (g.kind === "line") mk.Add(new oc.BRepBuilderAPI_MakeEdge(P(g.a), P(g.b)).Edge());
    else if (g.kind === "arc") mk.Add(new oc.BRepBuilderAPI_MakeEdge(new oc.GC_MakeArcOfCircle(P(g.a), P(g.m), P(g.b)).Value()).Edge());
    else {
      const c = P(g.c);
      const circ = new oc.gp_Circ(new oc.gp_Ax2(c, new oc.gp_Dir(f.normal[0], f.normal[1], f.normal[2]), new oc.gp_Dir(f.x[0], f.x[1], f.x[2])), g.r);
      mk.Add(new oc.BRepBuilderAPI_MakeEdge(circ).Edge());
    }
  }
  if (!mk.IsDone()) throw new KernelError("open-profile", "This shape's outline does not join up, so it cannot be extruded.");
  return mk.Wire();
}

/**
 * Extrude (#61): each profile's outline pushed from \`from\` to \`to\` along the frame's normal, its holes cut out, and
 * the profiles joined into one body.
 */
export function prismOf(oc: OC, spec: PrismSpec): TopoDS_Shape {
  const depth = spec.to - spec.from;
  if (!(Math.abs(depth) > 1e-9)) throw new KernelError("invalid-size", "An extrude needs a distance other than 0 mm.");
  const n = spec.frame.normal;
  const v: [number, number, number] = [n[0] * depth, n[1] * depth, n[2] * depth];
  const solidOf = (segs: ProfileSeg[]) =>
    guard(oc, "open-profile", "This shape could not be filled. Check it is closed and does not cross itself.", () => {
      const mk = new oc.BRepBuilderAPI_MakeFace(oc.TopoDS.Wire(outlineWire(oc, spec, segs, spec.from)), true);
      if (!mk.IsDone()) throw new KernelError("open-profile", "This shape could not be filled. Check it is closed and does not cross itself.");
      return prism(oc, mk.Face(), v);
    });
  const bodies = spec.profiles.map((p) => {
    const outer = solidOf(p.outer);
    return p.holes.length ? boolean(oc, "cut", outer, p.holes.map(solidOf)) : outer;
  });
  if (!bodies.length) throw new KernelError("open-profile", "Pick at least one closed shape to extrude.");
  return bodies.length === 1 ? bodies[0]! : boolean(oc, "join", bodies[0]!, bodies.slice(1));
}

/**
 * Revolve (#62): each profile turned round an axis in its sketch plane, holes cut, profiles joined. A symmetric
 * revolve starts half its angle back.
 */
export function revolveOf(oc: OC, spec: RevolveSpec): TopoDS_Shape {
  if (!(spec.angle > 0 && spec.angle <= 360)) throw new KernelError("invalid-size", "A revolve needs an angle from 1° to 360°.");
  const f = spec.frame;
  // An axis above or below the plane (a construction axis or an edge) sits `offset` along the normal.
  const off = spec.axis.offset ?? 0;
  const lift = (p: [number, number, number]): [number, number, number] => [p[0] + f.normal[0] * off, p[1] + f.normal[1] * off, p[2] + f.normal[2] * off];
  const o = lift(toWorld(f, spec.axis.origin));
  const tip = lift(toWorld(f, [spec.axis.origin[0] + spec.axis.dir[0], spec.axis.origin[1] + spec.axis.dir[1]]));
  const dir: [number, number, number] = [tip[0] - o[0], tip[1] - o[1], tip[2] - o[2]];
  const solidOf = (segs: ProfileSeg[]) =>
    guard(oc, "open-profile", "This shape could not be filled. Check it is closed and does not cross itself.", () => {
      const mk = new oc.BRepBuilderAPI_MakeFace(oc.TopoDS.Wire(outlineWire(oc, spec, segs, 0)), true);
      if (!mk.IsDone()) throw new KernelError("open-profile", "This shape could not be filled. Check it is closed and does not cross itself.");
      let face: TopoDS_Shape = mk.Face();
      if (spec.start) {
        const t = new oc.gp_Trsf();
        t.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(...o), new oc.gp_Dir(...dir)), spec.start * DEG);
        face = new oc.BRepBuilderAPI_Transform(face, t, true, false).Shape();
      }
      const out = revolve(oc, face, o, dir, spec.angle);
      return out;
    });
  const bodies = spec.profiles.map((p) => {
    const outer = solidOf(p.outer);
    return p.holes.length ? boolean(oc, "cut", outer, p.holes.map(solidOf)) : outer;
  });
  if (!bodies.length) throw new KernelError("open-profile", "Pick at least one closed shape to revolve.");
  return bodies.length === 1 ? bodies[0]! : boolean(oc, "join", bodies[0]!, bodies.slice(1));
}

/**
 * Push/pull (#65): a flat face pushed along its outward normal by `distance`. Out joins the slab to the body; in
 * cuts it away, so a box grows or shrinks and a pocket fills or deepens.
 */
export function pushPull(oc: OC, shape: TopoDS_Shape, faceIndex: number, distance: number): TopoDS_Shape {
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
  return boolean(oc, distance > 0 ? "join" : "cut", shape, [slab]);
}

/** Cuts screw holes (#70) into a shape: each a revolved section along the face's inward normal. */
export function holes(oc: OC, shape: TopoDS_Shape, spec: HoleSpec): TopoDS_Shape {
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
  return boolean(oc, "cut", shape, tools);
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
  else if ("mirror" in by) {
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
export function boolean(oc: OC, op: BooleanOp, target: TopoDS_Shape, tools: TopoDS_Shape[]): TopoDS_Shape {
  let out = target;
  for (const tool of tools) {
    out = guard(
      oc,
      "boolean-failed",
      op === "join" ? "These bodies could not be joined." : op === "cut" ? "That cut could not be made." : "These bodies could not be intersected.",
      () => {
        const mk =
          op === "join"
            ? new oc.BRepAlgoAPI_Fuse(out, tool, progress(oc))
            : op === "cut"
              ? new oc.BRepAlgoAPI_Cut(out, tool, progress(oc))
              : new oc.BRepAlgoAPI_Common(out, tool, progress(oc));
        mk.Build(progress(oc));
        if (!mk.IsDone()) throw new KernelError("boolean-failed", "That operation could not be worked out. Try moving the bodies slightly.");
        if (op === "join") mk.SimplifyResult(true, true, 1e-6);
        return mk.Shape();
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

/**
 * Every sub-shape of a kind, each once, in a stable order (the face, edge and vertex numbering). This build cannot
 * make OCCT's shape maps, so shared edges and vertices are found by their position first, then IsSame.
 */
export function elements(oc: OC, shape: TopoDS_Shape, kind: ShapeKind): TopoDS_Shape[] {
  const out: TopoDS_Shape[] = [];
  const buckets = new Map<string, TopoDS_Shape[]>();
  const ex = new oc.TopExp_Explorer(shape, abs(oc, kind), oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) {
    const s = ex.Current();
    const key = kind === "edge" || kind === "vertex" ? spot(oc, s, kind) : "";
    const bucket = buckets.get(key);
    if (bucket?.some((b) => b.IsSame(s))) continue;
    if (bucket) bucket.push(s);
    else buckets.set(key, [s]);
    out.push(s);
  }
  ex.delete();
  return out;
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
export function fillet(oc: OC, shape: TopoDS_Shape, edgeIndices: number[], radius: number): TopoDS_Shape {
  return blend(oc, shape, edgeIndices, radius, "fillet");
}

export function chamfer(oc: OC, shape: TopoDS_Shape, edgeIndices: number[], distance: number): TopoDS_Shape {
  return blend(oc, shape, edgeIndices, distance, "chamfer");
}

function tryBlend(oc: OC, shape: TopoDS_Shape, edges: TopoDS_Edge[], r: number, kind: "fillet" | "chamfer"): TopoDS_Shape | null {
  try {
    const mk = kind === "fillet" ? new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational) : new oc.BRepFilletAPI_MakeChamfer(shape);
    for (const e of edges) mk.Add(r, e);
    mk.Build(progress(oc));
    if (!mk.IsDone()) return null;
    const out = mk.Shape();
    return valid(oc, out) ? out : null;
  } catch {
    return null;
  }
}

function blend(oc: OC, shape: TopoDS_Shape, edgeIndices: number[], r: number, kind: "fillet" | "chamfer"): TopoDS_Shape {
  const word = kind === "fillet" ? "fillet" : "chamfer";
  if (!(r > 0)) throw new KernelError("invalid-size", `A ${word} needs a size above 0 mm.`);
  const all = elements(oc, shape, "edge");
  const edges = edgeIndices.map((i) => {
    const e = all[i];
    if (!e) throw new KernelError("reference-missing", `An edge picked for the ${word} is not there any more. Pick it again.`);
    return oc.TopoDS.Edge(e);
  });
  if (!edges.length) throw new KernelError("reference-missing", `Pick at least one edge for the ${word}.`);
  const out = tryBlend(oc, shape, edges, r, kind);
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

/** Hollows a solid to a wall `thickness`, leaving the faces given open. */
export function shell(oc: OC, shape: TopoDS_Shape, openFaces: number[], thickness: number, outside = false): TopoDS_Shape {
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
      out = outside ? boolean(oc, "cut", offset, [shape]) : boolean(oc, "cut", shape, [offset]);
    }
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
  const box = new oc.Bnd_Box();
  // The optimal box is tight to the exact geometry (the plain one adds tolerances and control points).
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  const lo = box.CornerMin();
  const hi = box.CornerMax();
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
    bbox: { min: [lo.X(), lo.Y(), lo.Z()], max: [hi.X(), hi.Y(), hi.Z()] },
    solids: count(oc, shape, "solid"),
    faces: count(oc, shape, "face"),
    edges: count(oc, shape, "edge"),
    vertices: count(oc, shape, "vertex"),
  };
  props.delete();
  surf.delete();
  box.delete();
  return out;
}

export type { TopoDS_Shape };
