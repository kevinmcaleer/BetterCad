import { arcFrom3, circleCircle, filletCorner, lineCircle, lineLine, polygonArea, polygonPoints, sweep } from "./geom2d";

const close = (a: number[], b: number[], d = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, d));

describe("geom2d", () => {
  it("an arc through three points", () => {
    const a = arcFrom3([10, 0], [0, 10], [-10, 0])!;
    close(a.c, [0, 0]);
    expect(a.r).toBeCloseTo(10, 9);
    expect(a.ccw).toBe(true);
    expect(arcFrom3([10, 0], [0, -10], [-10, 0])!.ccw).toBe(false);
    expect(arcFrom3([0, 0], [1, 1], [2, 2])).toBeNull();
  });

  it("polygon corners sit on the circle, the first straight up", () => {
    const pts = polygonPoints([0, 0], 10, 6);
    expect(pts).toHaveLength(6);
    close(pts[0]!, [0, 10]);
    for (const p of pts) expect(Math.hypot(...p)).toBeCloseTo(10, 9);
    expect(polygonArea(pts)).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * 100, 6);
  });

  it("intersections", () => {
    close(lineLine([0, 0], [10, 0], [5, -5], [5, 5])!.p, [5, 0]);
    expect(lineLine([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull();
    const lc = lineCircle([-20, 0], [20, 0], [0, 0], 10).map((h) => h.p[0]);
    close(lc, [-10, 10]);
    const cc = circleCircle([0, 0], 10, [10, 0], 10);
    expect(cc).toHaveLength(2);
    close(cc[0]!, [5, Math.sqrt(75)]);
    expect(circleCircle([0, 0], 1, [10, 0], 1)).toEqual([]);
  });

  it("sweeps run anticlockwise", () => {
    expect(sweep(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(sweep(Math.PI / 2, 0)).toBeCloseTo((3 * Math.PI) / 2);
  });

  it("a fillet arc touches both lines at the radius", () => {
    const f = filletCorner([0, 0], [20, 0], [0, 20], 3)!;
    close(f.c, [3, 3]);
    close(f.ta, [3, 0]);
    close(f.tb, [0, 3]);
    expect(filletCorner([0, 0], [2, 0], [0, 2], 3)).toBeNull();
  });
});
