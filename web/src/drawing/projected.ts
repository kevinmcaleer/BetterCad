import { frameOf, viewScale, type DrawingSheet, type DrawingView, type ViewDirection } from "@bettercad/kernel/drawing";
import { VIEWS, viewAxes, type V2, type V3, type ViewFrame } from "@bettercad/kernel/view";

/**
 * Projected views (#562): the view you get by looking at a parent view's model from one side, and where it sits.
 * A side is [across, up] on the sheet, each -1, 0 or 1: [1, 0] is to the right of the parent, [1, 1] above right.
 * Straight sides give orthographic views that stay lined up with the parent; diagonals give isometrics.
 */
export type Side = readonly [number, number];

export const SIDES: { id: string; label: string; side: Side }[] = [
  { id: "right", label: "To the right", side: [1, 0] },
  { id: "left", label: "To the left", side: [-1, 0] },
  { id: "above", label: "Above", side: [0, 1] },
  { id: "below", label: "Below", side: [0, -1] },
  { id: "above-right", label: "Above right, isometric", side: [1, 1] },
  { id: "above-left", label: "Above left, isometric", side: [-1, 1] },
  { id: "below-right", label: "Below right, isometric", side: [1, -1] },
  { id: "below-left", label: "Below left, isometric", side: [-1, -1] },
];
export const sideId = (s: Side) => SIDES.find((x) => x.side[0] === s[0] && x.side[1] === s[1])?.id ?? "right";

const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const tidy = (v: V3): V3 => v.map((x) => Math.round(x * 1e9) / 1e9 + 0) as V3;
const along = (a: V3, b: V3) => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return dot / (Math.hypot(...a) * Math.hypot(...b) || 1) > 1 - 1e-9;
};
const same = (f: ViewFrame, g: ViewFrame) => along(f.toEye, g.toEye) && along(f.up, g.up);

/**
 * The view of a parent's model from [across, up] of where the parent looks from: [1, 0] is from its right, [0, 1]
 * from above it, and a diagonal is the isometric over that corner.
 */
export function frameFrom(parent: ViewFrame, from: Side): ViewFrame {
  const { x, y, z } = viewAxes(parent);
  const [a, b] = from;
  if (a && b) return { toEye: tidy(add(add(z, x, a), y, b)), up: tidy(y) };
  if (a) return { toEye: tidy(add([0, 0, 0], x, a)), up: tidy(y) };
  return { toEye: tidy(add([0, 0, 0], y, b)), up: tidy(add([0, 0, 0], z, -b)) };
}

/**
 * Where a view placed on a side of its parent looks from. Third angle shows what you see from that side (the top
 * view sits above the front); first angle shows the far side (the top view sits below). Isometrics are the same in both.
 */
export const seenFrom = (side: Side, angle: "first" | "third"): Side => (angle === "first" && !(side[0] && side[1]) ? [-side[0], -side[1]] : side);

/** A frame as a view's direction: its name where it is one of the named views, so files and labels stay short. */
export function directionFor(frame: ViewFrame): ViewDirection {
  const named = (Object.keys(VIEWS) as (keyof typeof VIEWS)[]).find((k) => same(VIEWS[k], frame));
  return named ?? frame;
}

/** The direction of the view placed on a side of a parent. */
export const projectedDirection = (parent: ViewDirection, side: Side, angle: "first" | "third"): ViewDirection =>
  directionFor(frameFrom(frameOf(parent), seenFrom(side, angle)));

/** Which [across, up] of its parent a view looks from, if it is one of the eight. */
export function relationOf(parent: ViewDirection, child: ViewDirection): Side | undefined {
  const p = frameOf(parent);
  const c = frameOf(child);
  for (const { side } of SIDES) if (same(frameFrom(p, side), c)) return side;
  return undefined;
}

const parentOf = (sheet: DrawingSheet, v: DrawingView) => (v.parent ? sheet.views.find((x) => x.id === v.parent) : undefined);

/**
 * How a projected view is held to its parent: "x" slides across the sheet level with it, "y" up and down in line
 * with it. Isometrics and base views move freely.
 */
export function slides(sheet: DrawingSheet, view: DrawingView): "x" | "y" | undefined {
  const parent = parentOf(sheet, view);
  const from = parent && relationOf(parent.direction, view.direction);
  if (!from || (from[0] && from[1])) return undefined;
  return from[0] ? "x" : "y";
}

/** A position kept in line with the view's parent. */
export function lineUp(sheet: DrawingSheet, view: DrawingView, at: V2): V2 {
  const parent = parentOf(sheet, view);
  const way = slides(sheet, view);
  return !parent || !way ? at : way === "x" ? [at[0], parent.at[1]] : [parent.at[0], at[1]];
}

/** The side of a parent the pointer is on: within 30° of straight across or up is orthographic, the rest isometric. */
export function sideAt(d: V2): Side {
  const turn = (Math.atan2(Math.abs(d[1]), Math.abs(d[0])) * 180) / Math.PI;
  const sx = d[0] < 0 ? -1 : 1;
  const sy = d[1] < 0 ? -1 : 1;
  return turn <= 30 ? [sx, 0] : turn >= 60 ? [0, sy] : [sx, sy];
}

/** Clear paper between a parent and a view placed from the keyboard, mm. */
export const GAP = 15;

/** Where a view of a size goes on a side of its parent with no pointer to say: just clear of it. */
export function spotBeside(parent: { at: V2; w: number; h: number }, child: { w: number; h: number }, side: Side): V2 {
  return [parent.at[0] + side[0] * ((parent.w + child.w) / 2 + GAP), parent.at[1] + side[1] * ((parent.h + child.h) / 2 + GAP)];
}

/** Where the view being placed sits for a pointer position: lined up with the parent on a straight side, free on a diagonal. */
export function spotAt(parentAt: V2, pointer: V2, side: Side): V2 {
  return side[0] && side[1] ? pointer : side[0] ? [pointer[0], parentAt[1]] : [parentAt[0], pointer[1]];
}

/** Puts a projected view on the sheet. It shows what its parent shows, with the parent's lines and scale. */
export function placeProjected(sheet: DrawingSheet, id: string, parentId: string, side: Side, angle: "first" | "third", at: V2): DrawingSheet {
  const parent = sheet.views.find((v) => v.id === parentId);
  if (!parent) return sheet;
  const view: DrawingView = {
    id,
    kind: "projected",
    parent: parentId,
    shows: parent.shows,
    direction: projectedDirection(parent.direction, side, angle),
    hidden: parent.hidden,
    tangent: parent.tangent,
    at,
  };
  if (parent.style) view.style = parent.style;
  if (parent.explode) view.explode = parent.explode;
  return { ...sheet, views: [...sheet.views, { ...view, at: lineUp({ ...sheet, views: [...sheet.views, view] }, view, at) }] };
}

/** Every view projected from a view, and from those. */
export function descendants(sheet: DrawingSheet, id: string): DrawingView[] {
  const out: DrawingView[] = [];
  const seen = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const v of sheet.views) {
      if (v.parent && seen.has(v.parent) && !seen.has(v.id)) {
        seen.add(v.id);
        out.push(v);
        grew = true;
      }
    }
  }
  return out;
}

/** Moves a view, kept in line with its parent, and carries the views projected from it. */
export function moveWithChildren(sheet: DrawingSheet, id: string, to: V2): DrawingSheet {
  const view = sheet.views.find((v) => v.id === id);
  if (!view) return sheet;
  const at = lineUp(sheet, view, to);
  const by: V2 = [at[0] - view.at[0], at[1] - view.at[1]];
  if (!by[0] && !by[1]) return sheet;
  const carried = new Set(descendants(sheet, id).map((v) => v.id));
  return {
    ...sheet,
    views: sheet.views.map((v) => (v.id === id ? { ...v, at } : carried.has(v.id) ? { ...v, at: [v.at[0] + by[0], v.at[1] + by[1]] as V2 } : v)),
  };
}

/**
 * After a parent changes, its projected views follow: they show what it shows, look from the same side of its new
 * direction, and take its line style where they still had its old one.
 */
export function followParent(sheet: DrawingSheet, before: DrawingView): DrawingSheet {
  const views = new Map(sheet.views.map((v) => [v.id, v]));
  const was = new Map(sheet.views.map((v) => [v.id, v]));
  was.set(before.id, before);
  const walk = (id: string) => {
    const parent = views.get(id)!;
    const old = was.get(id)!;
    for (const v of sheet.views) {
      if (v.parent !== id) continue;
      // A section keeps its cut and where it looks from; a detail looks the way its parent does.
      const from = v.kind === "section" ? undefined : relationOf(old.direction, v.direction);
      views.set(v.id, {
        ...v,
        shows: parent.shows,
        direction: v.kind === "detail" ? parent.direction : from ? directionFor(frameFrom(frameOf(parent.direction), from)) : v.direction,
        hidden: v.hidden === old.hidden ? parent.hidden : v.hidden,
        tangent: v.tangent === old.tangent ? parent.tangent : v.tangent,
        // Sections and details stay line art.
        style: v.kind === "projected" && v.style === old.style ? parent.style : v.style,
      });
      walk(v.id);
    }
  };
  walk(before.id);
  return { ...sheet, views: sheet.views.map((v) => views.get(v.id)!) };
}

/**
 * Switching between first and third angle: each orthographic projected view swaps to the other side of its parent,
 * so the top view that sat above the front now sits below it. Isometrics keep their place beside their parent.
 */
export function flipAngle(sheet: DrawingSheet): DrawingSheet {
  const at = new Map<string, V2>();
  const place = (v: DrawingView): V2 => {
    const done = at.get(v.id);
    if (done) return done;
    at.set(v.id, v.at);
    const parent = parentOf(sheet, v);
    if (!parent) return v.at;
    const p = place(parent);
    const k = slides(sheet, v) ? -1 : 1;
    const next: V2 = [p[0] + k * (v.at[0] - parent.at[0]), p[1] + k * (v.at[1] - parent.at[1])];
    at.set(v.id, next);
    return next;
  };
  return { ...sheet, views: sheet.views.map((v) => ({ ...v, at: place(v) })) };
}

/** The scale a view has when it doesn't keep its own: its parent's, or the sheet's. */
export function inheritedScale(sheet: DrawingSheet, view: DrawingView): number {
  const parent = parentOf(sheet, view);
  return parent ? viewScale(sheet, parent) : sheet.scale;
}
