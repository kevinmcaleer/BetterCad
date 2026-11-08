import { beforeAll, describe, expect, it } from "vitest";
import { SketchIndex, newSketch, planeFrame, type Sketch } from "./model";
import { Draft, drawLine, drawPolyline, drawRectangle, drawCircle } from "./draw";
import { chainOf, cutsOn, filletAt, filletLines, flattenCurve, offsetChain, projectCurves, projectSegments, trimAt, trimPiece } from "./edit";
import { profiles } from "./profiles";
import { Solver } from "./solver";
import { angleOf, dist, sub } from "./geom2d";

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});

const ok = (r: Sketch | string): Sketch => {
  if (typeof r === "string") throw new Error(r);
  return r;
};
const lines = (s: Sketch) => s.entities.filter((e) => e.kind === "line");
const arcs = (s: Sketch) => s.entities.filter((e) => e.kind === "arc");

describe("fillet corner", () => {
  it("rounds an L with a tangent arc and a radius size", () => {
    const s = drawPolyline(newSketch(), [
      [20, 0],
      [0, 0],
      [0, 20],
    ]).sketch;
    const corner = s.entities.find((e) => e.kind === "point" && e.x === 0 && e.y === 0)!.id;
    const out = ok(filletAt(s, corner, 5));
    const idx = new SketchIndex(out);
    const arc = arcs(out)[0]!;
    expect(arc.kind === "arc" && arc.r).toBeCloseTo(5);
    expect(idx.get(corner)).toBeUndefined();
    expect(out.constraints.filter((c) => c.type === "tangent")).toHaveLength(2);
    expect(out.dimensions.find((d) => d.kind === "radius")?.value).toBe(5);
    if (arc.kind !== "arc") throw new Error();
    // Tangent: each touch point is square to the radius from the centre.
    const c = idx.xy(arc.c);
    for (const p of [arc.a, arc.b]) {
      const r = sub(idx.xy(p), c);
      const line = lines(out).find((l) => l.kind === "line" && (l.a === p || l.b === p))!;
      if (line.kind !== "line") throw new Error();
      const dir = sub(idx.xy(line.b), idx.xy(line.a));
      expect(Math.abs(r[0] * dir[0] + r[1] * dir[1])).toBeLessThan(1e-9);
    }
    // And the solver agrees.
    const solved = solver.solve(out);
    expect(solved.status).toBe("ok");
  });

  it("refuses a radius that doesn't fit, and lines that don't meet", () => {
    const s = drawPolyline(newSketch(), [
      [4, 0],
      [0, 0],
      [0, 4],
    ]).sketch;
    const corner = s.entities.find((e) => e.kind === "point" && e.x === 0 && e.y === 0)!.id;
    expect(filletAt(s, corner, 10)).toBe("A 10 mm round doesn't fit this corner");
    const apart = drawLine(drawLine(newSketch(), [0, 0], [10, 0]).sketch, [20, 0], [20, 10]).sketch;
    const [a, b] = lines(apart).map((l) => l.id);
    expect(filletLines(apart, a!, b!, 1)).toBe("Those lines don't meet at a corner");
  });

  it("rounds each corner of a rectangle, keeping one closed profile", () => {
    let s = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const corners = s.entities.filter((e) => e.kind === "point").map((e) => e.id);
    for (const c of corners) s = ok(filletAt(s, c, 3));
    expect(arcs(s)).toHaveLength(4);
    const p = profiles(s).profiles;
    expect(p).toHaveLength(1);
    expect(p[0]!.area).toBeCloseTo(800 - (4 - Math.PI) * 9, 0);
    expect(solver.solve(s).status).toBe("ok");
  });
});

describe("trim", () => {
  // A plus sign: two lines crossing at the origin.
  const plus = () => drawLine(drawLine(newSketch(), [-10, 0], [10, 0]).sketch, [0, -10], [0, 10]).sketch;

  it("finds where others cross a curve", () => {
    const s = plus();
    const [h] = lines(s);
    expect(cutsOn(s, h!.id)).toEqual([0.5]);
    expect(trimPiece(s, h!.id, [5, 0])).toMatchObject({ from: 0.5, to: 1 });
  });

  it("cuts a line back to the crossing", () => {
    const s = plus();
    const h = lines(s)[0]!;
    const out = ok(trimAt(s, h.id, [6, 0]));
    const idx = new SketchIndex(out);
    const kept = idx.get(h.id)!;
    if (kept.kind !== "line") throw new Error();
    expect(idx.xy(kept.a)).toEqual([-10, 0]);
    expect(idx.xy(kept.b)[0]).toBeCloseTo(0);
  });

  it("splits a line cut out of the middle, and removes one nothing crosses", () => {
    let s = drawLine(newSketch(), [0, 0], [30, 0]).sketch;
    s = drawLine(s, [10, -5], [10, 5]).sketch;
    s = drawLine(s, [20, -5], [20, 5]).sketch;
    const base = lines(s)[0]!;
    const out = ok(trimAt(s, base.id, [15, 0]));
    expect(lines(out)).toHaveLength(4);
    const idx = new SketchIndex(out);
    const parts = lines(out).filter((l) => l.kind === "line" && Math.abs(idx.xy(l.a)[1]) < 1e-9 && Math.abs(idx.xy(l.b)[1]) < 1e-9);
    const lengths = parts.map((l) => (l.kind === "line" ? dist(idx.xy(l.a), idx.xy(l.b)) : 0)).sort();
    expect(lengths.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([10, 10]);
    const lone = drawLine(newSketch(), [0, 0], [5, 5]).sketch;
    expect(lines(ok(trimAt(lone, lines(lone)[0]!.id, [1, 1])))).toHaveLength(0);
  });

  it("opens a circle crossed twice into an arc", () => {
    let s = drawCircle(newSketch(), [0, 0], 10).sketch;
    s = drawLine(s, [-20, 0], [20, 0]).sketch;
    const circle = s.entities.find((e) => e.kind === "circle")!;
    const out = ok(trimAt(s, circle.id, [0, 10]));
    const arc = new SketchIndex(out).get(circle.id)!;
    expect(arc.kind).toBe("arc");
    if (arc.kind !== "arc") throw new Error();
    const idx = new SketchIndex(out);
    // Clicking the top half leaves the bottom: anticlockwise from the left (180°) round to the right (0°).
    expect(angleOf(idx.xy(arc.a))).toBeCloseTo(Math.PI);
    expect(Math.abs(angleOf(idx.xy(arc.b)))).toBeCloseTo(0);
  });
});

describe("offset", () => {
  it("follows a chain through shared corners", () => {
    const s = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const c = chainOf(s, lines(s)[0]!.id)!;
    expect(c.closed).toBe(true);
    expect(c.steps).toHaveLength(4);
  });

  it("offsets a rectangle inward into a smaller rectangle held by sizes", () => {
    const s = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const out = ok(offsetChain(s, lines(s)[0]!.id, -2));
    expect(lines(out)).toHaveLength(8);
    const areas = profiles(out)
      .profiles.map((p) => [p.area, ...p.holes.map((h) => h.area)])
      .flat()
      .sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(36 * 16);
    expect(out.dimensions.filter((d) => d.kind === "distance").every((d) => d.value === 2)).toBe(true);
    const solved = solver.solve(out);
    expect(solved.status).toBe("ok");
    // Editing the original moves the copy: make the rectangle wider by sizing its bottom.
    const wider = {
      ...solved.sketch,
      dimensions: [
        ...solved.sketch.dimensions,
        { id: "w", kind: "length" as const, refs: [lines(s)[0]!.id], expression: "50", value: 50, driving: true, labelOffset: [0, 0] as [number, number] },
      ],
    };
    const again = solver.solve(wider);
    expect(again.status).toBe("ok");
    const inner = profiles(again.sketch).profiles[0]!.holes[0]!;
    expect(inner.area).toBeCloseTo(46 * 16, 1);
  });

  it("offsets outward, and a circle into a concentric circle", () => {
    const s = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const out = ok(offsetChain(s, lines(s)[0]!.id, 5));
    expect(profiles(out).profiles[0]!.area).toBeCloseTo(50 * 30);
    const c = drawCircle(newSketch(), [0, 0], 10).sketch;
    const circle = c.entities.find((e) => e.kind === "circle")!;
    const ring = ok(offsetChain(c, circle.id, 3)).entities.filter((e) => e.kind === "circle");
    expect(ring.map((e) => (e.kind === "circle" ? e.r : 0)).sort()).toEqual([10, 13]);
    expect(offsetChain(s, lines(s)[0]!.id, -15)).toBe("That distance is too far for this shape");
  });
});

describe("project", () => {
  it("flattens a box's top face edges onto an offset plane as fixed construction lines", () => {
    const frame = planeFrame({ kind: "world", plane: "XY", offset: 5 });
    const top: [number, number, number][] = [
      [0, 0, 10],
      [20, 0, 10],
      [20, 10, 10],
      [0, 10, 10],
    ];
    const segs = top.map((p, i) => [p, top[(i + 1) % 4]!] as [typeof p, typeof p]);
    const out = ok(projectSegments(newSketch({ kind: "world", plane: "XY", offset: 5 }), frame, segs, { body: "b1", face: 3 }));
    expect(lines(out)).toHaveLength(4);
    expect(out.entities.filter((e) => e.kind === "point")).toHaveLength(4);
    expect(out.entities.every((e) => e.construction && e.projectedFrom?.face === 3)).toBe(true);
    expect(out.constraints.filter((c) => c.type === "fix")).toHaveLength(4);
    expect(solver.solve(out).dof).toBe(0);
    // Real geometry when asked, which then makes a profile.
    const real = ok(projectSegments(newSketch(), frame, segs, { body: "b1", face: 3 }, false));
    expect(profiles(real).profiles[0]!.area).toBeCloseTo(200);
    // A side face seen edge-on projects nothing.
    expect(
      projectSegments(
        newSketch(),
        frame,
        [
          [
            [0, 0, 0],
            [0, 0, 10],
          ],
        ],
        { body: "b1", face: 1 },
      ),
    ).toMatch(/edge-on/);
  });
});

describe("project model edges", () => {
  const XZ = planeFrame({ kind: "world", plane: "XZ", offset: 0 });
  const ring = (c: [number, number, number], r: number, n: number, from = 0, to = 2 * Math.PI): [number, number, number][] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = from + ((to - from) * i) / n;
      return [c[0] + r * Math.cos(t), c[1], c[2] + r * Math.sin(t)];
    });

  it("names an edge's shape on the plane", () => {
    expect(
      flattenCurve(XZ, [
        [0, 0, 0],
        [5, 0, 0],
        [10, 0, 0],
      ]).kind,
    ).toBe("line");
    expect(
      flattenCurve(XZ, [
        [3, 0, 4],
        [3, 10, 4],
      ]),
    ).toEqual({ kind: "point", p: [3, 4] });
    const circle = flattenCurve(XZ, ring([10, 0, 5], 2, 24));
    expect(circle.kind).toBe("circle");
    if (circle.kind === "circle") {
      expect(circle.c[0]).toBeCloseTo(10);
      expect(circle.c[1]).toBeCloseTo(5);
      expect(circle.r).toBeCloseTo(2);
    }
    // A quarter arc running clockwise comes back anticlockwise, ends swapped.
    const arc = flattenCurve(XZ, ring([0, 0, 0], 3, 6, Math.PI / 2, 0));
    expect(arc.kind).toBe("arc");
    if (arc.kind === "arc") {
      expect(arc.a[0]).toBeCloseTo(3);
      expect(arc.b[1]).toBeCloseTo(3);
    }
    // A zig-zag is neither: a chain of lines.
    expect(
      flattenCurve(XZ, [
        [0, 0, 0],
        [5, 0, 1],
        [10, 0, 0],
        [15, 0, 3],
      ]).kind,
    ).toBe("polyline");
  });

  it("brings in a face's outline with its hole, held in place, and shares corners", () => {
    const box: [number, number, number][] = [
      [0, 0, 0],
      [40, 0, 0],
      [40, 0, 20],
      [0, 0, 20],
    ];
    const from = { body: "b1", face: 2 };
    const edges = box.map((p, i) => ({ points: [p, box[(i + 1) % 4]!], from }));
    const hole = { points: ring([20, 0, 10], 2, 32), from };
    const { sketch: out, ids } = projectCurves(newSketch({ kind: "world", plane: "XZ", offset: 0 }), XZ, [...edges, hole]);
    expect(lines(out)).toHaveLength(4);
    expect(out.entities.filter((e) => e.kind === "circle")).toHaveLength(1);
    // Four shared corners and the hole's centre.
    expect(out.entities.filter((e) => e.kind === "point")).toHaveLength(5);
    expect(out.entities.every((e) => e.construction && e.projectedFrom?.body === "b1")).toBe(true);
    expect(ids.every((x) => !!x)).toBe(true);
    const r = solver.solve(out);
    expect(r.status).toBe("ok");
    expect(r.dof).toBe(0);

    // Projecting the same edge again reuses it.
    const again = projectCurves(out, XZ, [{ points: box.slice(0, 2), from: { body: "b1", edge: 0 } }]);
    expect(again.ids[0]).toBe(ids[0]);
    expect(again.sketch.entities).toHaveLength(out.entities.length);
  });

  it("holds a projected rounded corner and lets a size measure to it", () => {
    const from = { body: "b1", edge: 7 };
    const { sketch: out, ids } = projectCurves(newSketch({ kind: "world", plane: "XZ", offset: 0 }), XZ, [
      { points: ring([5, 0, 5], 5, 8, Math.PI, 1.5 * Math.PI), from },
    ]);
    expect(arcs(out)).toHaveLength(1);
    const r = solver.solve(out);
    expect(r.status).toBe("ok");
    expect(r.dof).toBe(0);
    // A circle placed by sizes from the arc's centre, as you would size a hole from a rounded corner.
    const dr = new Draft(out);
    const centre = (out.entities.find((e) => e.id === ids[0]) as { c: string }).c;
    const circle = dr.circle([20, 9], 2);
    const c = (dr.done().sketch.entities.find((e) => e.id === circle) as { c: string }).c;
    dr.dimension("distanceX", [centre, c], 12);
    dr.dimension("distanceY", [centre, c], 3);
    dr.dimension("diameter", [circle], 4);
    const sized = solver.solve(dr.done().sketch);
    expect(sized.status).toBe("ok");
    expect(sized.dof).toBe(0);
    const at = sized.sketch.entities.find((e) => e.id === c) as { x: number; y: number };
    expect(at.x).toBeCloseTo(17);
    expect(at.y).toBeCloseTo(8);
  });
});
