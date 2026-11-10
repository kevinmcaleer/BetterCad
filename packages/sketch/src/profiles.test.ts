import { newSketch } from "./model";
import { drawCircle, drawPolyline, drawRectangle, drawArc3, Draft } from "./draw";
import { profiles, regions } from "./profiles";

describe("profiles", () => {
  it("a rectangle with two circles is one profile with two holes", () => {
    let s = drawRectangle(newSketch(), [0, 0], [60, 30]).sketch;
    s = drawCircle(s, [15, 15], 5).sketch;
    s = drawCircle(s, [45, 15], 5).sketch;
    const r = profiles(s);
    expect(r.profiles).toHaveLength(1);
    expect(r.profiles[0]!.area).toBeCloseTo(1800, 6);
    expect(r.profiles[0]!.holes).toHaveLength(2);
    expect(r.profiles[0]!.edges).toHaveLength(4);
    expect(r.openEnds).toEqual([]);
  });

  it("nested rings alternate: ring, then a disc inside the hole", () => {
    let s = drawCircle(newSketch(), [0, 0], 30).sketch;
    s = drawCircle(s, [0, 0], 20).sketch;
    s = drawCircle(s, [0, 0], 10).sketch;
    const r = profiles(s);
    expect(r.profiles.map((p) => Math.round(p.area))).toEqual([Math.round(Math.PI * 900), Math.round(Math.PI * 100)]);
    expect(r.profiles[0]!.holes).toHaveLength(1);
    expect(r.profiles[1]!.holes).toHaveLength(0);
  });

  it("an open polyline has no profile and reports its two ends", () => {
    const s = drawPolyline(newSketch(), [
      [0, 0],
      [10, 0],
      [10, 10],
    ]).sketch;
    const r = profiles(s);
    expect(r.profiles).toEqual([]);
    expect(r.openEnds).toHaveLength(2);
  });

  it("a line across a rectangle makes two profiles; a dangling line does not split anything", () => {
    const d = new Draft(newSketch());
    const c = [d.point([0, 0]), d.point([20, 0]), d.point([20, 10]), d.point([0, 10]), d.point([10, 0]), d.point([10, 10])];
    d.line(c[0]!, c[4]!);
    d.line(c[4]!, c[1]!);
    d.line(c[1]!, c[2]!);
    d.line(c[2]!, c[5]!);
    d.line(c[5]!, c[3]!);
    d.line(c[3]!, c[0]!);
    d.line(c[4]!, c[5]!);
    d.line(c[1]!, [30, 0]);
    const r = profiles(d.done().sketch);
    expect(r.profiles.map((p) => Math.round(p.area))).toEqual([100, 100]);
    expect(r.openEnds).toHaveLength(1);
  });

  it("arcs close a shape (a D) and construction lines are ignored", () => {
    const d0 = new Draft(newSketch());
    const a = d0.point([0, -10]);
    const b = d0.point([0, 10]);
    d0.line(a, b);
    d0.line([0, 0], [50, 50], { construction: true });
    const s = drawArc3(d0.done().sketch, a, [10, 0], b)!.sketch;
    const r = profiles(s);
    expect(r.profiles).toHaveLength(1);
    expect(r.profiles[0]!.area).toBeCloseTo((Math.PI * 100) / 2, 0);
    // It bulges toward the point it was drawn through.
    expect(Math.max(...r.profiles[0]!.points.map((p) => p[0]))).toBeCloseTo(10, 6);
  });

  it("points tied by a coincident constraint close the loop", () => {
    const d = new Draft(newSketch());
    d.line([0, 0], [10, 0]);
    d.line([10, 0], [10, 10]);
    d.line([10, 10], [0, 0]);
    const s = d.done().sketch;
    expect(profiles(s).profiles).toHaveLength(0);
    const pts = s.entities.filter((e) => e.kind === "point");
    const tied = new Draft(s);
    tied.constrain({ type: "coincident", a: pts[1]!.id, b: pts[2]!.id });
    tied.constrain({ type: "coincident", a: pts[3]!.id, b: pts[4]!.id });
    tied.constrain({ type: "coincident", a: pts[5]!.id, b: pts[0]!.id });
    expect(profiles(tied.done().sketch).profiles[0]!.area).toBeCloseTo(50, 9);
  });
});

describe("regions cut where curves cross (split)", () => {
  // Net areas, sorted; arcs are sampled, so they are within a square millimetre or so.
  const expectAreas = (list: { area: number; holes: { area: number }[] }[], want: number[]) => {
    const got = list.map((p) => p.area - p.holes.reduce((a, h) => a + h.area, 0)).sort((a, b) => a - b);
    expect(got).toHaveLength(want.length);
    [...want].sort((a, b) => a - b).forEach((w, i) => expect(Math.abs(got[i]! - w)).toBeLessThan(1.5));
  };

  it("a circle over a rectangle's corner makes three regions", () => {
    let s = drawRectangle(newSketch(), [0, 0], [20, 20]).sketch;
    s = drawCircle(s, [20, 20], 10).sketch;
    const q = (Math.PI * 100) / 4;
    expectAreas(regions(s, { split: true }), [q, 3 * q, 400 - q]);
    // Without splitting the two shapes stay whole.
    expect(regions(s)).toHaveLength(2);
  });

  it("projected face edges bound regions: the corners outside a circle that touches them", () => {
    const d = new Draft(newSketch());
    const c = [d.point([0, 0], true), d.point([40, 0], true), d.point([40, 20], true), d.point([0, 20], true)];
    for (let i = 0; i < 4; i++) d.line(c[i]!, c[(i + 1) % 4]!, { construction: true });
    // A construction line the user drew does not bound anything.
    d.line([0, 10], [40, 10], { construction: true });
    let s = d.done().sketch;
    const lines = s.entities
      .filter((e) => e.kind === "line")
      .slice(0, 4)
      .map((e) => e.id);
    s = { ...s, entities: s.entities.map((e) => (lines.includes(e.id) ? { ...e, projectedFrom: { body: "b", face: 0 } as never } : e)) };
    s = drawCircle(s, [30, 10], 10).sketch;
    const corner = (400 - 100 * Math.PI) / 4;
    expectAreas(regions(s, { split: true }), [corner, corner, 100 * Math.PI, 800 - 100 * Math.PI - 2 * corner]);
    // Each corner is a line, an arc and a line, the arc a quarter circle.
    const small = regions(s, { split: true }).filter((p) => Math.abs(p.area - corner) < 0.5);
    for (const p of small) {
      expect(p.edges).toHaveLength(3);
      expect(p.edges.every((e) => e.span)).toBe(true);
    }
  });

  it("a circle inside a rectangle is the hole in the ring; a line across the circle splits only the disc", () => {
    let s = drawRectangle(newSketch(), [0, 0], [60, 30]).sketch;
    s = drawCircle(s, [30, 15], 10).sketch;
    const d = new Draft(s);
    d.line([20, 15], [40, 15]);
    s = d.done().sketch;
    const list = regions(s, { split: true });
    const half = (Math.PI * 100) / 2;
    expectAreas(list, [half, half, 1800 - 2 * half]);
    const ring = list.find((p) => p.holes.length)!;
    expect(ring.holes).toHaveLength(1);
    expect(ring.holes[0]!.area).toBeCloseTo(Math.PI * 100, 0);
  });

  it("two overlapping circles make a lens and two crescents", () => {
    let s = drawCircle(newSketch(), [0, 0], 10).sketch;
    s = drawCircle(s, [10, 0], 10).sketch;
    const list = regions(s, { split: true });
    expect(list).toHaveLength(3);
    const lens = 2 * 100 * Math.acos(0.5) - 5 * Math.sqrt(400 - 100);
    expect(Math.min(...list.map((p) => p.area))).toBeCloseTo(lens, 0);
  });
});
