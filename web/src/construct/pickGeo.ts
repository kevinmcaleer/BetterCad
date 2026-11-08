import type { Single } from "@bettercad/kernel";
import type { Geo } from "../state/document";

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 | null => {
  const l = Math.hypot(...a);
  return l > 1e-9 ? scale(a, 1 / l) : null;
};

/**
 * What a pick on a body is, as construction input. A flat face is its plane (through the click for an axis square to
 * it, else through its middle); a round face its axis, with the point clicked on it; an edge its line or its circle.
 */
export function geoFromPick(s: Single, opts: { hit?: V3 | null; ray?: { origin: V3; dir: V3 }; x?: V3 } = {}): Geo | null {
  if (s.kind === "vertex") return { t: "point", at: s.point };
  if (s.kind === "edge") {
    if (s.line) {
      const dir = unit(s.line);
      return dir && { t: "line", origin: s.ends[0], dir, length: s.length };
    }
    if (s.circle) {
      const radial = sub(s.ends[0], s.circle.centre);
      const axis = (s.circle.axis && unit(s.circle.axis)) ?? null;
      if (!axis) return null;
      const closed = Math.hypot(...sub(s.ends[0], s.ends[1])) < 1e-6;
      const sweep = closed ? 360 : Math.min(360, (s.length / s.circle.radius) * (180 / Math.PI));
      return { t: "circle", centre: s.circle.centre, axis, radius: s.circle.radius, start: add(s.circle.centre, radial), sweep };
    }
    return null;
  }
  if (s.kind === "face") {
    if (s.circle) {
      const axis = unit(s.circle.axis);
      if (!axis) return null;
      // Where the click's ray passes nearest the axis, pushed out onto the face.
      let start: V3 | undefined;
      if (opts.ray) {
        const w = sub(opts.ray.origin, s.circle.centre);
        const b = dot(opts.ray.dir, axis);
        const den = 1 - b * b;
        const t = den > 1e-9 ? (b * dot(w, axis) - dot(w, opts.ray.dir)) / den : 0;
        const q = add(opts.ray.origin, scale(opts.ray.dir, t));
        const h = dot(sub(q, s.circle.centre), axis);
        const out = unit(sub(sub(q, s.circle.centre), scale(axis, h)));
        if (out) start = add(add(s.circle.centre, scale(axis, h)), scale(out, s.circle.radius));
      }
      return { t: "circle", centre: s.circle.centre, axis, radius: s.circle.radius, round: true, ...(start && { start }) };
    }
    if (s.normal) {
      const normal = unit(s.normal);
      return normal && { t: "plane", origin: opts.hit ?? s.centre, normal, ...(opts.x && { x: opts.x }) };
    }
  }
  return null;
}
