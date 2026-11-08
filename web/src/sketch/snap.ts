import { SketchIndex, allCrossings, closestOnSegment, dist, mid, sub, angleOf, onArc, polar, type Id, type Sketch, type Vec2 } from "@bettercad/sketch";

/**
 * Snaps while drawing (#55): the cursor jumps to the meaningful point nearest it, within a tolerance in screen pixels
 * (8 px, 16 px for touch). Priority: the model's origin, end points and centres (whichever is nearest), then midpoints,
 * then crossings, then a point on a line or curve, then level or upright with the point the tool started from, then
 * the grid. Ctrl snaps to the grid only.
 */
export type SnapKind = "origin" | "end" | "centre" | "middle" | "crossing" | "on" | "horizontal" | "vertical" | "grid" | "free";

export interface Snap {
  xy: Vec2;
  kind: SnapKind;
  /** The point snapped to (origin, end, centre), or the curve (middle, on, and the first of a crossing). */
  ref?: Id;
  /** The second curve of a crossing. */
  ref2?: Id;
  label: string;
}

export interface SnapOptions {
  /** Millimetres per screen pixel. */
  px: number;
  /** Tolerance in pixels. */
  radius?: number;
  /** Grid step in mm, or null when grid snapping is off. */
  grid: number | null;
  /** Where the tool started, for level and upright guides. */
  from?: Vec2;
  /** Points and curves to skip (the one being dragged). */
  exclude?: Set<Id>;
  /** Shift turns snapping off. */
  off?: boolean;
  /** Ctrl snaps to the grid and nothing else. */
  gridOnly?: boolean;
  /**
   * The model's origin in sketch mm: (0, 0) on the XY, XZ and YZ planes, the origin projected onto any other plane.
   * Null leaves it out.
   */
  origin?: Vec2 | null;
}

/** Points closer than this to the origin are on it. */
const ON_ORIGIN = 1e-6;
export const isAtOrigin = (xy: Vec2, origin: Vec2 = [0, 0]) => dist(xy, origin) < ON_ORIGIN;

/**
 * The sketch origin as a pick: Select, Dimension and the constraint tools can pick it where they take a point. It
 * becomes a real point fixed on the origin when a constraint or size uses it (`resolveOrigin` in tools.ts).
 */
export const ORIGIN = "@origin";

/**
 * What a click picks: the nearest point, then the origin, then the nearest line or curve, all within `tol` mm. Null
 * `origin` leaves the origin out.
 */
export function pickAt(p: Vec2, sketch: Sketch, tol: number, origin: Vec2 | null): Id | null {
  const id = entityAt(p, sketch, tol);
  if (id && sketch.entities.find((e) => e.id === id)?.kind === "point") return id;
  if (origin && dist(p, origin) <= tol) return ORIGIN;
  return id;
}

/**
 * A line's midpoint as a pick: the Coincident tool snaps to it, and a point picked with it gets a midpoint
 * constraint on that line.
 */
const MIDDLE_PREFIX = "@middle:";
export const middleOf = (line: Id): Id => `${MIDDLE_PREFIX}${line}`;
/** The line a midpoint pick stands for, or null when the id is not one. */
export const middleLine = (id: Id): Id | null => (id.startsWith(MIDDLE_PREFIX) ? id.slice(MIDDLE_PREFIX.length) : null);

/** What the Coincident tool snaps to under the pointer: a pick and the exact spot it stands for. */
export interface PointPick {
  id: Id;
  xy: Vec2;
  kind: SnapKind;
  label: string;
}

/**
 * The nearest point-like pick within `tol` mm, for the Coincident tool: points (ends, centres, points), the origin,
 * then line midpoints. Null when nothing is near enough, so moving away lets go of the snap.
 */
export function pointPickAt(p: Vec2, sketch: Sketch, tol: number, origin: Vec2 | null): PointPick | null {
  const idx = new SketchIndex(sketch);
  const centres = new Set(sketch.entities.flatMap((e) => (e.kind === "circle" || e.kind === "arc" ? [e.c] : [])));
  const ends = new Set(sketch.entities.flatMap((e) => (e.kind === "line" || e.kind === "arc" ? [e.a, e.b] : [])));
  let best = null as PointPick | null;
  let bestD = tol;
  const consider = (c: PointPick) => {
    const d = dist(c.xy, p);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  };
  for (const e of sketch.entities) {
    if (e.kind !== "point") continue;
    const kind: SnapKind = centres.has(e.id) ? "centre" : "end";
    consider({ id: e.id, xy: [e.x, e.y], kind, label: centres.has(e.id) || ends.has(e.id) ? SNAP_LABEL[kind] : "Point" });
  }
  // A point of the sketch's own wins over the origin under it.
  if (best) return best;
  if (origin) consider({ id: ORIGIN, xy: origin, kind: "origin", label: SNAP_LABEL.origin });
  if (best) return best;
  for (const e of sketch.entities) {
    if (e.kind !== "line") continue;
    consider({ id: middleOf(e.id), xy: mid(idx.xy(e.a), idx.xy(e.b)), kind: "middle", label: SNAP_LABEL.middle });
  }
  return best;
}

export const SNAP_LABEL: Record<SnapKind, string> = {
  origin: "Origin",
  end: "End",
  centre: "Centre",
  middle: "Middle",
  crossing: "Crossing",
  on: "On",
  horizontal: "Level",
  vertical: "Upright",
  grid: "Grid",
  free: "",
};

export function snap(cursor: Vec2, sketch: Sketch, o: SnapOptions): Snap {
  const free: Snap = { xy: cursor, kind: "free", label: "" };
  if (o.off) return free;
  if (o.gridOnly) {
    const g = o.grid ?? 1;
    return { xy: [Math.round(cursor[0] / g) * g, Math.round(cursor[1] / g) * g], kind: "grid", label: SNAP_LABEL.grid };
  }
  const tol = (o.radius ?? 8) * o.px;
  const idx = new SketchIndex(sketch);
  const skip = o.exclude ?? new Set<Id>();
  const centres = new Set(sketch.entities.flatMap((e) => (e.kind === "circle" || e.kind === "arc" ? [e.c] : [])));

  let best = null as Snap | null;
  let bestD = tol;
  const consider = (s: Snap) => {
    const d = dist(s.xy, cursor);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  };

  // The origin, end points and centres. A point already on the origin is the origin, so it is reused.
  const origin = o.origin === undefined ? ([0, 0] as Vec2) : o.origin;
  if (origin) consider({ xy: origin, kind: "origin", label: SNAP_LABEL.origin });
  for (const e of sketch.entities) {
    if (e.kind !== "point" || skip.has(e.id)) continue;
    const kind = origin && isAtOrigin([e.x, e.y], origin) ? "origin" : centres.has(e.id) ? "centre" : "end";
    consider({ xy: [e.x, e.y], kind, ref: e.id, label: SNAP_LABEL[kind] });
  }
  if (best) return best;

  // Midpoints.
  for (const e of sketch.entities) {
    if (e.kind !== "line" || skip.has(e.id) || skip.has(e.a) || skip.has(e.b)) continue;
    consider({ xy: mid(idx.xy(e.a), idx.xy(e.b)), kind: "middle", ref: e.id, label: SNAP_LABEL.middle });
  }
  if (best) return best;

  // Where two curves cross.
  for (const x of allCrossings(sketch, skip)) consider({ xy: x.xy, kind: "crossing", ref: x.a, ref2: x.b, label: SNAP_LABEL.crossing });
  if (best) return best;

  // On a curve.
  bestD = tol * 0.75;
  for (const e of sketch.entities) {
    if (skip.has(e.id)) continue;
    if (e.kind === "line") {
      if (skip.has(e.a) || skip.has(e.b)) continue;
      consider({ xy: closestOnSegment(cursor, idx.xy(e.a), idx.xy(e.b)).p, kind: "on", ref: e.id, label: SNAP_LABEL.on });
    } else if (e.kind === "circle" || e.kind === "arc") {
      const c = idx.xy(e.c);
      const ang = angleOf(sub(cursor, c));
      if (e.kind === "arc" && !onArc(ang, angleOf(sub(idx.xy(e.a), c)), angleOf(sub(idx.xy(e.b), c)))) continue;
      consider({ xy: polar(c, e.r, ang), kind: "on", ref: e.id, label: SNAP_LABEL.on });
    }
  }
  if (best) return best;

  // Level or upright with the start, then the grid.
  let xy: Vec2 = cursor;
  let kind: SnapKind = "free";
  if (o.from) {
    const dx = Math.abs(cursor[0] - o.from[0]);
    const dy = Math.abs(cursor[1] - o.from[1]);
    if (dy <= tol && dx > tol) {
      xy = [cursor[0], o.from[1]];
      kind = "horizontal";
    } else if (dx <= tol && dy > tol) {
      xy = [o.from[0], cursor[1]];
      kind = "vertical";
    }
  }
  if (o.grid) {
    const g = o.grid;
    const round = (v: number) => Math.round(v / g) * g;
    if (kind === "horizontal") xy = [round(xy[0]), xy[1]];
    else if (kind === "vertical") xy = [xy[0], round(xy[1])];
    else {
      xy = [round(xy[0]), round(xy[1])];
      kind = "grid";
    }
  }
  return { xy, kind, label: SNAP_LABEL[kind] };
}

/** A grid step that is about 10 px on screen: 0.1, 0.5, 1, 5, 10 mm… */
export function snapStep(px: number): number {
  const target = px * 10;
  const steps = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000];
  return steps.find((s) => s >= target) ?? 1000;
}

/** The entity nearest a point within `tol` mm: points first, then curves (only curves with `curvesOnly`). */
export function entityAt(p: Vec2, sketch: Sketch, tol: number, curvesOnly = false): Id | null {
  const idx = new SketchIndex(sketch);
  let best: Id | null = null;
  let bestD = tol;
  for (const e of sketch.entities) {
    if (e.kind !== "point" || curvesOnly) continue;
    const d = dist([e.x, e.y], p);
    if (d <= bestD) {
      best = e.id;
      bestD = d;
    }
  }
  if (best) return best;
  for (const e of sketch.entities) {
    let d = Infinity;
    if (e.kind === "line") d = dist(closestOnSegment(p, idx.xy(e.a), idx.xy(e.b)).p, p);
    else if (e.kind === "circle") d = Math.abs(dist(idx.xy(e.c), p) - e.r);
    else if (e.kind === "arc") {
      const c = idx.xy(e.c);
      const ang = angleOf(sub(p, c));
      d = onArc(ang, angleOf(sub(idx.xy(e.a), c)), angleOf(sub(idx.xy(e.b), c))) ? Math.abs(dist(c, p) - e.r) : Infinity;
    }
    if (d <= bestD) {
      best = e.id;
      bestD = d;
    }
  }
  return best;
}

/**
 * Where a dragged point would land as a coincident, Fusion-style: the nearest other point, then the origin, then a
 * line, circle or arc, within `tol` mm. Skips what can't take it: points already tied to it, the curves it is part of
 * (and a line's other end), and curves it already sits on. Null lets it go free.
 */
export function dropTarget(p: Vec2, sketch: Sketch, dragged: Id, tol: number, origin: Vec2 | null): PointPick | null {
  const idx = new SketchIndex(sketch);
  const skip = new Set([dragged]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of sketch.constraints) {
      if (c.type !== "coincident" || c.suppressed || skip.has(c.a) === skip.has(c.b)) continue;
      skip.add(c.a);
      skip.add(c.b);
      grew = true;
    }
  }
  const tied = new Set(skip);
  const own = (e: Sketch["entities"][number]) =>
    (e.kind === "line" && (tied.has(e.a) || tied.has(e.b))) ||
    (e.kind === "arc" && (tied.has(e.a) || tied.has(e.b) || tied.has(e.c))) ||
    (e.kind === "circle" && tied.has(e.c));
  const on = new Set(sketch.constraints.flatMap((c) => (c.type === "pointOn" && !c.suppressed && tied.has(c.p) ? [c.e] : [])));
  // A curve's own points: a line can't fold onto itself, nor an arc's end onto its centre.
  for (const e of sketch.entities) {
    if (!own(e)) continue;
    if (e.kind === "line") [e.a, e.b].forEach((q) => skip.add(q));
    else if (e.kind === "arc") [e.a, e.b, e.c].forEach((q) => skip.add(q));
    else if (e.kind === "circle") skip.add(e.c);
  }
  const centres = new Set(sketch.entities.flatMap((e) => (e.kind === "circle" || e.kind === "arc" ? [e.c] : [])));
  let best = null as PointPick | null;
  let bestD = tol;
  for (const e of sketch.entities) {
    if (e.kind !== "point" || skip.has(e.id) || dist([e.x, e.y], p) > bestD) continue;
    const kind: SnapKind = centres.has(e.id) ? "centre" : "end";
    best = { id: e.id, xy: [e.x, e.y], kind, label: SNAP_LABEL[kind] };
    bestD = dist([e.x, e.y], p);
  }
  if (best) return best;
  if (origin && dist(p, origin) <= tol) return { id: ORIGIN, xy: origin, kind: "origin", label: SNAP_LABEL.origin };
  for (const e of sketch.entities) {
    if (own(e) || on.has(e.id)) continue;
    let xy: Vec2 | null = null;
    if (e.kind === "line") xy = closestOnSegment(p, idx.xy(e.a), idx.xy(e.b)).p;
    else if (e.kind === "circle" || e.kind === "arc") {
      const c = idx.xy(e.c);
      const ang = angleOf(sub(p, c));
      if (e.kind === "circle" || onArc(ang, angleOf(sub(idx.xy(e.a), c)), angleOf(sub(idx.xy(e.b), c)))) xy = polar(c, e.r, ang);
    }
    if (xy && dist(xy, p) <= bestD) {
      best = { id: e.id, xy, kind: "on", label: SNAP_LABEL.on };
      bestD = dist(xy, p);
    }
  }
  return best;
}
