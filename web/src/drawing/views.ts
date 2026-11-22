import { fitScale, frameOf, viewScale, type DrawingSheet, type DrawingView, type ViewDirection } from "@bettercad/kernel/drawing";
import { TAU, turn, type ModelView, type ModelViewRequest, type V2, type ViewCurve } from "@bettercad/kernel/view";
import type { Box, SheetLayout } from "./layout";
import { followParent, inheritedScale, moveWithChildren } from "./projected";

/**
 * Views on a sheet (#561): which way each looks, how the kernel's flat curves become lines on paper, and where a view
 * sits. No DOM here, so the screen, tests and export (#569) draw a view the same way.
 */
export const DIRECTIONS: { id: string; label: string; direction: ViewDirection }[] = [
  { id: "front", label: "Front", direction: "front" },
  { id: "back", label: "Back", direction: "back" },
  { id: "left", label: "Left", direction: "left" },
  { id: "right", label: "Right", direction: "right" },
  { id: "top", label: "Top", direction: "top" },
  { id: "bottom", label: "Bottom", direction: "bottom" },
  { id: "iso", label: "Isometric, front right", direction: "iso" },
  { id: "iso-fl", label: "Isometric, front left", direction: { toEye: [-1, -1, 1], up: [0, 0, 1] } },
  { id: "iso-br", label: "Isometric, back right", direction: { toEye: [1, 1, 1], up: [0, 0, 1] } },
  { id: "iso-bl", label: "Isometric, back left", direction: { toEye: [-1, 1, 1], up: [0, 0, 1] } },
];

/** The entry of DIRECTIONS a view's direction is, if it is one of them. */
export function directionOf(d: ViewDirection) {
  const f = frameOf(d);
  return DIRECTIONS.find((x) => {
    const g = frameOf(x.direction);
    return g.toEye.every((v, i) => v === f.toEye[i]) && g.up.every((v, i) => v === f.up[i]);
  });
}

/** "Front view", "Isometric view", or "View" for a direction of its own. */
export function viewName(view: Pick<DrawingView, "direction">): string {
  // A top view turned on the sheet is still a top view: only where it looks from names it.
  const eye = frameOf(view.direction).toEye;
  const d = directionOf(view.direction) ?? DIRECTIONS.find((x) => frameOf(x.direction).toEye.every((v, i) => v === eye[i]));
  return d ? `${d.label.replace(/,.*/, "")} view` : "View";
}

/** What to ask the kernel for. A preview skips hidden edges and tracing, which is several times quicker. */
export function viewRequest(view: Pick<DrawingView, "shows" | "direction" | "hidden" | "tangent">, preview = false): ModelViewRequest {
  return { shows: view.shows, frame: frameOf(view.direction), hidden: preview ? false : view.hidden, smooth: view.tangent, trace: !preview };
}

const n = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * A curve as SVG path data on paper: millimetres from the middle of the view's box, at the view's scale, with y
 * flipped because the view plane's y is up and the page's is down.
 */
export function curvePath(curve: ViewCurve, scale: number, mid: V2): string {
  const p = (q: V2) => `${n((q[0] - mid[0]) * scale)} ${n((mid[1] - q[1]) * scale)}`;
  const round = (rx: number, ry: number, tilt: number, at: (t: number) => V2, from?: number, to?: number) => {
    // Anticlockwise on the view plane is still anticlockwise on the page: sweep flag 0.
    const radii = `${n(rx * scale)} ${n(ry * scale)} ${n((-tilt * 180) / Math.PI)}`;
    if (from === undefined) return `M${p(at(0))}A${radii} 1 0 ${p(at(Math.PI))}A${radii} 1 0 ${p(at(0))}`;
    const sweep = turn(to! - from) || TAU;
    return `M${p(at(from))}A${radii} ${sweep > Math.PI ? 1 : 0} 0 ${p(at(from + sweep))}`;
  };
  switch (curve.kind) {
    case "line":
      return `M${p(curve.a)}L${p(curve.b)}`;
    case "poly":
      return curve.pts.map((q, i) => `${i ? "L" : "M"}${p(q)}`).join("");
    case "circle":
    case "arc": {
      const at = (t: number): V2 => [curve.c[0] + curve.r * Math.cos(t), curve.c[1] + curve.r * Math.sin(t)];
      return curve.kind === "circle" ? round(curve.r, curve.r, 0, at) : round(curve.r, curve.r, 0, at, curve.from, curve.to);
    }
    case "ellipse": {
      const [cs, sn] = [Math.cos(curve.turn), Math.sin(curve.turn)];
      const at = (t: number): V2 => {
        const [u, v] = [curve.rx * Math.cos(t), curve.ry * Math.sin(t)];
        return [curve.c[0] + u * cs - v * sn, curve.c[1] + u * sn + v * cs];
      };
      return round(curve.rx, curve.ry, curve.turn, at, curve.from, curve.to);
    }
  }
}

export interface ViewArt {
  /** Path data for the edges you can see, and for those behind (drawn dashed). */
  visible: string;
  hidden: string;
  /** The view's size on paper, mm. */
  w: number;
  h: number;
}

/** A model view as two paths about the middle of its box, at a scale. */
export function viewArt(view: ModelView, scale: number): ViewArt {
  const { min, max } = view.box;
  const mid: V2 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  let visible = "";
  let hidden = "";
  for (const e of view.edges) {
    const d = curvePath(e.curve, scale, mid);
    if (e.visible) visible += d;
    else hidden += d;
  }
  return { visible, hidden, w: Math.max(0, (max[0] - min[0]) * scale), h: Math.max(0, (max[1] - min[1]) * scale) };
}

/** True when a view came back with nothing in it: no bodies, or all of them hidden. */
export const emptyView = (view: ModelView) => view.edges.length === 0;

/**
 * Sheet positions are millimetres from the page's bottom left corner, y up, so a view stays where it is from that
 * corner when the page changes size (#560). These turn one into the page's own top-left, y-down millimetres and back.
 */
export const toPage = (at: V2, pageH: number): V2 => [at[0], pageH - at[1]];
export const fromPage = toPage;

/** The clear part of the frame: everything above the title block. */
export function freeSpace(l: SheetLayout): Box {
  return { x: l.frame.x, y: l.frame.y, w: l.frame.w, h: l.block.y - l.frame.y };
}

/** Where a new view goes when it is placed from the keyboard: the middle of the clear space, as a sheet position. */
export function defaultSpot(l: SheetLayout): V2 {
  const s = freeSpace(l);
  return fromPage([s.x + s.w / 2, s.y + s.h / 2], l.page.h);
}

/**
 * The scale Fit picks for a base view: the largest standard scale at which it takes up no more than about 40% of the
 * clear space each way, leaving room for the views projected from it and their dimensions.
 */
export function fitView(view: ModelView, l: SheetLayout): number {
  const s = freeSpace(l);
  return fitScale({ w: view.box.max[0] - view.box.min[0], h: view.box.max[1] - view.box.min[1] }, { w: s.w * 0.4, h: s.h * 0.4 });
}

/** What the Base view card decides. `scale` is missing for Fit. */
export interface ViewChoice {
  shows: DrawingView["shows"];
  direction: ViewDirection;
  scale?: number;
  hidden: boolean;
  tangent: boolean;
}

/**
 * Puts a base view on the sheet. The first one sets the sheet's scale, which the title block shows; later ones keep
 * their own only when it differs.
 */
export function placeView(sheet: DrawingSheet, id: string, choice: ViewChoice, scale: number, at: V2): DrawingSheet {
  const first = sheet.views.length === 0;
  const view: DrawingView = { id, kind: "base", shows: choice.shows, direction: choice.direction, hidden: choice.hidden, tangent: choice.tangent, at };
  if (!first && scale !== sheet.scale) view.scale = scale;
  return { ...sheet, scale: first ? scale : sheet.scale, views: [...sheet.views, view] };
}

/**
 * Changes a placed view from its card. The view that set the sheet's scale changes the sheet's with its own; any
 * other keeps a scale only when it differs from the one it would have anyway. The views projected from it follow.
 */
export function editView(sheet: DrawingSheet, id: string, choice: ViewChoice, scale: number): DrawingSheet {
  const before = sheet.views.find((v) => v.id === id);
  if (!before) return sheet;
  const leads = sheet.views[0]?.id === id && before.scale === undefined && !before.parent;
  const next: DrawingView = { ...before, shows: choice.shows, direction: choice.direction, hidden: choice.hidden, tangent: choice.tangent };
  if (leads || scale === inheritedScale(sheet, before)) delete next.scale;
  else next.scale = scale;
  return followParent({ ...sheet, scale: leads ? scale : sheet.scale, views: sheet.views.map((v) => (v.id === id ? next : v)) }, before);
}

/** Moves a view. A projected view stays in line with its parent, and the views projected from it come too. */
export const moveView = moveWithChildren;

export { viewScale };
