import { SketchIndex, type Dimension, type Sketch, type Vec2 } from "./model";
import { cross, dist, dot, len, lineLine, norm, scale, sub } from "./geom2d";

/** What a dimension measures on the geometry as it is now: mm, or degrees for angles. Driven dimensions show this. */
export function measureDimension(sketch: Sketch, d: Pick<Dimension, "kind" | "refs" | "arms">): number {
  const idx = new SketchIndex(sketch);
  const [r0, r1] = d.refs;
  const e0 = idx.get(r0!);
  const e1 = r1 ? idx.get(r1) : undefined;
  const lineEnds = (id: string): [Vec2, Vec2] => {
    const l = idx.get(id);
    if (l?.kind !== "line") throw new Error(`${id} is not a line`);
    return [idx.xy(l.a), idx.xy(l.b)];
  };
  switch (d.kind) {
    case "radius":
    case "diameter": {
      if (e0?.kind !== "circle" && e0?.kind !== "arc") throw new Error("Pick a circle or an arc");
      return d.kind === "radius" ? e0.r : e0.r * 2;
    }
    case "angle": {
      const [a0, a1] = lineEnds(r0!);
      const [b0, b1] = lineEnds(r1!);
      const [s0, s1] = d.arms ?? [1, 1];
      const u = scale(sub(a1, a0), s0);
      const v = scale(sub(b1, b0), s1);
      return (Math.abs(Math.atan2(cross(u, v), dot(u, v))) * 180) / Math.PI;
    }
    default:
      break;
  }
  if (e0?.kind === "line" && !e1) {
    const [a, b] = lineEnds(r0!);
    if (d.kind === "distanceX") return Math.abs(b[0] - a[0]);
    if (d.kind === "distanceY") return Math.abs(b[1] - a[1]);
    return dist(a, b);
  }
  if (e0?.kind === "point" && e1?.kind === "line") {
    const [a, b] = lineEnds(r1!);
    return Math.abs(cross(sub(b, a), sub(idx.xy(r0!), a))) / (len(sub(b, a)) || 1);
  }
  const p = idx.xy(r0!);
  const q = idx.xy(r1!);
  if (d.kind === "distanceX") return Math.abs(q[0] - p[0]);
  if (d.kind === "distanceY") return Math.abs(q[1] - p[1]);
  return dist(p, q);
}

/**
 * The corner an angle between two lines is measured at: where the lines cross (or would, extended) and a unit arm
 * along each, turned by `arms`. Null when the lines are parallel or are not lines.
 */
export function angleCorner(sketch: Sketch | SketchIndex, d: Pick<Dimension, "refs" | "arms">): { at: Vec2; u: Vec2; v: Vec2 } | null {
  const idx = sketch instanceof SketchIndex ? sketch : new SketchIndex(sketch);
  const l0 = idx.get(d.refs[0]!);
  const l1 = d.refs[1] ? idx.get(d.refs[1]) : undefined;
  if (l0?.kind !== "line" || l1?.kind !== "line") return null;
  const [a0, a1, b0, b1] = [idx.xy(l0.a), idx.xy(l0.b), idx.xy(l1.a), idx.xy(l1.b)];
  const hit = lineLine(a0, a1, b0, b1);
  if (!hit) return null;
  const [s0, s1] = d.arms ?? [1, 1];
  return { at: hit.p, u: scale(norm(sub(a1, a0)), s0), v: scale(norm(sub(b1, b0)), s1) };
}

/** Which quadrant of two crossing lines a point is in, as the arms that bound it. Null when the lines are parallel. */
export function armsAt(sketch: Sketch | SketchIndex, refs: string[], p: Vec2): [1 | -1, 1 | -1] | null {
  const c = angleCorner(sketch, { refs });
  if (!c) return null;
  // p - at = α u + β v: the signs of α and β name the quadrant.
  const w = sub(p, c.at);
  const det = cross(c.u, c.v);
  const alpha = cross(w, c.v) / det;
  const beta = cross(c.u, w) / det;
  return [alpha < 0 ? -1 : 1, beta < 0 ? -1 : 1];
}
