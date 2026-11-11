import { partKey, type ModelBuilder } from "./model";
import type { OC } from "./oc";
import { triangles, writeStep } from "./export";
import { build, poseNesting, type ModelDoc, type Part } from "../document";
import { linkTransforms, type Mat4 } from "../pose";
import { resolvePose } from "../drivelinks";
import { boxCentre, placeOnBed, stlBytes, triangleCount, write3mf, writeStl, type MeshBody } from "../export/mesh";
import { gltfBytes, writeGlb, writeGltf } from "../export/gltf";
import { fileName } from "../bcad";
import { pbrOf } from "../looks";
import { KernelError } from "../errors";
import { buildUrdf } from "../export/urdf";
import { zip } from "../export/zip";

/**
 * glb and gltf (#195) are for Blender and web viewers: metres, Y up, a node and material per body. urdf (#175) is the
 * robot for Snakie, ROS, MuJoCo and Gazebo: a .zip of the .urdf and one STL per link.
 */
export type ExportFormat = "stl" | "3mf" | "step" | "glb" | "gltf" | "urdf";

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
  /** URDF only: mesh paths as `package://<robot>/meshes/…` for a ROS package. */
  rosPackage?: boolean;
}

export interface ExportEstimate {
  triangles: number;
  bytes: number;
  solids: number;
  /** Hole shapes that aren't grouped with a solid, which are left out. */
  skipped: number;
}

export interface ExportResult {
  /**
   * `centre` (mesh formats): the middle of the file's bodies where they sit in the model, in mm, before any move onto
   * the bed, so an assembly can put the part back where it goes. `parts`: the ids of the bodies in it.
   */
  files: { name: string; data: ArrayBuffer; centre?: [number, number, number]; parts?: string[] }[];
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
    const built = build(r.doc, r.upTo);
    const { parts, joints, links, drives } = built;
    const components = poseNesting(built);
    // Each body's move from home, when posed: its link's.
    const moves = new Map<string, Mat4>();
    if (r.posed && r.doc.pose) {
      const byLink = linkTransforms(joints, resolvePose(drives, r.doc.pose), components);
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

  /**
   * The robot (#175): every body that isn't a hole, at home, in its link. Reference bodies go in too, since a servo
   * bought rather than printed still has a shape and a weight.
   */
  private robot(r: ExportRequest & { name: string }, cancelled: () => boolean) {
    const { parts, links, joints, drives } = build(r.doc, r.upTo);
    if (!joints.length) throw new KernelError("failed", "Add a joint first to export a robot.");
    const linkOf = new Map<string, string>();
    for (const l of links) for (const id of l.parts) linkOf.set(id, l.id);
    const masses = new Map(this.model.mass(r.doc, r.upTo).map((m) => [m.id, m]));
    const bodies = parts
      .filter((p) => !p.hole)
      .map((p) => {
        if (cancelled()) throw new KernelError("cancelled", "Stopped.");
        return { id: p.id, name: p.name, link: linkOf.get(p.id), colour: p.colour, triangles: this.mesh(p, r.deflection).triangles, mass: masses.get(p.id) };
      });
    if (!bodies.length) throw new KernelError("failed", "There is nothing to export yet.");
    return buildUrdf(bodies, links, joints, { name: r.name, rosPackage: r.rosPackage, drives });
  }

  estimate(r: ExportRequest, cancelled: () => boolean = () => false): ExportEstimate {
    if (r.format === "urdf") {
      const out = this.robot({ ...r, name: "robot" }, cancelled);
      const n = out.links.reduce((a, l) => a + l.triangles.length / 9, 0);
      return { triangles: n, bytes: stlBytes(n) + out.urdf.length, solids: out.links.length, skipped: 0 };
    }
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
    if (r.format === "urdf") {
      const out = this.robot(r, cancelled);
      const files = [
        { name: `${out.robot}/${out.robot}.urdf`, data: new TextEncoder().encode(out.urdf) },
        ...out.links.map((l) => ({ name: `${out.robot}/${l.mesh}`, data: new Uint8Array(writeStl(l.name, [l])) })),
      ];
      const data = zip(files);
      return {
        files: [{ name: fileName(r.name, ".zip"), data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer }],
        triangles: out.links.reduce((a, l) => a + l.triangles.length / 9, 0),
        skipped: 0,
      };
    }
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
      const centre = boxCentre(bodies) ?? undefined;
      if (!r.keepPosition) bodies = placeOnBed(bodies);
      total += triangleCount(bodies);
      if (r.format === "gltf") {
        const bin = g.file.replace(/\.gltf$/, ".bin");
        const out = writeGltf(r.name, bodies, bin);
        files.push({ name: g.file, data: out.gltf }, { name: bin, data: out.bin });
      } else if (r.format === "glb") files.push({ name: g.file, data: writeGlb(r.name, bodies) });
      else
        files.push({ name: g.file, data: r.format === "stl" ? writeStl(r.name, bodies) : write3mf(r.name, bodies), centre, parts: g.parts.map((p) => p.id) });
    }
    return { files, triangles: total, skipped };
  }
}
