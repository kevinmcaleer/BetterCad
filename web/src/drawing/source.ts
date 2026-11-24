import type { DrawingDimension } from "@bettercad/kernel/drawing";
import type { Feature, ModelDoc } from "../state/document";

/**
 * Where in the model a drawing's size is set (#564): the sketch dimension it reads, or the step whose number it is.
 * A drawing's sizes report and never drive, so "Edit in model" opens this instead.
 */
export interface SizeSource {
  /** The step to open: a sketch, or an extrude or hole. */
  feature: string;
  /** The sketch dimension to type into, when it is one. */
  dimension?: string;
  /** How to say it: "d3 in Sketch 1", "Extrude 2". */
  label: string;
}

const NEAR = 1e-3;
const near = (a: number, b: number) => Math.abs(a - b) < NEAR;

/** The sketch curves and the steps an edge's name speaks of: `f7:side(l3)|cap.end` is curve l3 and step f7 (#47). */
export function named(name: string | undefined): { curves: string[]; steps: string[] } {
  const curves: string[] = [];
  const steps: string[] = [];
  for (const face of (name ?? "").split("|")) {
    const parts = face.split(":");
    steps.push(...parts.slice(0, -1));
    for (const m of parts[parts.length - 1]!.matchAll(/side\(([^()#]+)\)/g)) curves.push(m[1]!);
  }
  return { curves, steps };
}

/** Every id a sketch entity holds: its own and its points'. */
function idsOf(entity: object): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(entity)) {
    if (k === "kind") continue;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
  }
  return out;
}

/** Whether a sketch dimension of this kind and value is the size a drawing dimension shows. */
function same(kind: DrawingDimension["kind"], value: number, sketchKind: string, v: number): boolean {
  if (kind === "linear") return /^(length|distance)/.test(sketchKind) && near(v, value);
  if (kind === "radius") return (sketchKind === "radius" && near(v, value)) || (sketchKind === "diameter" && near(v / 2, value));
  if (kind === "diameter") return (sketchKind === "diameter" && near(v, value)) || (sketchKind === "radius" && near(v * 2, value));
  return sketchKind === "angle" && (near(v, value) || near(180 - v, value));
}

/**
 * The one place a size is set, or nothing when there isn't one: a size between two things made by different steps,
 * a primitive's size, a size on an import. `value` is the size as the drawing measures it, in mm or degrees.
 */
export function sizeSource(doc: Pick<ModelDoc, "features">, dim: Pick<DrawingDimension, "kind" | "refs">, value: number): SizeSource | undefined {
  const byId = new Map(doc.features.map((f) => [f.id, f]));
  const curves = new Set<string>();
  const steps: Feature[] = [];
  const step = (f: Feature | undefined) => {
    if (f && !steps.includes(f)) steps.push(f);
  };
  for (const r of dim.refs) {
    const n = named(r.name);
    n.curves.forEach((c) => curves.add(c));
    n.steps.forEach((s) => step(byId.get(s)));
    // The step that made the body: its faces carry no step of their own.
    step(doc.features.find((f) => (f as { body?: { id: string } }).body?.id === r.body));
  }

  if (curves.size) {
    // The sketches those steps were made from first, then any other that has a curve of that name.
    const from = steps.map((f) => byId.get((f as { sketch?: unknown }).sketch as string)).filter((f): f is Feature => f?.type === "sketch");
    const sketches = [...new Set([...from, ...doc.features.filter((f) => f.type === "sketch")])];
    for (const f of sketches) {
      if (f.type !== "sketch") continue;
      const touched = new Set<string>();
      for (const e of f.sketch.entities) if (curves.has(e.id)) idsOf(e).forEach((id) => touched.add(id));
      if (!touched.size) continue;
      const d = f.sketch.dimensions.find(
        (d) => d.driving && !d.suppressed && d.kind !== "pattern" && d.refs.every((id) => touched.has(id)) && same(dim.kind, value, d.kind, d.value),
      );
      if (d) return { feature: f.id, dimension: d.id, label: `${d.name ?? "a size"} in ${f.name}` };
    }
  }

  // A hole's size is the Hole step's; how far a shape was pushed is the Extrude's.
  const hole = dim.kind === "linear" || dim.kind === "angle" ? undefined : steps.find((f) => f.type === "hole");
  if (hole) return { feature: hole.id, label: hole.name };
  if (dim.kind === "linear") {
    const pushed = steps.find(
      (f) => f.type === "extrude" && (near(Math.abs(f.distance), value) || near(Math.abs(f.distance) + Math.abs(f.distance2 ?? 0), value)),
    );
    // Only an edge that runs between two swept faces is as long as the push.
    if (pushed && dim.refs.every((r) => (r.name ?? "").split("|").every((face) => /side\(/.test(face)))) return { feature: pushed.id, label: pushed.name };
  }
  return undefined;
}
