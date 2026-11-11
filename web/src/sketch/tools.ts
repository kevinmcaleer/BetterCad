import {
  Draft,
  arcFrom3,
  type SolveResult,
  dist,
  polygonPoints,
  sub,
  angleOf,
  sampleArc,
  SketchIndex,
  add,
  cross,
  dot,
  AXIS_SNAP_DEG,
  directionAt,
  drawArcTangent,
  drawEllipse,
  tangentArcCentre,
  drawSlot,
  drawSpline,
  fitSpline,
  sampleSpline,
  sampleEllipse,
  norm,
  scale,
  type Id,
  type Sketch,
  type Vec2,
  type NewConstraint,
} from "@bettercad/sketch";
import type { IconName } from "@bettercad/ui";
import { ORIGIN, isAtOrigin, middleLine, type Snap } from "./snap";

/**
 * The drawing tools (#53) as data: how many clicks each needs, what to preview while the pointer moves, which sizes
 * can be typed, and what one finished shape adds to the sketch. The sketch session routes pointer events here.
 */
export type SketchToolId =
  | "select"
  | "line"
  | "rectangle"
  | "circle"
  | "arc"
  | "arcCentre"
  | "arcTangent"
  | "slot"
  | "ellipse"
  | "spline"
  | "polygon"
  | "point"
  | "text"
  | "dimension"
  | "fillet"
  | "trim"
  | "extend"
  | "offset"
  | "mirror"
  | "project";

/** Tools that draw new shapes click by click (the rest pick existing geometry). */
export type DrawToolId = "line" | "rectangle" | "circle" | "arc" | "arcCentre" | "arcTangent" | "slot" | "ellipse" | "spline" | "polygon" | "point";
export const isDrawTool = (t: SketchToolId): t is DrawToolId => t in CLICKS;

export interface SketchTool {
  id: SketchToolId;
  label: string;
  icon: IconName;
  key: string;
  help: string;
  /** Sizes that can be typed while drawing, in order (Tab moves between them). */
  fields: string[];
  /**
   * A way of using another tool (#405): picked from that tool's bar, not the palette, and shown as that tool. `mode`
   * names it on the bar.
   */
  modeOf?: SketchToolId;
  mode?: string;
}

export const SKETCH_TOOLS: SketchTool[] = [
  {
    id: "select",
    label: "Select",
    icon: "arrow",
    key: "v",
    help: "Click to pick. Drag a point or line to move it; drop a point on another to join them, Shift-drag to pull it free. Enter finishes the sketch.",
    fields: [],
  },
  {
    id: "line",
    label: "Line",
    icon: "line",
    key: "l",
    help: "Click where the line starts, then each corner. Esc or a double-click ends it.",
    fields: ["Length"],
  },
  {
    id: "rectangle",
    label: "Rectangle",
    icon: "rect",
    key: "r",
    help: "Click one corner, then the opposite one. Type the width, Tab, the height.",
    fields: ["Width", "Height"],
  },
  { id: "circle", label: "Circle", icon: "circle", key: "c", help: "Click the centre, then the edge. Type the diameter.", fields: ["Diameter"] },
  {
    id: "arc",
    label: "Arc",
    icon: "arc",
    key: "a",
    help: "Click where the arc starts and ends, then a point it passes through.",
    fields: [],
    mode: "3 point",
  },
  {
    id: "arcCentre",
    label: "Arc",
    icon: "arc",
    key: "",
    help: "Click the centre, then where the arc starts, then where it ends. Type the radius.",
    fields: ["Radius"],
    modeOf: "arc",
    mode: "Centre",
  },
  {
    id: "arcTangent",
    label: "Arc",
    icon: "arc",
    key: "",
    help: "Click the end of a line or arc, then where the arc ends. It carries on tangent. Type the radius.",
    fields: ["Radius"],
    modeOf: "arc",
    mode: "Tangent",
  },
  {
    id: "slot",
    label: "Slot",
    icon: "slot",
    key: "s",
    help: "Click one end's centre, then the other's, then how wide. Type the length, Tab, the width.",
    fields: ["Length", "Width"],
  },
  {
    id: "ellipse",
    label: "Ellipse",
    icon: "ellipse",
    key: "e",
    help: "Click the centre, then the end of one axis, then how far the other reaches. Type the width across each axis.",
    fields: ["First axis", "Second axis"],
  },
  {
    id: "spline",
    label: "Spline",
    icon: "spline",
    key: "b",
    help: "Click each point the curve passes through. Double-click or Enter ends it; click the first point, or Shift-click, to close it.",
    fields: [],
  },
  { id: "polygon", label: "Polygon", icon: "polygon", key: "n", help: "Click the centre, then a corner. Set the sides in the bar.", fields: ["Radius"] },
  {
    id: "point",
    label: "Point",
    icon: "point",
    key: "p",
    help: "Click to place a point. Constrain or dimension it like any other point.",
    fields: [],
  },
  {
    id: "text",
    label: "Text",
    icon: "text",
    key: "w",
    help: "Click where the text starts, then type it and set the font and size in the Text card. Click a text to change it.",
    fields: [],
  },
  {
    id: "dimension",
    label: "Dimension",
    icon: "dimension",
    key: "d",
    help: "Click a line, circle or arc, or two points or two lines, then click to place the size. Move off past the ends for a level or upright size. For an angle, click a second line. Axes count as lines, the origin as a point.",
    fields: [],
  },
  {
    id: "fillet",
    label: "Fillet",
    icon: "fillet",
    key: "f",
    help: "Click a corner, or two lines that meet, to round it. Set the radius in the bar.",
    fields: [],
  },
  {
    id: "trim",
    label: "Trim",
    icon: "crop",
    key: "t",
    help: "Click a piece between crossings to remove it, or drag across pieces to trim them all. Hold Alt to extend instead.",
    fields: [],
    mode: "Trim",
  },
  {
    id: "extend",
    label: "Trim",
    icon: "crop",
    key: "",
    help: "Hover near the end of a line or arc to see it grow to the next shape, then click. The end joins what it meets.",
    fields: [],
    modeOf: "trim",
    mode: "Extend",
  },
  {
    id: "offset",
    label: "Offset",
    icon: "shrink",
    key: "o",
    help: "Click a line, arc or circle. The copy goes on the side the pointer is on. Set the distance in the bar.",
    fields: [],
  },
  {
    id: "mirror",
    label: "Mirror",
    icon: "flipH",
    key: "m",
    help: "Click the shapes to mirror, then Mirror line and click a line or an axis. The copy follows the shapes.",
    fields: [],
  },
  { id: "project", label: "Project", icon: "body", key: "j", help: "Click a face of a part to bring its edges into the sketch.", fields: [] },
];

export const toolById = (id: SketchToolId): SketchTool & { modes?: SketchTool[] } => {
  const t = SKETCH_TOOLS.find((x) => x.id === id)!;
  const base = t.modeOf ?? t.id;
  const modes = SKETCH_TOOLS.filter((x) => x.id === base || x.modeOf === base);
  return modes.length > 1 ? { ...t, modes } : t;
};

/**
 * How many clicks a tool takes to finish one shape. The line tool chains: each click after the first is a line. The
 * spline takes as many as you give it, until a double-click, Enter or a click on its first point.
 */
export const CLICKS: Record<DrawToolId, number> = {
  line: 2,
  rectangle: 2,
  circle: 2,
  arc: 3,
  arcCentre: 3,
  arcTangent: 2,
  slot: 3,
  ellipse: 3,
  polygon: 2,
  point: 1,
  spline: Infinity,
};

export interface Preview {
  /** Polylines in sketch mm. */
  lines: Vec2[][];
  /** The live sizes to show beside the cursor, in field order. */
  values: number[];
}

/** What a tool would draw now, from its placed clicks and the cursor. */
export function preview(tool: SketchToolId, clicks: Vec2[], cursor: Vec2, sides = 6, from?: Vec2 | null): Preview {
  const [a] = clicks;
  if (!a) return { lines: [], values: [] };
  switch (tool) {
    case "line":
      return { lines: [[a, cursor]], values: [dist(a, cursor)] };
    case "rectangle":
      return {
        lines: [[a, [cursor[0], a[1]], cursor, [a[0], cursor[1]], a]],
        values: [Math.abs(cursor[0] - a[0]), Math.abs(cursor[1] - a[1])],
      };
    case "circle": {
      const r = dist(a, cursor);
      return { lines: [sampleArc(a, r, 0, 2 * Math.PI, 72)], values: [r * 2] };
    }
    case "spline": {
      const pts = [...clicks, cursor].filter((p, i, all) => i === 0 || dist(p, all[i - 1]!) > 1e-6);
      if (pts.length < 2) return { lines: [], values: [] };
      return { lines: [sampleSpline(fitSpline(pts))], values: [] };
    }
    case "polygon": {
      const r = dist(a, cursor);
      const pts = polygonPoints(a, r, sides, angleOf(sub(cursor, a)));
      return { lines: [[...pts, pts[0]!]], values: [r] };
    }
    case "slot": {
      const b = clicks[1];
      if (!b) return { lines: [[a, cursor]], values: [dist(a, cursor)] };
      const w = slotWidth(a, b, cursor);
      return { lines: w > 1e-6 ? [slotOutline(a, b, w / 2)] : [[a, b]], values: [dist(a, b), w] };
    }
    case "ellipse": {
      const b = clicks[1];
      if (!b) return { lines: [[a, cursor]], values: [2 * dist(a, cursor)] };
      const r1 = dist(a, b);
      const r2 = slotWidth(a, b, cursor) / 2;
      const g = { c: a, r1, r2, rot: angleOf(sub(b, a)) };
      return { lines: r2 > 1e-6 ? [sampleEllipse(g), [b, add(a, sub(a, b))]] : [[add(a, sub(a, b)), b]], values: [2 * r1, 2 * r2] };
    }
    case "arc": {
      const b = clicks[1];
      if (!b) return { lines: [[a, cursor]], values: [] };
      const fit = arcFrom3(a, cursor, b);
      if (!fit) return { lines: [[a, b]], values: [] };
      const [s, e] = fit.ccw ? [a, b] : [b, a];
      return { lines: [sampleArc(fit.c, fit.r, angleOf(sub(s, fit.c)), angleOf(sub(e, fit.c)))], values: [fit.r] };
    }
    case "arcCentre": {
      const b = clicks[1];
      const r = dist(a, b ?? cursor);
      if (!b) return { lines: [[a, cursor]], values: [r] };
      const [s0, e0] = turnsLeft(a, b, cursor) ? [b, cursor] : [cursor, b];
      return { lines: [sampleArc(a, r, angleOf(sub(s0, a)), angleOf(sub(e0, a))), [a, b]], values: [r] };
    }
    case "arcTangent": {
      // `from` is the way the curve the arc starts from leaves its end.
      const c = from ? tangentArcCentre(a, from, cursor) : null;
      if (!c) return { lines: [[a, cursor]], values: [] };
      const [s0, e0] = turnsLeft(a, add(a, from!), cursor, true) ? [a, cursor] : [cursor, a];
      return { lines: [sampleArc(c, dist(a, c), angleOf(sub(s0, c)), angleOf(sub(e0, c)))], values: [dist(a, c)] };
    }
    default:
      return { lines: [], values: [] };
  }
}

/**
 * Whether going from b to p turns anticlockwise about c (a centre arc's sweep follows the pointer the short way), or,
 * with `ahead`, whether p is left of the heading from c through b.
 */
function turnsLeft(c: Vec2, b: Vec2, p: Vec2, ahead = false): boolean {
  return ahead ? cross(sub(b, c), sub(p, c)) > 0 : cross(sub(b, c), sub(p, c)) >= 0;
}

/** A slot's width: twice the pointer's distance from the line through its two centres. */
export function slotWidth(a: Vec2, b: Vec2, cursor: Vec2): number {
  const l = dist(a, b);
  return l > 1e-9 ? (2 * Math.abs(cross(sub(b, a), sub(cursor, a)))) / l : 2 * dist(a, cursor);
}

/** A slot's outline round two centres, for the preview. */
function slotOutline(a: Vec2, b: Vec2, r: number): Vec2[] {
  const t = angleOf(sub(b, a));
  return [
    ...sampleArc(b, r, t - Math.PI / 2, t + Math.PI / 2, 24),
    ...sampleArc(a, r, t + Math.PI / 2, t + (3 * Math.PI) / 2, 24),
    add(b, scale([Math.sin(t), -Math.cos(t)], r)),
  ];
}

/** The newest arc with an end at `p`, which a line drawn on from there can carry on tangent to. */
function arcEndingAt(s: Sketch, p: Id): Id | null {
  for (const e of [...s.entities].reverse()) {
    if (e.construction) continue;
    if (e.kind === "line" && (e.a === p || e.b === p)) return null;
    if (e.kind === "arc" && (e.a === p || e.b === p)) return e.id;
  }
  return null;
}

/**
 * Puts a snapped point in the draft: the point snapped to when there is one (shared corners), otherwise a new point,
 * tied to the line or curve it landed on. A point on the origin is fixed there, as Fusion makes it coincident with
 * the sketch's origin point.
 */
export function place(d: Draft, s: Snap): Id {
  if (s.kind === "origin") {
    const p = s.ref ?? d.point(s.xy);
    if (!d.constraints.some((c) => c.type === "fix" && c.p === p)) d.constrain({ type: "fix", p });
    return p;
  }
  if ((s.kind === "end" || s.kind === "centre") && s.ref) return s.ref;
  const p = d.point(s.xy);
  if (s.kind === "on" && s.ref) d.constrain({ type: "pointOn", p, e: s.ref });
  if (s.kind === "middle" && s.ref) d.constrain({ type: "midpoint", p, line: s.ref });
  if (s.kind === "crossing" && s.ref && s.ref2) {
    d.constrain({ type: "pointOn", p, e: s.ref });
    d.constrain({ type: "pointOn", p, e: s.ref2 });
  }
  return p;
}

export interface Commit {
  sketch: Sketch;
  /** The undo label: "Draw a line". */
  label: string;
  /** The last point placed, where a chaining line tool continues from. */
  end?: Id;
}

/**
 * Finishes one shape. `typed` holds the sizes typed into the pills (undefined where nothing was typed); a typed size
 * becomes a driving dimension and moves the last click to match.
 */
export function commit(tool: SketchToolId, sketch: Sketch, clicks: Snap[], typed: (number | undefined)[] = [], sides = 6, closed = false): Commit | null {
  const d = new Draft(sketch);
  switch (tool) {
    case "spline": {
      // A click on the spot of the one before (a double-click's second click) adds nothing.
      const kept = clicks.filter((c, i) => i === 0 || dist(c.xy, clicks[i - 1]!.xy) > 1e-6);
      if (kept.length < (closed ? 3 : 2)) return null;
      const ids = kept.map((c) => place(d, c));
      const r = drawSpline(d.done().sketch, ids, closed);
      return r && { sketch: r.sketch, label: closed ? "Draw a closed spline" : "Draw a spline" };
    }
    case "point": {
      const [s0] = clicks as [Snap];
      // A point already there (a corner, a centre, the origin's point) is not doubled.
      if (s0.ref && (s0.kind === "end" || s0.kind === "centre" || s0.kind === "origin")) return null;
      const p = place(d, s0);
      return { sketch: d.done().sketch, label: "Add a point", end: p };
    }
    case "line": {
      const [s0, s1] = clicks as [Snap, Snap];
      let end = s1;
      const length = typed[0];
      if (length !== undefined && length > 0) {
        const dir = sub(s1.xy, s0.xy);
        const l = Math.hypot(...dir) || 1;
        end = { xy: [s0.xy[0] + (dir[0] / l) * length, s0.xy[1] + (dir[1] / l) * length], kind: "free", label: "" };
      }
      if (dist(s0.xy, end.xy) < 1e-6) return null;
      const a = place(d, s0);
      const b = place(d, end);
      if (a === b) return null;
      const id = d.line(a, b);
      if (length !== undefined && length > 0) d.dimension("length", [id], length);
      // Leaving an arc's end nearly along it, the line carries on tangent (#405).
      const arc = s0.kind === "end" && s0.ref ? arcEndingAt(sketch, s0.ref) : null;
      const along = arc && directionAt(sketch, s0.ref!);
      if (arc && along) {
        const u = norm(sub(end.xy, s0.xy));
        if ((Math.acos(Math.max(-1, Math.min(1, dot(u, along)))) * 180) / Math.PI < AXIS_SNAP_DEG) d.constrain({ type: "tangent", a: arc, b: id });
      }
      return { sketch: d.done().sketch, label: "Draw a line", end: b };
    }
    case "rectangle": {
      const [s0, s1] = clicks as [Snap, Snap];
      const [w, h] = typed;
      const sx = s1.xy[0] >= s0.xy[0] ? 1 : -1;
      const sy = s1.xy[1] >= s0.xy[1] ? 1 : -1;
      const far: Snap =
        w !== undefined || h !== undefined
          ? { xy: [w !== undefined ? s0.xy[0] + sx * w : s1.xy[0], h !== undefined ? s0.xy[1] + sy * h : s1.xy[1]], kind: "free", label: "" }
          : s1;
      if (Math.abs(far.xy[0] - s0.xy[0]) < 1e-6 || Math.abs(far.xy[1] - s0.xy[1]) < 1e-6) return null;
      const p1 = place(d, s0);
      const p3 = place(d, far);
      const p2 = d.point([far.xy[0], s0.xy[1]]);
      const p4 = d.point([s0.xy[0], far.xy[1]]);
      const bottom = d.line(p1, p2, { auto: false });
      const right = d.line(p2, p3, { auto: false });
      const top = d.line(p3, p4, { auto: false });
      const left = d.line(p4, p1, { auto: false });
      d.constrain({ type: "horizontal", e: bottom });
      d.constrain({ type: "horizontal", e: top });
      d.constrain({ type: "vertical", e: right });
      d.constrain({ type: "vertical", e: left });
      if (w !== undefined) d.dimension("length", [bottom], w);
      if (h !== undefined) d.dimension("length", [right], h);
      return { sketch: d.done().sketch, label: "Draw a rectangle" };
    }
    case "circle": {
      const [s0, s1] = clicks as [Snap, Snap];
      const dia = typed[0];
      const r = dia !== undefined ? dia / 2 : dist(s0.xy, s1.xy);
      if (r < 1e-6) return null;
      const id = d.circle(place(d, s0), r);
      if (dia !== undefined) d.dimension("diameter", [id], dia);
      return { sketch: d.done().sketch, label: "Draw a circle" };
    }
    case "arc": {
      const [s0, s1, s2] = clicks as [Snap, Snap, Snap];
      const fit = arcFrom3(s0.xy, s2.xy, s1.xy);
      if (!fit) return null;
      const a = place(d, s0);
      const b = place(d, s1);
      d.arc(fit.c, fit.ccw ? a : b, fit.ccw ? b : a);
      return { sketch: d.done().sketch, label: "Draw an arc" };
    }
    case "arcCentre": {
      const [s0, s1, s2] = clicks as [Snap, Snap, Snap];
      const r = typed[0] ?? dist(s0.xy, s1.xy);
      if (!(r > 1e-6) || dist(s0.xy, s2.xy) < 1e-6) return null;
      const c = place(d, s0);
      const o = d.xy(c);
      const startXy = add(o, scale(norm(sub(s1.xy, s0.xy)), r));
      const a = typed[0] === undefined ? place(d, s1) : d.point(startXy);
      const endXy = add(o, scale(norm(sub(s2.xy, s0.xy)), r));
      // The end lands on the circle, along the pointer's direction; a point already there is used.
      const b = s2.ref && s2.kind === "end" && Math.abs(dist(s2.xy, o) - r) < 1e-6 ? s2.ref : d.point(endXy);
      if (a === b || dist(d.xy(a), d.xy(b)) < 1e-6) return null;
      const id = turnsLeft(s0.xy, s1.xy, s2.xy) ? d.arc(c, a, b) : d.arc(c, b, a);
      if (typed[0] !== undefined) d.dimension("radius", [id], r);
      return { sketch: d.done().sketch, label: "Draw an arc", end: b };
    }
    case "arcTangent": {
      const [s0, s1] = clicks as [Snap, Snap];
      if (!s0.ref || s0.kind !== "end") return null;
      const b = place(d, s1);
      if (b === s0.ref) return null;
      const r = drawArcTangent(d.done().sketch, s0.ref, b, typed[0]);
      return r && { sketch: r.sketch, label: "Draw an arc", end: b };
    }
    case "slot": {
      // Two snaps when Enter is pressed after the first click with both sizes typed; three after the width click.
      const [s0, s1, s2] = clicks as [Snap, Snap, Snap | undefined];
      const [length, width] = typed;
      let far = s1;
      if (length !== undefined && length > 0) {
        const dir = sub(s1.xy, s0.xy);
        const l = Math.hypot(...dir) || 1;
        far = { xy: add(s0.xy, scale(dir, length / l)), kind: "free", label: "" };
      }
      const w = width ?? (s2 ? slotWidth(s0.xy, far.xy, s2.xy) : 0);
      if (dist(s0.xy, far.xy) < 1e-6 || !(w > 1e-6)) return null;
      const a = place(d, s0);
      const b = place(d, far);
      if (a === b) return null;
      const r = drawSlot(d.done().sketch, a, b, w, { ...(length !== undefined && { length }), ...(width !== undefined && { width }) });
      return r && { sketch: r.sketch, label: "Draw a slot" };
    }
    case "ellipse": {
      // As the slot: two snaps when Enter is pressed after the first click with both widths typed.
      const [s0, s1, s2] = clicks as [Snap, Snap, Snap | undefined];
      const [first, second] = typed;
      if (!s2 && second === undefined) return null;
      if (dist(s0.xy, s1.xy) < 1e-6) return null;
      const c = place(d, s0);
      const r = drawEllipse(d.done().sketch, c, s1.xy, s2?.xy ?? s1.xy, {
        ...(first !== undefined && { first }),
        ...(second !== undefined && { second }),
      });
      return r && { sketch: r.sketch, label: "Draw an ellipse" };
    }
    case "polygon": {
      const [s0, s1] = clicks as [Snap, Snap];
      const r = typed[0] ?? dist(s0.xy, s1.xy);
      if (r < 1e-6) return null;
      const n = Math.max(3, Math.min(12, Math.round(sides)));
      const centre = place(d, s0);
      const ring = d.circle(centre, r, true);
      const pts = polygonPoints(s0.xy, r, n, angleOf(sub(s1.xy, s0.xy))).map((p) => d.point(p));
      const lines = pts.map((p, i) => d.line(p, pts[(i + 1) % n]!, { auto: false }));
      for (const p of pts) d.constrain({ type: "pointOn", p, e: ring });
      for (let i = 1; i < n; i++) d.constrain({ type: "equal", a: lines[0]!, b: lines[i]! });
      if (typed[0] !== undefined) d.dimension("radius", [ring], r);
      return { sketch: d.done().sketch, label: `Draw a ${n}-sided polygon` };
    }
    default:
      return null;
  }
}

/**
 * The constraint tools: what each needs picked, and the hint until it has it. A tool stays armed after it applies, so
 * line after line can be clicked until Esc. Horizontal/Vertical is one tool: each line takes whichever it is nearer,
 * and two points line up across or up, whichever they are nearer to already.
 * The sketch origin can be picked wherever a point can.
 */
export type ConstraintToolId = Exclude<NewConstraint["type"], "horizontal" | "vertical"> | "horizontalVertical";

export interface ConstraintTool {
  id: ConstraintToolId;
  label: string;
  hint: string;
  /** How many picks make one constraint. */
  picks: number;
  /** A short mark for the tag that follows the pointer. */
  tag: string;
}

export const CONSTRAINT_TOOLS: ConstraintTool[] = [
  { id: "coincident", label: "Coincident", hint: "Pick two points, or a point and a line or curve", picks: 2, tag: "Coincident" },
  { id: "horizontalVertical", label: "Horizontal/Vertical", hint: "Pick lines, or two points to line them up", picks: 1, tag: "H/V" },
  { id: "parallel", label: "Parallel", hint: "Pick two lines", picks: 2, tag: "Parallel" },
  { id: "perpendicular", label: "Perpendicular", hint: "Pick two lines", picks: 2, tag: "Perpendicular" },
  { id: "tangent", label: "Tangent", hint: "Pick a line and a curve, or two curves", picks: 2, tag: "Tangent" },
  { id: "equal", label: "Equal", hint: "Pick two lines, or two circles or arcs", picks: 2, tag: "Equal" },
  { id: "concentric", label: "Concentric", hint: "Pick two circles or arcs", picks: 2, tag: "Concentric" },
  { id: "midpoint", label: "Midpoint", hint: "Pick a point and a line, or two lines to line up their midpoints", picks: 2, tag: "Midpoint" },
  { id: "fix", label: "Fix", hint: "Pick points, lines or curves", picks: 1, tag: "Fix" },
  { id: "symmetric", label: "Symmetric", hint: "Pick two points and a line", picks: 3, tag: "Symmetric" },
];

export const constraintToolById = (id: ConstraintToolId) => CONSTRAINT_TOOLS.find((t) => t.id === id)!;

/**
 * Horizontal or vertical for a line, by its angle from the horizon: up to 45° is horizontal, past it vertical.
 * Null when the id is not a line.
 */
export function levelOrUpright(sketch: Sketch, id: Id): "horizontal" | "vertical" | null {
  const line = sketch.entities.find((e) => e.id === id);
  if (line?.kind !== "line") return null;
  const at = (p: Id) => sketch.entities.find((e) => e.id === p);
  const a = at(line.a);
  const b = at(line.b);
  if (a?.kind !== "point" || b?.kind !== "point") return null;
  return Math.abs(b.y - a.y) > Math.abs(b.x - a.x) ? "vertical" : "horizontal";
}

/**
 * Horizontal (same y) or vertical (same x) for two points, whichever they are nearer to now: up to 45° apart from
 * the horizon lines them up across, past it up. Null unless both ids are points.
 */
export function levelOrUprightPoints(sketch: Sketch, a: Id, b: Id, origin: Vec2 = [0, 0]): "horizontal" | "vertical" | null {
  const xy = (id: Id): Vec2 | null => {
    if (id === ORIGIN) return origin;
    const p = sketch.entities.find((e) => e.id === id);
    return p?.kind === "point" ? [p.x, p.y] : null;
  };
  const p = xy(a);
  const q = xy(b);
  if (!p || !q) return null;
  return Math.abs(q[1] - p[1]) > Math.abs(q[0] - p[0]) ? "vertical" : "horizontal";
}

/** Whether a pick is a point: a sketch point (an end, a centre, a lone or projected point) or the origin. */
export const isPointPick = (sketch: Sketch, id: Id) => id === ORIGIN || sketch.entities.find((e) => e.id === id)?.kind === "point";

/**
 * Whether a constraint tool has picks enough to apply. Most count picks; Horizontal/Vertical takes a line at once
 * but waits on a point for a second one.
 */
export function picksReady(type: ConstraintToolId, sketch: Sketch, picked: Id[]): boolean {
  if (type === "horizontalVertical" && picked.length === 1 && isPointPick(sketch, picked[0]!)) return false;
  return picked.length >= constraintToolById(type).picks;
}

/**
 * Swaps a picked origin for a real point fixed on it, as Fusion ties geometry to the sketch's origin point: the one
 * already there if the sketch has it, otherwise a new one. Picks without the origin come back unchanged.
 */
export function resolveOrigin(sketch: Sketch, picked: Id[], origin: Vec2 = [0, 0]): { sketch: Sketch; picked: Id[] } {
  if (!picked.includes(ORIGIN)) return { sketch, picked };
  const fixed = new Set(sketch.constraints.flatMap((c) => (c.type === "fix" && !c.suppressed ? [c.p] : [])));
  let id = sketch.entities.find((e) => e.kind === "point" && fixed.has(e.id) && isAtOrigin([e.x, e.y], origin))?.id;
  let next = sketch;
  if (!id) {
    const d = new Draft(sketch);
    id = d.point(origin);
    d.constrain({ type: "fix", p: id });
    next = d.done().sketch;
  }
  return { sketch: next, picked: picked.map((p) => (p === ORIGIN ? id! : p)) };
}

/** Stands in for a new construction point at the first picked line's midpoint; `addConstraints` makes it. */
export const MIDPOINT_OF_FIRST = "@midpoint";

/**
 * A constraint tool on a selection: the sketch with its constraints added, or the hint when the selection does not
 * fit. Midpoint on two lines adds a construction point at the first line's midpoint and ties both lines to it.
 */
export function addConstraints(type: ConstraintToolId, base: Sketch, chosen: Id[], origin?: Vec2): Sketch | string {
  const hint = constraintToolById(type).hint;
  // Only geometry, the origin and line midpoints are picks: a constraint or size picked by its mark is not.
  const known = new Set(base.entities.map((e) => e.id));
  if (chosen.some((id) => id !== ORIGIN && !known.has(middleLine(id) ?? id))) return hint;
  const { sketch, picked } = resolveOrigin(base, chosen, origin);
  if (new Set(picked).size < picked.length) return type === "coincident" ? "Pick two different points" : hint;
  const middles = picked.flatMap((id) => middleLine(id) ?? []);
  if (middles.length) {
    // Coincident on a line's midpoint is a midpoint constraint; any other tool takes the line itself.
    if (type !== "coincident")
      return addConstraints(
        type,
        sketch,
        picked.map((id) => middleLine(id) ?? id),
        origin,
      );
    const others = picked.filter((id) => !middleLine(id));
    const point = others.length === 1 && sketch.entities.find((e) => e.id === others[0])?.kind === "point" ? others[0]! : null;
    if (middles.length === 2 && middles[0] !== middles[1]) return addConstraints("midpoint", sketch, middles, origin);
    if (middles.length === 1 && point) {
      const line = sketch.entities.find((e) => e.id === middles[0]);
      if (line?.kind === "line" && (line.a === point || line.b === point)) return "A line's end can't sit on its own midpoint";
      return addConstraints("midpoint", sketch, [point, middles[0]!], origin);
    }
    return hint;
  }
  const out = constraintsFor(type, sketch, picked);
  if (typeof out === "string") return out;
  const dr = new Draft(sketch);
  let mid: Id | undefined;
  for (const c of out) {
    if (c.type === "midpoint" && c.p === MIDPOINT_OF_FIRST) {
      if (!mid) {
        const l = sketch.entities.find((e) => e.id === c.line);
        if (l?.kind !== "line") return constraintToolById(type).hint;
        const [ax, ay] = dr.xy(l.a);
        const [bx, by] = dr.xy(l.b);
        mid = dr.point([(ax + bx) / 2, (ay + by) / 2], true);
      }
      dr.constrain({ ...c, p: mid });
    } else dr.constrain(c);
  }
  return dr.done().sketch;
}

/**
 * The constraints a constraint tool adds for a selection, or the hint when the selection does not fit. Lines and
 * curves may be picked where points are wanted for Fix (their points are fixed).
 */
export function constraintsFor(type: ConstraintToolId, sketch: Sketch, picked: Id[]): NewConstraint[] | string {
  const kinds = picked.map((id) => sketch.entities.find((e) => e.id === id)?.kind);
  const only = (k: string[]) => kinds.length > 0 && kinds.every((x) => x && k.includes(x));
  const hint = constraintToolById(type).hint;
  const two = picked.length === 2;
  const [a, b] = picked as [Id, Id];
  const curve = (k?: string) => k === "circle" || k === "arc";
  switch (type) {
    case "horizontalVertical": {
      if (two && only(["point"])) {
        // Two ends of one line: the line itself goes level or upright.
        const line = sketch.entities.find((e) => e.kind === "line" && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
        if (line) return constraintsFor(type, sketch, [line.id]);
        const pair = (c: (typeof sketch.constraints)[number]) =>
          (c.type === "horizontal" || c.type === "vertical") && !!c.b && ((c.e === a && c.b === b) || (c.e === b && c.b === a));
        if (sketch.constraints.some(pair)) return "Those points are already lined up";
        return [{ type: levelOrUprightPoints(sketch, a, b)!, e: a, b }];
      }
      if (!only(["line"])) return hint;
      const set = new Set(sketch.constraints.flatMap((c) => ((c.type === "horizontal" || c.type === "vertical") && !c.b ? [c.e] : [])));
      const fresh = picked.filter((e) => !set.has(e));
      if (!fresh.length) return picked.length === 1 ? "That line is already horizontal or vertical" : "Those lines are already horizontal or vertical";
      return fresh.map((e) => ({ type: levelOrUpright(sketch, e)!, e }));
    }
    case "parallel":
    case "perpendicular":
      return two && only(["line"]) ? [{ type, a, b }] : hint;
    case "equal":
      return two && (only(["line"]) || (curve(kinds[0]) && curve(kinds[1]))) ? [{ type, a, b }] : hint;
    case "concentric": {
      const round = (k?: string) => curve(k) || k === "ellipse";
      return two && round(kinds[0]) && round(kinds[1]) ? [{ type, a, b }] : hint;
    }
    case "tangent": {
      // A spline end leaves along a line it shares that end with (#269).
      const sp = picked.map((id) => sketch.entities.find((e) => e.id === id));
      const [s, l] = sp[0]?.kind === "spline" ? [sp[0], sp[1]] : [sp[1], sp[0]];
      if (two && s?.kind === "spline") {
        const ends = s.closed ? [] : [s.pts[0], s.pts[s.pts.length - 1]];
        return l?.kind === "line" && (ends.includes(l.a) || ends.includes(l.b))
          ? [{ type, a: s.id, b: l.id }]
          : "A spline is tangent to a line that ends on one of its ends";
      }
      return two && (curve(kinds[0]) || curve(kinds[1])) && kinds.every((k) => k === "line" || curve(k)) ? [{ type, a, b }] : hint;
    }
    case "coincident": {
      if (two && only(["point"])) return [{ type, a, b }];
      const p = picked[kinds.indexOf("point")];
      const e = picked.find((_, i) => kinds[i] !== "point");
      // Points can't sit on an ellipse yet: the solver holds an ellipse by its axes alone.
      return two && p && e && !kinds.includes("ellipse") && !kinds.includes("spline") ? [{ type: "pointOn", p, e }] : hint;
    }
    case "midpoint": {
      const p = picked[kinds.indexOf("point")];
      const line = picked[kinds.indexOf("line")];
      if (two && p && line) return [{ type, p, line }];
      // Two lines: their midpoints meet, through one line's midpoint (a new construction point if it has none).
      if (two && only(["line"])) {
        const mid = sketch.constraints.find((c) => c.type === "midpoint" && !c.suppressed && c.line === a);
        return mid?.type === "midpoint"
          ? [{ type, p: mid.p, line: b }]
          : [
              { type, p: MIDPOINT_OF_FIRST, line: a },
              { type, p: MIDPOINT_OF_FIRST, line: b },
            ];
      }
      return hint;
    }
    case "fix": {
      const pts = new Set<Id>();
      for (const id of picked) {
        const e = sketch.entities.find((x) => x.id === id);
        if (!e) continue;
        if (e.kind === "point") pts.add(e.id);
        else if (e.kind === "line") [e.a, e.b].forEach((p) => pts.add(p));
        else if (e.kind === "ellipse") {
          // Its centre and the ends of both axes: the whole ellipse stays put.
          pts.add(e.c);
          for (const ax of [e.ax1, e.ax2]) {
            const l = sketch.entities.find((x) => x.id === ax);
            if (l?.kind === "line") [l.a, l.b].forEach((p) => pts.add(p));
          }
        } else if (e.kind === "spline") e.pts.forEach((p) => pts.add(p));
        else [e.c, ...(e.kind === "arc" ? [e.a, e.b] : [])].forEach((p) => pts.add(p));
      }
      return pts.size ? [...pts].map((p) => ({ type, p })) : hint;
    }
    case "symmetric": {
      const pts = picked.filter((_, i) => kinds[i] === "point");
      const line = picked[kinds.indexOf("line")];
      return picked.length === 3 && pts.length === 2 && line ? [{ type, a: pts[0]!, b: pts[1]!, line }] : hint;
    }
    default:
      return hint;
  }
}

/**
 * The redundant constraints a strict change adds: none when the sketch was already this redundant before it (a fixed
 * line that is also horizontal, say), so old redundancy never blocks a new constraint.
 */
export function newlyRedundant(before: Pick<SolveResult, "status" | "redundant"> | null, after: Pick<SolveResult, "status" | "redundant">): Id[] {
  if (after.status !== "redundant") return [];
  const old = new Set(before?.status === "redundant" ? before.redundant : []);
  if (after.redundant.length <= old.size) return [];
  const fresh = after.redundant.filter((id) => !old.has(id));
  return fresh.length ? fresh : after.redundant;
}

/**
 * An axis as a sketch line a size can measure from: a fixed construction line along a to b, running past `near` (where
 * it was picked) and through a. The one already there is reused.
 */
export function axisLine(s: Sketch, a: Vec2, b: Vec2, near: Vec2): { sketch: Sketch; id: Id } {
  const u = norm(sub(b, a));
  const idx = new SketchIndex(s);
  const fixed = new Set(s.constraints.flatMap((c) => (c.type === "fix" ? [c.p] : [])));
  const on = (id: Id) => fixed.has(id) && Math.abs(cross(u, sub(idx.xy(id), a))) < 1e-6;
  const had = s.entities.find((e) => e.kind === "line" && e.construction && on(e.a) && on(e.b));
  if (had) return { sketch: s, id: had.id };
  const t = dot(sub(near, a), u);
  const half = Math.max(10, Math.abs(t) + 5);
  const d = new Draft(s);
  const ends = [t - half, t + half].map((k) => {
    const id = d.point(add(a, scale(u, k)), true);
    d.constrain({ type: "fix", p: id });
    return id;
  });
  const id = d.line(ends[0]!, ends[1]!, { construction: true, auto: false });
  return { sketch: d.done().sketch, id };
}
