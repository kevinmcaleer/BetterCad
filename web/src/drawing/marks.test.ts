import { describe, expect, it } from "vitest";
import type { DrawingMark, DrawingRef } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { autoMarks, crossAt, dashDot, markArt, markKey, markStyle, offered, pitchCircle, refTo, resolve, targets } from "./marks";

const TAU = Math.PI * 2;
const face = (index: number, name?: string) => ({ body: "b1", kind: "face" as const, index, ...(name ? { name } : {}) });
const edge = (index: number) => ({ body: "b1", kind: "edge" as const, index });
/** Six 5 mm holes on a 40 mm bolt circle round the origin, with a 12 mm bore in the middle. */
const bolts: V2[] = [0, 1, 2, 3, 4, 5].map((i) => [20 * Math.cos((i * TAU) / 6), 20 * Math.sin((i * TAU) / 6)]);
/**
 * A flange from the front: the bolt circle and bore end on, a cross hole seen from the side, a fillet, and the
 * two slanted edges of a chamfered corner.
 */
const flange = {
  edges: [
    { curve: { kind: "line", a: [-30, -30], b: [30, -30] }, visible: true, type: "sharp", source: edge(0) },
    { curve: { kind: "line", a: [-30, 30], b: [30, 30] }, visible: true, type: "sharp", source: edge(1) },
    { curve: { kind: "line", a: [30, -30], b: [30, 20] }, visible: true, type: "sharp", source: edge(2) },
    { curve: { kind: "line", a: [20, 30], b: [-30, 30] }, visible: true, type: "sharp", source: edge(3) },
    { curve: { kind: "circle", c: [0, 0], r: 6 }, visible: true, type: "sharp", source: edge(4) },
    { curve: { kind: "arc", c: [-25, -25], r: 5, from: Math.PI, to: Math.PI * 1.5 }, visible: true, type: "sharp", source: edge(5) },
    { curve: { kind: "line", a: [0, 0], b: [1, 1] }, visible: true, type: "sharp" },
  ],
  box: { min: [-30, -30], max: [30, 30] },
  rounds: [
    ...bolts.map((c, i) => ({ seen: "end", c, r: 2.5, hole: true, sweep: TAU, source: face(10 + i, `hole${i}`) })),
    { seen: "end", c: [0, 0], r: 6, hole: true, sweep: TAU, source: face(20, "bore") },
    { seen: "end", c: [0, 0], r: 8, hole: true, sweep: TAU, source: face(21, "counterbore") },
    { seen: "side", a: [-30, 10], b: [30, 10], r: 1.5, hole: true, sweep: TAU, source: face(22, "cross") },
    { seen: "side", a: [-30, 10], b: [-10, 10], r: 3, hole: true, sweep: TAU, source: face(23, "cross-wide") },
    { seen: "end", c: [-25, -25], r: 5, hole: false, sweep: Math.PI / 2, source: face(24, "fillet") },
  ],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
const all = targets(flange);
const iso = markStyle("iso");
const ref = (name: string): DrawingRef =>
  refTo(
    "v1",
    all.find((t) => t.source.name === name)!,
  );
const edgeRef = (index: number): DrawingRef => ({ view: "v1", body: "b1", kind: "edge", index });
const len = ([a, b]: [V2, V2]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

describe("what a view offers the mark tools", () => {
  it("lists holes, axes and edges once each, round faces before the edges that rim them", () => {
    expect(all.filter((t) => t.kind === "round")).toHaveLength(11);
    expect(all.filter((t) => t.kind === "axis")).toHaveLength(2);
    // Four straight edges with names; the one the kernel could not trace is left out.
    expect(all.filter((t) => t.kind === "edge")).toHaveLength(4);
    expect(all.find((t) => t.source.name === "fillet")).toMatchObject({ kind: "round", whole: false, hole: false });
  });

  it("offers a hole once, not again for the edge round its rim", () => {
    const rounds = offered(all).filter((t) => t.kind === "round");
    expect(rounds.map((t) => t.source.name ?? `edge ${t.source.index}`)).toEqual([...bolts.map((_, i) => `hole${i}`), "bore", "counterbore", "fillet"]);
    expect(offered(all).filter((t) => t.kind !== "round")).toEqual(all.filter((t) => t.kind !== "round"));
  });

  it("finds a mark's hole again by name when its number has changed, and by number when it has no name", () => {
    expect(resolve(all, { ...ref("bore"), index: 999 })).toMatchObject({ c: [0, 0], r: 6 });
    expect(resolve(all, edgeRef(2))).toMatchObject({ kind: "edge", a: [30, -30] });
    expect(resolve(all, { view: "v1", body: "b1", kind: "face", index: 20, name: "gone" })).toBeUndefined();
    expect(resolve(all, { view: "v1", body: "b2", kind: "edge", index: 2 })).toBeUndefined();
  });
});

describe("a centre mark", () => {
  it("is a short cross with a line each way out past the rim", () => {
    const lines = crossAt([10, 20], 6, iso);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toEqual([
      [8.5, 20],
      [11.5, 20],
    ]);
    // Gap of 1.5, then out to 3 mm past the rim.
    expect(lines[1]).toEqual([
      [13, 20],
      [19, 20],
    ]);
    expect(lines[5]).toEqual([
      [10, 17],
      [10, 11],
    ]);
  });

  it("on a small hole is one line each way", () => {
    expect(crossAt([0, 0], 0.5, iso)).toEqual([
      [
        [-3.5, 0],
        [3.5, 0],
      ],
      [
        [0, -3.5],
        [0, 3.5],
      ],
    ]);
  });

  it("is drawn at the view's scale, with the mark's own size staying in paper millimetres", () => {
    const art = markArt({ id: "m", kind: "centre-mark", on: ref("hole0") }, flange, 2, iso)!;
    // The hole at (20, 0) is 40 mm from the middle on paper, 5 mm in radius.
    expect(art.lines[0]).toEqual([
      [38.5, 0],
      [41.5, 0],
    ]);
    expect(art.lines[1]![1]).toEqual([48, 0]);
    expect(markArt({ id: "m", kind: "centre-mark", on: edgeRef(4) }, flange, 1, iso)!.lines).toHaveLength(6);
    expect(markArt({ id: "m", kind: "centre-mark", on: { ...ref("bore"), name: "gone" } }, flange, 1, iso)).toBeUndefined();
    expect(markStyle("asme").over).toBe(3.2);
  });
});

describe("a centre line", () => {
  it("is long dash, dot, long dash, starting and ending on a long dash", () => {
    const pieces = dashDot([0, 0], [60, 0]);
    expect(pieces.length % 2).toBe(1);
    expect(pieces[0]![0]).toEqual([0, 0]);
    expect(pieces[pieces.length - 1]![1][0]).toBeCloseTo(60);
    pieces.forEach((p, i) => (i % 2 ? expect(len(p)).toBeCloseTo(1.5) : expect(len(p)).toBeGreaterThan(8)));
    expect(pieces[1]![0][0] - pieces[0]![1][0]).toBeCloseTo(1.5);
    expect(dashDot([0, 0], [6, 0])).toEqual([
      [
        [0, 0],
        [6, 0],
      ],
    ]);
  });

  it("runs along a hole seen from the side, a little past each end", () => {
    const art = markArt({ id: "m", kind: "centre-line", a: ref("cross") }, flange, 1, iso)!;
    expect(art.lines[0]![0]).toEqual([-33, 10]);
    expect(art.lines[art.lines.length - 1]![1][0]).toBeCloseTo(33);
    expect(art.lines.every(([a, b]) => a[1] === 10 && b[1] === 10)).toBe(true);
  });

  it("runs midway between two edges, whichever way round they were drawn", () => {
    // The bottom edge runs left to right and the top one right to left.
    const art = markArt({ id: "m", kind: "centre-line", a: edgeRef(0), b: edgeRef(3) }, flange, 1, iso)!;
    expect(art.lines[0]![0]).toEqual([-33, 0]);
    expect(art.lines[art.lines.length - 1]![1][0]).toBeCloseTo(28);
    expect(art.lines.every(([a, b]) => Math.abs(a[1]) < 1e-9 && Math.abs(b[1]) < 1e-9)).toBe(true);
  });
});

describe("a centre mark pattern", () => {
  const on = bolts.map((_, i) => ref(`hole${i}`));

  it("finds the circle a set of holes sits on, and none for a row", () => {
    const fit = pitchCircle(bolts)!;
    expect(fit.r).toBeCloseTo(20);
    expect(Math.hypot(...fit.c)).toBeLessThan(1e-9);
    expect(
      pitchCircle([
        [0, 0],
        [10, 0],
        [20, 0],
      ]),
    ).toBeUndefined();
    expect(pitchCircle([...bolts, [0, 0]])).toBeUndefined();
    expect(pitchCircle(bolts.slice(0, 2))).toBeUndefined();
  });

  it("marks each hole, with the pitch circle through them and a small cross at its middle", () => {
    const art = markArt({ id: "m", kind: "centre-pattern", on, join: "circle" }, flange, 1, iso)!;
    expect(art.curves).toHaveLength(1);
    const c = art.curves[0] as { kind: "circle"; c: V2; r: number };
    expect([c.kind, Math.round(c.r)]).toEqual(["circle", 20]);
    expect(art.lines).toHaveLength(6 * 6 + 2);
  });

  it("joins a row with centre lines carried past the first and last hole", () => {
    const row: DrawingMark = { id: "m", kind: "centre-pattern", on: [ref("hole0"), ref("hole3")], join: "lines" };
    const art = markArt(row, flange, 1, iso)!;
    expect(art.curves).toHaveLength(0);
    const joins = art.lines.slice(12);
    expect(Math.min(...joins.flatMap(([a, b]) => [a[0], b[0]]))).toBeCloseTo(-25.5);
    expect(Math.max(...joins.flatMap(([a, b]) => [a[0], b[0]]))).toBeCloseTo(25.5);
  });
});

describe("an edge extension", () => {
  it("carries two edges on to the corner they would make, a little past it", () => {
    // The right edge stops at y 20 and the top edge at x 20: a chamfer took the corner at (30, 30).
    const art = markArt({ id: "m", kind: "extension", a: edgeRef(2), b: edgeRef(3) }, flange, 1, iso)!;
    expect(art.lines).toEqual([
      [
        [30, 20],
        [30, 31.5],
      ],
      [
        [20, 30],
        [31.5, 30],
      ],
    ]);
  });

  it("is nothing for edges that never meet or already do", () => {
    expect(markArt({ id: "m", kind: "extension", a: edgeRef(0), b: edgeRef(1) }, flange, 1, iso)).toBeUndefined();
    expect(markArt({ id: "m", kind: "extension", a: edgeRef(0), b: edgeRef(2) }, flange, 1, iso)).toBeUndefined();
  });
});

describe("Add centre marks to this view", () => {
  let n = 0;
  const id = () => `m${++n}`;

  it("marks every whole hole once per centre on the biggest, and one axis per line on the longest; fillets get nothing", () => {
    const marks = autoMarks(flange, "v1", [], id);
    const centres = marks.filter((m) => m.kind === "centre-mark");
    expect(centres).toHaveLength(7);
    expect(centres.map((m) => (m as { on: DrawingRef }).on.name)).toContain("counterbore");
    expect(centres.map((m) => (m as { on: DrawingRef }).on.name)).not.toContain("bore");
    expect(centres.map((m) => (m as { on: DrawingRef }).on.name)).not.toContain("fillet");
    const axes = marks.filter((m) => m.kind === "centre-line");
    expect(axes).toHaveLength(1);
    expect((axes[0] as { a: DrawingRef }).a).toMatchObject({ view: "v1", name: "cross", kind: "face" });
  });

  it("leaves alone what is already marked, and only looks at this view's marks", () => {
    const first = autoMarks(flange, "v1", [], id);
    expect(autoMarks(flange, "v1", first, id)).toHaveLength(0);
    expect(autoMarks(flange, "v1", first.slice(0, 3), id)).toHaveLength(5);
    expect(autoMarks(flange, "v2", first, id)).toHaveLength(8);
    const pattern: DrawingMark = { id: "p", kind: "centre-pattern", on: bolts.map((_, i) => ref(`hole${i}`)), join: "circle" };
    expect(autoMarks(flange, "v1", [pattern], id)).toHaveLength(2);
  });

  it("tells two marks on the same thing apart from two on different things", () => {
    const a: DrawingMark = { id: "1", kind: "centre-line", a: edgeRef(0), b: edgeRef(3) };
    expect(markKey(a)).toBe(markKey({ id: "2", kind: "centre-line", a: edgeRef(3), b: edgeRef(0) }));
    expect(markKey(a)).not.toBe(markKey({ id: "3", kind: "extension", a: edgeRef(0), b: edgeRef(3) }));
  });
});
