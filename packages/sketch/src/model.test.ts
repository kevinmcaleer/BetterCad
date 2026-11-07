import {
  cross3,
  faceFrame,
  formatDimension,
  frameY,
  newSketch,
  parseSketch,
  planeFrame,
  removeEntities,
  toSketch,
  toWorld,
  WORLD_FRAMES,
  type Vec3,
} from "./model";
import { drawCircle, drawRectangle } from "./draw";

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe("sketch model", () => {
  it("round-trips through JSON", () => {
    let s = drawRectangle(newSketch(), [0, 0], [40, 20], { width: 40, height: 20 }).sketch;
    s = drawCircle(s, [10, 10], 3).sketch;
    const back = parseSketch(JSON.parse(JSON.stringify(s)));
    expect(back).toEqual(s);
    expect(() => parseSketch({ entities: [] })).toThrow(/not a sketch/);
  });

  it("removing a line takes its unshared points, constraints and dimensions with it", () => {
    const r = drawRectangle(newSketch(), [0, 0], [40, 20], { width: 40 });
    const s = removeEntities(r.sketch, [r.ids[0]!]);
    expect(s.entities.filter((e) => e.kind === "line")).toHaveLength(3);
    // The corners are shared with the sides, so all four stay.
    expect(s.entities.filter((e) => e.kind === "point")).toHaveLength(4);
    expect(s.dimensions).toHaveLength(0);
    expect(s.constraints).toHaveLength(3);
  });

  it("world planes give right-handed frames, and offsets move along the normal", () => {
    for (const f of Object.values(WORLD_FRAMES)) close(cross3(f.x, frameY(f)), f.normal);
    const top = planeFrame({ kind: "world", plane: "XY", offset: 5 });
    close(toWorld(top, [3, 4]), [3, 4, 5]);
    const front = planeFrame({ kind: "world", plane: "XZ", offset: 0 });
    // Sketch Y on the front plane is world Z (up).
    close(toWorld(front, [0, 10]), [0, 0, 10]);
  });

  it("a face at any angle gets a right-handed frame whose normal is the face's", () => {
    const n: Vec3 = [0.3, -0.5, 0.81];
    const f = faceFrame([1, 2, 3], n, [1, 1, 0]);
    const l = Math.hypot(...n);
    close(
      f.normal,
      n.map((v) => v / l),
    );
    close(cross3(f.x, frameY(f)), f.normal);
    expect(f.x[0] * f.normal[0] + f.x[1] * f.normal[1] + f.x[2] * f.normal[2]).toBeCloseTo(0, 9);
    close(toSketch(f, toWorld(f, [7, -2])), [7, -2]);
  });

  it("formats dimensions as the brand book says", () => {
    expect(formatDimension({ kind: "length", value: 45, driving: true })).toBe("45 mm");
    expect(formatDimension({ kind: "diameter", value: 8, driving: true })).toBe("⌀ 8 mm");
    expect(formatDimension({ kind: "radius", value: 2.5, driving: true })).toBe("R 2.5 mm");
    expect(formatDimension({ kind: "angle", value: 30, driving: false })).toBe("(30°)");
  });
});
