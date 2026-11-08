import {
  SketchIndex,
  add,
  measureDimension,
  angleOf,
  dist,
  mid,
  norm,
  perp,
  polar,
  scale,
  sub,
  type Dimension,
  type DimensionKind,
  type Entity,
  type Id,
  type Sketch,
  type Vec2,
} from "@bettercad/sketch";

/**
 * How a dimension is drawn on the sketch, in sketch mm, as a drawing office would and as Fusion does: extension lines
 * out from the geometry, a dimension line with an arrow at each end, and the size sitting on it. `text` is where the
 * size sits; `arrows` point at their tips along `dir`. Angles have only their text for now.
 */
export interface DimensionArt {
  text: Vec2;
  lines: [Vec2, Vec2][];
  arrows: { tip: Vec2; dir: Vec2 }[];
}

/** How far out from the geometry a size sits until it is placed or dragged, in screen pixels. */
export const DIM_OFFSET_PX = 26;

/**
 * Whether a size has been placed (with the Dimension tool) or dragged. A placed size keeps its label where it was put,
 * in sketch mm from its anchor; one never placed sits a fixed number of pixels out, on the side away from the middle.
 */
export const isPlaced = (d: Pick<Dimension, "labelOffset">): boolean => d.labelOffset[0] !== 0 || d.labelOffset[1] !== 0;

/** The label offset that puts a size's label at `xy`, never exactly zero so it counts as placed. */
export function offsetTo(idx: SketchIndex, d: Dimension, xy: Vec2): Vec2 {
  const round = roundOf(idx, d);
  if (round) {
    // Round sizes keep their label out past the rim, along the leader from the centre: the gap past the rim.
    const v = sub(xy, round.c);
    const len = Math.hypot(v[0], v[1]);
    const u: Vec2 = len > 1e-9 ? scale(v, 1 / len) : [Math.cos(round.ang), Math.sin(round.ang)];
    return scale(u, Math.max(len - round.r, 1e-6));
  }
  const o = sub(xy, dimensionAnchor(idx, d));
  return o[0] === 0 && o[1] === 0 ? [1e-6, 0] : o;
}

/**
 * Which way a size between two points runs, from where the pointer is while placing it, as in Fusion: off the end of
 * the box the two points span, above or below it, the size is level (across); off its left or right side it is upright
 * (up); anywhere else, inside the box or past a corner, it runs along the line between them (aligned). Points already
 * level or upright only size aligned.
 */
export type DimDirection = "aligned" | "x" | "y";
export function directionAt(p: Vec2, q: Vec2, at: Vec2): DimDirection {
  const span = Math.max(dist(p, q), 1e-9);
  const [x0, x1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0])];
  const [y0, y1] = [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
  if (x1 - x0 < 1e-6 * span || y1 - y0 < 1e-6 * span) return "aligned";
  const inX = at[0] >= x0 && at[0] <= x1;
  const inY = at[1] >= y0 && at[1] <= y1;
  if (inX && !inY) return "x";
  if (inY && !inX) return "y";
  return "aligned";
}

/** The two ends a size's direction is chosen between: a line's ends, or two points. Null for any other size. */
export function dimensionEnds(idx: SketchIndex, kind: Dimension["kind"], refs: string[]): [Vec2, Vec2] | null {
  const e0 = refs[0] ? idx.get(refs[0]) : undefined;
  const e1 = refs[1] ? idx.get(refs[1]) : undefined;
  if (!e0) return null;
  if (refs.length === 1 && e0.kind === "line" && (kind === "length" || kind === "distanceX" || kind === "distanceY")) return [idx.xy(e0.a), idx.xy(e0.b)];
  if (refs.length === 2 && e0.kind === "point" && e1?.kind === "point" && (kind === "distance" || kind === "distanceX" || kind === "distanceY"))
    return [
      [e0.x, e0.y],
      [e1.x, e1.y],
    ];
  return null;
}

/** The kind a size takes for a direction: aligned keeps a line's length or a plain distance. */
export function kindFor(refs: string[], idx: SketchIndex, dir: DimDirection): Dimension["kind"] {
  if (dir === "x") return "distanceX";
  if (dir === "y") return "distanceY";
  return idx.get(refs[0]!)?.kind === "line" && refs.length === 1 ? "length" : "distance";
}

/** The point a size's label offset is measured from: the middle of what it measures, a rim point, or the foot on a line. */
export function dimensionAnchor(idx: SketchIndex, d: Pick<Dimension, "kind" | "refs">): Vec2 {
  const e0 = d.refs[0] ? idx.get(d.refs[0]) : undefined;
  const e1 = d.refs[1] ? idx.get(d.refs[1]) : undefined;
  if (!e0) return [0, 0];
  if (e0.kind === "line" && !e1) return mid(idx.xy(e0.a), idx.xy(e0.b));
  if (d.kind === "radius" || d.kind === "diameter") {
    if (e0.kind !== "circle" && e0.kind !== "arc") return anchorOf(idx, e0);
    return polar(idx.xy(e0.c), e0.r, rimAngle(idx, e0));
  }
  if (!e1) return anchorOf(idx, e0);
  if (d.kind === "angle") return mid(anchorOf(idx, e0), anchorOf(idx, e1));
  const p = anchorOf(idx, e0);
  if (e1.kind === "line" && e0.kind === "point") {
    const q = footOn(idx, p, e1);
    return d.kind === "distance" ? q : mid(p, q);
  }
  return mid(p, anchorOf(idx, e1));
}

/** The circle or arc a radius or diameter measures: its centre, radius and the leader's default angle. */
function roundOf(idx: SketchIndex, d: Pick<Dimension, "kind" | "refs">): { c: Vec2; r: number; ang: number } | null {
  if (d.kind !== "radius" && d.kind !== "diameter") return null;
  const e = d.refs[0] ? idx.get(d.refs[0]) : undefined;
  if (!e || (e.kind !== "circle" && e.kind !== "arc")) return null;
  return { c: idx.xy(e.c), r: e.r, ang: rimAngle(idx, e) };
}

/**
 * A radius or diameter, as Fusion draws it: the dimension line runs from the circle through its centre and out along a
 * leader to the label, which sits `labelOffset` past the rim. So the label follows the circle when it moves or changes
 * size, and the line always reaches the label wherever it is dragged. Until placed, it sits a little out at 45°.
 */
function roundArt(kind: "radius" | "diameter", c: Vec2, r: number, ang: number, labelOffset: Vec2, px: number): DimensionArt {
  const placed = isPlaced({ labelOffset });
  const gap = Math.hypot(labelOffset[0], labelOffset[1]);
  const u: Vec2 = placed ? scale(labelOffset, 1 / gap) : [Math.cos(ang), Math.sin(ang)];
  const rim = add(c, scale(u, r));
  const text = placed ? add(rim, labelOffset) : add(rim, scale(u, 18 * px));
  const lines: [Vec2, Vec2][] = [[kind === "radius" ? c : add(c, scale(u, -r)), rim]];
  // The leader out to the label, ending under it.
  if (dist(rim, text) > 4 * px) lines.push([rim, text]);
  const arrows = [{ tip: rim, dir: u }];
  if (kind === "diameter") arrows.push({ tip: add(c, scale(u, -r)), dir: scale(u, -1) });
  return { text, lines, arrows };
}

function rimAngle(idx: SketchIndex, e: Entity & { kind: "circle" | "arc" }): number {
  if (e.kind === "circle") return Math.PI / 4;
  const c = idx.xy(e.c);
  return (angleOf(sub(idx.xy(e.a), c)) + angleOf(sub(idx.xy(e.b), c))) / 2;
}

function footOn(idx: SketchIndex, p: Vec2, l: Entity & { kind: "line" }): Vec2 {
  const a = idx.xy(l.a);
  const u = norm(sub(idx.xy(l.b), a));
  return add(a, scale(u, dot(sub(p, a), u)));
}

const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

export function anchorOf(idx: SketchIndex, e: Entity): Vec2 {
  if (e.kind === "point") return [e.x, e.y];
  if (e.kind === "line") return mid(idx.xy(e.a), idx.xy(e.b));
  if (e.kind === "circle") return polar(idx.xy(e.c), e.r, -Math.PI / 4);
  const c = idx.xy(e.c);
  return polar(c, e.r, (angleOf(sub(idx.xy(e.a), c)) + angleOf(sub(idx.xy(e.b), c))) / 2);
}

/**
 * A size measured from `a` to `b`, drawn on the side away from `centre` (the middle of the sketch) unless its label
 * has been moved. The dimension line runs parallel to a–b through the label.
 */
function aligned(a: Vec2, b: Vec2, px: number, centre: Vec2, labelOffset: Vec2): DimensionArt {
  const u = dist(a, b) > 1e-9 ? norm(sub(b, a)) : ([1, 0] as Vec2);
  const n = perp(u);
  const m = mid(a, b);
  const side = dot(n, sub(centre, m)) > 0 ? -1 : 1;
  const text = isPlaced({ labelOffset }) ? add(m, labelOffset) : add(m, scale(n, side * DIM_OFFSET_PX * px));
  const o = dot(sub(text, a), n);
  return along(a, b, n, o, px, text);
}

/**
 * A label dragged past either end of its dimension line: the line runs on out to it, so the size never floats loose.
 * `text` is on the dimension line's run, so only how far along it matters.
 */
function leader(a2: Vec2, b2: Vec2, u: Vec2, text: Vec2, px: number, lines: [Vec2, Vec2][]): void {
  const t = dot(sub(text, a2), u);
  const len = dist(a2, b2);
  if (t > len + 2 * px) lines.push([b2, add(a2, scale(u, t))]);
  else if (t < -2 * px) lines.push([a2, add(a2, scale(u, t))]);
}

/** The extension lines and the arrowed line for a size between `a` and `b`, `o` mm out along `n`. */
function along(a: Vec2, b: Vec2, n: Vec2, o: number, px: number, text: Vec2): DimensionArt {
  const s = o >= 0 ? 1 : -1;
  const a2 = add(a, scale(n, o));
  const b2 = add(b, scale(n, o));
  const lines: [Vec2, Vec2][] = [];
  // Extension lines leave a small gap at the geometry and run a little past the dimension line.
  if (Math.abs(o) > 4 * px) {
    lines.push([add(a, scale(n, s * 3 * px)), add(a2, scale(n, s * 5 * px))]);
    lines.push([add(b, scale(n, s * 3 * px)), add(b2, scale(n, s * 5 * px))]);
  }
  lines.push([a2, b2]);
  const u = dist(a2, b2) > 1e-9 ? norm(sub(b2, a2)) : perp(n);
  leader(a2, b2, u, text, px, lines);
  return {
    text,
    lines,
    arrows: [
      { tip: a2, dir: scale(u, -1) },
      { tip: b2, dir: u },
    ],
  };
}

export function dimensionArt(idx: SketchIndex, d: Dimension, px: number, centre: Vec2): DimensionArt {
  const e0 = d.refs[0] ? idx.get(d.refs[0]) : undefined;
  const e1 = d.refs[1] ? idx.get(d.refs[1]) : undefined;
  const textOnly = (at: Vec2): DimensionArt => ({ text: add(at, d.labelOffset), lines: [], arrows: [] });
  /** Where the label sits: where it was placed, or `auto` until then. */
  const textAt = (anchor: Vec2, auto: Vec2): Vec2 => (isPlaced(d) ? add(anchor, d.labelOffset) : auto);
  if (!e0) return textOnly([0, 0]);

  if (d.kind === "length" && e0.kind === "line") return aligned(idx.xy(e0.a), idx.xy(e0.b), px, centre, d.labelOffset);
  if ((d.kind === "distanceX" || d.kind === "distanceY") && e0.kind === "line" && !e1) return levelled(d.kind, idx.xy(e0.a), idx.xy(e0.b), px, centre, textAt);

  if (d.kind === "radius" || d.kind === "diameter") {
    if (e0.kind !== "circle" && e0.kind !== "arc") return textOnly(anchorOf(idx, e0));
    return roundArt(d.kind, idx.xy(e0.c), e0.r, rimAngle(idx, e0), d.labelOffset, px);
  }

  if (d.kind === "angle" || !e1) return textOnly(e1 ? mid(anchorOf(idx, e0), anchorOf(idx, e1)) : anchorOf(idx, e0));

  // Distances: between two points, or from a point to where it meets a line square on.
  const p = anchorOf(idx, e0);
  let q = anchorOf(idx, e1);
  if (e1.kind === "line" && e0.kind === "point") {
    const u = norm(sub(idx.xy(e1.b), idx.xy(e1.a)));
    q = footOn(idx, p, e1);
    if (d.kind === "distance") {
      // Square on to the line, as Fusion draws it: an extension line out from the point and one along the line, both
      // running parallel to the line out to where the label is, and the arrowed dimension line between them there.
      if (!isPlaced(d)) {
        // Until placed: straight across the gap, running on past the line to the size, which sits outside so it never
        // covers the corners a small gap sits beside.
        const v = dist(p, q) > 1e-9 ? norm(sub(q, p)) : perp(u);
        return along(p, q, u, 0, px, add(q, scale(v, 16 * px)));
      }
      const text = add(q, d.labelOffset);
      return along(p, q, u, dot(sub(text, p), u), px, text);
    }
  }
  if (d.kind === "distanceX" || d.kind === "distanceY") return levelled(d.kind, p, q, px, centre, textAt);
  return aligned(p, q, px, centre, d.labelOffset);
}

/** Across: a level dimension line above or below; Up: an upright one to the left or right. */
function levelled(kind: "distanceX" | "distanceY", a: Vec2, b: Vec2, px: number, centre: Vec2, textAt: (anchor: Vec2, auto: Vec2) => Vec2): DimensionArt {
  const axis = kind === "distanceX" ? 1 : 0;
  const n: Vec2 = axis === 1 ? [0, 1] : [1, 0];
  const m = mid(a, b);
  const side = m[axis]! < centre[axis]! ? -1 : 1;
  const text = textAt(m, add(m, scale(n, side * DIM_OFFSET_PX * px)));
  // Each extension line runs from its own point to the shared dimension line.
  const level = text[axis]!;
  const a2: Vec2 = axis === 1 ? [a[0], level] : [level, a[1]];
  const b2: Vec2 = axis === 1 ? [b[0], level] : [level, b[1]];
  const lines: [Vec2, Vec2][] = [];
  for (const [g, t] of [
    [a, a2],
    [b, b2],
  ] as const) {
    const len = dist(g, t);
    if (len > 4 * px) {
      const s = norm(sub(t, g));
      lines.push([add(g, scale(s, 3 * px)), add(t, scale(s, 5 * px))]);
    }
  }
  lines.push([a2, b2]);
  const u = dist(a2, b2) > 1e-9 ? norm(sub(b2, a2)) : perp(n);
  leader(a2, b2, u, text, px, lines);
  return {
    text,
    lines,
    arrows: [
      { tip: a2, dir: scale(u, -1) },
      { tip: b2, dir: u },
    ],
  };
}

/** A placing size's preview with its label at `xy` (left where it was when null), its direction picked from there. */
export function placeAt(sketch: Sketch, kind: DimensionKind, refs: Id[], xy: Vec2 | null): Dimension {
  const idx = new SketchIndex(sketch);
  const ends = dimensionEnds(idx, kind, refs);
  const k = ends && xy ? kindFor(refs, idx, directionAt(ends[0], ends[1], xy)) : kind;
  // A level or upright size on two points names the points; on a line it names the line.
  const dim: Dimension = { id: "placing", kind: k, refs, expression: "", value: 0, driving: true, labelOffset: [0, 0] };
  dim.value = measureDimension(sketch, dim);
  if (xy) dim.labelOffset = offsetTo(idx, dim, xy);
  return dim;
}
