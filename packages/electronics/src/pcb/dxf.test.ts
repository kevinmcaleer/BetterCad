import { describe, expect, it } from "vitest";
import { boardSize } from "../board";
import { fabBoard } from "../fab/fixture";
import type { P2 } from "../model";
import { dxfOutline } from "./dxf";
import { followFace, holesFromCutouts, outlineBehind, roundCutouts, shapeFromLoops, takeShape, unfollowSketch } from "./outline";

/** A DXF file from group codes and values, a pair a row. */
const dxf = (...rows: (string | number)[][]) => `${rows.map(([code, value]) => `${String(code).padStart(3)}\n${value}`).join("\n")}\n  0\nEOF\n`;
const section = (...rows: (string | number)[][]) => dxf([0, "SECTION"], [2, "ENTITIES"], ...rows, [0, "ENDSEC"]);
const line = (a: P2, b: P2) => [
  [0, "LINE"],
  [8, "0"],
  [10, a[0]],
  [20, a[1]],
  [11, b[0]],
  [21, b[1]],
];
const box = (x: number, y: number, w: number, h: number) => [
  ...line([x, y], [x + w, y]),
  // Drawn the other way round: pieces join whichever way they run.
  ...line([x + w, y + h], [x + w, y]),
  ...line([x + w, y + h], [x, y + h]),
  ...line([x, y + h], [x, y]),
];
const span = (pts: P2[]) => [
  Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])),
  Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])),
];

describe("a board outline from a DXF file", () => {
  it("joins loose lines into the edge, and takes a circle inside it as a cut-out", () => {
    const { shape, notes } = dxfOutline(section(...box(10, 10, 60, 40), [0, "CIRCLE"], [10, 25], [20, 30], [40, 3], [0, "TEXT"], [1, "Rev A"]));
    expect(notes).toEqual(["Not read: text (1)."]);
    expect(span(shape!.outer)).toEqual([60, 40]);
    expect(shape!.holes).toHaveLength(1);
    const [w, h] = span(shape!.holes[0]!);
    expect(w).toBeCloseTo(6, 2);
    expect(h).toBeCloseTo(6, 2);
  });

  it("reads a closed polyline with bulges as rounded corners", () => {
    // A 20 by 10 slot shape: straight top and bottom, a half circle at each end (bulge 1).
    const { shape } = dxfOutline(
      section([0, "LWPOLYLINE"], [90, 4], [70, 1], [10, 5], [20, 0], [10, 15], [20, 0], [42, 1], [10, 15], [20, 10], [10, 5], [20, 10], [42, 1]),
    );
    const [w, h] = span(shape!.outer);
    expect(w).toBeCloseTo(20, 2);
    expect(h).toBeCloseTo(10, 6);
    expect(shape!.outer.length).toBeGreaterThan(20);
    // Every point of the right end is 5 mm from its centre.
    for (const p of shape!.outer.filter((q) => q[0] > 15.001)) expect(Math.hypot(p[0] - 15, p[1] - 5)).toBeCloseTo(5, 6);
  });

  it("joins arcs to lines, and reads an old style polyline", () => {
    // A rectangle with one rounded corner: the arc runs anticlockwise from 0° to 90° about (18, 8).
    const rounded = dxfOutline(
      section(
        ...line([0, 0], [20, 0]),
        ...line([20, 0], [20, 8]),
        [0, "ARC"],
        [10, 18],
        [20, 8],
        [40, 2],
        [50, 0],
        [51, 90],
        ...line([18, 10], [0, 10]),
        ...line([0, 10], [0, 0]),
      ),
    );
    expect(rounded.notes).toEqual([]);
    expect(span(rounded.shape!.outer)).toEqual([20, 10]);
    expect(rounded.shape!.outer.some((p) => Math.abs(p[0] - 19.414214) < 1e-3 && Math.abs(p[1] - 9.414214) < 1e-3)).toBe(true);
    const old = dxfOutline(
      section(
        [0, "POLYLINE"],
        [70, 1],
        [0, "VERTEX"],
        [10, 0],
        [20, 0],
        [0, "VERTEX"],
        [10, 30],
        [20, 0],
        [0, "VERTEX"],
        [10, 30],
        [20, 20],
        [0, "VERTEX"],
        [10, 0],
        [20, 20],
        [0, "SEQEND"],
      ),
    );
    expect(old.shape!.outer).toEqual([
      [0, 0],
      [30, 0],
      [30, 20],
      [0, 20],
    ]);
  });

  it("honours the file's units, and says what it left out", () => {
    const inches = dxfOutline(
      dxf([0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, 1], [0, "ENDSEC"], [0, "SECTION"], [2, "ENTITIES"], ...box(0, 0, 2, 1), [0, "ENDSEC"]),
    );
    expect(span(inches.shape!.outer)).toEqual([50.8, 25.4]);
    const open = dxfOutline(section(...line([0, 0], [10, 0]), ...line([10, 0], [10, 10]), [0, "SPLINE"], [0, "SPLINE"]));
    expect(open.shape).toBeNull();
    expect(open.notes).toEqual(["1 open shape was left out.", "Not read: splines (2)."]);
    expect(dxfOutline("not a drawing").shape).toBeNull();
  });
});

describe("a board that takes a shape", () => {
  const plate = shapeFromLoops([
    [
      [100, 100],
      [170, 100],
      [170, 130],
      [100, 130],
    ],
    [
      [110, 110],
      [120, 110],
      [120, 120],
      [110, 120],
    ],
    // Outside the edge: not a cut-out.
    [
      [300, 300],
      [310, 300],
      [310, 310],
    ],
  ])!;

  it("keeps its corner where it was and follows nothing after a file", () => {
    const { d } = fabBoard();
    expect(plate.holes).toHaveLength(1);
    const made = takeShape(followFace(d, "b1|top", plate), plate);
    expect(boardSize(made.board!)).toMatchObject({ x: 0, y: 0, w: 70, h: 30 });
    expect(made.board!.cutouts).toEqual([
      [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
        { x: 10, y: 20 },
      ],
    ]);
    expect(made.board).not.toHaveProperty("outlineFrom");
  });

  it("follows a face, and knows when the face has changed", () => {
    const { d } = fabBoard();
    const on = followFace(d, "b1|top", plate);
    expect(on.board!.outlineFrom).toEqual({ face: "b1|top" });
    expect(outlineBehind(on.board!, plate)).toBe(false);
    expect(outlineBehind(on.board!, { ...plate, holes: [] })).toBe(true);
    expect(unfollowSketch(on).board).not.toHaveProperty("outlineFrom");
    expect(followFace(d, "b1|top", { outer: [], holes: [] })).toBe(d);
  });

  it("offers round cut-outs as mounting holes, and keeps them holes as it follows (#653)", () => {
    const ring = (cx: number, cy: number, r: number): P2[] =>
      Array.from({ length: 32 }, (_, i) => [cx + r * Math.cos((i * Math.PI) / 16), cy + r * Math.sin((i * Math.PI) / 16)]);
    const edge: P2[] = [
      [0, 0],
      [70, 0],
      [70, 30],
      [0, 30],
    ];
    // A 3.2 mm screw hole, a square window, and a round window too big for a screw.
    const window: P2[] = [
      [20, 10],
      [30, 10],
      [30, 20],
      [20, 20],
    ];
    const lid = (x: number) => shapeFromLoops([edge, ring(x, 5, 1.6), window, ring(50, 15, 8)])!;
    const on = followFace(fabBoard().d, "b1|top", lid(5));
    expect(roundCutouts(on.board!.cutouts!)).toEqual([{ at: [5, 5], d: 3.2, i: 2 }]);
    const before = on.board!.holes.length;
    const drilled = holesFromCutouts(on);
    expect(drilled.board!.cutouts).toHaveLength(2);
    expect(drilled.board!.holes).toHaveLength(before + 1);
    expect(drilled.board!.holes.at(-1)).toMatchObject({ x: 5, y: 5, drill: 3.2 });
    expect(drilled.board!.outlineFrom).toEqual({ face: "b1|top", holes: true });
    expect(holesFromCutouts(drilled)).toBe(drilled);
    // In step with the face as it is; behind when the face's hole moves, and the update drills the new one.
    expect(outlineBehind(drilled.board!, lid(5))).toBe(false);
    expect(outlineBehind(drilled.board!, lid(9))).toBe(true);
    const moved = followFace(drilled, "b1|top", lid(9));
    expect(moved.board!.cutouts).toHaveLength(2);
    expect(moved.board!.holes.at(-1)).toMatchObject({ x: 9, y: 5, drill: 3.2 });
    expect(outlineBehind(moved.board!, lid(9))).toBe(false);
  });
});
