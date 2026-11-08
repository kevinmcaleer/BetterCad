import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import {
  boolean,
  box,
  chamfer,
  cone,
  copyShape,
  cylinder,
  fillet,
  grow,
  measure,
  inset,
  place,
  prismOf,
  pushPull,
  holes,
  revolveOf,
  shell,
  sphere,
  torus,
  unplace,
  wedge,
  type Measure,
} from "./shapes";
import { tessellate, type Quality } from "./tessellate";
import { build, printed, type ModelDoc, type Part } from "../document";
import { DEFAULT_INFILL, SHELL_MM, estimateWeight, materialOf } from "../print/materials";
import { scaledTo, shellAndInfill, type MassMethod, type MassProps, type VolumeProps } from "../mass";
import type { BodyMesh } from "../mesh";
import { KernelError, isKernelError } from "../errors";
import { between, describe, subShape, type MeasureResult, type TopoRef } from "./measure";
import { readImport, type ImportedBody } from "./imports";
import { findMates, type Mate } from "./mates";
import { findClashes, overlapsAt, type Clash } from "./clashes";
import { triangles } from "./export";
import { meshTree, type MeshTree } from "../collide";
import { sweepClashes, type SweepOptions, type SweepResult } from "../sweep";
import { linkTransforms } from "../pose";
import { resolvePose } from "../drivelinks";
import { catalogueShape } from "./catalogue";
import { baseName, fromBase64, type ImportFormat } from "../imports";

/**
 * Turns a document revision into solids. Each part's solid is cached by what makes it (its shape, size and place),
 * so undo, redo and moving the timeline marker reuse what was built before.
 */
export interface BuiltBody {
  id: string;
  mesh: BodyMesh;
  measure: Measure;
}

export interface ImportInfo {
  bodies: { name: string; open: boolean; triangles?: number }[];
}

export interface ModelResult {
  bodies: BuiltBody[];
  /** Features the kernel could not build, with the reason. */
  failed: [string, string][];
  ms: number;
}

/** Everything a part's shape depends on, for caches. */
/** A body's mass properties (#174) and how they were found. */
export interface BodyMass extends MassProps {
  id: string;
  method: MassMethod;
}

export const partKey = (p: Part, q: Quality) =>
  JSON.stringify([
    p.kind,
    p.kind === "solid" ? null : p.size,
    p.position,
    p.rotation ?? null,
    p.prism ?? null,
    p.revolve ?? null,
    p.imported ?? null,
    p.catalogue ? [p.catalogue.id, p.catalogue.version, p.catalogue.model] : null,
    p.copy ?? null,
    p.ops ?? null,
    q,
  ]);

const MESH_REFUSAL: Partial<Record<string, string>> = {
  fillet: "Imported meshes can't be filleted; use a STEP file for that",
  chamfer: "Imported meshes can't be chamfered; use a STEP file for that",
  shell: "Imported meshes can't be shelled; use a STEP file for that",
  pushpull: "Imported meshes can't be pushed or pulled; use a STEP file for that",
};

/** Steps that made a part, so a part that cannot be built marks its tile. */
const makers = (doc: ModelDoc, id: string) =>
  doc.features.find(
    (x) => (x.type === "add" && x.part.id === id) || ((x.type === "extrude" || x.type === "revolve") && x.operation === "new" && x.body.id === id),
  );

/** A part's own shape, before any join, cut or move. */
function primitive(oc: OC, p: Part): TopoDS_Shape {
  switch (p.kind) {
    case "solid":
      if (p.catalogue) return catalogueShape(oc, p.catalogue);
      return p.revolve ? revolveOf(oc, p.revolve) : prismOf(oc, p.prism!);
    case "box":
      return box(oc, p.size);
    case "cylinder":
      return cylinder(oc, p.size);
    case "sphere":
      return sphere(oc, p.size);
    case "cone":
      return cone(oc, p.size.x, 0, p.size.z);
    case "torus":
      return torus(oc, p.size.x - p.size.z, p.size.z);
    case "wedge":
      return wedge(oc, p.size);
  }
}

export class ModelBuilder {
  private cache = new Map<string, { shape: TopoDS_Shape; body: Omit<BuiltBody, "id"> }>();
  /** Box trees over each body's mesh, for the clash sweep (#179). */
  private trees = new Map<string, MeshTree>();
  private used = new Set<string>();

  constructor(private oc: OC) {}

  /** The document's imported files (base64 by hash), and the bodies read from them. */
  private blobs: Record<string, string> = {};
  private files = new Map<string, ImportedBody[]>();

  /** A file's bodies, read once and each stood with its bottom centre on its own origin. */
  private readFile(blob: string, format: ImportFormat, data: string, name: string): ImportedBody[] {
    let bodies = this.files.get(blob);
    if (!bodies) {
      bodies = readImport(this.oc, format, fromBase64(data), name).map((b) => {
        const box = measure(this.oc, b.shape).bbox;
        const at = { x: -(box.min[0] + box.max[0]) / 2, y: -(box.min[1] + box.max[1]) / 2, z: -box.min[2] };
        return { ...b, shape: place(this.oc, b.shape, { position: at }) };
      });
      this.files.set(blob, bodies);
    }
    return bodies;
  }

  /** What an import would bring in (#82): its bodies' names, and which are open meshes. */
  inspect(p: { name: string; format: ImportFormat; blob: string; data: string }): ImportInfo {
    const bodies = this.readFile(p.blob, p.format, p.data, baseName(p.name));
    return { bodies: bodies.map((b) => ({ name: b.name, open: b.open, triangles: b.triangles })) };
  }

  /** An imported body. */
  private importedShape(p: Part): { shape: TopoDS_Shape; open: boolean } {
    const im = p.imported!;
    const data = this.blobs[im.blob];
    if (!data && !this.files.has(im.blob)) throw new KernelError("failed", "The imported file is missing from this model.");
    const b = this.readFile(im.blob, im.format, data ?? "", baseName(p.name))[im.index];
    if (!b) throw new KernelError("failed", "That body is no longer in the imported file.");
    return b;
  }

  /** Steps whose join, cut or intersection could not be made on the last build (the part is built without them). */
  private opFailures: [string, string][] = [];

  /** The solid for one part, made fresh or from the cache. */
  solid(p: Part, quality: Quality = "fast"): { shape: TopoDS_Shape; body: Omit<BuiltBody, "id"> } {
    const k = partKey(p, quality);
    this.used.add(k);
    let hit = this.cache.get(k);
    if (!hit) {
      const oc = this.oc;
      let local: TopoDS_Shape;
      let open = false;
      if (p.imported) {
        const im = this.importedShape(p);
        local = im.shape;
        open = im.open;
      } else if (p.copy) {
        // A mirrored or turned copy (#69): the original built where it stood, moved in the world, then taken into the
        // copy's own coordinates, so later steps on the copy work as on any body.
        const src = this.solid(p.copy.body, quality).shape;
        local = unplace(oc, copyShape(oc, src, p.copy.by), { position: p.copy.at });
      } else local = primitive(oc, p);
      for (const o of p.ops ?? []) {
        try {
          if (p.imported?.mesh && MESH_REFUSAL[o.op]) throw new KernelError("failed", MESH_REFUSAL[o.op]!);
          if (open && (o.op === "join" || o.op === "cut" || o.op === "intersect"))
            throw new KernelError("failed", "This mesh has holes, so it can't be combined");
          // A mirrored op (Mirror of features): mirror the body, make the op as it was, and mirror the body back, which
          // is the op made with its tool mirrored. The last plane goes first on the way in and last on the way out.
          const flips = o.mirror ?? [];
          let s = local;
          for (let i = flips.length - 1; i >= 0; i--) s = copyShape(oc, s, { mirror: flips[i]! });
          if (o.op === "fillet" || o.op === "chamfer") s = (o.op === "fillet" ? fillet : chamfer)(oc, s, o.refs ?? [], o.size ?? 0);
          else if (o.op === "shell") s = shell(oc, s, o.refs ?? [], o.size ?? 0, o.outside);
          else if (o.op === "pushpull") s = pushPull(oc, s, o.refs?.[0] ?? -1, o.size ?? 0);
          else if (o.op === "hole") s = holes(oc, s, o.holes!);
          else {
            // A body is built where it stood, then taken into this part's coordinates as they were then.
            const tool = o.body
              ? unplace(oc, this.solid(o.body, quality).shape, o.at ?? { position: p.position, rotation: p.rotation })
              : o.rev
                ? revolveOf(oc, o.rev)
                : prismOf(oc, o.tool!);
            s = boolean(oc, o.op, s, [o.op === "cut" && o.gap ? grow(oc, tool, o.gap) : tool]);
          }
          for (const m of flips) s = copyShape(oc, s, { mirror: m });
          local = s;
        } catch (e) {
          this.opFailures.push([o.feature, isKernelError(e) ? e.message : "That step could not be made."]);
        }
      }
      const shape = place(oc, local, { position: p.position, rotation: p.rotation });
      hit = { shape, body: { mesh: tessellate(oc, shape, quality), measure: measure(oc, shape) } };
      this.cache.set(k, hit);
    }
    return hit;
  }

  useBlobs(doc: ModelDoc): void {
    this.blobs = doc.blobs ?? {};
    for (const k of this.files.keys()) if (!(k in this.blobs)) this.files.delete(k);
  }

  /** Builds the first `upTo` features. `cancelled` is checked between parts. */
  build(doc: ModelDoc, upTo = doc.features.length, quality: Quality = "fast", cancelled: () => boolean = () => false): ModelResult {
    const t0 = performance.now();
    const { parts, failed } = build(doc, upTo);
    this.useBlobs(doc);
    const bodies: BuiltBody[] = [];
    const out: [string, string][] = [...failed];
    this.used.clear();
    this.opFailures = [];
    for (const p of parts) {
      if (cancelled()) throw new KernelError("cancelled", "Stopped.");
      try {
        bodies.push({ id: p.id, ...this.solid(p, quality).body });
      } catch (e) {
        const why = isKernelError(e) ? e.message : "This part could not be built.";
        const f = makers(doc, p.id);
        if (f) out.push([f.id, why]);
      }
    }
    out.push(...this.opFailures);
    // Keep the cache to what the last few builds used, so memory stays flat across many edits.
    if (this.cache.size > 400) for (const k of this.cache.keys()) if (!this.used.has(k)) this.cache.delete(k);
    return { bodies, failed: out, ms: performance.now() - t0 };
  }

  /** Mating faces (#184) between the bodies that print, as built up to `upTo`. */
  mates(doc: ModelDoc, upTo = doc.features.length, limit = 1): Mate[] {
    const { parts } = build(doc, upTo);
    this.useBlobs(doc);
    const bodies: { id: string; shape: TopoDS_Shape }[] = [];
    for (const p of parts) {
      if (!printed(p)) continue;
      try {
        bodies.push({ id: p.id, shape: this.solid(p).shape });
      } catch {
        // A body that can't build has no faces to check; the timeline already says why.
      }
    }
    return findMates(this.oc, bodies, limit);
  }

  /**
   * Bodies that overlap or touch at the document's pose (#178), as built up to `upTo`. Holes never clash; reference
   * bodies only when asked; bodies in one link only when asked.
   */
  clashes(
    doc: ModelDoc,
    upTo = doc.features.length,
    opts: { sameLink?: boolean; references?: boolean; cancelled?: () => boolean; progress?: (f: number) => void } = {},
  ): Clash[] {
    const { parts, joints, links, drives, components } = build(doc, upTo);
    this.useBlobs(doc);
    const byLink = doc.pose ? linkTransforms(joints, resolvePose(drives, doc.pose), components) : new Map();
    const linkOf = new Map<string, string>();
    for (const l of links) for (const id of l.parts) linkOf.set(id, l.id);
    const bodies = [];
    for (const p of parts) {
      if (p.hole || (p.reference && !opts.references)) continue;
      try {
        const link = linkOf.get(p.id);
        bodies.push({ id: p.id, shape: this.solid(p).shape, link, move: link ? byLink.get(link) : undefined });
      } catch {
        // A body that can't build has nothing to clash with; the timeline already says why.
      }
    }
    return findClashes(this.oc, bodies, opts);
  }

  /**
   * The clash sweep (#179): each joint through its range, or all together, at the document's pose otherwise, as built up
   * to `upTo`. Bodies are meshed once for the fast test; the exact check settles the ends of each range. Holes never
   * clash; reference bodies only when asked.
   */
  sweep(doc: ModelDoc, upTo = doc.features.length, opts: SweepOptions & { references?: boolean } = {}): SweepResult {
    const { parts, joints, links, drives } = build(doc, upTo);
    this.useBlobs(doc);
    const linkOf = new Map<string, string>();
    for (const l of links) for (const id of l.parts) linkOf.set(id, l.id);
    const bodies = [];
    const shapes = new Map<string, TopoDS_Shape>();
    for (const p of parts) {
      if (p.hole || (p.reference && !opts.references)) continue;
      try {
        const shape = this.solid(p).shape;
        const k = partKey(p, "fast");
        let tree = this.trees.get(k);
        if (!tree) {
          tree = meshTree(triangles(this.oc, shape, 0.05));
          if (this.trees.size > 200) this.trees.clear();
          this.trees.set(k, tree);
        }
        shapes.set(p.id, shape);
        bodies.push({ id: p.id, link: linkOf.get(p.id), tree });
      } catch {
        // A body that can't build has nothing to clash with; the timeline already says why.
      }
    }
    return sweepClashes(
      joints,
      drives,
      doc.pose,
      bodies,
      (a, b, at) => overlapsAt(this.oc, shapes.get(a.id)!, a.link ? at.get(a.link) : undefined, shapes.get(b.id)!, b.link ? at.get(b.link) : undefined),
      opts,
    );
  }

  /**
   * Mass properties (#174) of each body that has mass, as built up to `upTo`: printed bodies as a shell and infill of
   * the document's material, and any body with a datasheet mass (its own, or its catalogue part's) as uniform at that
   * mass. Holes and reference bodies without a datasheet mass weigh nothing and are left out.
   */
  mass(doc: ModelDoc, upTo = doc.features.length): BodyMass[] {
    const { parts } = build(doc, upTo);
    this.useBlobs(doc);
    const material = materialOf(doc.print?.material);
    const infill = doc.print?.infill ?? DEFAULT_INFILL;
    const out: BodyMass[] = [];
    for (const p of parts) {
      const datasheet = p.mass ?? p.catalogue?.mass;
      if (p.hole || (p.reference && datasheet === undefined)) continue;
      let shape: TopoDS_Shape;
      let m: Measure;
      try {
        const s = this.solid(p);
        shape = s.shape;
        m = s.body.measure;
      } catch {
        continue;
      }
      const full: VolumeProps = { volume: m.volume, centroid: m.centroid, inertia: m.inertia };
      if (datasheet !== undefined) {
        out.push({ id: p.id, ...scaledTo(full, datasheet), method: "datasheet" });
        continue;
      }
      const core = this.core(p, shape, m);
      if (core) out.push({ id: p.id, ...shellAndInfill(full, core, material.density, infill), method: "shell" });
      else {
        const estimate = estimateWeight({ volume: m.volume, area: m.area, density: material.density, infill });
        out.push({ id: p.id, ...scaledTo(full, estimate), method: "uniform" });
      }
    }
    return out;
  }

  /** A body's infill core: its volume properties, cached by its shape; null when there's none (too thin, or failed). */
  private core(p: Part, shape: TopoDS_Shape, m: Measure): VolumeProps | null {
    const k = partKey(p, "fast");
    if (this.cores.has(k)) return this.cores.get(k)!;
    let v: VolumeProps | null = null;
    // A body thinner than the shell is solid all through: no core.
    const thin = Math.min(...[0, 1, 2].map((i) => m.bbox.max[i]! - m.bbox.min[i]!)) <= 2 * SHELL_MM;
    const inner = thin ? null : inset(this.oc, shape, SHELL_MM);
    if (inner) {
      const c = measure(this.oc, inner);
      if (c.volume > 0 && c.volume < m.volume) v = { volume: c.volume, centroid: c.centroid, inertia: c.inertia };
    } else if (thin) v = { volume: 0, centroid: m.centroid, inertia: [0, 0, 0, 0, 0, 0] };
    if (this.cores.size > 200) this.cores.clear();
    this.cores.set(k, v);
    return v;
  }
  private cores = new Map<string, VolumeProps | null>();

  /** Measures one or two picks (#71) on the model as built up to `upTo`, from the cached solids. */
  measure(doc: ModelDoc, refs: TopoRef[], upTo = doc.features.length): MeasureResult {
    const { parts } = build(doc, upTo);
    this.useBlobs(doc);
    const picked = refs.slice(0, 2).map((r) => {
      const p = parts.find((x) => x.id === r.body);
      if (!p) throw new KernelError("reference-missing", "That body is not in the model any more.");
      const { shape } = this.solid(p);
      return { sub: subShape(this.oc, shape, r), info: describe(this.oc, shape, r) };
    });
    const [a, b] = picked;
    return { items: picked.map((x) => x.info), pair: a && b ? between(this.oc, a.sub, b.sub, a.info, b.info) : undefined };
  }
}
