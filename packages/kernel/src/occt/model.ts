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
import { Namer, edgeNames, resolveNames } from "./naming";
import { build, poseNesting, printed, type ModelDoc, type Part } from "../document";
import { opMoves, undoMove } from "../pattern";
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
  /**
   * Each face's and edge's name (#47), in the mesh's numbering, for steps to store with their picks. Missing on bodies
   * too big to follow (large imports).
   */
  names?: { faces: string[]; edges: string[] };
}

export interface ImportInfo {
  bodies: { name: string; open: boolean; triangles?: number }[];
}

export interface ModelResult {
  bodies: BuiltBody[];
  /** Features the kernel could not build, with the reason. */
  failed: [string, string][];
  ms: number;
  /** How many body steps (joins, cuts, fillets…) were made rather than reused, for timings and tests. */
  made: number;
  /** Steps whose named edges or faces were not all found as they were (#47), so may now be on the wrong ones. */
  recovered: [string, string][];
  /** Each step's time on this build, in timeline order (#76). */
  timings: StepTiming[];
  /** What the cache holds after this build. */
  cache: { bodies: number; bytes: number; steps: number };
}

/** Everything a part's shape depends on, for caches. */
/** A body's mass properties (#174) and how they were found. */
export interface BodyMass extends MassProps {
  id: string;
  method: MassMethod;
}

/**
 * A value as JSON with its keys sorted and its numbers rounded to 1e-9 mm (#76), so the same settings always give the
 * same key whatever order they were written in, and float noise from the UI doesn't throw a body out of the cache.
 */
export function canonical(v: unknown): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e9) / 1e9 || 0) : "null";
  if (v === null || v === undefined || typeof v === "function") return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export const partKey = (p: Part, q: Quality) =>
  canonical([
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

/** How many part-way bodies to keep: enough for a few bodies' worth of steps while one is dragged or undone. */
export const STEPS_KEPT = 240;

/**
 * How many finished bodies to keep for undo, redo and scrubbing the timeline (#76), and roughly how much memory they
 * may take. Bodies the last build used are always kept.
 */
export const CACHE_LIMIT = { bodies: 200, bytes: 256 * 1024 * 1024 };

/** A rough size for a cached body: its mesh, and as much again three times over for the B-rep behind it. */
export function bodyBytes(b: { mesh: BodyMesh }): number {
  const m = b.mesh;
  const mesh = [m.positions, m.normals, m.indices, m.faceTris, m.faceVerts, m.edgePositions, m.edgeSegs, m.vertices].reduce(
    (n, a) => n + (a?.byteLength ?? 0),
    0,
  );
  return mesh * 4;
}

/** One step's last build (#76): how long it took and whether it came from the cache. */
export interface StepTiming {
  feature: string;
  ms: number;
  cached: boolean;
}

/**
 * A short key for a body after one more step: a hash of the key so far and the step. Chained so a body with many
 * steps doesn't need a key as long as all of them.
 */
export function chain(key: string, op: unknown): string {
  const s = key + canonical(op);
  // cyrb53: a fast 53-bit string hash, far from colliding at the few hundred keys kept.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

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

/** A part's solid as built, with what its steps left to report. */
interface Solid {
  shape: TopoDS_Shape;
  bytes: number;
  body: Omit<BuiltBody, "id">;
  /** Face names (#47), or null when the body is too big to follow. */
  faces: string[] | null;
  failures: [string, string][];
  recovered: [string, string][];
}

export class ModelBuilder {
  private cache = new Map<string, Solid>();
  /** Box trees over each body's mesh, for the clash sweep (#179). */
  private trees = new Map<string, MeshTree>();
  private used = new Set<string>();
  /** Bodies part way through their steps, by what made them so far (see `chain`), least recently used first. */
  private steps = new Map<
    string,
    { shape: TopoDS_Shape; open: boolean; failures: [string, string][]; faces: string[] | null; recovered: [string, string][] }
  >();

  constructor(
    private oc: OC,
    /** How much to keep (#76); smaller in tests. */
    private limit: { bodies: number; bytes: number } = CACHE_LIMIT,
  ) {}

  /** The document's imported files (base64 by hash), and the bodies read from them, as the file has them. */
  private blobs: Record<string, string> = {};
  private files = new Map<string, { raw: ImportedBody[]; placed: Partial<Record<"each" | "whole", ImportedBody[]>> }>();

  /**
   * A file's bodies, read once. `whole`: they keep their places in the file, the file's bottom centre on the origin.
   * `each`: every body stands with its own bottom centre on the origin (imports made before `keepLayout`).
   */
  private readFile(blob: string, format: ImportFormat, data: string, name: string, how: "each" | "whole" = "whole"): ImportedBody[] {
    let file = this.files.get(blob);
    if (!file) {
      file = { raw: readImport(this.oc, format, fromBase64(data), name), placed: {} };
      this.files.set(blob, file);
    }
    const done = file.placed[how];
    if (done) return done;
    const boxes = file.raw.map((b) => measure(this.oc, b.shape).bbox);
    const all = {
      min: [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k]!))),
      max: [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k]!))),
    };
    const bodies = file.raw.map((b, i) => {
      const box = how === "whole" ? all : boxes[i]!;
      const at = { x: -(box.min[0]! + box.max[0]!) / 2, y: -(box.min[1]! + box.max[1]!) / 2, z: -box.min[2]! };
      return { ...b, shape: place(this.oc, b.shape, { position: at }) };
    });
    file.placed[how] = bodies;
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
    const b = this.readFile(im.blob, im.format, data ?? "", baseName(p.name), im.keepLayout ? "whole" : "each")[im.index];
    if (!b) throw new KernelError("failed", "That body is no longer in the imported file.");
    return b;
  }

  /** Steps whose join, cut or intersection could not be made on the last build (the part is built without them). */
  private opFailures: [string, string][] = [];
  private opRecovered: [string, string][] = [];
  private made = 0;
  /** Each step's time on this build (#76), and the step that made each part. */
  private times: StepTiming[] = [];
  private makerOf = new Map<string, string>();

  /** The solid for one part, made fresh or from the cache. */
  solid(p: Part, quality: Quality = "fast"): Solid {
    const k = partKey(p, quality);
    this.used.add(k);
    let hit = this.cache.get(k);
    const base = this.makerOf.get(p.id) ?? p.id;
    if (hit) {
      // Most recently used last, so the oldest go first when the cache is full.
      this.cache.delete(k);
      this.cache.set(k, hit);
      this.times.push({ feature: base, ms: 0, cached: true }, ...(p.ops ?? []).map((o) => ({ feature: o.feature, ms: 0, cached: true })));
    } else {
      let t = performance.now();
      const lap = (feature: string, cached = false) => {
        const now = performance.now();
        this.times.push({ feature, ms: now - t, cached });
        t = now;
      };
      const oc = this.oc;
      const ops = p.ops ?? [];
      // The body as it stood after each of its steps, so changing one step (dragging a cut's arrow) redoes that step
      // and the ones after it, not the whole body from scratch.
      const keys: string[] = [];
      let at = partKey({ ...p, ops: undefined }, quality);
      for (const o of ops) keys.push((at = chain(at, o)));
      let from = ops.length;
      while (from > 0 && !this.steps.has(keys[from - 1]!)) from--;
      let local: TopoDS_Shape;
      let open = false;
      const failures: [string, string][] = [];
      const recovered: [string, string][] = [];
      // Face names (#47) follow the body through its steps.
      const namer = new Namer(oc);
      const kept = from > 0 ? this.steps.get(keys[from - 1]!)! : null;
      if (kept) {
        // Most recently used last, so the oldest go first when the store is full.
        this.steps.delete(keys[from - 1]!);
        this.steps.set(keys[from - 1]!, kept);
        local = kept.shape;
        open = kept.open;
        failures.push(...kept.failures);
        recovered.push(...kept.recovered);
        if (kept.faces) namer.add(local, kept.faces);
        else namer.off = true;
      } else if (p.imported) {
        const im = this.importedShape(p);
        local = im.shape;
        open = im.open;
        // A mesh has a face per triangle: too many to name, and it can't be filleted anyway.
        if (p.imported.mesh) namer.off = true;
      } else if (p.copy) {
        // A mirrored or turned copy (#69): the original built where it stood, moved in the world, then taken into the
        // copy's own coordinates, so later steps on the copy work as on any body.
        const src = this.solid(p.copy.body, quality);
        local = unplace(oc, copyShape(oc, src.shape, p.copy.by), { position: p.copy.at });
        if (src.faces) namer.add(local, src.faces);
      } else local = p.kind === "solid" && !p.catalogue ? (p.revolve ? revolveOf(oc, p.revolve, namer) : prismOf(oc, p.prism!, namer)) : primitive(oc, p);
      lap(base, !!kept);
      for (let i = 0; i < from; i++) lap(ops[i]!.feature, true);
      let faces = namer.off ? null : namer.namesOf(local);
      for (let i = from; i < ops.length; i++) {
        const o = ops[i]!;
        this.made++;
        // Shapes this step makes fresh (its tool, a slab) are named under its id.
        namer.prefix = `${o.feature}:`;
        try {
          if (p.imported?.mesh && MESH_REFUSAL[o.op]) throw new KernelError("failed", MESH_REFUSAL[o.op]!);
          if (open && (o.op === "join" || o.op === "cut" || o.op === "intersect"))
            throw new KernelError("failed", "This mesh has holes, so it can't be combined");
          // A mirrored, turned or moved op (Mirror or Pattern of features): move the body the other way, make the op as
          // it was, and move the body back, which is the op made with its tool moved. The last move is undone first on
          // the way in and made last on the way out.
          const flips = opMoves(o);
          let s = local;
          const move = (m: Parameters<typeof copyShape>[2]) => {
            const next = copyShape(oc, s, m);
            namer.moved(next, s);
            s = next;
          };
          for (let j = flips.length - 1; j >= 0; j--) move(undoMove(flips[j]!));
          // Picks stored by name are found again by name; picks without, or on a body too big to name, by number.
          let refs = o.refs ?? [];
          if (o.names?.length && !namer.off) {
            const fs = namer.namesOf(s);
            const r = resolveNames(o.names, o.op === "fillet" || o.op === "chamfer" ? edgeNames(oc, s, fs) : fs, refs);
            refs = r.refs;
            if (r.recovered) recovered.push([o.feature, "Its edges or faces changed in an earlier step. Check it's on the right ones."]);
          }
          if (o.op === "fillet" || o.op === "chamfer") s = (o.op === "fillet" ? fillet : chamfer)(oc, s, refs, o.size ?? 0, namer);
          else if (o.op === "shell") s = shell(oc, s, refs, o.size ?? 0, o.outside, namer);
          else if (o.op === "pushpull") s = pushPull(oc, s, refs[0] ?? -1, o.size ?? 0, namer);
          else if (o.op === "hole") s = holes(oc, s, o.holes!, namer);
          else {
            // A body is built where it stood, then taken into this part's coordinates as they were then.
            let tool: TopoDS_Shape;
            if (o.body) {
              const b = this.solid(o.body, quality);
              tool = unplace(oc, b.shape, o.at ?? { position: p.position, rotation: p.rotation });
              if (b.faces)
                namer.add(
                  tool,
                  b.faces.map((n) => namer.prefix + n),
                );
            } else tool = o.rev ? revolveOf(oc, o.rev, namer) : prismOf(oc, o.tool!, namer);
            s = boolean(oc, o.op, s, [o.op === "cut" && o.gap ? grow(oc, tool, o.gap) : tool], namer);
          }
          for (const m of flips) move(m);
          local = s;
        } catch (e) {
          failures.push([o.feature, isKernelError(e) ? e.message : "That step could not be made."]);
        }
        faces = namer.off ? null : namer.namesOf(local);
        this.steps.set(keys[i]!, { shape: local, open, failures: [...failures], faces, recovered: [...recovered] });
        lap(o.feature);
      }
      while (this.steps.size > STEPS_KEPT) this.steps.delete(this.steps.keys().next().value!);
      const shape = place(oc, local, { position: p.position, rotation: p.rotation });
      // Placing keeps the faces' order, so the names hold; edges are named from them on the placed shape.
      const names = faces ? { faces, edges: edgeNames(oc, shape, faces) } : undefined;
      const body = { mesh: tessellate(oc, shape, quality), measure: measure(oc, shape), names };
      hit = { shape, body, bytes: bodyBytes(body), faces, failures, recovered };
      this.cache.set(k, hit);
      // Meshing counts towards the last step's time, and doesn't make a reused step new.
      lap(ops.at(-1)?.feature ?? base, from === ops.length && !!kept);
    }
    // A body from the cache still reports the steps it couldn't make or found again by name.
    this.opFailures.push(...hit.failures);
    this.opRecovered.push(...hit.recovered);
    return hit;
  }

  useBlobs(doc: ModelDoc): void {
    this.blobs = doc.blobs ?? {};
    for (const k of this.files.keys()) if (!(k in this.blobs)) this.files.delete(k);
  }

  /**
   * Builds the first `upTo` features. `cancelled` is checked between parts; `progress` hears how many of the steps are
   * done after each part (#76).
   */
  build(
    doc: ModelDoc,
    upTo = doc.features.length,
    quality: Quality = "fast",
    cancelled: () => boolean = () => false,
    progress?: (done: number, total: number) => void,
  ): ModelResult {
    const t0 = performance.now();
    const { parts, failed } = build(doc, upTo);
    this.useBlobs(doc);
    const bodies: BuiltBody[] = [];
    const out: [string, string][] = [...failed];
    this.used.clear();
    this.opFailures = [];
    this.opRecovered = [];
    this.made = 0;
    this.times = [];
    this.makerOf = new Map(parts.flatMap((p) => (makers(doc, p.id) ? [[p.id, makers(doc, p.id)!.id]] : [])));
    const total = parts.reduce((n, p) => n + 1 + (p.ops?.length ?? 0), 0);
    let done = 0;
    for (const p of parts) {
      if (cancelled()) throw new KernelError("cancelled", "Stopped.");
      try {
        bodies.push({ id: p.id, ...this.solid(p, quality).body });
      } catch (e) {
        const why = isKernelError(e) ? e.message : "This part could not be built.";
        const f = makers(doc, p.id);
        if (f) out.push([f.id, why]);
      }
      done += 1 + (p.ops?.length ?? 0);
      progress?.(done, total);
    }
    // A body used as a tool reports its steps again: once each.
    for (const f of this.opFailures) if (!out.some(([id, why]) => id === f[0] && why === f[1])) out.push(f);
    const cache = this.trim();
    // A step that failed doesn't also need a warning that its picks moved.
    const failedIds = new Set(out.map(([id]) => id));
    const recovered = this.opRecovered.filter(([id], i, all) => !failedIds.has(id) && all.findIndex(([x]) => x === id) === i);
    return { bodies, failed: out, ms: performance.now() - t0, made: this.made, recovered, timings: this.timings(doc), cache };
  }

  /**
   * Drops the least recently used bodies until the cache is within CACHE_LIMIT, keeping those the last build used, so
   * memory stays flat across many edits while undo and scrubbing stay quick.
   */
  private trim(limit = this.limit): ModelResult["cache"] {
    let bytes = 0;
    for (const h of this.cache.values()) bytes += h.bytes;
    for (const [k, h] of this.cache) {
      if (this.cache.size <= limit.bodies && bytes <= limit.bytes) break;
      if (this.used.has(k)) continue;
      this.cache.delete(k);
      bytes -= h.bytes;
    }
    return { bodies: this.cache.size, bytes, steps: this.steps.size };
  }

  /** The cache's keys, oldest first, for tests. */
  cachedKeys(): string[] {
    return [...this.cache.keys()];
  }

  /** Each step's time on the last build, summed over the bodies it made, in timeline order. */
  private timings(doc: ModelDoc): StepTiming[] {
    const by = new Map<string, StepTiming>();
    for (const t of this.times) {
      const x = by.get(t.feature);
      if (x) by.set(t.feature, { feature: t.feature, ms: x.ms + t.ms, cached: x.cached && t.cached });
      else by.set(t.feature, { ...t });
    }
    const order = new Map(doc.features.map((f, i) => [f.id, i]));
    return [...by.values()].sort((a, b) => (order.get(a.feature) ?? 1e9) - (order.get(b.feature) ?? 1e9));
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
    const built = build(doc, upTo);
    const { parts, joints, links, drives } = built;
    const components = poseNesting(built);
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
