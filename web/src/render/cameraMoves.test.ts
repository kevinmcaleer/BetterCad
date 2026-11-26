import { describe, expect, it } from "vitest";
import { CAMERA_MOVES, cameraAt, cameraMove, ease, framingOf, movePreset } from "./cameraMoves";
import { DEFAULT_CAMERA, type CameraState } from "../viewport/camera";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** A 40 × 20 × 10 mm box from the origin, moved 100 mm along X. */
const BOX = framingOf([{ positions: [0, 0, 0, 40, 20, 10], matrix: [...IDENTITY.slice(0, 12), 100, 0, 0, 1] }], 1.5)!;
const VIEW: CameraState = { ...DEFAULT_CAMERA, azimuth: -60, elevation: 30, target: [0, 0, 0], distance: 999 };

describe("camera moves", () => {
  it("frames the middle of the model, placed by its matrix", () => {
    expect(BOX.centre).toEqual([120, 10, 5]);
    expect(BOX.radius).toBeCloseTo(Math.hypot(40, 20, 10) / 2);
    expect(framingOf([], 1)).toBeNull();
  });

  it("eases: steady, slow at both ends, and slowing to a stop", () => {
    for (const e of ["linear", "inOut", "ramp", "out"] as const) {
      expect(ease(e, 0)).toBe(0);
      expect(ease(e, 1)).toBeCloseTo(1);
      expect(ease(e, 0.5)).toBeCloseTo(e === "out" ? 0.875 : 0.5);
    }
    expect(ease("linear", 0.1)).toBeCloseTo(0.1);
    // The speed ramp starts slower than a plain ease in and out.
    expect(ease("ramp", 0.1)).toBeLessThan(ease("inOut", 0.1));
    expect(ease("ramp", 2)).toBe(1);
  });

  it("orbits once round the middle of the model, left to right, from your view and back to it", () => {
    const move = cameraMove("orbit", 10);
    expect(move).toEqual({ preset: "orbit", seconds: 10, easing: "linear" });
    const start = cameraAt(move, VIEW, BOX, 0);
    expect(start.target).toEqual(BOX.centre);
    expect(start.azimuth).toBe(-60);
    expect(start.elevation).toBe(30);
    expect(start.ortho).toBe(false);
    // Steady: a quarter of the time, a quarter turn; the azimuth grows, so the camera moves to its right.
    expect(cameraAt(move, VIEW, BOX, 2.5).azimuth).toBeCloseTo(30);
    expect(cameraAt(move, VIEW, BOX, 10).azimuth).toBeCloseTo(300);
    // Far enough out to frame the whole model, the same all the way round.
    expect(cameraAt(move, VIEW, BOX, 5).distance).toBeCloseTo(start.distance);
    expect(start.distance).toBeLessThan(999);
  });

  it("keeps an orbit off the top and out of the floor", () => {
    const move = cameraMove("orbit", 10);
    expect(cameraAt(move, { ...VIEW, elevation: 90 }, BOX, 3).elevation).toBe(60);
    expect(cameraAt(move, { ...VIEW, elevation: -20 }, BOX, 3).elevation).toBe(2);
  });

  it("ramps the orbit's speed: slow out of the start, fast through the middle", () => {
    const ramp = cameraMove("ramp", 10);
    const steady = cameraMove("orbit", 10);
    expect(cameraAt(ramp, VIEW, BOX, 1).azimuth - VIEW.azimuth).toBeLessThan(cameraAt(steady, VIEW, BOX, 1).azimuth - VIEW.azimuth);
    expect(cameraAt(ramp, VIEW, BOX, 5).azimuth).toBeCloseTo(-60 + 180);
    expect(cameraAt(ramp, VIEW, BOX, 10).azimuth).toBeCloseTo(300);
  });

  it("sweeps up through your view, cranes down past it, and pushes in to end on it", () => {
    const rise = cameraMove("rise", 8);
    expect(cameraAt(rise, VIEW, BOX, 0)).toMatchObject({ azimuth: -150, elevation: 4 });
    expect(cameraAt(rise, VIEW, BOX, 4).azimuth).toBeCloseTo(-60);
    expect(cameraAt(rise, VIEW, BOX, 8)).toMatchObject({ azimuth: 30, elevation: 50 });

    const crane = cameraMove("crane", 8);
    expect(cameraAt(crane, VIEW, BOX, 0).elevation).toBe(75);
    expect(cameraAt(crane, VIEW, BOX, 8).elevation).toBeCloseTo(8);

    const push = cameraMove("push", 6);
    const from = cameraAt(push, VIEW, BOX, 0),
      to = cameraAt(push, VIEW, BOX, 6);
    expect(from.azimuth).toBeCloseTo(-150);
    expect(to.azimuth).toBeCloseTo(-60);
    expect(to.distance).toBeLessThan(from.distance * 0.5);
  });

  it("names every preset for the menu", () => {
    expect(CAMERA_MOVES.map((m) => m.label)).toEqual(["Orbit", "Speed ramp orbit", "Rising sweep", "Crane down", "Push in"]);
    expect(movePreset("push").easing).toBe("out");
  });
});
