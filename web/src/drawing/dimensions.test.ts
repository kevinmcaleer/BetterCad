import { describe, expect, it } from "vitest";
import type { DrawingRef } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import {
  addPick,
  defaultSpot,
  dimArt,
  dimName,
  dimPicks,
  dimStyle,
  directionAt,
  draftOf,
  isIso,
  measured,
  sizeText,
  textWidth,
  type DimContext,
} from "./dimensions";
import { targets } from "./marks";

const TAU = Math.PI * 2;
const face = (index: number, name: string) => ({ body: "b1", kind: "face" as const, index, name });
const edge = (index: number) => ({ body: "b1", kind: "edge" as const, index });
const bolts: V2[] = [0, 1, 2, 3].map((i) => [Math.round(20 * Math.cos((i * TAU) / 4)), Math.round(20 * Math.sin((i * TAU) / 4))]);
/**
 * A 60 mm plate about the origin with one corner chamfered and one filleted: four 5 mm holes on a bolt circle, a
 * 12 mm bore and a cross hole seen from the side.
 */
const plate = {
  edges: [
    { curve: { kind: "line", a: [-25, -30], b: [30, -30] }, visible: true, type: "sharp", source: edge(0) },
    { curve: { kind: "line", a: [30, -30], b: [30, 20] }, visible: true, type: "sharp", source: edge(1) },
    { curve: { kind: "line", a: [30, 20], b: [20, 30] }, visible: true, type: "sharp", source: edge(2) },
    { curve: { kind: "line", a: [20, 30], b: [-30, 30] }, visible: true, type: "sharp", source: edge(3) },
    { curve: { kind: "line", a: [-30, 30], b: [-30, -25] }, visible: true, type: "sharp", source: edge(4) },
    { curve: { kind: "arc", c: [-25, -25], r: 5, from: Math.PI, to: Math.PI * 1.5 }, visible: true, type: "sharp", source: edge(5) },
    { curve: { kind: "line", a: [-2, 24], b: [2, 24] }, visible: true, type: "sharp", source: edge(6) },
  ],
  box: { min: [-30, -30], max: [30, 30] },
  rounds: [
    ...bolts.map((c, i) => ({ seen: "end", c, r: 2.5, hole: true, sweep: TAU, source: face(10 + i, `hole${i}`) })),
    { seen: "end", c: [0, 0], r: 6, hole: true, sweep: TAU, source: face(20, "bore") },
    { seen: "side", a: [-30, 10], b: [30, 10], r: 1.5, hole: true, sweep: TAU, source: face(22, "cross") },
  ],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
const all = targets(plate);
const picks = dimPicks("v1", plate);
const e = (index: number, at?: DrawingRef["at"]): DrawingRef => ({ view: "v1", ...edge(index), ...(at ? { at } : {}) });
const f = (name: string, at?: DrawingRef["at"]): DrawingRef => ({
  view: "v1",
  ...face(name === "bore" ? 20 : name === "cross" ? 22 : 10 + Number(name.slice(4)), name),
  ...(at ? { at } : {}),
});
const ctx = (standard: "iso" | "asme" = "iso", scale = 1, more: Partial<DimContext> = {}): DimContext => ({
  view: plate,
  scale,
  style: dimStyle(standard),
  decimals: 2,
  all,
  ...more,
});
const close = (got: V2, want: V2) => {
  expect(got[0]).toBeCloseTo(want[0], 6);
  expect(got[1]).toBeCloseTo(want[1], 6);
};

describe("what the Dimension tool can pick in a view", () => {
  it("offers edges, axes and circles by name, then their ends, centres and middles, each place once", () => {
    expect(picks.filter((p) => p.kind === "edge").map((p) => p.name)).toEqual([
      "Axis of a hole, 3 mm across",
      "Edge, 55 mm long",
      "Edge, 50 mm long",
      "Edge, 14.14 mm long",
      "Edge, 50 mm long",
      "Edge, 55 mm long",
      "Edge, 4 mm long",
    ]);
    expect(picks.filter((p) => p.kind === "round").map((p) => p.name)).toEqual([
      "Hole, 5 mm across",
      "Hole, 5 mm across",
      "Hole, 5 mm across",
      "Hole, 5 mm across",
      "Hole, 12 mm across",
      "Arc, 10 mm across",
    ]);
    const points = picks.filter((p) => p.kind === "point");
    // Shared corners are one point, on the first edge that reaches them.
    expect(points.filter((p) => p.name === "Point at 30, -30 mm")).toHaveLength(1);
    expect(points.find((p) => p.name === "Point at 30, -30 mm")!.ref).toEqual(e(0, "end"));
    expect(points.find((p) => p.name === "Centre at 0, 0 mm")!.ref).toEqual(f("bore", "centre"));
    expect(points.find((p) => p.name === "Midpoint at 30, -5 mm")!.ref).toEqual(e(1, "middle"));
    expect(new Set(points.map((p) => p.name)).size).toBe(points.length);
  });
});

describe("what a dimension measures", () => {
  it("is an edge's length, or the distance between two points, free to run across, up or aligned", () => {
    expect(measured([e(0)], all)).toEqual({ kind: "linear", p: [-25, -30], q: [30, -30], free: true });
    expect(measured([f("hole0", "centre"), f("hole1", "centre")], all)).toEqual({ kind: "linear", p: [20, 0], q: [0, 20], free: true });
    // A circle picked with something else stands for its centre.
    expect(measured([f("bore"), e(1, "start")], all)).toEqual({ kind: "linear", p: [0, 0], q: [30, -30], free: true });
  });

  it("is square to an edge from a point, or between two edges side by side", () => {
    expect(measured([e(1), f("bore", "centre")], all)).toEqual({ kind: "linear", p: [30, 0], q: [0, 0], free: false });
    expect(measured([f("bore", "centre"), e(1)], all)).toEqual({ kind: "linear", p: [30, 0], q: [0, 0], free: false });
    expect(measured([e(0), e(3)], all)).toEqual({ kind: "linear", p: [2.5, -30], q: [2.5, 30], free: false });
    // A hole seen from the side measures from its axis.
    expect(measured([f("cross"), e(0)], all)).toEqual({ kind: "linear", p: [0, 10], q: [0, -30], free: false });
  });

  it("is an angle between two edges that are not side by side, about where they would cross", () => {
    const m = measured([e(0), e(4)], all);
    expect(m?.kind).toBe("angle");
    close((m as { v: V2 }).v, [-30, -30]);
  });

  it("is a diameter for a circle and a radius for an arc", () => {
    expect(measured([f("bore")], all)).toEqual({ kind: "diameter", c: [0, 0], r: 6, hole: true });
    expect(measured([e(5)], all)).toEqual({ kind: "radius", c: [-25, -25], r: 5, hole: false });
  });

  it("is nothing for one point, the same thing twice, or an edge the model no longer has", () => {
    expect(measured([e(0, "start")], all)).toBeUndefined();
    expect(measured([e(0, "end"), e(1, "start")], all)).toBeUndefined();
    expect(measured([e(99)], all)).toBeUndefined();
    expect(measured([e(0), { ...f("bore"), name: "gone" }], all)).toBeUndefined();
    expect(dimArt({ refs: [e(99)], at: [0, 0] }, ctx())).toBeUndefined();
  });

  it("runs level above or below the two points, upright beside them, and aligned anywhere else", () => {
    expect(directionAt([0, 0], [10, 5], [5, -8])).toBe("x");
    expect(directionAt([0, 0], [10, 5], [14, 2])).toBe("y");
    expect(directionAt([0, 0], [10, 5], [5, 2])).toBe("aligned");
    expect(directionAt([0, 0], [10, 5], [14, 9])).toBe("aligned");
    expect(directionAt([0, 0], [10, 0], [5, -8])).toBe("aligned");
  });
});

describe("a size as text", () => {
  it("drops trailing zeros and keeps to the decimal places asked for", () => {
    expect(sizeText(5, 2)).toBe("5");
    expect(sizeText(12.5, 2)).toBe("12.5");
    expect(sizeText(14.1421, 2)).toBe("14.14");
    expect(sizeText(14.1421, 0)).toBe("14");
    expect(sizeText(0.0004, 3)).toBe("0");
    expect(sizeText(-0.0001, 2)).toBe("0");
  });
});

describe("a length drawn to ISO", () => {
  const art = dimArt({ refs: [e(0)], across: "aligned", at: [0, -40] }, ctx())!;

  it("has extension lines that start clear of the part and run past the dimension line", () => {
    expect(art.lines).toEqual([
      [
        [-25, -31],
        [-25, -42],
      ],
      [
        [30, -31],
        [30, -42],
      ],
      [
        [-25, -40],
        [30, -40],
      ],
    ]);
  });

  it("has an arrowhead at each end pointing out, and the size above the line", () => {
    expect(art.arrows.map((a) => a[0])).toEqual([
      [-25, -40],
      [30, -40],
    ]);
    // Each head is 3 mm long and 1 mm wide, behind its tip.
    close(art.arrows[0]![1], [-22, -40.5]);
    close(art.arrows[1]![2], [27, -40.5]);
    expect(art.text.text).toBe("55");
    expect(art.text.turn).toBe(0);
    close(art.text.at, [0, -40 + 1 + 3.5 * 0.36]);
    expect(dimName(art)).toBe("Dimension, 55 mm");
  });

  it("reads the model's true size at 2:1 and 1:2, with its own sizes staying in paper millimetres", () => {
    for (const scale of [2, 0.5]) {
      const scaled = dimArt({ refs: [e(0)], across: "aligned", at: [0, -30 * scale - 10] }, ctx("iso", scale))!;
      expect(scaled.text.text).toBe("55");
      expect(scaled.value).toBe(55);
      expect(scaled.lines[2]).toEqual([
        [-25 * scale, -30 * scale - 10],
        [30 * scale, -30 * scale - 10],
      ]);
      expect(scaled.lines[0]![0]).toEqual([-25 * scale, -30 * scale - 1]);
      close(scaled.arrows[0]![1], [-25 * scale + 3, -30 * scale - 10.5]);
    }
  });

  it("turns an upright size to read from the right, on the left of its line", () => {
    const up = dimArt({ refs: [e(1)], across: "aligned", at: [40, -5] }, ctx())!;
    expect(up.text.text).toBe("50");
    expect(up.text.turn).toBeCloseTo(Math.PI / 2);
    close(up.text.at, [40 - 1 - 3.5 * 0.36, -5]);
  });

  it("measures two points across, up or along the line between them", () => {
    const refs = [f("hole0", "centre"), f("hole1", "centre")];
    expect(dimArt({ refs, across: "x", at: [10, -40] }, ctx())!.text.text).toBe("20");
    expect(dimArt({ refs, across: "y", at: [40, 10] }, ctx())!.text.text).toBe("20");
    const along = dimArt({ refs, across: "aligned", at: [20, 20] }, ctx())!;
    expect(along.text.text).toBe("28.28");
    // Read from below: the text turns with the line, never upside down.
    expect(along.text.turn).toBeCloseTo(-Math.PI / 4);
    expect(dimArt({ refs, across: "aligned", at: [20, 20], decimals: 0 }, ctx())!.text.text).toBe("28");
    expect(dimArt({ refs, across: "aligned", at: [20, 20] }, ctx("iso", 1, { decimals: 1 }))!.text.text).toBe("28.3");
  });

  it("keeps to aligned in an isometric view, and when it is square to an edge", () => {
    const refs = [f("hole0", "centre"), f("hole1", "centre")];
    expect(dimArt({ refs, across: "x", at: [10, -40] }, ctx("iso", 1, { iso: true }))!.text.text).toBe("28.28");
    expect(dimArt({ refs: [e(0), e(3)], across: "x", at: [40, 0] }, ctx())!.text.text).toBe("60");
  });

  it("puts the arrows outside a size too short to hold them", () => {
    const short = dimArt({ refs: [e(6)], across: "aligned", at: [0, 28] }, ctx())!;
    expect(short.text.text).toBe("4");
    // The line runs on 6 mm each side for the tails, and the heads point in.
    expect(short.lines.at(-1)).toEqual([
      [-8, 28],
      [8, 28],
    ]);
    close(short.arrows[0]![1], [-5, 28.5]);
    close(short.arrows[1]![1], [5, 27.5]);
  });

  it("runs the line on to text dragged past an end", () => {
    const out = dimArt({ refs: [e(0)], across: "aligned", at: [45, -40] }, ctx())!;
    const width = textWidth("55", 3.5);
    expect(out.lines.at(-1)![0]).toEqual([-25, -40]);
    close(out.lines.at(-1)![1], [45 + width / 2, -40]);
  });
});

describe("a length drawn to ASME", () => {
  it("keeps the size level in a break in the line, with a wider gap and longer extension lines", () => {
    const art = dimArt({ refs: [e(0)], across: "aligned", at: [0, -40] }, ctx("asme"))!;
    const half = textWidth("55", 3.5) / 2 + 0.8;
    expect(art.lines[0]).toEqual([
      [-25, -31.5],
      [-25, -43],
    ]);
    expect(art.lines.slice(2)).toEqual([
      [
        [-25, -40],
        [-half, -40],
      ],
      [
        [half, -40],
        [30, -40],
      ],
    ]);
    expect(art.text).toMatchObject({ at: [0, -40], turn: 0, text: "55" });
    const up = dimArt({ refs: [e(1)], across: "aligned", at: [40, -5] }, ctx("asme"))!;
    expect(up.text).toMatchObject({ at: [40, -5], turn: 0, text: "50" });
    // An upright line breaks for the height of the level text, not its width.
    close(up.lines[2]![1], [40, -5 - 3.5 / 2 - 0.8]);
  });
});

describe("an angle", () => {
  const refs = [e(1), e(2)];
  it("is measured in the quadrant its text is in", () => {
    expect(dimArt({ refs, at: [25, 10] }, ctx())!.text.text).toBe("135°");
    expect(dimArt({ refs, at: [35, 30] }, ctx())!.text.text).toBe("135°");
    expect(dimArt({ refs, at: [35, 10] }, ctx())!.text.text).toBe("45°");
    expect(dimName(dimArt({ refs, at: [35, 10] }, ctx())!)).toBe("Dimension, 45°");
  });

  it("is an arc about the corner through the text, with an arrow on each arm and extension lines where an edge stops short", () => {
    const art = dimArt({ refs, at: [35, 10] }, ctx())!;
    const R = Math.hypot(5, 10);
    expect(art.arcs).toHaveLength(1);
    expect(art.arcs[0]).toMatchObject({ kind: "arc", c: [30, 20], r: R });
    const arc = art.arcs[0] as { from: number; to: number };
    expect(((arc.to - arc.from) * 180) / Math.PI).toBeCloseTo(45);
    expect(art.arrows).toHaveLength(2);
    for (const a of art.arrows) expect(Math.hypot(a[0][0] - 30, a[0][1] - 20)).toBeCloseTo(R);
    // The upright edge reaches the arc; the chamfer is carried on past its end to get there.
    expect(art.lines).toHaveLength(1);
    close(art.lines[0]![0], [30 + Math.SQRT1_2 * 1, 20 - Math.SQRT1_2 * 1]);
    close(art.lines[0]![1], [30 + Math.SQRT1_2 * (R + 2), 20 - Math.SQRT1_2 * (R + 2)]);
  });

  it("breaks the arc round level text to ASME", () => {
    const art = dimArt({ refs, at: [10, 5] }, ctx("asme"))!;
    expect(art.text.text).toBe("135°");
    expect(art.arcs).toHaveLength(2);
    close(art.text.at, [10, 5]);
  });
});

describe("a radius or diameter", () => {
  it("is a leader from a level shoulder beside the text to the rim, its arrow pointing at the centre", () => {
    const art = dimArt({ refs: [f("bore")], at: [20, 20] }, ctx())!;
    expect(art.text).toMatchObject({ at: [20, 20], turn: 0, text: "Ø12" });
    const edge = 20 - textWidth("Ø12", 3.5) / 2 - 0.8;
    close(art.lines[0]![0], [edge, 20]);
    close(art.lines[0]![1], [edge - 2, 20]);
    close(art.lines[1]![0], [edge - 2, 20]);
    const rim = art.lines[1]![1];
    expect(Math.hypot(...rim)).toBeCloseTo(6);
    expect(art.arrows).toHaveLength(1);
    expect(art.arrows[0]![0]).toEqual(rim);
    // The head lies outside the circle.
    expect(Math.hypot(...art.arrows[0]![1])).toBeGreaterThan(6);
    expect(dimName(art)).toBe("Dimension, Ø12 mm");
  });

  it("is a line across with an arrow at each end when the text is inside the circle", () => {
    const art = dimArt({ refs: [f("bore")], at: [2, 0] }, ctx("iso", 4))!;
    expect(art.lines).toEqual([
      [
        [-24, 0],
        [24, 0],
      ],
    ]);
    expect(art.arrows.map((a) => a[0])).toEqual([
      [24, 0],
      [-24, 0],
    ]);
    expect(art.text.text).toBe("Ø12");
  });

  it("counts holes the same size, and writes an arc as a radius", () => {
    expect(dimArt({ refs: [f("hole2")], at: [-30, 12] }, ctx())!.text.text).toBe("4× Ø5");
    const r = dimArt({ refs: [e(5)], at: [-40, -40] }, ctx())!;
    expect(r.text.text).toBe("R5");
    expect(Math.hypot(r.arrows[0]![0][0] + 25, r.arrows[0]![0][1] + 25)).toBeCloseTo(5);
    const inside = dimArt({ refs: [e(5)], at: [-27, -27] }, ctx())!;
    expect(inside.lines[0]![0]).toEqual([-25, -25]);
    expect(inside.arrows).toHaveLength(1);
  });
});

describe("placing a size", () => {
  it("goes under the view when level and to its left when upright, just clear of it, with no pointer to say", () => {
    expect(defaultSpot(measured([e(0)], all)!, plate, 1)).toEqual({ at: [2.5, -40], across: "aligned" });
    expect(defaultSpot(measured([e(1)], all)!, plate, 2)).toEqual({ at: [-70, -10], across: "aligned" });
    // On a slant: across when it is wider than it is tall, up when taller.
    expect(defaultSpot(measured([e(4, "end"), f("hole0", "centre")], all)!, plate, 1)).toEqual({ at: [-5, -40], across: "x" });
    expect(defaultSpot(measured([f("hole1", "centre"), e(0, "end")], all)!, plate, 1)).toEqual({ at: [-40, -5], across: "y" });
    expect(defaultSpot(measured([f("hole1", "centre"), e(0, "end")], all)!, plate, 1, true).across).toBe("aligned");
    const corner = defaultSpot(measured([e(1), e(2)], all)!, plate, 1);
    expect(dimArt({ refs: [e(1), e(2)], at: corner.at }, ctx())!.text.text).toBe("135°");
    const round = defaultSpot(measured([f("bore")], all)!, plate, 1);
    expect(Math.hypot(...round.at)).toBeCloseTo(14);
  });

  it("takes one pick, then a second in the same view; the same again lets go, and a third starts over", () => {
    const one = addPick(null, "v1", e(0), all);
    expect(one).toEqual({ view: "v1", refs: [e(0)] });
    expect(addPick(one, "v1", e(0), all)).toBeNull();
    const two = addPick(one, "v1", e(3), all);
    expect(two).toEqual({ view: "v1", refs: [e(0), e(3)] });
    expect(addPick(two, "v1", e(1), all)).toEqual({ view: "v1", refs: [e(1)] });
    expect(addPick(one, "v2", e(1), all)).toEqual({ view: "v2", refs: [e(1)] });
    // A pair that gives no size starts again from the second.
    expect(addPick({ view: "v1", refs: [e(0, "end")] }, "v1", e(1, "start"), all)).toEqual({ view: "v1", refs: [e(1, "start")] });
  });

  it("makes the dimension the picks give, its direction from where the text is put", () => {
    const pair = { view: "v1", refs: [f("hole0", "centre"), f("hole1", "centre")] };
    expect(draftOf(null, all, null, plate, 1)).toBeUndefined();
    expect(draftOf({ view: "v1", refs: [e(0, "start")] }, all, null, plate, 1)).toBeUndefined();
    expect(draftOf(pair, all, [10, -40], plate, 1)).toEqual({ view: "v1", kind: "linear", refs: pair.refs, at: [10, -40], across: "x" });
    expect(draftOf(pair, all, [40, 10], plate, 1)?.across).toBe("y");
    expect(draftOf(pair, all, [12, 12], plate, 1)?.across).toBe("aligned");
    expect(draftOf(pair, all, [10, -40], plate, 1, true)?.across).toBe("aligned");
    // At 2:1 the pointer is twice as far out on paper for the same place on the part.
    expect(draftOf(pair, all, [20, 30], plate, 2)?.across).toBe("aligned");
    expect(draftOf(pair, all, null, plate, 1)).toEqual({ view: "v1", kind: "linear", refs: pair.refs, at: [10, -40], across: "x" });
    expect(draftOf({ view: "v1", refs: [f("bore")] }, all, [20, 20], plate, 1)).toEqual({ view: "v1", kind: "diameter", refs: [f("bore")], at: [20, 20] });
    expect(draftOf({ view: "v1", refs: [e(1), e(2)] }, all, [35, 10], plate, 1)).toEqual({ view: "v1", kind: "angle", refs: [e(1), e(2)], at: [35, 10] });
  });

  it("knows an isometric view from one that looks along an axis", () => {
    expect(isIso([0, -1, 0])).toBe(false);
    expect(isIso([1, -1, 1])).toBe(true);
  });
});
