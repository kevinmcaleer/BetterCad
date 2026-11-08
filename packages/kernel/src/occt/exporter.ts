import { partKey, type ModelBuilder } from "./model";
import type { OC } from "./oc";
import { triangles, writeStep } from "./export";
import { build, type ModelDoc, type Part } from "../document";
import { linkTransforms, type Mat4 } from "../pose";
import { placeOnBed, stlBytes, triangleCount, write3mf, writeStl, type MeshBody } from "../export/mesh";
import { gltfBytes, writeGlb, writeGltf } from "../export/gltf";
import { fileName } from "../bcad";
import { pbrOf } from "../looks";
import { KernelError } from "../errors";

/** glb and gltf (#195) are for Blender and web viewers: metres, Y up, a node and material per body. */
export type ExportFormat = "stl" | "3mf" | "step" | "glb" | "gltf";

export interface ExportRequest {
  doc: ModelDoc;
  upTo?: number;
  /** The bodies to export; null for all of them. */
  bodies: string[] | null;
  format: ExportFormat;
  /** mm; ignored for STEP, which is exact. */
  deflection: number;
  /** One file per body instead of one for all. */
  separate?: boolean;
  /** Leave bodies where they are instead of putting the lowest point on Z = 0. */
  keepPosition?: boolean;
  /** Export the bodies as the joints are posed (#173) instead of at home. */
  posed?: boolean;
}

export interface ExportEstimate {
  triangles: number;
  bytes: number;
  solids: number;
  /** Hole shapes that aren't grouped with a solid, which are left out. */
  skipped: number;
}

export interface ExportResult {
  files: { name: string; data: ArrayBuffer }[];
  triangles: number;
  skipped: number;
}

/** Where the B-rep turns into export files, reusing the builder's solids and keeping each body's triangles for the next call. */
export class Exporter {
  private tris = new Map<string, Float32Array>();

  constructor(
    private oc: OC,
    private model: ModelBuilder,
  ) {}

  private pick(r: ExportRequest): { parts: Part[]; skipped: number; moves: Map<string, Mat4> } {
    const { parts, joints, links } = build(r.doc, r.upTo);
    // Each body's move from home, when posed: its link's.
    const moves = new Map<string, Mat4>();
    if (r.posed && r.doc.pose) {
      const byLink = linkTransforms(joints, r.doc.pose);
      for (const l of links) {
        const m = byLink.get(l.id);
        if (m) for (const id of l.parts) moves.set(id, m);
      }
    }
    const wanted = r.bodies ? parts.filter((p) => r.bodies!.includes(p.id)) : parts;
    const solid = wanted.filter((p) => !p.hole && !p.reference);
    if (!solid.length) {
      const why = !wanted.length
        ? "There is nothing to export yet."
        : wanted.every((p) => p.reference)
          ? "Reference bodies aren't exported. Turn off Reference in Properties to export one."
          : "Only hole shapes are chosen. Group them with a solid first.";
      throw new KernelError("failed", why);
    }
    return { parts: solid, skipped: wanted.length - solid.length, moves };
  }

  /** A body's solid, moved to its pose when it has one. */
  private shape(p: Part, move?: Mat4) {
    const shape = this.model.solid(p).shape;
    if (!move) return shape;
    const t = new this.oc.gp_Trsf();
    const m = move;
    t.SetValues(m[0]!, m[4]!, m[8]!, m[12]!, m[1]!, m[5]!, m[9]!, m[13]!, m[2]!, m[6]!, m[10]!, m[14]!);
    return new this.oc.BRepBuilderAPI_Transform(shape, t, true, false).Shape();
  }

  /** A body's triangles, moved to its pose when it has one. */
  private posedMesh(p: Part, deflection: number, move?: Mat4) {
    const b = this.mesh(p, deflection);
    if (!move) return b;
    const t = b.triangles;
    const out = new Float32Array(t.length);
    const m = move;
    for (let i = 0; i < t.length; i += 3) {
      const x = t[i]!;
      const y = t[i + 1]!;
      const z = t[i + 2]!;
      out[i] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      out[i + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      out[i + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    }
    return { ...b, triangles: out };
  }

  private mesh(p: Part, deflection: number): MeshBody & { look: ReturnType<typeof pbrOf> } {
    const shape = this.model.solid(p).shape;
    const k = `${partKey(p, "fine")}@${deflection}`;
    let t = this.tris.get(k);
    if (!t) {
      t = triangles(this.oc, shape, deflection);
      if (this.tris.size > 200) this.tris.clear();
      this.tris.set(k, t);
    }
    return { name: p.name, triangles: t, look: pbrOf(p) };
  }

  estimate(r: ExportRequest, cancelled: () => boolean = () => false): ExportEstimate {
    const { parts, skipped } = this.pick(r);
    if (r.format === "step") return { triangles: 0, bytes: 0, solids: parts.length, skipped };
    let n = 0;
    for (const p of parts) {
      if (cancelled()) throw new KernelError("cancelled", "Stopped.");
      n += this.mesh(p, r.deflection).triangles.length / 9;
    }
    // A 3MF shares corners between triangles (about half as many corners as triangles), as text.
    const bytes = r.format === "stl" ? stlBytes(n) : r.format === "3mf" ? Math.round(n * 70 + 1500) : gltfBytes(n);
    return { triangles: n, bytes, solids: parts.length, skipped };
  }

  export(r: ExportRequest & { name: string }, cancelled: () => boolean = () => false): ExportResult {
    const { parts, skipped, moves } = this.pick(r);
    const ext = `.${r.format}`;
    const groups: { file: string; parts: Part[] }[] =
      r.separate && parts.length > 1
        ? parts.map((p) => ({ file: fileName(`${r.name}-${p.name}`, ext), parts: [p] }))
        : [{ file: fileName(r.name, ext), parts }];
    const files: ExportResult["files"] = [];
    let total = 0;
    for (const g of groups) {
      if (cancelled()) throw new KernelError("cancelled", "Stopped.");
      if (r.format === "step") {
        files.push({
          name: g.file,
          data: writeStep(
            this.oc,
            g.parts.map((p) => ({ name: p.name, shape: this.shape(p, moves.get(p.id)) })),
          ),
        });
        continue;
      }
      let bodies = g.parts.map((p) => this.posedMesh(p, r.deflection, moves.get(p.id)));
      if (!r.keepPosition) bodies = placeOnBed(bodies);
      total += triangleCount(bodies);
      if (r.format === "gltf") {
        const bin = g.file.replace(/\.gltf$/, ".bin");
        const out = writeGltf(r.name, bodies, bin);
        files.push({ name: g.file, data: out.gltf }, { name: bin, data: out.bin });
      } else if (r.format === "glb") files.push({ name: g.file, data: writeGlb(r.name, bodies) });
      else files.push({ name: g.file, data: r.format === "stl" ? writeStl(r.name, bodies) : write3mf(r.name, bodies) });
    }
    return { files, triangles: total, skipped };
  }
}
