import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA,
  cameraBasis,
  facing,
  fit,
  PRESETS,
  boxCorners,
  dot,
  fitPoints,
  halfHeight,
  type CameraState,
  type V3,
  gridStep,
  lerpCamera,
  lookFrom,
  orbit,
  pan,
  presetOf,
  rollBy,
  sketchTurn,
  snapTo,
  toPreset,
  viewDir,
  zoom,
} from "./camera";
import { frameY, squareFrame, type Vec3 } from "@bettercad/sketch";
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

  it("rolls the view a quarter turn about the line of sight, the picture turning clockwise", () => {
    const front = toPreset(DEFAULT_CAMERA, "front");
    const cw = rollBy(front, 1);
    expect(cw.roll).toBe(90);
    const b = cameraBasis(cw);
    near(b.back, [0, -1, 0]); // still looking from the front
    near(b.up, [-1, 0, 0]); // the world's −X is now up the screen…
    near(b.right, [0, 0, 1]); // …and Z points right: the picture turned clockwise
    near(cameraBasis(rollBy(front, -1)).up, [1, 0, 0]);
    // Four quarter turns come back round; a preset or a cube pick squares the roll off.
    expect(rollBy(rollBy(rollBy(cw, 1), 1), 1).roll).toBe(0);
    expect(presetOf(cw)).toBeNull();
    expect(presetOf(rollBy(rollBy(rollBy(cw, 1), 1), 1))).toBe("front");
    expect(toPreset(cw, "front").roll).toBe(0);
    // Half way through the glide it has turned 45°.
    expect(lerpCamera(front, cw, 0.5).roll).toBeCloseTo(45, 6);
  });

  it("a cube pick keeps the view's quarter turn instead of standing it upright", () => {
    // Turned upside down, then nudged by an orbit: clicking Front squares it up, still upside down.
    const upside = orbit(rollBy(rollBy(toPreset(DEFAULT_CAMERA, "front"), 1), 1), 8, 5);
    const back = lookFrom(upside, [0, -1, 0]);
    expect(back.roll).toBe(-180);
    expect(back.azimuth).toBeCloseTo(-90, 6);
    expect(back.elevation).toBeCloseTo(0, 6);
    near(cameraBasis(back).up, [0, 0, -1]);
    // An odd roll squares to the nearest quarter turn; an upright view stays upright.
    expect(lookFrom({ ...DEFAULT_CAMERA, roll: 100 }, [0, 0, 1]).roll).toBe(90);
    expect(lookFrom({ ...DEFAULT_CAMERA, roll: -30 }, [1, 0, 0]).roll).toBe(0);
    expect(lookFrom(DEFAULT_CAMERA, [0, -1, 0]).roll).toBe(0);
  });

  it("a sketch keeps the view's quarter turn only while the view looks straight at it", () => {
    const top = toPreset(DEFAULT_CAMERA, "top");
    expect(sketchTurn(rollBy(rollBy(top, 1), 1), [0, 0, 1])).toBe(-180);
    expect(sketchTurn({ ...top, roll: 95 }, [0, 0, 1])).toBe(90);
    expect(sketchTurn(top, [0, 0, 1])).toBe(0);
    // Turned away from the plane, or looking at its back: nothing to keep.
    expect(sketchTurn(orbit(top, 0, -20), [0, 0, 1])).toBeNull();
    expect(sketchTurn(top, [0, 0, -1])).toBeNull();
  });

  it("orbits a rolled view along the drag on the rolled screen", () => {
    // Rolled 90° clockwise, a drag down the screen (which raises elevation unrolled) now runs along the old horizontal.
    const cw = rollBy(toPreset(DEFAULT_CAMERA, "front"), 1);
    const o = orbit(cw, 0, 10);
    expect(o.elevation).toBeCloseTo(0, 6);
    expect(Math.abs(o.azimuth - cw.azimuth)).toBeCloseTo(10, 6);
  });

  it("a sketch on any face is square to the screen when you look straight at it", () => {
    // A round face's longest mesh edge points anywhere; the frame no longer follows it (Kev's wheel sketch came out at 45°).
    const normals: Vec3[] = [
      [0, 0, 1],
      [0, 0, -1],
      [0, -1, 0],
      [1, 0, 0],
      [-0.6, 0.8, 0],
      [0.3, -0.5, 0.81],
      [0.2, 0.1, -0.9],
    ];
    for (const n of normals) {
      const f = squareFrame([5, 6, 7], n);
      const view = cameraBasis({ ...DEFAULT_CAMERA, ...facing(n) });
      near(view.right, f.x);
      near(view.up, frameY(f));
    }
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

  it("fit fills the clear area with the model's outline, keeping the view's direction and roll", () => {
    const box = boxCorners([-40, -20, 0], [40, 20, 30]);
    const rect = { left: 300, top: 100, width: 500, height: 600 };
    for (const ortho of [false, true]) {
      for (const turn of [{}, PRESETS.front, { roll: 90 }]) {
        const c: CameraState = { ...DEFAULT_CAMERA, ...turn, ortho };
        const f = fitPoints(c, box, 1000, 800, rect, 0.05);
        expect(f.azimuth).toBe(c.azimuth);
        expect(f.elevation).toBe(c.elevation);
        expect(f.roll).toBe(c.roll);
        const px = box.map((p) => onScreen(f, p, 1000, 800));
        const xs = px.map((p) => p[0]);
        const ys = px.map((p) => p[1]);
        // Inside the clear area, less the margin...
        expect(Math.min(...xs)).toBeGreaterThan(rect.left + 25 - 0.5);
        expect(Math.max(...xs)).toBeLessThan(rect.left + rect.width - 25 + 0.5);
        expect(Math.min(...ys)).toBeGreaterThan(rect.top + 30 - 0.5);
        expect(Math.max(...ys)).toBeLessThan(rect.top + rect.height - 30 + 0.5);
        // ...and touching both its edges on one axis at least.
        const fillsX = Math.abs(Math.min(...xs) - (rect.left + 25)) < 1 && Math.abs(Math.max(...xs) - (rect.left + rect.width - 25)) < 1;
        const fillsY = Math.abs(Math.min(...ys) - (rect.top + 30)) < 1 && Math.abs(Math.max(...ys) - (rect.top + rect.height - 30)) < 1;
        expect(fillsX || fillsY).toBe(true);
      }
    }
  });

  it("fit without a usable clear area fills the whole view", () => {
    const box = boxCorners([0, 0, 0], [10, 10, 10]);
    const whole = fitPoints(DEFAULT_CAMERA, box, 1000, 800, null);
    expect(fitPoints(DEFAULT_CAMERA, box, 1000, 800, { left: 0, top: 0, width: 20, height: 20 })).toEqual(whole);
    const xs = box.map((p) => onScreen(whole, p, 1000, 800)[0]);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(1000);
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

/** Where a world point lands on a `width` x `height` px view, from its top left. */
function onScreen(c: CameraState, p: V3, width: number, height: number): [number, number] {
  const { position, right, up, back } = cameraBasis(c);
  const d: V3 = [p[0] - position[0], p[1] - position[1], p[2] - position[2]];
  const h = halfHeight(c);
  const depth = c.ortho ? 1 : -dot(d, back) / c.distance;
  const nx = dot(d, right) / (h * (width / height) * depth);
  const ny = dot(d, up) / (h * depth);
  return [((nx + 1) / 2) * width, ((1 - ny) / 2) * height];
}
