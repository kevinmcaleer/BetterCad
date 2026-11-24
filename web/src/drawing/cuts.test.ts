import { describe, expect, it } from "vitest";
import { newSheet, removeView, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import { VIEWS, type ModelView, type V2 } from "@bettercad/kernel/view";
import { AUTO_START, candidates } from "./auto";
import { contextOf } from "./arrange";
import { dimArt } from "./dimensions";
import { sheetScene } from "./export/scene";
import { sheetLayout } from "./layout";
import { targets } from "./marks";
import { viewArt, viewName, viewRequest } from "./views";
import {
  addBreak,
  caption,
  cutArt,
  cutLine,
  cutThrough,
  flipSection,
  hatch,
  nextLetter,
  picturesOf,
  pictured,
  placeDetail,
  placeSection,
  removeBreaks,
  snapPoint,
  viewPoint,
  type Picture,
} from "./cuts";

const TAU = Math.PI * 2;
const edge = (index: number, name: string) => ({ body: "b1", kind: "edge" as const, index, name });
const line = (index: number, a: V2, b: V2, name: string) => ({ curve: { kind: "line", a, b }, visible: true, type: "sharp", source: edge(index, name) });

/** A bar 200 mm long and 20 mm tall from the front, with a 6 mm hole 30 mm from its left end. */
const bar = (): ModelView =>
  ({
    edges: [
      line(0, [0, 0], [200, 0], "bottom"),
      line(1, [200, 0], [200, 20], "right"),
      line(2, [200, 20], [0, 20], "top"),
      line(3, [0, 20], [0, 0], "left"),
      { curve: { kind: "circle", c: [30, 10], r: 3 }, visible: true, type: "sharp", source: edge(4, "rim") },
    ],
    box: { min: [0, 0], max: [200, 20] },
    rounds: [{ seen: "end", c: [30, 10], r: 3, hole: true, sweep: TAU, source: { body: "b1", kind: "face", index: 9, name: "bore" } }],
    bodies: ["b1"],
    ms: 1,
  }) as unknown as ModelView;

const base = (over: Partial<DrawingView> = {}): DrawingView => ({
  id: "v1",
  kind: "base",
  shows: { all: true },
  direction: "front",
  hidden: true,
  tangent: false,
  at: [100, 100],
  ...over,
});
const sheetWith = (...views: DrawingView[]): DrawingSheet => ({ ...newSheet("Sheet 1", { size: "A3" }), views });

describe("hatching", () => {
  const square: V2[][] = [
    [
      [0, 0],
      [10, 0],
    ],
    [
      [10, 0],
      [10, 10],
    ],
    [
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ];
  it("fills an outline given as loose pieces with lines at 45°", () => {
    const lines = hatch(square, 2);
    expect(lines.length).toBeGreaterThan(5);
    for (const [a, b] of lines) {
      expect(b[1] - a[1]).toBeCloseTo(b[0] - a[0], 6);
      for (const p of [a, b]) expect(Math.min(p[0], p[1], 10 - p[0], 10 - p[1])).toBeGreaterThan(-1e-5);
    }
  });
  it("leaves a hole in the outline clear", () => {
    const hole: V2[] = Array.from({ length: 65 }, (_, i) => [5 + 2 * Math.cos((i / 64) * TAU), 5 + 2 * Math.sin((i / 64) * TAU)]);
    const lines = hatch([...square, hole], 1);
    const mid = lines.map(([a, b]): V2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    expect(mid.some((m) => Math.hypot(m[0] - 5, m[1] - 5) < 1.9)).toBe(false);
    // The line through the middle of the hole comes in two parts.
    expect(lines.length).toBeGreaterThan(hatch(square, 1).length);
  });
});

describe("section views", () => {
  it("cuts across a front view on a level plane and looks down from above", () => {
    const cut = cutThrough(VIEWS.front, [30, 10], "across", false);
    expect(cut).toEqual({ origin: [30, 0, 10], normal: [0, 0, 1] });
    expect(cutThrough(VIEWS.front, [30, 10], "up", true).normal).toEqual([-1, 0, 0]);
    expect(cutLine(VIEWS.front, cut)).toEqual({ at: [30, 10], side: [0, 1] });
    // Seen from above, the cut is not a line.
    expect(cutLine(VIEWS.top, cut)).toBeUndefined();
  });

  it("puts the section above its parent in third angle and below in first, in line with it, lettered", () => {
    const s = sheetWith(base());
    const third = placeSection(s, "v2", "v1", [30, 10], "across", false, "third", { w: 200, h: 20 });
    const v = third.views[1]!;
    expect(v).toMatchObject({ kind: "section", parent: "v1", direction: "top", hidden: false, section: { label: "A", normal: [0, 0, 1] } });
    expect(v.at[0]).toBe(100);
    expect(v.at[1]).toBeGreaterThan(100);
    const first = placeSection(s, "v2", "v1", [30, 10], "across", false, "first", { w: 200, h: 20 });
    expect(first.views[1]!.at[1]).toBeLessThan(100);
    expect(viewName(v)).toBe("Section A-A");
    expect(caption(v, 1, "iso")).toBe("A-A");
    expect(caption(v, 1, "asme")).toBe("SECTION A-A");
    expect(nextLetter(third)).toBe("B");
  });

  it("asks the kernel for the cut, and for nothing new when only the letter changes", () => {
    const s = placeSection(sheetWith(base()), "v2", "v1", [30, 10], "up", false, "third", { w: 200, h: 20 });
    const v = s.views[1]!;
    expect(viewRequest(v).cut).toEqual({ origin: [30, 0, 10], normal: [1, 0, 0] });
    expect(viewRequest({ ...v, section: { ...v.section!, label: "Z" } })).toEqual(viewRequest(v));
    expect(viewRequest(s.views[0]!).cut).toBeUndefined();
  });

  it("flips to look from the other side, on the other side of its parent", () => {
    const s = placeSection(sheetWith(base()), "v2", "v1", [30, 10], "up", false, "third", { w: 200, h: 20 });
    const f = flipSection(s, "v2").views[1]!;
    expect(f.section!.normal).toEqual([-1, 0, 0]);
    expect(f.direction).toBe("left");
    expect(f.at[0] - 100).toBeCloseTo(-(s.views[1]!.at[0] - 100));
  });

  it("draws the cutting line, arrows and letters on the parent, and the caption over the section", () => {
    const s = placeSection(sheetWith(base()), "v2", "v1", [30, 10], "up", false, "third", { w: 200, h: 20 });
    const art = cutArt(s, s.views[0]!, () => bar());
    // The line runs up the view at x = 30, which is 70 mm left of the view's middle.
    const [a, b] = art.chain[0]!;
    expect(a[0]).toBeCloseTo(-70);
    expect(b[0]).toBeCloseTo(-70);
    expect(Math.abs(b[1] - a[1])).toBeGreaterThan(20);
    expect(art.thick).toHaveLength(2);
    expect(art.arrows).toHaveLength(2);
    expect(art.labels.map((l) => l.text)).toEqual(["A", "A"]);
    // The arrows point to the left: away from the right, which is taken away.
    for (const [tip, back] of art.arrows) expect(tip[0]).toBeLessThan(back[0]);
    expect(cutArt(s, s.views[1]!, () => bar()).labels.map((l) => l.text)).toEqual(["A-A"]);
  });

  it("hatches the cut faces the kernel gives, and exports the hatching and the cutting line", () => {
    const cutView = {
      ...bar(),
      cuts: [
        {
          body: "b1",
          outline: [
            [
              [0, 0],
              [200, 0],
              [200, 20],
              [0, 20],
              [0, 0],
            ] as V2[],
          ],
        },
      ],
    } as ModelView;
    const s = placeSection(sheetWith(base()), "v2", "v1", [30, 10], "across", false, "third", { w: 200, h: 20 });
    const pic = pictured(cutView, s.views[1]!, 1) as Picture;
    expect(pic.thin!.length).toBeGreaterThan(50);
    expect(pictured(cutView, s.views[1]!, 1)).toBe(pic);
    expect(viewArt(pic, 1).thin).toMatch(/^M/);
    const of = picturesOf(s, (id) => (id === "v2" ? cutView : bar()));
    const scene = sheetScene(s, sheetLayout(s), of, 2);
    expect(scene.strokes.filter((k) => k.layer === "section").length).toBeGreaterThan(50);
    expect(scene.labels.filter((l) => l.layer === "section").map((l) => l.text)).toEqual(["A", "A", "A-A"]);
    expect(scene.fills?.filter((f) => f.layer === "section")).toHaveLength(2);
  });

  it("stays a section when the view it was cut from is deleted", () => {
    const s = placeSection(sheetWith(base()), "v2", "v1", [30, 10], "across", false, "third", { w: 200, h: 20 });
    const left = removeView(s, "v1").views[0]!;
    expect(left.kind).toBe("section");
    expect(left.parent).toBeUndefined();
  });
});

describe("detail views", () => {
  const s = placeDetail(sheetWith(base()), "v2", "v1", [30, 10], 12, 2, [250, 100]);
  const v = s.views[1]!;
  const pic = pictured(bar(), v, 2) as Picture;

  it("is a lettered circle of its parent at its own scale", () => {
    expect(v).toMatchObject({ kind: "detail", parent: "v1", scale: 2, direction: "front", detail: { c: [30, 10], r: 12, label: "A" } });
    expect(viewName(v)).toBe("Detail A");
    expect(caption(v, 2, "iso")).toBe("A (2:1)");
    expect(caption(v, 2, "asme")).toBe("DETAIL A, SCALE 2:1");
    expect(viewRequest(v)).toEqual(viewRequest(s.views[0]!));
  });

  it("keeps only what is inside the circle, with the circle drawn round it", () => {
    expect(pic.box).toEqual({ min: [18, -2], max: [42, 22] });
    // The hole whole, and a piece of the top and bottom edges; the ends of the bar are outside.
    expect(pic.edges.map((e) => e.source!.name).sort()).toEqual(["bottom", "rim", "top"]);
    const bottom = pic.edges.find((e) => e.source!.name === "bottom")!.curve as { a: V2; b: V2 };
    expect(Math.abs(bottom.b[0] - bottom.a[0])).toBeCloseTo(2 * Math.sqrt(12 * 12 - 10 * 10), 6);
    expect(pic.thin).toContainEqual({ kind: "circle", c: [30, 10], r: 12 });
    expect(pic.rounds).toHaveLength(1);
  });

  it("measures whole edges, so a size on a detail is the true one", () => {
    const all = targets(pic);
    const bottom = all.find((t) => t.kind === "edge" && t.source.name === "bottom")!;
    expect(bottom).toMatchObject({ a: [0, 0], b: [200, 0] });
  });

  it("marks the circle and letter on the parent", () => {
    const art = cutArt(s, s.views[0]!, () => bar());
    expect(art.rings).toEqual([{ c: [-70, 0], r: 12 }]);
    expect(art.labels.map((l) => l.text)).toEqual(["A"]);
    expect(cutArt(s, v, () => pic).labels.map((l) => l.text)).toEqual(["A (2:1)"]);
  });

  it("is left out of Auto dimension, which has its parent", () => {
    const list = candidates(
      s,
      picturesOf(s, () => bar()),
      AUTO_START,
    );
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.dim.view === "v1")).toBe(true);
  });
});

describe("a detail's circle through a short edge", () => {
  it("cuts an edge that crosses the circle to the part inside", () => {
    const s = placeDetail(sheetWith(base()), "v2", "v1", [100, 0], 10, 2, [250, 100]);
    const pic = pictured(bar(), s.views[1]!, 2);
    expect(pic.edges).toHaveLength(1);
    const c = pic.edges[0]!.curve as { a: V2; b: V2 };
    expect(c.a[0]).toBeCloseTo(90);
    expect(c.b[0]).toBeCloseTo(110);
  });
});

describe("broken views", () => {
  const s = addBreak(sheetWith(base()), "v1", "x", 60, 160);
  const v = s.views[0]!;
  const pic = pictured(bar(), v, 1) as Picture;

  it("leaves the stretch out and draws what is past it closer, with a gap and two break lines", () => {
    expect(v.breaks).toEqual([{ axis: "x", from: 60, to: 160 }]);
    // 100 mm out, 4 mm of gap left in.
    expect(pic.box).toEqual({ min: [0, 0], max: [104, 20] });
    const tops = pic.edges.filter((e) => e.source!.name === "top").map((e) => e.curve as { a: V2; b: V2 });
    expect(tops.map((t) => [Math.min(t.a[0], t.b[0]), Math.max(t.a[0], t.b[0])]).sort((a, b) => a[0]! - b[0]!)).toEqual([
      [0, 60],
      [64, 104],
    ]);
    expect(pic.thin!.filter((c) => c.kind === "poly")).toHaveLength(2);
    // The hole is before the break and stays where it was.
    expect(pic.edges.find((e) => e.source!.name === "rim")!.curve).toMatchObject({ c: [30, 10] });
  });

  it("still reads the true size across the break", () => {
    const ctx = contextOf(s, "v1", pic, 2)!;
    const ref = (name: string, at: "start" | "end") => ({ view: "v1", body: "b1", kind: "edge" as const, index: 0, name, at });
    const art = dimArt({ refs: [ref("bottom", "start"), ref("bottom", "end")], across: "x", at: [0, -25] }, ctx)!;
    expect(art.text.text).toBe("200");
    // Its extension lines are where the ends are drawn: 104 mm apart.
    const xs = art.lines.map(([a]) => a[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(104);
  });

  it("offers Auto dimension the true overall size", () => {
    const list = candidates(s, () => pic, AUTO_START);
    expect(list.find((c) => c.rank === 0 && c.dim.across === "x")!.size).toBeCloseTo(200);
  });

  it("turns a click on the closed-up view back into the place in the model", () => {
    // 20 mm right of the middle of the drawn view (52) is 72 as drawn, which is 168 in the model.
    expect(viewPoint(pic, 1, [20, 0])).toEqual([168, 10]);
    expect(viewPoint(bar(), 2, [20, 0])).toEqual([110, 10]);
  });

  it("joins a break that overlaps another, and takes them all off", () => {
    const two = addBreak(s, "v1", "x", 150, 180);
    expect(two.views[0]!.breaks).toEqual([{ axis: "x", from: 60, to: 180 }]);
    expect(addBreak(s, "v1", "y", 5, 15).views[0]!.breaks).toHaveLength(2);
    expect(removeBreaks(two, "v1").views[0]!.breaks).toBeUndefined();
    expect(addBreak(s, "v1", "x", 70, 70)).toBe(s);
  });

  it("leaves a view with no break in it as the kernel gave it", () => {
    const raw = bar();
    expect(pictured(raw, base(), 1)).toBe(raw);
    expect(pictured(raw, base({ breaks: [{ axis: "x", from: 300, to: 400 }] }), 1)).toBe(raw);
  });
});

describe("snapping a cut", () => {
  it("goes through a hole's centre or the middle of the view when the pointer is near", () => {
    expect(snapPoint(bar(), [31, 9.2], 2)).toEqual([30, 10]);
    expect(snapPoint(bar(), [99, 3], 2)).toEqual([100, 3]);
    expect(snapPoint(bar(), [150, 3], 2)).toEqual([150, 3]);
  });
});
