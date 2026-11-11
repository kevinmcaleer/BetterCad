import { newDoc } from "../state/document";
import { addCanvas, calibrate, canvasFrame, firstCanvasSize, removeCanvas, updateCanvas } from "./canvas";
import type { CanvasImage } from "../state/document";

const image = { blob: "h1", type: "image/png", file: "part.png", width: 400, height: 200 };
const base: Omit<CanvasImage, "name"> = {
  id: "c1",
  plane: { kind: "world", plane: "XY", offset: 0 },
  image,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  angle: 0,
  opacity: 0.5,
};

describe("calibrating a canvas (#248)", () => {
  it("scales it so the two spots are the distance apart, keeping the first spot where it is", () => {
    // Spots 20 mm apart that are really 40 mm apart: twice the size, about the first spot.
    const to = calibrate(base, [-10, 0], [10, 0], 40)!;
    expect(to.width).toBeCloseTo(200);
    expect(to.height).toBeCloseTo(100);
    expect(to.x).toBeCloseTo(10);
    expect(to.y).toBeCloseTo(0);
  });
  it("works along a slant", () => {
    const to = calibrate({ ...base, x: 5, y: 5 }, [0, 0], [3, 4], 10)!;
    expect(to.width).toBeCloseTo(200);
    expect(to.x).toBeCloseTo(10);
    expect(to.y).toBeCloseTo(10);
  });
  it("won't calibrate from one spot or to no distance", () => {
    expect(calibrate(base, [1, 1], [1, 1], 40)).toBeNull();
    expect(calibrate(base, [0, 0], [1, 0], 0)).toBeNull();
  });
});

describe("canvases in the model", () => {
  it("starts 100 mm on its long side, in the picture's shape", () => {
    expect(firstCanvasSize({ width: 400, height: 200 })).toEqual({ width: 100, height: 50 });
    expect(firstCanvasSize({ width: 300, height: 600 })).toEqual({ width: 50, height: 100 });
  });
  it("finds a plane's frame with its up axis", () => {
    const f = canvasFrame({ kind: "world", plane: "XY", offset: 0 });
    expect(f.x).toEqual([1, 0, 0]);
    expect(f.y.map((v) => v + 0)).toEqual([0, 1, 0]);
    expect(f.normal).toEqual([0, 0, 1]);
  });
  it("follows a construction plane as built", () => {
    const frame = { origin: [0, 0, 30] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    const f = canvasFrame({ kind: "construct", step: "k1", offset: 0, frame: { ...frame, origin: [0, 0, 10] } }, [
      { id: "k1", name: "Plane 1", geo: { what: "plane", frame } } as never,
    ]);
    expect(f.origin).toEqual([0, 0, 30]);
  });
  it("adds, names, changes and removes them, keeping the picture's bytes only while used", () => {
    let d = addCanvas(newDoc(), base, "AAAA");
    expect(d.canvases).toHaveLength(1);
    expect(d.canvases![0]!.name).toBe("Canvas 1");
    expect(d.blobs?.h1).toBe("AAAA");
    d = addCanvas(d, { ...base, id: "c2" }, "AAAA");
    expect(d.canvases![1]!.name).toBe("Canvas 2");
    d = updateCanvas(d, "c1", { opacity: 0.8, locked: true });
    expect(d.canvases![0]).toMatchObject({ opacity: 0.8, locked: true });
    d = removeCanvas(d, "c1");
    expect(d.blobs?.h1).toBe("AAAA");
    d = removeCanvas(d, "c2");
    expect(d.canvases).toEqual([]);
    expect(d.blobs?.h1).toBeUndefined();
  });
});
