import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { readStep } from "./export";
import { elements } from "./shapes";
import { KernelError } from "../errors";
import { read3mf, readStl } from "../export/mesh";
import type { ImportFormat } from "../imports";

/**
 * Imports (#82): STEP files come in as exact solids; STL and 3MF meshes are sewn into a solid from their triangles
 * so they can be moved, measured and combined, but not filleted.
 */

export interface ImportedBody {
  name: string;
  shape: TopoDS_Shape;
  /** A mesh with gaps: it stays a shell, which can't be combined. */
  open: boolean;
  triangles?: number;
  /** How far the builder moved it from where the file had it, to stand it on its own origin. */
  at?: { x: number; y: number; z: number };
}

/** Sews triangles into a closed solid, or an open shell when they don't close. */
export function meshSolid(oc: OC, t: Float32Array): { shape: TopoDS_Shape; open: boolean } {
  const sewing = new oc.BRepBuilderAPI_Sewing(1e-4, true, true, true, false);
  const pts: unknown[] = [];
  try {
    for (let i = 0; i < t.length; i += 9) {
      const a = new oc.gp_Pnt(t[i]!, t[i + 1]!, t[i + 2]!);
      const b = new oc.gp_Pnt(t[i + 3]!, t[i + 4]!, t[i + 5]!);
      const c = new oc.gp_Pnt(t[i + 6]!, t[i + 7]!, t[i + 8]!);
      pts.push(a, b, c);
      // Skip slivers: two corners in the same place make no face.
      if (a.Distance(b) < 1e-7 || b.Distance(c) < 1e-7 || c.Distance(a) < 1e-7) continue;
      const e1 = new oc.BRepBuilderAPI_MakeEdge(a, b);
      const e2 = new oc.BRepBuilderAPI_MakeEdge(b, c);
      const e3 = new oc.BRepBuilderAPI_MakeEdge(c, a);
      const w = new oc.BRepBuilderAPI_MakeWire(e1.Edge(), e2.Edge(), e3.Edge());
      const f = new oc.BRepBuilderAPI_MakeFace(w.Wire(), true);
      if (f.IsDone()) sewing.Add(f.Face());
      for (const x of [e1, e2, e3, w, f]) x.delete();
    }
    sewing.Perform(new oc.Message_ProgressRange());
    const sewn = sewing.SewedShape();
    const open = sewing.NbFreeEdges() > 0;
    const shells = elements(oc, sewn, "shell");
    if (open || shells.length !== 1) return { shape: sewn, open: true };
    const fix = new oc.ShapeFix_Solid();
    let solid: TopoDS_Shape = fix.SolidFromShell(oc.TopoDS.Shell(shells[0]!));
    fix.delete();
    // Flat runs of triangles become one face each, so a printed cube reads as six faces, not twelve.
    const unify = new oc.ShapeUpgrade_UnifySameDomain(solid, true, true, false);
    try {
      unify.Build();
      solid = unify.Shape();
    } catch {
      // Keep the triangles as faces.
    } finally {
      unify.delete();
    }
    return { shape: solid, open: false };
  } finally {
    sewing.delete();
    for (const p of pts) (p as { delete(): void }).delete();
  }
}

/** The bodies in an imported file. */
export function readImport(oc: OC, format: ImportFormat, data: Uint8Array, base: string): ImportedBody[] {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  if (format === "step") {
    const bodies = readStep(oc, data);
    return bodies.map((b, i) => ({ name: bodies.length === 1 ? base : `${base} ${i + 1}`, shape: b.shape, open: false }));
  }
  const meshes = format === "stl" ? [{ name: base, triangles: readStl(buf) }] : read3mf(buf);
  if (!meshes.length) throw new KernelError("failed", "That file has no shapes in it.");
  return meshes.map((m) => ({ name: format === "stl" || !m.name ? base : m.name, ...meshSolid(oc, m.triangles), triangles: m.triangles.length / 9 }));
}

/** The triangles of one body of a mesh file, as the file has them (#437), or null for a STEP file. */
export function importTriangles(format: ImportFormat, data: Uint8Array, index: number): Float32Array | null {
  if (format === "step") return null;
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return format === "stl" ? (index === 0 ? readStl(buf) : null) : (read3mf(buf)[index]?.triangles ?? null);
}
