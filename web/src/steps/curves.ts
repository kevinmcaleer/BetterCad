/** A sketch's curves as polylines in sketch mm, for the build steps' pictures and diagrams. */
import { sampleArc, textsOf, type Sketch, type Vec2 } from "@bettercad/sketch";

export interface Polyline {
  points: Vec2[];
  closed: boolean;
  construction: boolean;
  /** Projected from the model (#54): drawn as a reference, not as the sketch's own curve. */
  projected: boolean;
}

export function sketchCurves(sketch: Sketch): Polyline[] {
  const pts = new Map<string, Vec2>();
  for (const e of sketch.entities) if (e.kind === "point") pts.set(e.id, [e.x, e.y]);
  const out: Polyline[] = [];
  for (const e of sketch.entities) {
    const base = { construction: !!e.construction, projected: !!e.projectedFrom };
    if (e.kind === "line") {
      const a = pts.get(e.a);
      const b = pts.get(e.b);
      if (a && b) out.push({ ...base, points: [a, b], closed: false });
    } else if (e.kind === "circle") {
      const c = pts.get(e.c);
      if (c) out.push({ ...base, points: sampleArc(c, e.r, 0, 2 * Math.PI, 72).slice(0, -1), closed: true });
    } else if (e.kind === "arc") {
      const c = pts.get(e.c);
      const a = pts.get(e.a);
      const b = pts.get(e.b);
      if (c && a && b)
        out.push({ ...base, points: sampleArc(c, e.r, Math.atan2(a[1] - c[1], a[0] - c[0]), Math.atan2(b[1] - c[1], b[0] - c[0])), closed: false });
    }
  }
  for (const t of textsOf(sketch)) for (const l of t.loops) out.push({ points: l, closed: true, construction: !!t.text.construction, projected: false });
  return out;
}
