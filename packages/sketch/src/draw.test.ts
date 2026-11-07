import { newSketch, type Sketch } from "./model";
import { drawArc3, drawCentreRectangle, drawCircle, drawLine, drawPolygon, drawPolyline, drawRectangle } from "./draw";

const count = (s: Sketch) => ({
  points: s.entities.filter((e) => e.kind === "point").length,
  lines: s.entities.filter((e) => e.kind === "line").length,
  constraints: s.constraints.map((c) => c.type).sort(),
  dimensions: s.dimensions.map((d) => `${d.kind} ${d.value}`),
});

describe("what each drawing tool adds", () => {
  it("a line near level is horizontal, near upright is vertical, otherwise free", () => {
    expect(count(drawLine(newSketch(), [0, 0], [20, 0.5]).sketch).constraints).toEqual(["horizontal"]);
    expect(count(drawLine(newSketch(), [0, 0], [0.5, -20]).sketch).constraints).toEqual(["vertical"]);
    expect(count(drawLine(newSketch(), [0, 0], [20, 5]).sketch).constraints).toEqual([]);
    expect(count(drawLine(newSketch(), [0, 0], [20, 5], { length: 25 }).sketch).dimensions).toEqual(["length 25"]);
  });

  it("a rectangle: 4 lines, 4 points, 2 horizontal, 2 vertical, and the typed sizes", () => {
    expect(count(drawRectangle(newSketch(), [0, 0], [45, 20], { width: 45, height: 20 }).sketch)).toEqual({
      points: 4,
      lines: 4,
      constraints: ["horizontal", "horizontal", "vertical", "vertical"],
      dimensions: ["length 45", "length 20"],
    });
  });

  it("a centre rectangle adds a construction centre on a construction diagonal", () => {
    const s = drawCentreRectangle(newSketch(), [0, 0], [10, 5]).sketch;
    expect(s.entities.filter((e) => e.construction).map((e) => e.kind)).toEqual(["point", "line"]);
    expect(count(s).constraints).toContain("midpoint");
  });

  it("a polyline shares its corners and closing it shares the first", () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(count(drawPolyline(newSketch(), pts).sketch)).toMatchObject({ points: 3, lines: 2 });
    expect(count(drawPolyline(newSketch(), pts, true).sketch)).toMatchObject({ points: 3, lines: 3 });
  });

  it("a typed circle size is a diameter", () => {
    const s = drawCircle(newSketch(), [0, 0], 1, 8).sketch;
    expect(s.entities.find((e) => e.kind === "circle")).toMatchObject({ r: 4 });
    expect(count(s).dimensions).toEqual(["diameter 8"]);
  });

  it("an arc through three points is stored anticlockwise", () => {
    const s = drawArc3(newSketch(), [10, 0], [0, -10], [-10, 0])!.sketch;
    const arc = s.entities.find((e) => e.kind === "arc")!;
    const pt = (id: string) => s.entities.find((e) => e.id === id) as { x: number; y: number };
    // Drawn clockwise through the bottom, so stored from (-10, 0) round to (10, 0).
    expect([pt((arc as { a: string }).a).x, pt((arc as { b: string }).b).x]).toEqual([-10, 10]);
    expect(drawArc3(newSketch(), [0, 0], [1, 1], [2, 2])).toBeNull();
  });

  it("a polygon: equal sides on a construction circle, 3 to 12 sides", () => {
    const s = drawPolygon(newSketch(), [0, 0], 10, 6).sketch;
    expect(count(s)).toMatchObject({ lines: 6 });
    expect(s.constraints.filter((c) => c.type === "equal")).toHaveLength(5);
    expect(s.constraints.filter((c) => c.type === "pointOn")).toHaveLength(6);
    expect(s.entities.filter((e) => e.kind === "circle" && e.construction)).toHaveLength(1);
    expect(count(drawPolygon(newSketch(), [0, 0], 10, 40).sketch).lines).toBe(12);
  });
});
