import { newSketch, type Line } from "./model";
import { drawCircle, drawPolyline, drawRectangle } from "./draw";
import { connectedCurves } from "./chain";

const lines = (s: ReturnType<typeof newSketch>) => s.entities.filter((e): e is Line => e.kind === "line");

describe("connectedCurves", () => {
  it("picks every side of a closed outline, the clicked one first", () => {
    let s = drawRectangle(newSketch(), [0, 0], [60, 30]).sketch;
    s = drawCircle(s, [15, 15], 5).sketch;
    const ls = lines(s);
    const chain = connectedCurves(s, ls[2]!.id);
    expect(chain[0]).toBe(ls[2]!.id);
    expect([...chain].sort()).toEqual(ls.map((l) => l.id).sort());
  });

  it("follows an open polyline, and leaves separate shapes out", () => {
    let s = drawPolyline(newSketch(), [
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
    ]).sketch;
    const open = lines(s).map((l) => l.id);
    s = drawRectangle(s, [50, 50], [60, 60]).sketch;
    expect([...connectedCurves(s, open[1]!)].sort()).toEqual([...open].sort());
  });

  it("joins ends tied by a coincident constraint", () => {
    let s = drawPolyline(newSketch(), [
      [0, 0],
      [10, 0],
    ]).sketch;
    s = drawPolyline(s, [
      [10, 0],
      [10, 10],
    ]).sketch;
    const [a, b] = lines(s);
    const joined = a!.b === b!.a ? s : { ...s, constraints: [...s.constraints, { id: "k", type: "coincident" as const, a: a!.b, b: b!.a }] };
    expect(connectedCurves(joined, a!.id)).toEqual([a!.id, b!.id]);
  });

  it("keeps construction apart, a circle on its own, and a point picks nothing", () => {
    let s = drawRectangle(newSketch(), [0, 0], [10, 10]).sketch;
    const [first, ...rest] = lines(s);
    s = { ...s, entities: s.entities.map((e) => (e.id === first!.id ? { ...e, construction: true } : e)) };
    expect(connectedCurves(s, first!.id)).toEqual([first!.id]);
    expect([...connectedCurves(s, rest[0]!.id)].sort()).toEqual(rest.map((l) => l.id).sort());
    s = drawCircle(s, [30, 30], 5).sketch;
    const c = s.entities.find((e) => e.kind === "circle")!;
    expect(connectedCurves(s, c.id)).toEqual([c.id]);
    expect(connectedCurves(s, rest[0]!.a)).toEqual([]);
  });
});
