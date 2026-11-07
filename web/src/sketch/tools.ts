import { Draft, arcFrom3, dist, polygonPoints, sub, angleOf, sampleArc, type Id, type Sketch, type Vec2, type NewConstraint } from "@bettercad/sketch";
import type { IconName } from "@bettercad/ui";
import type { Snap } from "./snap";

/**
 * The drawing tools (#53) as data: how many clicks each needs, what to preview while the pointer moves, which sizes
 * can be typed, and what one finished shape adds to the sketch. The sketch session routes pointer events here.
 */
export type SketchToolId = "select" | "line" | "rectangle" | "circle" | "arc" | "polygon" | "dimension" | "fillet" | "trim" | "offset" | "project";

/** Tools that draw new shapes click by click (the rest pick existing geometry). */
export type DrawToolId = "line" | "rectangle" | "circle" | "arc" | "polygon";
export const isDrawTool = (t: SketchToolId): t is DrawToolId => t in CLICKS;

export interface SketchTool {
  id: SketchToolId;
  label: string;
  icon: IconName;
  key: string;
  help: string;
  /** Sizes that can be typed while drawing, in order (Tab moves between them). */
  fields: string[];
}

export const SKETCH_TOOLS: SketchTool[] = [
  { id: "select", label: "Select", icon: "arrow", key: "v", help: "Click to pick, drag a point to move it. Enter finishes the sketch.", fields: [] },
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
  { id: "arc", label: "Arc", icon: "arc", key: "a", help: "Click where the arc starts and ends, then a point it passes through.", fields: [] },
  { id: "polygon", label: "Polygon", icon: "polygon", key: "n", help: "Click the centre, then a corner. Set the sides in the bar.", fields: ["Radius"] },
  {
    id: "dimension",
    label: "Dimension",
    icon: "dimension",
    key: "d",
    help: "Click a line, circle or arc, or two points or two lines, to size them.",
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
  { id: "trim", label: "Trim", icon: "crop", key: "t", help: "Hover a piece between crossings and click to remove it.", fields: [] },
  {
    id: "offset",
    label: "Offset",
    icon: "shrink",
    key: "o",
    help: "Click a line, arc or circle. The copy goes on the side the pointer is on. Set the distance in the bar.",
    fields: [],
  },
  { id: "project", label: "Project", icon: "body", key: "j", help: "Click a face of a part to bring its edges into the sketch.", fields: [] },
];

export const toolById = (id: SketchToolId) => SKETCH_TOOLS.find((t) => t.id === id)!;

/** How many clicks a tool takes to finish one shape. The line tool chains: each click after the first is a line. */
export const CLICKS: Record<DrawToolId, number> = { line: 2, rectangle: 2, circle: 2, arc: 3, polygon: 2 };

export interface Preview {
  /** Polylines in sketch mm. */
  lines: Vec2[][];
  /** The live sizes to show beside the cursor, in field order. */
  values: number[];
}

/** What a tool would draw now, from its placed clicks and the cursor. */
export function preview(tool: SketchToolId, clicks: Vec2[], cursor: Vec2, sides = 6): Preview {
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
    case "polygon": {
      const r = dist(a, cursor);
      const pts = polygonPoints(a, r, sides, angleOf(sub(cursor, a)));
      return { lines: [[...pts, pts[0]!]], values: [r] };
    }
    case "arc": {
      const b = clicks[1];
      if (!b) return { lines: [[a, cursor]], values: [] };
      const fit = arcFrom3(a, cursor, b);
      if (!fit) return { lines: [[a, b]], values: [] };
      const [s, e] = fit.ccw ? [a, b] : [b, a];
      return { lines: [sampleArc(fit.c, fit.r, angleOf(sub(s, fit.c)), angleOf(sub(e, fit.c)))], values: [fit.r] };
    }
    default:
      return { lines: [], values: [] };
  }
}

/**
 * Puts a snapped point in the draft: the point snapped to when there is one (shared corners), otherwise a new point,
 * tied to the line or curve it landed on.
 */
export function place(d: Draft, s: Snap): Id {
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
export function commit(tool: SketchToolId, sketch: Sketch, clicks: Snap[], typed: (number | undefined)[] = [], sides = 6): Commit | null {
  const d = new Draft(sketch);
  switch (tool) {
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

/** The constraints in the constraints group: what each needs picked, and the hint until it has it. */
export interface ConstraintTool {
  id: NewConstraint["type"];
  label: string;
  hint: string;
}

export const CONSTRAINT_TOOLS: ConstraintTool[] = [
  { id: "coincident", label: "Coincident", hint: "Pick two points, or a point and a line or curve" },
  { id: "horizontal", label: "Horizontal", hint: "Pick lines" },
  { id: "vertical", label: "Vertical", hint: "Pick lines" },
  { id: "parallel", label: "Parallel", hint: "Pick two lines" },
  { id: "perpendicular", label: "Perpendicular", hint: "Pick two lines" },
  { id: "tangent", label: "Tangent", hint: "Pick a line and a curve, or two curves" },
  { id: "equal", label: "Equal", hint: "Pick two lines, or two circles or arcs" },
  { id: "concentric", label: "Concentric", hint: "Pick two circles or arcs" },
  { id: "midpoint", label: "Midpoint", hint: "Pick a point and a line" },
  { id: "fix", label: "Fix", hint: "Pick points, lines or curves" },
  { id: "symmetric", label: "Symmetric", hint: "Pick two points and a line" },
];

/**
 * The constraints a constraint tool adds for a selection, or the hint when the selection does not fit. Lines and
 * curves may be picked where points are wanted for Fix (their points are fixed).
 */
export function constraintsFor(type: ConstraintTool["id"], sketch: Sketch, picked: Id[]): NewConstraint[] | string {
  const kinds = picked.map((id) => sketch.entities.find((e) => e.id === id)?.kind);
  const only = (k: string[]) => kinds.length > 0 && kinds.every((x) => x && k.includes(x));
  const hint = CONSTRAINT_TOOLS.find((t) => t.id === type)!.hint;
  const two = picked.length === 2;
  const [a, b] = picked as [Id, Id];
  const curve = (k?: string) => k === "circle" || k === "arc";
  switch (type) {
    case "horizontal":
    case "vertical":
      return only(["line"]) ? picked.map((e) => ({ type, e })) : hint;
    case "parallel":
    case "perpendicular":
      return two && only(["line"]) ? [{ type, a, b }] : hint;
    case "equal":
      return two && (only(["line"]) || (curve(kinds[0]) && curve(kinds[1]))) ? [{ type, a, b }] : hint;
    case "concentric":
      return two && curve(kinds[0]) && curve(kinds[1]) ? [{ type, a, b }] : hint;
    case "tangent":
      return two && (curve(kinds[0]) || curve(kinds[1])) && kinds.every((k) => k === "line" || curve(k)) ? [{ type, a, b }] : hint;
    case "coincident": {
      if (two && only(["point"])) return [{ type, a, b }];
      const p = picked[kinds.indexOf("point")];
      const e = picked.find((_, i) => kinds[i] !== "point");
      return two && p && e ? [{ type: "pointOn", p, e }] : hint;
    }
    case "midpoint": {
      const p = picked[kinds.indexOf("point")];
      const line = picked[kinds.indexOf("line")];
      return two && p && line ? [{ type, p, line }] : hint;
    }
    case "fix": {
      const pts = new Set<Id>();
      for (const id of picked) {
        const e = sketch.entities.find((x) => x.id === id);
        if (!e) continue;
        if (e.kind === "point") pts.add(e.id);
        else if (e.kind === "line") [e.a, e.b].forEach((p) => pts.add(p));
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
