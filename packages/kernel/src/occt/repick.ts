import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { elements } from "./shapes";
import { build, movedPicks, reorderFeature, type Feature, type FinishFeature, type ModelDoc, type Part } from "../document";

/** The parts of a model a reorder needs: its solids, as built. */
export interface SolidSource {
  solid(p: Part): { shape: TopoDS_Shape };
  useBlobs(doc: ModelDoc): void;
}

type V3 = [number, number, number];
/** Where an edge or face is: its middle, and the line's direction or the plane's normal and offset when it has one. */
export interface Sig {
  at: V3;
  dir?: V3;
  offset?: number;
}

/** Steps that pick edges or faces by number, and so can be re-picked by place after a reorder. */
const REPICK = new Set<Feature["type"]>(["fillet", "chamfer", "shell", "pushpull", "offsetFace"]);
const kindOf = (f: FinishFeature) => (f.type === "fillet" || f.type === "chamfer" ? "edge" : "face");

/** How close, in mm, a picked edge or face must be to its match: the same line or plane, the nearest middle. */
const ON = 0.01;
const NEAR = 0.05;
const PARALLEL = 0.9999;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a: V3, b: V3) => Math.hypot(...sub(a, b));

export function signature(oc: OC, s: TopoDS_Shape, kind: "edge" | "face"): Sig {
  const props = new oc.GProp_GProps();
  if (kind === "edge") oc.BRepGProp.LinearProperties(s, props, false, false);
  else oc.BRepGProp.SurfaceProperties(s, props, false, false);
  const c = props.CentreOfMass();
  const at: V3 = [c.X(), c.Y(), c.Z()];
  props.delete();
  if (kind === "edge") {
    const curve = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(s));
    let out: Sig = { at };
    if (curve.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line) {
      // This build can't hand back a gp_Lin, so the direction comes from the ends.
      const p = curve.Value(curve.FirstParameter());
      const q = curve.Value(curve.LastParameter());
      const d: V3 = [q.X() - p.X(), q.Y() - p.Y(), q.Z() - p.Z()];
      const l = Math.hypot(...d);
      if (l > 1e-12) out = { at, dir: [d[0] / l, d[1] / l, d[2] / l] };
    }
    curve.delete();
    return out;
  }
  const face = oc.TopoDS.Face(s);
  const surf = new oc.BRepAdaptor_Surface(face, true);
  let out: Sig = { at };
  if (surf.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
    const flip = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
    const d = surf.Plane().Axis().Direction();
    const n: V3 = [d.X() * flip, d.Y() * flip, d.Z() * flip];
    out = { at, dir: n, offset: dot(n, at) };
  }
  surf.delete();
  return out;
}

/** The new element that is the same edge or face as `old`: on the same line or plane, nearest it; else nearest. */
export function match(old: Sig, kind: "edge" | "face", next: Sig[]): number {
  let best = -1;
  let bestD = Infinity;
  next.forEach((n, i) => {
    const d = dist(old.at, n.at);
    let same: boolean;
    if (old.dir && n.dir) {
      if (kind === "face") same = dot(old.dir, n.dir) > PARALLEL && Math.abs((old.offset ?? 0) - (n.offset ?? 0)) < ON;
      else {
        // The old middle lies on the new line.
        const off = sub(old.at, n.at);
        const along = dot(off, n.dir);
        same = Math.abs(dot(old.dir, n.dir)) > PARALLEL && Math.hypot(...off) ** 2 - along * along < ON * ON;
      }
    } else same = !old.dir && !n.dir && d < NEAR;
    if (same && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** The part a step works on, as the steps before it leave it. */
function partBefore(src: SolidSource, doc: ModelDoc, f: FinishFeature): TopoDS_Shape | null {
  const i = doc.features.findIndex((g) => g.id === f.id);
  const p = build(doc, i).parts.find((x) => x.id === f.part);
  if (!p) return null;
  try {
    return src.solid(p).shape;
  } catch {
    return null;
  }
}

export interface Reordered {
  doc: ModelDoc;
  /** Steps whose edges or faces could not all be found again, in timeline order. */
  lost: string[];
}

/**
 * Moves a step before another (null for the end), then finds each moved fillet's, chamfer's, shell's and
 * push/pull's edges or faces again on the shape now in front of it, by where they are rather than their number.
 * Steps whose picks can't all be found keep their numbers and are listed as lost.
 */
export function reorderWithPicks(oc: OC, src: SolidSource, doc: ModelDoc, id: string, beforeId: string | null): Reordered {
  let next = reorderFeature(doc, id, beforeId);
  if (next === doc) return { doc, lost: [] };
  src.useBlobs(doc);
  const lost: string[] = [];
  for (const moved of movedPicks(doc, id, beforeId)) {
    if (!REPICK.has(moved.type)) continue;
    const f = moved as FinishFeature;
    const kind = kindOf(f);
    const was = partBefore(src, doc, f);
    const now = partBefore(src, next, f);
    if (!was || !now) {
      lost.push(f.name);
      continue;
    }
    const oldEls = elements(oc, was, kind);
    const newSigs = elements(oc, now, kind).map((s) => signature(oc, s, kind));
    const refs: number[] = [];
    let ok = true;
    for (const r of f.refs) {
      const s = oldEls[r];
      const j = s ? match(signature(oc, s, kind), kind, newSigs) : -1;
      if (j < 0) ok = false;
      else if (!refs.includes(j)) refs.push(j);
    }
    if (!ok) {
      lost.push(f.name);
      continue;
    }
    next = { ...next, features: next.features.map((g) => (g.id === f.id ? { ...f, refs } : g)) };
  }
  return { doc: next, lost };
}
