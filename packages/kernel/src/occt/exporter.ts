import { partKey, type ModelBuilder } from "./model";
import type { OC } from "./oc";
import { triangles, writeStep } from "./export";
import { build, type ModelDoc, type Part } from "../document";
import { placeOnBed, stlBytes, triangleCount, write3mf, writeStl, type MeshBody } from "../export/mesh";
import { fileName } from "../bcad";
import { KernelError } from "../errors";

export type ExportFormat = "stl" | "3mf" | "step";

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

  private pick(r: ExportRequest): { parts: Part[]; skipped: number } {
    const { parts } = build(r.doc, r.upTo);
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
    return { parts: solid, skipped: wanted.length - solid.length };
  }

  private mesh(p: Part, deflection: number): MeshBody {
    const shape = this.model.solid(p).shape;
    const k = `${partKey(p, "fine")}@${deflection}`;
    let t = this.tris.get(k);
    if (!t) {
      t = triangles(this.oc, shape, deflection);
      if (this.tris.size > 200) this.tris.clear();
      this.tris.set(k, t);
    }
    return { name: p.name, triangles: t };
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
    return { triangles: n, bytes: r.format === "stl" ? stlBytes(n) : Math.round(n * 70 + 1500), solids: parts.length, skipped };
  }

  export(r: ExportRequest & { name: string }, cancelled: () => boolean = () => false): ExportResult {
    const { parts, skipped } = this.pick(r);
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
            g.parts.map((p) => ({ name: p.name, shape: this.model.solid(p).shape })),
          ),
        });
        continue;
      }
      let bodies = g.parts.map((p) => this.mesh(p, r.deflection));
      if (!r.keepPosition) bodies = placeOnBed(bodies);
      total += triangleCount(bodies);
      files.push({ name: g.file, data: r.format === "stl" ? writeStl(r.name, bodies) : write3mf(r.name, bodies) });
    }
    return { files, triangles: total, skipped };
  }
}
