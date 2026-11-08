import { describe, expect, it } from "vitest";
import { startDrag, type DragView } from "./poseDrag";

// Looking straight down Z: world X goes right, world Y goes up the screen, 2 px per mm, origin at (200, 200).
const top: DragView = { project: ([x, y]) => ({ x: 200 + x * 2, y: 200 - y * 2 }), towards: [0, 0, 1] };
const hinge = { kind: "revolute" as const, origin: [0, 0, 0] as [number, number, number], axis: [0, 0, 1] as [number, number, number], lower: -90, upper: 90 };

describe("dragging a joint", () => {
  it("turns a hinge by where the pointer meets its plane, with a ray", () => {
    const rays: DragView = { ...top, ray: (p) => ({ origin: [(p.x - 200) / 2, (200 - p.y) / 2, 100], dir: [0, 0, -1] }) };
    const d = startDrag(hinge, rays, { x: 300, y: 200 }, 0);
    expect(d.at({ x: 271, y: 129 })).toBe(45);
    const back = startDrag({ ...hinge, axis: [0, 0, -1] }, rays, { x: 300, y: 200 }, 0);
    expect(back.at({ x: 200, y: 100 })).toBe(-90);
  });

  it("turns a hinge facing the viewer anticlockwise as the pointer goes round anticlockwise", () => {
    const d = startDrag(hinge, top, { x: 300, y: 200 }, 0);
    // From +X round to +Y on screen (up), a quarter turn anticlockwise.
    expect(d.at({ x: 271, y: 129 })).toBe(45);
    expect(d.at({ x: 200, y: 100 })).toBe(90);
  });

  it("turns the other way when the axis points away", () => {
    const d = startDrag({ ...hinge, axis: [0, 0, -1] }, top, { x: 300, y: 200 }, 0);
    expect(d.at({ x: 200, y: 100 })).toBe(-90);
  });

  it("snaps to 5° unless snapping is held off, and stops at the limits", () => {
    const d = startDrag(hinge, top, { x: 300, y: 200 }, 0);
    const p = { x: 200 + 100 * Math.cos(0.2), y: 200 - 100 * Math.sin(0.2) };
    expect(d.at(p)).toBe(10);
    const free = startDrag(hinge, top, { x: 300, y: 200 }, 0);
    expect(free.at(p, true)).toBeCloseTo(11.5, 1);
    const far = startDrag(hinge, top, { x: 300, y: 200 }, 80);
    expect(far.at({ x: 200, y: 100 })).toBe(90);
  });

  it("keeps count past half a turn for a wheel", () => {
    const d = startDrag({ ...hinge, kind: "continuous" }, top, { x: 300, y: 200 }, 0);
    d.at({ x: 200, y: 100 });
    d.at({ x: 100, y: 200 });
    expect(d.at({ x: 200, y: 300 })).toBe(-90);
  });

  it("turns a hinge seen edge-on with sideways movement", () => {
    const d = startDrag({ ...hinge, axis: [1, 0, 0] }, top, { x: 300, y: 200 }, 0);
    expect(d.at({ x: 340, y: 200 })).toBe(20);
  });

  it("slides a slider along its axis on screen, in mm, snapped to 1 mm", () => {
    const slider = {
      kind: "prismatic" as const,
      origin: [0, 0, 0] as [number, number, number],
      axis: [1, 0, 0] as [number, number, number],
      lower: 0,
      upper: 50,
    };
    const d = startDrag(slider, top, { x: 200, y: 200 }, 0);
    expect(d.at({ x: 225, y: 230 })).toBe(13);
    expect(d.at({ x: 400, y: 200 })).toBe(50);
    expect(d.at({ x: 100, y: 200 })).toBe(0);
  });
});
