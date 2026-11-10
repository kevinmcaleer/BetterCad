/**
 * The snap points a face offers the Joint tool (#384): its middle, its corners, the middles of its straight edges and
 * the centres of its holes and round edges. Each comes with the way a part snapped there would face (`normal`, out of
 * the face) and a direction across the face (`x`) for drawing its axes. Pure, so it can be tested without a view.
 */
export type V3 = [number, number, number];

export type SnapKind = "middle" | "corner" | "edge" | "centre";

export interface SnapPoint {
  point: V3;
  /** Out of the face: the joint's axis if this snap is picked. */
  normal: V3;
  /** Across the face, square to `normal`, for the X of the drawn axes. */
  x: V3;
  kind: SnapKind;
  /** Where a bevel or round cut the corner away (#389): drawn as a hollow ring. */
  sharp?: boolean;
}

/** What the view says about a face (`Engine.faceInfo` and `Engine.faceEdges`). */
export interface FaceShape {
  flat: boolean;
  normal: V3;
  centroid: V3;
  edge: V3;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
/** Rounds away float noise (1e-9 mm), so a snap on a whole number stays whole. */
const tidy = (a: V3): V3 => a.map((v) => Math.round(v * 1e9) / 1e9 + 0) as V3;
const unit = (a: V3): V3 | null => {
  const l = len(a);
  return l > 1e-12 ? mul(a, 1 / l) : null;
};

/** A direction square to `n`, from `hint` where it can, else from whichever world axis lies flattest. */
export function across(n: V3, hint?: V3): V3 {
  const tries: V3[] = [...(hint ? [hint] : []), [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const t of tries) {
    const x = unit(sub(t, mul(n, dot(t, n))));
    if (x && Math.abs(dot(t, n)) < 0.99 * len(t)) return x;
  }
  return [1, 0, 0];
}

/** Whether every point sits on the line from the first to the last. */
function straight(points: V3[], tol: number): boolean {
  const a = points[0]!;
  const d = unit(sub(points[points.length - 1]!, a));
  if (!d) return false;
  return points.every((p) => {
    const v = sub(p, a);
    return len(sub(v, mul(d, dot(v, d)))) <= tol;
  });
}

/** The circle through three points: its centre and plane normal, or null when they are in a line. */
function circle3(a: V3, b: V3, c: V3): { centre: V3; axis: V3 } | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const nn = dot(n, n);
  if (nn < 1e-18) return null;
  // Circumcentre: a + ((|ac|²(n×ab)) + (|ab|²(ac×n))) / 2|n|²
  const t = add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab)));
  return { centre: add(a, mul(t, 1 / (2 * nn))), axis: unit(n)! };
}

/** The circle an edge's points lie on (a whole circle or an arc), or null for any other curve. */
export function edgeCircle(points: V3[], tol: number): { centre: V3; axis: V3; radius: number; closed: boolean } | null {
  if (points.length < 4) return null;
  const closed = len(sub(points[0]!, points[points.length - 1]!)) <= tol;
  const n = closed ? points.length - 1 : points.length;
  const c = circle3(points[0]!, points[Math.floor(n / 3)]!, points[Math.floor((2 * n) / 3)]!);
  if (!c) return null;
  const radius = len(sub(points[0]!, c.centre));
  if (radius < tol) return null;
  for (const p of points) {
    const v = sub(p, c.centre);
    if (Math.abs(len(v) - radius) > Math.max(tol, radius * 0.01) || Math.abs(dot(v, c.axis)) > tol) return null;
  }
  return { ...c, radius, closed };
}

/**
 * The snap points on a face. `edges` are its edges' points in world space; `towards` points at the viewer, so a flat
 * face's snaps face out of the side you can see. A curved face gives the centres of its round edges, facing away from
 * the face. Points closer than `tol` mm are one.
 */
export function faceSnaps(face: FaceShape, edges: V3[][], towards: V3, tol = 1e-3): SnapPoint[] {
  const out: SnapPoint[] = [];
  let normal = unit(face.normal) ?? [0, 0, 1];
  if (face.flat && dot(normal, towards) < 0) normal = mul(normal, -1);
  const x = across(normal, face.edge);
  const push = (point: V3, kind: SnapKind, n = normal, ax = x) => {
    if (out.some((s) => len(sub(s.point, point)) <= tol)) return;
    out.push({ point: tidy(point), normal: tidy(n), x: tidy(ax), kind });
  };
  for (const pts of edges) {
    if (pts.length < 2) continue;
    const c = edgeCircle(pts, tol * 10);
    if (c) {
      if (face.flat) push(c.centre, "centre");
      else {
        // A round edge on a curved face: its centre, facing away from the rest of the face.
        const facing = dot(sub(c.centre, face.centroid), c.axis) >= 0 ? c.axis : mul(c.axis, -1);
        push(c.centre, "centre", facing, across(facing));
      }
      if (!c.closed && face.flat) {
        push(pts[0]!, "corner");
        push(pts[pts.length - 1]!, "corner");
      }
      continue;
    }
    if (!face.flat) continue;
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (straight(pts, tol * 10)) push(mul(add(a, b), 0.5), "edge");
    if (len(sub(a, b)) > tol) {
      push(a, "corner");
      push(b, "corner");
    }
  }
  if (face.flat) push(face.centroid, "middle");
  return out;
}

/** The snap nearest `p` on screen within `reach` px, by index, or -1. */
export function nearestSnap(screen: { x: number; y: number }[], p: { x: number; y: number }, reach: number): number {
  let best = -1;
  let bestD = reach;
  screen.forEach((s, i) => {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** `n` turned to face `towards`. */
export function facing(n: V3, towards: V3): V3 {
  return dot(n, towards) < 0 ? tidy(mul(n, -1)) : tidy(n);
}

/** A Shift-click for a snap between two (#388): a snap point, or a flat face standing for its plane. */
export interface Half {
  point: V3;
  normal: V3;
  plane: boolean;
}

/**
 * The point halfway between two picks: two snap points give their middle; a face gives the plane halfway between it
 * and the other pick, with the first pick's point carried onto it. Two faces must be parallel. Null when they aren't.
 */
export function between(a: Half, b: Half): V3 | null {
  if (!a.plane && !b.plane) return tidy(mul(add(a.point, b.point), 0.5));
  if (a.plane && b.plane && Math.abs(dot(unit(a.normal) ?? a.normal, unit(b.normal) ?? b.normal)) < 0.999) return null;
  const f = b.plane ? b : a;
  const n = unit(f.normal);
  if (!n) return null;
  // Halfway along the plane's normal from the first pick to the other's plane.
  const h = dot(sub(b.point, a.point), n) / 2;
  return tidy(add(a.point, mul(n, h)));
}

/** The snaps within `reach` px of `p` on screen, nearest first, by index: Tab steps through them (#391). */
export function nearSnaps(screen: { x: number; y: number }[], p: { x: number; y: number }, reach: number): number[] {
  return screen
    .map((s, i) => ({ i, d: Math.hypot(s.x - p.x, s.y - p.y) }))
    .filter((s) => s.d <= reach)
    .sort((a, b) => a.d - b.d)
    .map((s) => s.i);
}

/**
 * The joint's value `t` of the way (0…1) through a wiggle (#394): a hinge swings out to its upper limit, over to its
 * lower and back; a wheel ±45°; a slider out to its far limit and back. Null for a joint that doesn't move.
 */
export function wiggle(kind: string, lower: number, upper: number, t: number): number | null {
  const s = Math.sin(2 * Math.PI * t);
  if (kind === "revolute") return s >= 0 ? s * upper : -s * lower;
  if (kind === "continuous") return s * 45;
  if (kind === "prismatic") return Math.sin(Math.PI * t) * (Math.abs(upper) >= Math.abs(lower) ? upper : lower);
  return null;
}
