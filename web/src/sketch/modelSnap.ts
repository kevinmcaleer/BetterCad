import { flattenCurve, mid, projectCurves, type Frame, type Id, type ModelCurve, type Sketch, type Vec2, type Vec3 } from "@bettercad/sketch";
import type { Snap } from "./snap";

/**
 * Snapping to the model while drawing, as Fusion does with auto project on: the model's corners, the centres of its
 * holes and round edges, and the middles of its straight edges, flattened onto the sketch plane. Nothing comes into
 * the sketch until a click uses one; then that edge or corner is projected (held in place) and the click joins it.
 */
export interface ModelTarget {
  xy: Vec2;
  kind: "end" | "centre" | "middle";
  /** The edge or vertex to project when a click lands here. */
  curve: ModelCurve;
}

/** What the engine gives for each body on show: how many edges and corners it has, and where they are. */
export interface ModelSource {
  bodyCounts(): { id: string; edges: number; vertices: number }[];
  edgePoints(body: string, edge: number): Vec3[] | null;
  vertexPoint(body: string, vertex: number): Vec3 | null;
}

/** Targets closer than this, in mm, are one target: the first one found stays. */
const SAME = 1e-4;

/** Every snap target the model offers on the sketch plane. */
export function modelTargets(src: ModelSource, frame: Frame): ModelTarget[] {
  const out: ModelTarget[] = [];
  const seen = new Map<string, true>();
  const add = (t: ModelTarget) => {
    const key = `${t.kind}:${Math.round(t.xy[0] / SAME)}:${Math.round(t.xy[1] / SAME)}`;
    if (seen.has(key)) return;
    seen.set(key, true);
    out.push(t);
  };
  for (const b of src.bodyCounts()) {
    for (let v = 0; v < b.vertices; v++) {
      const p = src.vertexPoint(b.id, v);
      if (!p) continue;
      const f = flattenCurve(frame, [p]);
      if (f.kind === "point") add({ xy: f.p, kind: "end", curve: { points: [p], from: { body: b.id, vertex: v } } });
    }
    for (let e = 0; e < b.edges; e++) {
      const points = src.edgePoints(b.id, e);
      if (!points || points.length < 2) continue;
      const f = flattenCurve(frame, points);
      const curve = { points, from: { body: b.id, edge: e } };
      if (f.kind === "circle" || f.kind === "arc") add({ xy: f.c, kind: "centre", curve });
      else if (f.kind === "line") add({ xy: mid(f.a, f.b), kind: "middle", curve });
    }
  }
  return out;
}

/**
 * Brings the model edges and corners that clicks snapped to into the sketch, and points each of those clicks at what
 * it became: a corner's point, a circle's or arc's centre, or a straight edge (for its middle). One sketch out, so the
 * projection and the shape drawn on it are one undo step.
 */
export function resolveModelSnaps(sketch: Sketch, frame: Frame, clicks: Snap[]): { sketch: Sketch; clicks: Snap[] } {
  let s = sketch;
  const out = clicks.map((c) => {
    if (!c.model) return c;
    const r = projectCurves(s, frame, [c.model]);
    s = r.sketch;
    const id = r.ids[0];
    const e = id ? s.entities.find((x) => x.id === id) : undefined;
    let ref: Id | undefined;
    if (c.kind === "centre" && (e?.kind === "circle" || e?.kind === "arc")) ref = e.c;
    else if (c.kind === "end" && e?.kind === "point") ref = e.id;
    else if (c.kind === "middle" && e?.kind === "line") ref = e.id;
    const rest: Snap = { ...c };
    delete rest.model;
    return ref ? { ...rest, ref } : { ...rest, kind: "free" as const };
  });
  return { sketch: s, clicks: out };
}
