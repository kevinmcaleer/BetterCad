import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { elements } from "./shapes";
import { MeshBuilder, type BodyMesh } from "../mesh";

/**
 * B-rep to the triangles, edges and points the viewport draws (#46). Faces, edges and vertices are numbered as
 * `elements()` numbers them, so a pick in the view names the same face the kernel means.
 *
 * Fast: relative deflection (scales with the body), for the view. Fine: 0.01 mm, for export.
 */
export type Quality = "fast" | "fine";

const SETTINGS: Record<Quality, { linear: number; relative: boolean; angular: number }> = {
  fast: { linear: 0.002, relative: true, angular: 0.5 },
  fine: { linear: 0.01, relative: false, angular: 0.1 },
};

export function tessellate(oc: OC, shape: TopoDS_Shape, quality: Quality = "fast"): BodyMesh {
  const q = SETTINGS[quality];
  // Clean first so a shape meshed at another quality is meshed again.
  oc.BRepTools.Clean(shape, true);
  const mesher = new oc.BRepMesh_IncrementalMesh(shape, q.linear, q.relative, q.angular, false);
  mesher.delete();

  const b = new MeshBuilder();
  const faces = elements(oc, shape, "face");
  const reversed = oc.TopAbs_Orientation.TopAbs_REVERSED;
  for (const f of faces) {
    const face = oc.TopoDS.Face(f);
    const loc = new oc.TopLoc_Location();
    const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
    if (!tri || (tri as unknown as { isNull?: () => boolean }).isNull?.()) {
      b.endFace();
      loc.delete();
      continue;
    }
    if (!tri.HasNormals()) oc.BRepLib_ToolTriangulatedShape.ComputeNormals(face, tri);
    const trsf = loc.Transformation();
    const flip = face.Orientation() === reversed;
    const base = b.vertexCount;
    const n = tri.NbNodes();
    for (let i = 1; i <= n; i++) {
      const p = tri.Node(i).Transformed(trsf);
      const d = tri.Normal(i).Transformed(trsf);
      const s = flip ? -1 : 1;
      b.vertex(p.X(), p.Y(), p.Z(), d.X() * s, d.Y() * s, d.Z() * s);
      p.delete();
      d.delete();
    }
    const nt = tri.NbTriangles();
    for (let i = 1; i <= nt; i++) {
      const t = tri.Triangle(i);
      const a = base + t.Value(1) - 1;
      const c = base + t.Value(2) - 1;
      const e = base + t.Value(3) - 1;
      if (flip) b.tri(a, e, c);
      else b.tri(a, c, e);
      t.delete();
    }
    b.endFace();
    loc.delete();
  }

  // Seams (where a cylinder's surface closes on itself) are edges of the B-rep but not lines you would draw.
  // Found face by face (only the edges each face owns), so a body with many faces doesn't check every pair.
  const seamEdges: TopoDS_Shape[] = [];
  for (const f of faces) {
    const face = oc.TopoDS.Face(f);
    const ex = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const e = ex.Current();
      if (oc.BRep_Tool.IsClosed(oc.TopoDS.Edge(e), face) && !seamEdges.some((s) => s.IsSame(e))) seamEdges.push(e);
    }
    ex.delete();
  }
  const seams = (e: TopoDS_Shape) => seamEdges.some((s) => s.IsSame(e));
  for (const e of elements(oc, shape, "edge")) {
    const edge = oc.TopoDS.Edge(e);
    if (oc.BRep_Tool.Degenerated(edge) || seams(e)) {
      b.edge([]);
      continue;
    }
    const pts: number[] = [];
    const curve = new oc.BRepAdaptor_Curve(edge);
    const first = curve.FirstParameter();
    const last = curve.LastParameter();
    const sampler = new oc.GCPnts_TangentialDeflection(curve, first, last, q.angular, quality === "fine" ? 0.01 : 0.05, 2, 1e-9, 0);
    for (let i = 1; i <= sampler.NbPoints(); i++) {
      const p = sampler.Value(i);
      pts.push(p.X(), p.Y(), p.Z());
      p.delete();
    }
    sampler.delete();
    curve.delete();
    b.edge(pts);
  }

  for (const v of elements(oc, shape, "vertex")) {
    const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(v));
    b.point(p.X(), p.Y(), p.Z());
    p.delete();
  }
  return b.build();
}
