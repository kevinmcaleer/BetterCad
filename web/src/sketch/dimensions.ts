import { SketchIndex, add, angleOf, dist, mid, norm, perp, polar, scale, sub, type Dimension, type Entity, type Vec2 } from "@bettercad/sketch";

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

/** How far out from the geometry a size sits until it is dragged, in screen pixels. */
export const DIM_OFFSET_PX = 26;

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
  const text = add(add(m, scale(n, side * DIM_OFFSET_PX * px)), labelOffset);
  const o = dot(sub(text, a), n);
  return along(a, b, n, o, px, text);
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
  const u = dist(a2, b2) > 1e-9 ? norm(sub(b2, a2)) : ([1, 0] as Vec2);
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
  if (!e0) return textOnly([0, 0]);

  if (d.kind === "length" && e0.kind === "line") return aligned(idx.xy(e0.a), idx.xy(e0.b), px, centre, d.labelOffset);

  if (d.kind === "radius" || d.kind === "diameter") {
    if (e0.kind !== "circle" && e0.kind !== "arc") return textOnly(anchorOf(idx, e0));
    const c = idx.xy(e0.c);
    const ang = e0.kind === "arc" ? (angleOf(sub(idx.xy(e0.a), c)) + angleOf(sub(idx.xy(e0.b), c))) / 2 : Math.PI / 4;
    const u: Vec2 = [Math.cos(ang), Math.sin(ang)];
    const rim = polar(c, e0.r, ang);
    const text = add(add(rim, scale(u, 18 * px)), d.labelOffset);
    if (d.kind === "radius") return { text, lines: [[c, rim]], arrows: [{ tip: rim, dir: u }] };
    const far = polar(c, e0.r, ang + Math.PI);
    return {
      text,
      lines: [[far, rim]],
      arrows: [
        { tip: rim, dir: u },
        { tip: far, dir: scale(u, -1) },
      ],
    };
  }

  if (d.kind === "angle" || !e1) return textOnly(e1 ? mid(anchorOf(idx, e0), anchorOf(idx, e1)) : anchorOf(idx, e0));

  // Distances: between two points, or from a point to where it meets a line square on.
  const p = anchorOf(idx, e0);
  let q = anchorOf(idx, e1);
  if (e1.kind === "line" && e0.kind === "point") {
    const a = idx.xy(e1.a);
    const u = norm(sub(idx.xy(e1.b), a));
    q = add(a, scale(u, dot(sub(p, a), u)));
    if (d.kind === "distance") {
      // Square on to the line: the dimension line spans the gap and runs on past the line to the size, which sits
      // outside so it never covers the corners a small gap sits beside.
      const v = dist(p, q) > 1e-9 ? norm(sub(q, p)) : perp(u);
      const text = add(add(q, scale(v, 16 * px)), d.labelOffset);
      return {
        text,
        lines: [[p, add(q, scale(v, 8 * px))]],
        arrows: [
          { tip: p, dir: scale(v, -1) },
          { tip: q, dir: v },
        ],
      };
    }
  }
  if (d.kind === "distanceX" || d.kind === "distanceY") {
    // Across: a level dimension line above or below; Up: an upright one to the left or right.
    const axis = d.kind === "distanceX" ? 1 : 0;
    const n: Vec2 = axis === 1 ? [0, 1] : [1, 0];
    const m = mid(p, q);
    const side = m[axis]! < centre[axis]! ? -1 : 1;
    const text = add(add(m, scale(n, side * DIM_OFFSET_PX * px)), d.labelOffset);
    const [a, b] = [p, q];
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
    return {
      text,
      lines,
      arrows: [
        { tip: a2, dir: scale(u, -1) },
        { tip: b2, dir: u },
      ],
    };
  }
  return aligned(p, q, px, centre, d.labelOffset);
}
