import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { elements } from "./shapes";
import { KernelError } from "../errors";

/**
 * From the exact B-rep to files (#80, #81): triangles at an absolute deflection for STL and 3MF, and STEP AP214
 * through OCCT's writer with each body's name. Nothing here reads the viewport's meshes.
 */

export { DEFLECTION, type Resolution } from "./deflection";

/** The triangles of a shape, 9 numbers each, wound outward. */
export function triangles(oc: OC, shape: TopoDS_Shape, deflection: number): Float32Array {
  oc.BRepTools.Clean(shape, true);
  const mesher = new oc.BRepMesh_IncrementalMesh(shape, Math.max(deflection, 1e-4), false, 0.35, false);
  mesher.delete();
  const out: number[] = [];
  const reversed = oc.TopAbs_Orientation.TopAbs_REVERSED;
  for (const f of elements(oc, shape, "face")) {
    const face = oc.TopoDS.Face(f);
    const loc = new oc.TopLoc_Location();
    const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
    if (!tri || (tri as unknown as { isNull?: () => boolean }).isNull?.()) {
      loc.delete();
      continue;
    }
    const trsf = loc.Transformation();
    const flip = face.Orientation() === reversed;
    const pts: number[] = [];
    for (let i = 1; i <= tri.NbNodes(); i++) {
      const p = tri.Node(i).Transformed(trsf);
      pts.push(p.X(), p.Y(), p.Z());
      p.delete();
    }
    for (let i = 1; i <= tri.NbTriangles(); i++) {
      const t = tri.Triangle(i);
      const a = t.Value(1) - 1;
      const b = t.Value(flip ? 3 : 2) - 1;
      const c = t.Value(flip ? 2 : 3) - 1;
      for (const k of [a, b, c]) out.push(pts[k * 3]!, pts[k * 3 + 1]!, pts[k * 3 + 2]!);
      t.delete();
    }
    loc.delete();
  }
  return Float32Array.from(out);
}

const TMP = "/bettercad-export.step";

/** STEP AP214 in millimetres, one named solid per body. */
export function writeStep(oc: OC, bodies: { name: string; shape: TopoDS_Shape }[]): ArrayBuffer {
  oc.Interface_Static.SetCVal("write.step.schema", "AP214IS");
  oc.Interface_Static.SetCVal("write.step.unit", "MM");
  oc.Interface_Static.SetIVal("write.precision.mode", 1);
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString("MDTV-XCAF", true));
  oc.XCAFDoc_ShapeTool.SetAutoNaming(false);
  const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
  for (const b of bodies) {
    const label = tool.AddShape(b.shape, false, false);
    oc.TDataStd_Name.Set(label, new oc.TCollection_ExtendedString(b.name, true));
  }
  const ws = new oc.XSControl_WorkSession();
  const writer = new oc.STEPCAFControl_Writer(ws, false);
  const progress = new oc.Message_ProgressRange();
  try {
    // Perform transfers and writes in one go, into the one file (Transfer with a name would write a file per body).
    if (!writer.Perform(doc, TMP, progress)) throw new KernelError("failed", "The STEP file could not be written.");
    const bytes = oc.FS.readFile(TMP);
    oc.FS.unlink(TMP);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } finally {
    progress.delete();
    writer.delete();
  }
}

/** Reads a STEP file into its solids (#82 uses this; export's round-trip test does too). */
export function readStep(oc: OC, data: ArrayBuffer | Uint8Array, progress?: (fraction: number) => void): { name: string; shape: TopoDS_Shape }[] {
  const path = "/bettercad-import.step";
  oc.FS.writeFile(path, data instanceof Uint8Array ? data : new Uint8Array(data));
  const reader = new oc.STEPControl_Reader();
  try {
    progress?.(0.05);
    if (reader.ReadFile(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new KernelError("failed", "That STEP file could not be read.");
    // Reading the text is about half the work; making the solids, root by root, is the rest.
    progress?.(0.5);
    const roots = reader.NbRootsForTransfer();
    for (let i = 1; i <= roots; i++) {
      const range = new oc.Message_ProgressRange();
      reader.TransferRoot(i, range);
      range.delete();
      progress?.(0.5 + (0.45 * i) / roots);
    }
    const list: TopoDS_Shape[] = [];
    for (let i = 1; i <= reader.NbShapes(); i++) {
      const shape = reader.Shape(i);
      const solids = elements(oc, shape, "solid");
      // Copies, so the solids outlive the reader.
      for (const x of solids.length ? solids : [shape]) list.push(x.Moved(new oc.TopLoc_Location(), false));
    }
    if (!list.length) throw new KernelError("failed", "That STEP file has no solids in it.");
    return list.map((s, i) => ({ name: `Imported ${i + 1}`, shape: s }));
  } finally {
    reader.delete();
    oc.FS.unlink(path);
  }
}
