import { describe, expect, it } from "vitest";
import { newSheet, type DrawingDimension, type DrawingMark, type DrawingRef, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { AUTO_START, autoDimension } from "./auto";
import { contextOf } from "./arrange";
import { dimArt } from "./dimensions";
import { follow, lostName, problemCount, problems, stamp } from "./follow";

const TAU = Math.PI * 2;
const edge = (index: number, name?: string) => ({ body: "b1", kind: "edge" as const, index, ...(name ? { name } : {}) });
const face = (index: number, name: string) => ({ body: "b1", kind: "face" as const, index, name });
const line = (index: number, a: V2, b: V2, name?: string) => ({ curve: { kind: "line", a, b }, visible: true, type: "sharp", source: edge(index, name) });
const hole = (index: number, name: string, c: V2, r: number) => ({ seen: "end", c, r, hole: true, sweep: TAU, source: face(index, name) });

/**
 * A bracket from the front, `w` mm wide and 40 mm tall, with a notch `notch` mm wide at the bottom left, a 5 mm
 * hole, and a 3 mm fillet at the top right unless it has been deleted. Every edge and face has a name, as the kernel
 * gives them (#47), so they are the same edges whatever the width.
 */
function bracket({ w = 60, notch = 10, fillet = true, more = false } = {}): ModelView {
  return {
    edges: [
      line(0, [0, 0], [notch, 0], "notch"),
      line(1, [notch, 0], [w, 0], "bottom"),
      line(2, [w, 0], [w, 40], "right"),
      line(3, [w, 40], [0, 40], "top"),
      line(4, [0, 40], [0, 0], "left"),
    ],
    box: { min: [0, 0], max: [w, 40] },
    rounds: [
      hole(20, "bore", [20, 20], 2.5),
      ...(more ? [hole(22, "extra", [40, 20], 4)] : []),
      ...(fillet ? [{ seen: "end", c: [w - 3, 37], r: 3, hole: false, sweep: TAU / 4, source: edge(21, "fillet") }] : []),
    ],
    bodies: ["b1"],
    ms: 1,
  } as unknown as ModelView;
}
const empty = { edges: [], box: { min: [0, 0], max: [0, 0] }, rounds: [], bodies: [], ms: 1 } as unknown as ModelView;

const v1: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const e = (index: number, name: string, at?: DrawingRef["at"]): DrawingRef => ({ view: "v1", ...edge(index, name), ...(at ? { at } : {}) });
const dim = (id: string, refs: DrawingRef[], at: V2, more: Partial<DrawingDimension> = {}): DrawingDimension => ({
  id,
  view: "v1",
  kind: "linear",
  refs,
  across: "aligned",
  at,
  ...more,
});
// On a 60 by 40 mm view the first row is 10 mm outside the outline: 30 mm under the middle, 40 mm left of it.
const notch = dim("notch", [e(0, "notch")], [-25, -30]);
const rest = dim("rest", [e(1, "bottom")], [5, -30]);
const width = dim("width", [e(0, "notch", "start"), e(1, "bottom", "end")], [0, -38]);
const height = dim("height", [e(4, "left")], [-40, 0]);
const bore: DrawingDimension = { id: "bore", view: "v1", kind: "diameter", refs: [{ view: "v1", ...face(20, "bore") }], at: [45, 10] };
const radius: DrawingDimension = { id: "radius", view: "v1", kind: "radius", refs: [{ view: "v1", ...edge(21, "fillet") }], at: [40, 30] };
const mark: DrawingMark = { id: "m1", kind: "centre-mark", on: { view: "v1", ...face(20, "bore") } };

const sheetOf = (dimensions: DrawingDimension[], marks: DrawingMark[] = []): DrawingSheet => ({
  ...newSheet("Sheet 1", { size: "A3" }),
  views: [v1],
  dimensions,
  marks,
});
const of = (model: ModelView) => (id: string) => (id === "v1" ? model : undefined);
const laid = (dimensions: DrawingDimension[], marks: DrawingMark[] = [], model = bracket()) => stamp(sheetOf(dimensions, marks), of(model), 2);
const reads = (sheet: DrawingSheet, model: ModelView) =>
  Object.fromEntries(sheet.dimensions.map((d) => [d.id, dimArt(d, contextOf(sheet, "v1", model, 2)!)?.text.text ?? null]));
const spots = (sheet: DrawingSheet) => Object.fromEntries(sheet.dimensions.map((d) => [d.id, d.at]));

describe("writing down how a sheet is laid out", () => {
  it("notes each view's size on paper, what its dimensions read, and where its marks are", () => {
    const sheet = laid([width, height], [mark]);
    expect(sheet.views[0]!.laid).toEqual({ w: 60, h: 40, sizes: "width:60|height:40" });
    // The bore is 10 mm left of the middle of the view and level with it.
    expect(sheet.marks[0]!.was).toEqual([-10, 0]);
  });

  it("changes nothing the second time, or before a view's picture is in", () => {
    const sheet = laid([width], [mark]);
    expect(stamp(sheet, of(bracket()), 2)).toBe(sheet);
    const bare = sheetOf([width], [mark]);
    expect(stamp(bare, () => undefined, 2)).toBe(bare);
  });
});

describe("a drawing after its model changed", () => {
  it("is left alone when nothing a view shows has changed", () => {
    const sheet = laid([notch, rest, width, height, bore]);
    expect(follow(sheet, of(bracket()), 2)).toBe(sheet);
    // A sheet that was never laid out has nothing to compare with.
    const bare = sheetOf([width]);
    expect(follow(bare, of(bracket({ w: 80 })), 2)).toBe(bare);
  });

  it("widen the bracket: the sizes read the new width in the same rows, and the height stays 10 mm off the outline", () => {
    const wide = bracket({ w: 80 });
    const sheet = follow(laid([notch, rest, width, height]), of(wide), 2);
    expect(reads(sheet, wide)).toEqual({ notch: "10", rest: "70", width: "80", height: "40" });
    expect(spots(sheet)).toEqual({ notch: [-35, -30], rest: [5, -30], width: [0, -38], height: [-50, 0] });
  });

  it("stacks the rows again when the sizes change order", () => {
    // By hand, the overall width was put nearest the part and the notch outside it.
    const odd = laid([dim("width", width.refs, [0, -30]), dim("notch", notch.refs, [-25, -38])]);
    expect(follow(odd, of(bracket()), 2)).toBe(odd);
    const sheet = follow(odd, of(bracket({ notch: 25 })), 2);
    expect(spots(sheet)).toEqual({ width: [0, -38], notch: [-17.5, -30] });
  });

  it("keeps a size you put somewhere of your own as far outside the view as it was", () => {
    // 50 mm right of the middle is 20 mm outside the outline; 5 mm up is inside the view's height.
    const mine = dim("mine", [e(2, "right")], [50, 5]);
    const sheet = follow(laid([mine, bore]), of(bracket({ w: 80 })), 2);
    expect(spots(sheet)).toEqual({ mine: [60, 5], bore: [55, 10] });
  });

  it("re-stacks the automatic sizes wherever they were", () => {
    const auto = autoDimension(
      sheetOf([]),
      of(bracket()),
      2,
      { ...AUTO_START, density: 1 },
      (
        (n) => () =>
          `a${++n}`
      )(0),
    ).sheet;
    const stamped = stamp(auto, of(bracket()), 2);
    const wide = bracket({ w: 100 });
    const sheet = follow(stamped, of(wide), 2);
    expect(Object.values(reads(sheet, wide))).toContain("100");
    // Every level size is still under the view, clear of its outline.
    for (const d of sheet.dimensions.filter((x) => x.across === "x")) expect(d.at[1]).toBeLessThanOrEqual(-30);
    // Laid out again from scratch, they would be in the same places.
    const fresh = autoDimension(
      sheetOf([]),
      of(wide),
      2,
      { ...AUTO_START, density: 1 },
      (
        (n) => () =>
          `a${++n}`
      )(0),
    ).sheet;
    expect(spots(sheet)).toEqual(spots(fresh));
  });

  it("add a hole: nothing moves, and running Auto dimension again picks the new hole up", () => {
    const first = autoDimension(
      sheetOf([]),
      of(bracket()),
      2,
      { ...AUTO_START, density: 1 },
      (
        (n) => () =>
          `a${++n}`
      )(0),
    );
    const stamped = stamp(first.sheet, of(bracket()), 2);
    const holed = bracket({ more: true });
    expect(follow(stamped, of(holed), 2)).toBe(stamped);
    expect(problems(stamped, of(holed), 2)).toEqual([]);
    const again = autoDimension(
      stamped,
      of(holed),
      2,
      stamped.auto!,
      (
        (n) => () =>
          `b${++n}`
      )(0),
    );
    expect(again.total).toBeGreaterThan(first.total);
    expect(Object.values(reads(again.sheet, holed))).toContain("Ø8");
  });
});

describe("what a drawing has lost", () => {
  it("delete a filleted edge: its radius stays where it was as a problem, and the rest read as before", () => {
    const sheet = laid([width, radius], [mark]);
    expect(problems(sheet, of(bracket()), 2)).toEqual([]);
    const plain = bracket({ fillet: false });
    expect(problems(sheet, of(plain), 2)).toEqual([{ kind: "dimension", id: "radius", view: "v1", at: [40, 30] }]);
    expect(reads(follow(sheet, of(plain), 2), plain)).toEqual({ width: "60", radius: null });
    expect(lostName({ kind: "dimension", id: "radius", view: "v1", at: [40, 30] }, sheet)).toBe("Lost dimension");
  });

  it("a mark whose hole is gone is flagged where it was drawn, or in the view's corner when that was never noted", () => {
    const filled = { ...bracket(), rounds: [] } as unknown as ModelView;
    expect(problems(laid([], [mark]), of(filled), 2)).toEqual([{ kind: "mark", id: "m1", view: "v1", at: [-10, 0] }]);
    const old = sheetOf([], [mark]);
    expect(problems(old, of(filled), 2)).toEqual([{ kind: "mark", id: "m1", view: "v1", at: [-27, 17] }]);
    expect(lostName({ kind: "mark", id: "m1", view: "v1", at: [0, 0] }, old)).toBe("Lost centre mark");
  });

  it("delete a body: its view is the problem, once, however much was on it", () => {
    const sheet = laid([width, height, bore], [mark]);
    expect(problems(sheet, of(empty), 2)).toEqual([{ kind: "view", id: "v1", view: "v1", at: [0, 0] }]);
    expect(follow(sheet, of(empty), 2)).toBe(sheet);
    expect(lostName({ kind: "view", id: "v1", view: "v1", at: [0, 0] }, sheet)).toBe("Nothing to show");
  });

  it("a view the kernel could not draw is a problem too, and one still being worked out is not", () => {
    const sheet = laid([width]);
    expect(problems(sheet, () => undefined, 2)).toEqual([]);
    expect(
      problems(
        sheet,
        () => undefined,
        2,
        () => true,
      ),
    ).toEqual([{ kind: "view", id: "v1", view: "v1", at: [0, 0] }]);
  });

  it("counts in words", () => {
    expect(problemCount(1)).toBe("1 problem");
    expect(problemCount(3)).toBe("3 problems");
  });
});
