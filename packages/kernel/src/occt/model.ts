import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { boolean, box, cone, cylinder, measure, place, prismOf, sphere, torus, unplace, wedge, type Measure } from "./shapes";
import { tessellate, type Quality } from "./tessellate";
import { build, type ModelDoc, type Part } from "../document";
import type { BodyMesh } from "../mesh";
import { KernelError, isKernelError } from "../errors";

/**
 * Turns a document revision into solids. Each part's solid is cached by what makes it (its shape, size and place),
 * so undo, redo and moving the timeline marker reuse what was built before.
 */
export interface BuiltBody {
  id: string;
  mesh: BodyMesh;
  measure: Measure;
}

export interface ModelResult {
  bodies: BuiltBody[];
  /** Features the kernel could not build, with the reason. */
  failed: [string, string][];
  ms: number;
}

const key = (p: Part, q: Quality) =>
  JSON.stringify([p.kind, p.kind === "solid" ? null : p.size, p.position, p.rotation ?? null, p.prism ?? null, p.ops ?? null, q]);

/** Steps that made a part, so a part that cannot be built marks its tile. */
const makers = (doc: ModelDoc, id: string) =>
  doc.features.find((x) => (x.type === "add" && x.part.id === id) || (x.type === "extrude" && x.operation === "new" && x.body.id === id));

/** A part's own shape, before any join, cut or move. */
function primitive(oc: OC, p: Part): TopoDS_Shape {
  switch (p.kind) {
    case "solid":
      return prismOf(oc, p.prism!);
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

  /** Steps whose join, cut or intersection could not be made on the last build (the part is built without them). */
  private opFailures: [string, string][] = [];

  /** The solid for one part, made fresh or from the cache. */
  solid(p: Part, quality: Quality = "fast"): { shape: TopoDS_Shape; body: Omit<BuiltBody, "id"> } {
    const k = key(p, quality);
    this.used.add(k);
    let hit = this.cache.get(k);
    if (!hit) {
      const oc = this.oc;
      let local = primitive(oc, p);
      for (const o of p.ops ?? []) {
        try {
          // A body is built where it stood, then taken into this part's coordinates as they were then.
          const tool = o.body ? unplace(oc, this.solid(o.body, quality).shape, o.at ?? { position: p.position, rotation: p.rotation }) : prismOf(oc, o.tool!);
          local = boolean(oc, o.op, local, [tool]);
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

  /** Builds the first `upTo` features. `cancelled` is checked between parts. */
  build(doc: ModelDoc, upTo = doc.features.length, quality: Quality = "fast", cancelled: () => boolean = () => false): ModelResult {
    const t0 = performance.now();
    const { parts, failed } = build(doc, upTo);
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
}
