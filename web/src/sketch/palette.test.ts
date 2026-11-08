// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { Draft, SketchIndex, WORLD_FRAMES, drawCircle, drawRectangle, newSketch } from "@bettercad/sketch";
import { dimensionArt, DIM_OFFSET_PX } from "./dimensions";
import { DEFAULT_OPTIONS, loadOptions, saveOptions, sketchGrid } from "./options";
import { FINISHED, sketchView } from "./useSketch";

const ALL = { points: true, profile: true, projected: true, construction: true };

describe("sketch palette options", () => {
  beforeEach(() => localStorage.clear());

  it("starts with everything on and remembers changes", () => {
    expect(loadOptions()).toEqual(DEFAULT_OPTIONS);
    saveOptions({ ...DEFAULT_OPTIONS, grid: false, points: false });
    expect(loadOptions()).toMatchObject({ grid: false, points: false, snap: true });
  });

  it("ignores rubbish in storage", () => {
    localStorage.setItem("bettercad.sketchOptions", '{"grid":"yes"');
    expect(loadOptions()).toEqual(DEFAULT_OPTIONS);
  });

  it("draws a grid at least 25 px apart, with a major line every step up", () => {
    // 0.1 mm a pixel: minor lines every 5 mm (50 px), major every 10 mm.
    const g = sketchGrid([3, -2], 40, 0.1);
    expect(g.step).toBe(5);
    const xs = (lines: [number, number][][]) => lines.filter((l) => l[0]![0] === l[1]![0]).map((l) => l[0]![0]);
    expect(xs(g.major as [number, number][][]).every((x) => Math.abs(x % 10) < 1e-9)).toBe(true);
    expect(xs(g.minor as [number, number][][]).every((x) => Math.abs(Math.abs(x % 10) - 5) < 1e-9)).toBe(true);
    expect(xs([...g.minor, ...g.major] as [number, number][][])).toContain(0);
  });

  it("caps the grid's lines", () => {
    const g = sketchGrid([0, 0], 1e6, 0.1);
    expect(g.minor.length + g.major.length).toBeLessThanOrEqual(2 * 241);
  });
});

describe("sketch view", () => {
  it("shades the closed shapes faintly while Profile is on", () => {
    const s = drawRectangle(newSketch(), [0, 0], [30, 20]).sketch;
    const on = sketchView(s, WORLD_FRAMES.XY, null, [], null, [], null, undefined, undefined, null, ALL);
    expect(on.fills).toHaveLength(1);
    expect(on.fillOpacity).toBeLessThan(0.35);
    const off = sketchView(s, WORLD_FRAMES.XY, null, [], null, [], null, undefined, undefined, null, { ...ALL, profile: false });
    expect(off.fills).toHaveLength(0);
  });

  it("hides points and construction geometry, but not what is picked", () => {
    const d = new Draft(drawRectangle(newSketch(), [0, 0], [30, 20]).sketch);
    const guide = d.line(d.point([0, 0]), d.point([30, 20]), { construction: true, auto: false });
    const s = d.done().sketch;
    const all = sketchView(s, WORLD_FRAMES.XY, null, [], null, [], null, undefined, undefined, null, ALL);
    const bare = sketchView(s, WORLD_FRAMES.XY, null, [], null, [], null, undefined, undefined, null, { ...ALL, points: false, construction: false });
    expect(all.curves).toHaveLength(5);
    expect(bare.curves).toHaveLength(4);
    expect(bare.points).toHaveLength(0);
    const picked = sketchView(s, WORLD_FRAMES.XY, null, [guide], null, [], null, undefined, undefined, null, { ...ALL, construction: false });
    expect(picked.curves).toHaveLength(5);
  });

  it("draws a finished sketch's curves only: no construction, no points", () => {
    const d = new Draft(drawRectangle(newSketch(), [0, 0], [30, 20]).sketch);
    d.line(d.point([0, 0]), d.point([30, 20]), { construction: true, auto: false });
    d.point([50, 50]);
    const s = drawCircle(d.done().sketch, [80, 0], 5).sketch;
    const v = sketchView(s, WORLD_FRAMES.XY, null, [], null, [], null, undefined, "guide", null, FINISHED);
    // Four sides and the circle; the diagonal is construction.
    expect(v.curves).toHaveLength(5);
    expect(v.curves.every((c) => !c.dashed)).toBe(true);
    expect(v.points).toHaveLength(0);
    expect(v.fills).toHaveLength(0);
  });

  it("shows line ends only while drawing, or the one under the pointer or picked", () => {
    const d = new Draft(drawRectangle(newSketch(), [0, 0], [30, 20]).sketch);
    const lone = d.point([50, 50]);
    const circle = drawCircle(d.done().sketch, [80, 0], 5);
    const s = circle.sketch;
    const corners = s.entities.filter((e) => e.kind === "point" && e.id !== lone).map((e) => e.id);
    const drawing = sketchView(s, WORLD_FRAMES.XY, null, [], null, [], null, undefined, undefined, null, ALL);
    // Four corners, the lone point and the circle's centre.
    expect(drawing.points).toHaveLength(6);
    const selecting = sketchView(s, WORLD_FRAMES.XY, null, [], null, [], null, undefined, undefined, null, { ...ALL, ends: false });
    expect(selecting.points).toHaveLength(2);
    const near = sketchView(s, WORLD_FRAMES.XY, null, [corners[0]!], corners[1]!, [], null, undefined, undefined, null, { ...ALL, ends: false });
    expect(near.points).toHaveLength(4);
  });
});

describe("dimension drawing", () => {
  it("draws a length outside the shape with extension lines and two arrows", () => {
    const s = drawRectangle(newSketch(), [0, 0], [30, 20], { width: 30 }).sketch;
    const idx = new SketchIndex(s);
    const px = 0.1;
    const art = dimensionArt(idx, s.dimensions[0]!, px, [15, 10]);
    // The bottom edge's size sits below it, away from the middle.
    expect(art.text[0]).toBeCloseTo(15);
    expect(art.text[1]).toBeCloseTo(-DIM_OFFSET_PX * px);
    expect(art.lines).toHaveLength(3);
    const [, , dimLine] = art.lines;
    expect(dimLine![0][1]).toBeCloseTo(art.text[1]);
    expect(art.arrows.map((a) => a.tip[0]).sort((a, b) => a - b)).toEqual([0, 30]);
    expect(art.arrows.find((a) => a.tip[0] === 30)!.dir).toEqual([1, 0]);
  });

  it("draws a diameter across the circle with arrows at the rim", () => {
    const s = drawCircle(newSketch(), [0, 0], 5, 10).sketch;
    const art = dimensionArt(new SketchIndex(s), s.dimensions[0]!, 0.1, [0, 0]);
    expect(art.arrows).toHaveLength(2);
    for (const a of art.arrows) expect(Math.hypot(...a.tip)).toBeCloseTo(5);
    expect(Math.hypot(...art.text)).toBeGreaterThan(5);
  });
});

describe("point to line distance", () => {
  it("runs square across the gap, with the size just past the line", () => {
    const d = new Draft(newSketch());
    const line = d.line(d.point([0, 0]), d.point([40, 0]), { auto: false });
    const pt = d.point([10, 3]);
    d.dimension("distance", [pt, line], 3);
    const s = d.done().sketch;
    const art = dimensionArt(new SketchIndex(s), s.dimensions[0]!, 0.1, [20, 10]);
    expect(art.text[0]).toBeCloseTo(10);
    expect(art.text[1]).toBeCloseTo(-1.6);
    expect(art.arrows.map((a) => a.tip)).toEqual([
      [10, 3],
      [10, 0],
    ]);
  });
});
