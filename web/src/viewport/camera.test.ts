import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA, cameraBasis, fit, fitInRect, gridStep, lerpCamera, lookFrom, orbit, pan, presetOf, snapTo, toPreset, viewDir, zoom } from "./camera";
import { FACE_ONLY, decodeId, encodeId, findPick } from "./ids";

const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

describe("camera", () => {
  it("presets look the way Fusion does, Z up", () => {
    near(viewDir(-90, 0), [0, -1, 0]); // front: camera on −Y
    near(viewDir(0, 0), [1, 0, 0]); // side: camera on +X
    const top = cameraBasis(toPreset(DEFAULT_CAMERA, "top"));
    near(top.back, [0, 0, 1]);
    near(top.up, [0, 1, 0]); // +Y up the screen
    near(top.right, [1, 0, 0]);
    const front = cameraBasis(toPreset(DEFAULT_CAMERA, "front"));
    near(front.up, [0, 0, 1]);
    near(front.right, [1, 0, 0]);
  });

  it("knows which preset it is at, and stops being one when turned", () => {
    expect(presetOf(toPreset(DEFAULT_CAMERA, "side"))).toBe("side");
    expect(presetOf(orbit(toPreset(DEFAULT_CAMERA, "side"), 10, 0))).toBeNull();
  });

  it("orbit wraps azimuth and stops elevation at the poles", () => {
    const c = orbit({ ...DEFAULT_CAMERA, azimuth: 170, elevation: 80 }, 20, 30);
    expect(c.azimuth).toBeCloseTo(-170);
    expect(c.elevation).toBe(90);
  });

  it("pan moves the target opposite the drag, scaled to the view", () => {
    const c = toPreset({ ...DEFAULT_CAMERA, target: [0, 0, 0] }, "front");
    const p = pan(c, 100, 0, 500);
    expect(p.target[0]).toBeLessThan(0);
    expect(p.target[1]).toBeCloseTo(0);
  });

  it("zoom keeps the point under the cursor still", () => {
    const c = toPreset({ ...DEFAULT_CAMERA, target: [0, 0, 0], distance: 100 }, "front");
    const z = zoom(c, 0.5, 1, 0, 1);
    expect(z.distance).toBe(50);
    // The cursor was at the right edge; the target moves halfway towards that point.
    expect(z.target[0]).toBeGreaterThan(0);
  });

  it("fit frames a sphere and tweens in log space", () => {
    const f = fit(DEFAULT_CAMERA, [5, 5, 5], 50, 1.6);
    expect(f.target).toEqual([5, 5, 5]);
    expect(f.distance).toBeGreaterThan(150);
    const mid = lerpCamera({ ...f, distance: 10 }, { ...f, distance: 1000 }, 0.5);
    expect(mid.distance).toBeCloseTo(100);
  });

  it("fit frames the model in the part of the view the panels leave clear", () => {
    const whole = fitInRect(DEFAULT_CAMERA, [0, 0, 0], 50, 1000, 800, null);
    expect(whole).toEqual(fit(DEFAULT_CAMERA, [0, 0, 0], 50, 1000 / 800));
    // A clear area half the height and centred on the view: twice as far back, same target.
    const half = fitInRect(DEFAULT_CAMERA, [0, 0, 0], 50, 1000, 800, { left: 250, top: 200, width: 500, height: 400 });
    expect(half.distance).toBeCloseTo(whole.distance * 2);
    expect(half.target[0]).toBeCloseTo(0);
    expect(half.target[2]).toBeCloseTo(0);
    // The clear area sits right of centre: the target moves left, so the model shows to the right.
    const right = fitInRect(DEFAULT_CAMERA, [0, 0, 0], 50, 1000, 800, { left: 500, top: 200, width: 500, height: 400 });
    const { right: r } = cameraBasis(right);
    const along = right.target[0] * r[0] + right.target[1] * r[1] + right.target[2] * r[2];
    expect(along).toBeLessThan(0);
    // Too small to use: frames the whole view.
    expect(fitInRect(DEFAULT_CAMERA, [0, 0, 0], 50, 1000, 800, { left: 0, top: 0, width: 20, height: 20 })).toEqual(whole);
  });

  it("the grid steps by powers of ten, never under 1 mm", () => {
    expect(gridStep(5)).toBe(1);
    expect(gridStep(200)).toBe(10);
    expect(gridStep(2500)).toBe(100);
  });

  it("snaps to steps", () => {
    expect(snapTo(12.4, 5)).toBe(10);
    expect(snapTo(23, 15)).toBe(30);
  });
});

describe("looking from the view cube", () => {
  it("faces, edges and corners turn the camera to look from there", () => {
    expect(presetOf(lookFrom(DEFAULT_CAMERA, [0, -1, 0]))).toBe("front");
    expect(presetOf(lookFrom(DEFAULT_CAMERA, [1, 0, 0]))).toBe("side");
    expect(presetOf(lookFrom(DEFAULT_CAMERA, [0, 0, 1]))).toBe("top");
    expect(presetOf(lookFrom(DEFAULT_CAMERA, [0, 0, -1]))).toBe("bottom");
    expect(presetOf(lookFrom({ ...DEFAULT_CAMERA, azimuth: 120, elevation: 10 }, [1, -1, 1]))).toBe("iso");
    const edge = lookFrom(DEFAULT_CAMERA, [0, -1, 1]);
    expect(edge.azimuth).toBeCloseTo(-90);
    expect(edge.elevation).toBeCloseTo(45);
    expect(edge.distance).toBe(DEFAULT_CAMERA.distance);
  });
});

describe("picking IDs", () => {
  it("round-trips a body and element", () => {
    expect(decodeId(...encodeId(300, 1234))).toEqual({ body: 300, element: 1234 });
    expect(decodeId(0, 0, 0, 0).body).toBe(-1);
  });

  it("finds the nearest edge pixel, skipping faces drawn only to hide", () => {
    const size = 5;
    const px = new Uint8Array(size * size * 4);
    const put = (x: number, y: number, body: number, el: number) => px.set(encodeId(body, el), (y * size + x) * 4);
    put(2, 2, 0, FACE_ONLY);
    put(4, 2, 0, 7);
    put(0, 0, 1, 3);
    expect(findPick(px, size, "edge")).toEqual({ body: 0, element: 7 });
    expect(findPick(px, size, "face")).toEqual({ body: 0, element: FACE_ONLY });
    expect(findPick(new Uint8Array(size * size * 4), size, "body")).toBeNull();
  });

  it("finds a body a finger lands just off, which a cursor would miss", () => {
    const size = 15;
    const px = new Uint8Array(size * size * 4);
    px.set(encodeId(2, 0), (7 * size + 13) * 4);
    expect(findPick(px, size, "body")).toBeNull();
    expect(findPick(px, size, "body", true)).toEqual({ body: 2, element: 0 });
  });
});
