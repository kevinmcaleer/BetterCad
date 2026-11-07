import { SketchIndex, type Dimension, type Sketch, type Vec2 } from "./model";
import { cross, dist, dot, len, sub } from "./geom2d";

/** What a dimension measures on the geometry as it is now: mm, or degrees for angles. Driven dimensions show this. */
export function measureDimension(sketch: Sketch, d: Pick<Dimension, "kind" | "refs">): number {
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
      const u = sub(a1, a0);
      const v = sub(b1, b0);
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
