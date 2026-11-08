import { clampJoint, type JointKind, type V3 } from "../state/document";

export interface ScreenPoint {
  x: number;
  y: number;
}

/** What a drag needs of the view: where a world point lands on screen, and which way is towards the viewer. */
export interface DragView {
  project(p: V3): ScreenPoint;
  /** Unit vector from the scene towards the camera. */
  towards: V3;
  /** The ray from the camera through a screen point, to turn hinges by where the pointer meets their plane. */
  ray?(p: ScreenPoint): { origin: V3; dir: V3 };
}

/** A joint as the drag sees it: where it sits now (posed) and its limits. */
export interface DragJoint {
  kind: JointKind;
  origin: V3;
  axis: V3;
  lower: number;
  upper: number;
}

/** Steps a dragged joint snaps to: 5° for a hinge or wheel, 1 mm for a slider. */
export const snapStep = (kind: JointKind) => (kind === "prismatic" ? 1 : 5);

/** Degrees per pixel when a hinge's axis lies across the screen and there's no circle to drag round. */
const EDGE_ON_RATE = 0.5;

const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * A joint dragged in the view (#173). Hinges and wheels turn with the pointer's angle round the axis on screen,
 * accumulated so a drag can go round more than once; with the axis lying across the screen, sideways movement turns
 * them. Sliders follow the pointer along the axis's line on screen. Values snap unless snapping is held off, and stay in
 * the joint's limits.
 */
export function startDrag(j: DragJoint, view: DragView, start: ScreenPoint, startValue: number) {
  const axis = unit(j.axis);
  const o = view.project(j.origin);
  const facing = dot(axis, view.towards);
  const edgeOn = Math.abs(facing) < 0.25;
  // A slider: screen pixels per mm along its axis.
  const tip = view.project([j.origin[0] + axis[0] * 10, j.origin[1] + axis[1] * 10, j.origin[2] + axis[2] * 10]);
  const along = { x: (tip.x - o.x) / 10, y: (tip.y - o.y) / 10 };
  const perMm = Math.hypot(along.x, along.y);
  // A hinge's plane: through the origin, square to the axis, with u and w across it (w = axis × u).
  const u = unit(Math.abs(axis[0]) < 0.9 ? cross(axis, [1, 0, 0]) : cross(axis, [0, 1, 0]));
  const w = cross(axis, u);
  /** Where the pointer meets the hinge's plane, as an angle round the axis in degrees; null when the ray misses. */
  const planeAngle = (p: ScreenPoint): number | null => {
    if (!view.ray) return null;
    const r = view.ray(p);
    const den = dot(r.dir, axis);
    if (Math.abs(den) < 1e-6) return null;
    const t = dot(sub(j.origin, r.origin), axis) / den;
    if (t < 0) return null;
    const hit: V3 = [r.origin[0] + r.dir[0] * t, r.origin[1] + r.dir[1] * t, r.origin[2] + r.dir[2] * t];
    const v = sub(hit, j.origin);
    return (Math.atan2(dot(v, w), dot(v, u)) * 180) / Math.PI;
  };
  let prev = start;
  let prevAngle = planeAngle(start);
  let turned = 0;
  return {
    /** The joint's value with the pointer at `p`; `free` holds snapping off. */
    at(p: ScreenPoint, free = false): number {
      let raw: number;
      if (j.kind === "prismatic") {
        raw = perMm > 0.05 ? startValue + ((p.x - start.x) * along.x + (p.y - start.y) * along.y) / (perMm * perMm) : startValue - (p.y - start.y) / 4;
      } else {
        const a = edgeOn ? null : planeAngle(p);
        if (edgeOn) turned += (p.x - prev.x) * EDGE_ON_RATE;
        else if (a !== null && prevAngle !== null) turned += wrap(a - prevAngle);
        else {
          const a0 = Math.atan2(prev.y - o.y, prev.x - o.x);
          const a1 = Math.atan2(p.y - o.y, p.x - o.x);
          // Screen y points down, so a growing atan2 is clockwise on screen: negative about an axis facing the viewer.
          turned += wrap(((a1 - a0) * 180) / Math.PI) * (facing > 0 ? -1 : 1);
        }
        prevAngle = a;
        raw = startValue + turned;
      }
      prev = p;
      const step = snapStep(j.kind);
      const v = free ? Math.round(raw * 10) / 10 : Math.round(raw / step) * step;
      return clampJoint(j, v);
    },
  };
}
