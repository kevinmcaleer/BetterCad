import { newSketch } from "./model";
import { drawCircle, drawPolyline, drawRectangle, drawArc3, Draft } from "./draw";
import { profiles } from "./profiles";

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
