import { describe, expect, it } from "vitest";
import { newSheet, type DrawingSheet } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import { sheetLayout } from "./layout";
import {
  curvePath,
  defaultSpot,
  DIRECTIONS,
  directionOf,
  editView,
  emptyView,
  fitView,
  freeSpace,
  fromPage,
  moveView,
  placeView,
  toPage,
  viewArt,
  viewName,
  viewRequest,
  type ViewChoice,
} from "./views";

const sheet = (o: Partial<DrawingSheet> = {}): DrawingSheet => ({ ...newSheet("Sheet 1", { size: "A3" }), ...o });
const choice: ViewChoice = { shows: { all: true }, direction: "front", hidden: true, tangent: false };
/** A 40 × 20 mm plate with a hole, as the kernel hands a view over. */
const plate: ModelView = {
  edges: [
    { curve: { kind: "line", a: [0, 0], b: [40, 0] }, visible: true, type: "sharp" },
    { curve: { kind: "line", a: [40, 0], b: [40, 20] }, visible: true, type: "sharp" },
    { curve: { kind: "circle", c: [20, 10], r: 4 }, visible: false, type: "sharp" },
  ],
  box: { min: [0, 0], max: [40, 20] },
  rounds: [],
  bodies: ["b1"],
  ms: 1,
};

describe("view directions", () => {
  it("offers the six sides and four isometrics, each with its own name", () => {
    expect(DIRECTIONS.map((d) => d.label)).toEqual([
      "Front",
      "Back",
      "Left",
      "Right",
      "Top",
      "Bottom",
      "Isometric, front right",
      "Isometric, front left",
      "Isometric, back right",
      "Isometric, back left",
    ]);
    expect(new Set(DIRECTIONS.map((d) => JSON.stringify(viewRequest({ ...choice, direction: d.direction }).frame))).size).toBe(10);
  });

  it("names a view by its direction", () => {
    expect(viewName({ direction: "top" })).toBe("Top view");
    expect(viewName({ direction: { toEye: [-1, 1, 1], up: [0, 0, 1] } })).toBe("Isometric view");
    expect(viewName({ direction: { toEye: [0.2, -1, 0.3], up: [0, 0, 1] } })).toBe("View");
    expect(directionOf({ toEye: [0, -1, 0], up: [0, 0, 1] })?.id).toBe("front");
  });

  it("asks for hidden edges and tracing in full, and for neither in a preview", () => {
    expect(viewRequest({ ...choice, tangent: true })).toEqual({
      shows: { all: true },
      frame: { toEye: [0, -1, 0], up: [0, 0, 1] },
      hidden: true,
      smooth: true,
      trace: true,
    });
    expect(viewRequest(choice, true)).toMatchObject({ hidden: false, smooth: false, trace: false });
  });
});

describe("curves on paper", () => {
  it("draws a line from the middle of the view, scaled, with y turned down the page", () => {
    expect(curvePath({ kind: "line", a: [0, 0], b: [40, 20] }, 2, [20, 10])).toBe("M-40 20L40 -20");
    expect(
      curvePath(
        {
          kind: "poly",
          pts: [
            [0, 0],
            [1, 1],
            [2, 0],
          ],
        },
        1,
        [0, 0],
      ),
    ).toBe("M0 0L1 -1L2 0");
  });

  it("draws a circle as two half turns and an arc anticlockwise, the long way when it is over half", () => {
    expect(curvePath({ kind: "circle", c: [0, 0], r: 5 }, 1, [0, 0])).toBe("M5 0A5 5 0 1 0 -5 0A5 5 0 1 0 5 0");
    expect(curvePath({ kind: "arc", c: [0, 0], r: 5, from: 0, to: Math.PI / 2 }, 2, [0, 0])).toBe("M10 0A10 10 0 0 0 0 -10");
    expect(curvePath({ kind: "arc", c: [0, 0], r: 5, from: 0, to: (3 * Math.PI) / 2 }, 1, [0, 0])).toBe("M5 0A5 5 0 1 0 0 5");
  });

  it("draws an ellipse turned the same way on the page as on the view", () => {
    // Long axis 30° up from x on the view is 30° anticlockwise on the page, which SVG writes as -30.
    expect(curvePath({ kind: "ellipse", c: [0, 0], rx: 10, ry: 5, turn: Math.PI / 6 }, 1, [0, 0])).toMatch(
      /^M8\.66 -5A10 5 -30 1 0 -8\.66 5A10 5 -30 1 0 8\.66 -5$/,
    );
    expect(curvePath({ kind: "ellipse", c: [0, 0], rx: 10, ry: 5, turn: 0, from: 0, to: Math.PI / 2 }, 1, [0, 0])).toBe("M10 0A10 5 0 0 0 0 -5");
  });

  it("splits a view into the edges you see and the ones behind, sized at its scale", () => {
    const art = viewArt(plate, 0.5);
    expect(art.visible).toBe("M-10 5L10 5M10 5L10 -5");
    expect(art.hidden).toBe("M2 0A2 2 0 1 0 -2 0A2 2 0 1 0 2 0");
    expect([art.w, art.h]).toEqual([20, 10]);
    expect(emptyView(plate)).toBe(false);
    expect(emptyView({ ...plate, edges: [] })).toBe(true);
  });
});

describe("views on the sheet", () => {
  it("keeps positions from the page's bottom left, y up", () => {
    expect(toPage([30, 40], 297)).toEqual([30, 257]);
    expect(fromPage(toPage([30, 40], 297), 297)).toEqual([30, 40]);
  });

  it("the clear space is the frame above the title block, and a view placed by keyboard goes in its middle", () => {
    const wide = sheetLayout(sheet());
    expect(freeSpace(wide)).toEqual({ x: 20, y: 10, w: 390, h: wide.block.y - 10 });
    const tall = sheetLayout(sheet({ size: "A4", landscape: false }));
    expect(freeSpace(tall)).toEqual({ x: 20, y: 10, w: 180, h: tall.block.y - 10 });
    const spot = toPage(defaultSpot(tall), tall.page.h);
    expect(spot).toEqual([110, 10 + (tall.block.y - 10) / 2]);
  });

  it("Fit picks the largest standard scale that leaves room for projected views", () => {
    const l = sheetLayout(sheet());
    expect(fitView(plate, l)).toBe(2);
    expect(fitView({ ...plate, box: { min: [0, 0], max: [800, 300] } }, l)).toBe(0.1);
    expect(fitView({ ...plate, box: { min: [0, 0], max: [4, 2] } }, l)).toBe(20);
  });

  it("the first view sets the sheet's scale; later ones keep their own only when it differs", () => {
    let s = placeView(sheet(), "v1", choice, 2, [100, 150]);
    expect(s.scale).toBe(2);
    expect(s.views).toEqual([{ id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [100, 150] }]);
    s = placeView(s, "v2", { ...choice, direction: "iso" }, 2, [200, 150]);
    s = placeView(s, "v3", { ...choice, direction: "top" }, 1, [100, 60]);
    expect(s.scale).toBe(2);
    expect(s.views.map((v) => v.scale)).toEqual([undefined, undefined, 1]);
  });

  it("editing the first view changes the sheet's scale with it; another view's only its own", () => {
    let s = placeView(placeView(sheet(), "v1", choice, 2, [100, 150]), "v2", choice, 2, [200, 150]);
    s = editView(s, "v2", { ...choice, direction: "left", hidden: false, tangent: true }, 5);
    expect(s.scale).toBe(2);
    expect(s.views[1]).toMatchObject({ direction: "left", hidden: false, tangent: true, scale: 5, at: [200, 150] });
    s = editView(s, "v2", choice, 2);
    expect("scale" in s.views[1]!).toBe(false);
    s = editView(s, "v1", choice, 1);
    expect(s.scale).toBe(1);
    expect("scale" in s.views[0]!).toBe(false);
  });

  it("moves one view and leaves the rest", () => {
    const s = moveView(placeView(placeView(sheet(), "v1", choice, 1, [10, 10]), "v2", choice, 1, [50, 50]), "v2", [60, 70]);
    expect(s.views.map((v) => v.at)).toEqual([
      [10, 10],
      [60, 70],
    ]);
  });
});
