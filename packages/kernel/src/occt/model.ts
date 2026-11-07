import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import {
  boolean,
  box,
  chamfer,
  cone,
  cylinder,
  fillet,
  grow,
  measure,
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
import { build, type ModelDoc, type Part } from "../document";
import type { BodyMesh } from "../mesh";
import { KernelError, isKernelError } from "../errors";
import { between, describe, subShape, type MeasureResult, type TopoRef } from "./measure";
import { readImport, type ImportedBody } from "./imports";
import { findMates, type Mate } from "./mates";
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

const key = (p: Part, q: Quality) =>
  JSON.stringify([
    p.kind,
    p.kind === "solid" ? null : p.size,
    p.position,
    p.rotation ?? null,
    p.prism ?? null,
    p.revolve ?? null,
    p.imported ?? null,
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
    const k = key(p, quality);
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
      } else local = primitive(oc, p);
      for (const o of p.ops ?? []) {
        try {
          if (p.imported?.mesh && MESH_REFUSAL[o.op]) throw new KernelError("failed", MESH_REFUSAL[o.op]!);
          if (open && (o.op === "join" || o.op === "cut" || o.op === "intersect"))
            throw new KernelError("failed", "This mesh has holes, so it can't be combined");
          if (o.op === "fillet" || o.op === "chamfer") local = (o.op === "fillet" ? fillet : chamfer)(oc, local, o.refs ?? [], o.size ?? 0);
          else if (o.op === "shell") local = shell(oc, local, o.refs ?? [], o.size ?? 0, o.outside);
          else if (o.op === "pushpull") local = pushPull(oc, local, o.refs?.[0] ?? -1, o.size ?? 0);
          else if (o.op === "hole") local = holes(oc, local, o.holes!);
          else {
            // A body is built where it stood, then taken into this part's coordinates as they were then.
            const tool = o.body
              ? unplace(oc, this.solid(o.body, quality).shape, o.at ?? { position: p.position, rotation: p.rotation })
              : o.rev
                ? revolveOf(oc, o.rev)
                : prismOf(oc, o.tool!);
            local = boolean(oc, o.op, local, [o.op === "cut" && o.gap ? grow(oc, tool, o.gap) : tool]);
          }
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
      if (p.hole || p.hidden) continue;
      try {
        bodies.push({ id: p.id, shape: this.solid(p).shape });
      } catch {
        // A body that can't build has no faces to check; the timeline already says why.
      }
    }
    return findMates(this.oc, bodies, limit);
  }

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
