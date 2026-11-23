import { describe, expect, it } from "vitest";
import { newSheet, type DrawingDimension, type DrawingRef, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { arrange, arrangeSheet, contextOf, crowded, rowsFor, sheetRows, sizesBox, snapRow } from "./arrange";
import { dimArt, dimStyle, textWidth, type DimContext } from "./dimensions";
import { targets } from "./marks";

const TAU = Math.PI * 2;
const edge = (index: number) => ({ body: "b1", kind: "edge" as const, index });
const face = (index: number, name: string) => ({ body: "b1", kind: "face" as const, index, name });
const line = (index: number, a: V2, b: V2) => ({ curve: { kind: "line", a, b }, visible: true, type: "sharp", source: edge(index) });
/**
 * A 100 by 60 mm bar whose bottom edge is ten 10 mm steps (edges 0 to 9), with its left (10), top (11) and right
 * (12) edges, a 3 mm notch edge on top (13), and three holes.
 */
const bar = {
  edges: [
    ...Array.from({ length: 10 }, (_, i) => line(i, [10 * i, 0], [10 * i + 10, 0])),
    line(10, [0, 0], [0, 60]),
    line(11, [0, 60], [100, 60]),
    line(12, [100, 0], [100, 60]),
    line(13, [40, 60], [43, 60]),
    line(14, [0, 20], [0, 40]),
  ],
  box: { min: [0, 0], max: [100, 60] },
  rounds: [
    { seen: "end", c: [50, 30], r: 4, hole: true, sweep: TAU, source: face(20, "bore") },
    { seen: "end", c: [80, 45], r: 2, hole: true, sweep: TAU, source: face(21, "a") },
    { seen: "end", c: [90, 52.5], r: 3, hole: true, sweep: TAU, source: face(22, "b") },
  ],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
const all = targets(bar);
const e = (index: number, at?: DrawingRef["at"]): DrawingRef => ({ view: "v1", ...edge(index), ...(at ? { at } : {}) });
const f = (index: number, name: string): DrawingRef => ({ view: "v1", ...face(index, name) });
let n = 0;
const dim = (refs: DrawingRef[], more: Partial<DrawingDimension> = {}): DrawingDimension => ({
  id: `d${++n}`,
  view: "v1",
  kind: "linear",
  refs,
  across: "aligned",
  at: [0, 0],
  ...more,
});
const ctx = (standard: "iso" | "asme" = "iso", scale = 1): DimContext => ({ view: bar, scale, style: dimStyle(standard), decimals: 2, all });
const rows = rowsFor("iso");

/** Ten steps in a chain, two sizes over parts of it, a longer one and the overall length: fourteen sizes on one side. */
const chain = Array.from({ length: 10 }, (_, i) => dim([e(i)]));
const part = dim([e(0, "start"), e(2, "end")]);
const middle = dim([e(3, "start"), e(6, "end")]);
const most = dim([e(0, "start"), e(6, "end")]);
const overall = dim([e(0, "start"), e(9, "end")]);
const below = [overall, ...chain, most, middle, part];

describe("rows of dimensions", () => {
  it("start 10 mm from the view and step out 8 mm to ISO, 6 mm to ASME, unless the sheet says otherwise", () => {
    expect(rowsFor("iso")).toEqual({ first: 10, next: 8 });
    expect(rowsFor("asme")).toEqual({ first: 10, next: 6 });
    const sheet = newSheet("Sheet 1", { size: "A3" });
    expect(sheetRows(sheet)).toEqual({ first: 10, next: 8 });
    expect(sheetRows({ ...sheet, rows: { first: 12, next: 10 } })).toEqual({ first: 12, next: 10 });
  });

  it("put the shortest nearest the part and each longer size outside it, the overall size outermost", () => {
    const spots = arrange(below, ctx(), rows);
    const y = (d: DrawingDimension) => spots.get(d.id)!.at[1];
    // The view is 60 mm tall about its middle: the first row is 10 mm under its outline.
    for (const d of chain) expect(y(d)).toBe(-40);
    expect(y(part)).toBe(-48);
    expect(y(middle)).toBe(-48);
    expect(y(most)).toBe(-56);
    expect(y(overall)).toBe(-64);
  });

  it("share a row between sizes that don't overlap, so a chain is one row, with each text at the middle of its size", () => {
    const spots = arrange(below, ctx(), rows);
    expect(chain.map((d) => spots.get(d.id)!.at[0])).toEqual([-45, -35, -25, -15, -5, 5, 15, 25, 35, 45]);
    // 0 to 30 and 30 to 70 meet end to end.
    expect(spots.get(part.id)!.at[0]).toBe(-35);
    expect(spots.get(middle.id)!.at[0]).toBe(0);
  });

  it("leave no extension line crossing a dimension line, and no two texts on each other", () => {
    const spots = arrange(below, ctx(), rows);
    const arts = below.map((d) => ({ d, art: dimArt({ ...d, ...spots.get(d.id)! }, ctx())! }));
    for (const a of arts) {
      for (const b of arts) {
        if (a === b) continue;
        // Texts in the same row keep clear of each other.
        if (a.art.text.at[1] === b.art.text.at[1])
          expect(Math.abs(a.art.text.at[0] - b.art.text.at[0])).toBeGreaterThan((a.art.text.width + b.art.text.width) / 2);
        // A's dimension line is the last of its lines; B's extension lines are its first two.
        const [from, to] = a.art.lines.at(-1)!;
        for (const [top, end] of b.art.lines.slice(0, 2)) {
          const crosses =
            top[0] > from[0] + 1e-6 && top[0] < to[0] - 1e-6 && Math.min(top[1], end[1]) < from[1] - 1e-6 && Math.max(top[1], end[1]) > from[1] + 1e-6;
          expect(crosses, `${b.d.id} over ${a.d.id}`).toBe(false);
        }
      }
    }
  });

  it("choose a side for each size: under and left by default, over or right when what it measures is nearer", () => {
    const [top, left, right, low] = [dim([e(11)]), dim([e(10)]), dim([e(12)]), dim([e(0)])];
    const spots = arrange([top, left, right, low], ctx(), rows);
    expect(spots.get(top.id)).toEqual({ at: [0, 40], across: "aligned" });
    expect(spots.get(left.id)).toEqual({ at: [-60, 0], across: "aligned" });
    expect(spots.get(right.id)).toEqual({ at: [60, 0], across: "aligned" });
    expect(spots.get(low.id)).toEqual({ at: [-45, -40], across: "aligned" });
    // Between two holes in the top half, measured across: over the view, where they are nearer.
    const across = dim(
      [f(20, "bore"), f(21, "a")].map((r) => ({ ...r, at: "centre" as const })),
      { across: "x" },
    );
    expect(arrange([across], ctx(), rows).get(across.id)).toEqual({ at: [15, 40], across: "x" });
  });

  it("stack columns beside the view the same way, at the view's scale but in paper millimetres", () => {
    const [short, tall] = [dim([e(14)]), dim([e(10)])];
    const spots = arrange([tall, short], ctx("iso", 2), rows);
    expect(spots.get(short.id)!.at).toEqual([-110, 0]);
    expect(spots.get(tall.id)!.at).toEqual([-118, 0]);
  });

  it("move text that won't fit between its arrows outside them, keeping its row-mates clear", () => {
    const [notch, top] = [dim([e(13)]), dim([e(11)])];
    const spots = arrange([top, notch], ctx(), rows);
    const width = textWidth("3", 3.5);
    // The 3 mm size has its arrows outside on 6 mm tails, and its text past the far tail.
    expect(spots.get(notch.id)!.at[0]).toBeCloseTo(-7 + 6 + 1.5 + width / 2);
    expect(spots.get(notch.id)!.at[1]).toBe(40);
    expect(spots.get(top.id)!.at[1]).toBe(48);
    // To ASME a size's text sits in a break in the line, so it needs room for the arrows as well.
    const step = dim([e(0)]);
    expect(arrange([step], ctx("iso"), rows).get(step.id)!.at[0]).toBe(-45);
    expect(arrange([step], ctx("asme"), rowsFor("asme")).get(step.id)!.at[0]).toBeGreaterThan(-40);
  });

  it("put radii and diameters on leaders outside the view, fanned so their texts don't sit on each other", () => {
    const [bore, a, b] = [dim([f(20, "bore")], { kind: "diameter" }), dim([f(21, "a")], { kind: "diameter" }), dim([f(22, "b")], { kind: "diameter" })];
    const spots = arrange([bore, a, b], ctx(), rows);
    for (const d of [bore, a, b]) {
      const at = spots.get(d.id)!.at;
      expect(Math.abs(at[0]) > 50 || Math.abs(at[1]) > 30, d.id).toBe(true);
    }
    // The two holes lie the same way out from the middle: their texts are a line apart.
    const [pa, pb] = [spots.get(a.id)!.at, spots.get(b.id)!.at];
    expect(Math.abs(pa[1] - pb[1])).toBeGreaterThanOrEqual(3.5 + 1.5 - 1e-6);
    // A hole at the middle of the view goes up and to the right.
    expect(spots.get(bore.id)!.at[0]).toBeGreaterThan(0);
    expect(spots.get(bore.id)!.at[1]).toBeGreaterThan(0);
  });

  it("leave angles, and sizes whose edges the model has lost, where they are", () => {
    const [angle, lost] = [dim([e(0), e(10)], { kind: "angle" }), dim([e(99)])];
    expect(arrange([angle, lost], ctx(), rows).size).toBe(0);
  });
});

const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const sheetOf = (dimensions: DrawingDimension[], views: DrawingView[] = [front]): DrawingSheet => ({
  ...newSheet("Sheet 1", { size: "A3" }),
  views,
  dimensions,
});

describe("Arrange dimensions on a sheet", () => {
  it("tidies the views it is asked to, and only the sizes it is asked to", () => {
    const other = { ...dim([e(10)]), view: "v2" };
    const mine = [dim([e(0)]), dim([e(11)], { auto: true })];
    const sheet = sheetOf([...mine, other], [front, { ...front, id: "v2", at: [300, 150] }]);
    const one = arrangeSheet(sheet, () => bar, 2, { views: ["v1"] });
    expect(one.dimensions.map((d) => d.at)).toEqual([
      [-45, -40],
      [0, 40],
      [0, 0],
    ]);
    expect(arrangeSheet(sheet, () => bar, 2).dimensions[2]!.at).toEqual([-60, 0]);
    const auto = arrangeSheet(sheet, () => bar, 2, { dimensions: (d) => !!d.auto });
    expect(auto.dimensions.map((d) => d.at)).toEqual([
      [0, 0],
      [0, 40],
      [0, 0],
    ]);
    // Tidy already: the same sheet comes back, so nothing is added to Undo.
    expect(arrangeSheet(one, () => bar, 2, { views: ["v1"] })).toBe(one);
  });

  it("uses the sheet's own row spacing", () => {
    const sheet = { ...sheetOf([dim([e(0)]), dim([e(0, "start"), e(2, "end")])]), rows: { first: 15, next: 10 } };
    expect(arrangeSheet(sheet, () => bar, 2).dimensions.map((d) => d.at[1])).toEqual([-45, -55]);
  });
});

describe("dragging a size", () => {
  const c = ctx();
  it("drops it into a row when it is near one, and leaves it where it is put otherwise", () => {
    const low = dim([e(0)]);
    expect(snapRow(low, [-45, -41.5], c, rows)).toEqual([-45, -40]);
    expect(snapRow(low, [-45, -47], c, rows)).toEqual([-45, -48]);
    expect(snapRow(low, [-45, -44], c, rows)).toEqual([-45, -44]);
    expect(snapRow(low, [-20, 39], c, rows)).toEqual([-20, 40]);
    // Inside the view there are no rows.
    expect(snapRow(low, [-45, -20], c, rows)).toEqual([-45, -20]);
    const tall = dim([e(10)]);
    expect(snapRow(tall, [-61, 5], c, rows)).toEqual([-60, 5]);
    expect(snapRow(dim([f(20, "bore")], { kind: "diameter" }), [-61, -41], c, rows)).toEqual([-61, -41]);
  });
});

describe("sizes that run into a neighbouring view", () => {
  it("are boxed with their lines, arrows and text", () => {
    const d = dim([e(0, "start"), e(9, "end")], { at: [0, -40] });
    const box = sizesBox([d], ctx())!;
    expect(box.min[0]).toBe(-50);
    expect(box.max[0]).toBe(50);
    expect(box.min[1]).toBe(-42);
    expect(sizesBox([], ctx())).toBeUndefined();
  });

  it("say which view is in the way and how far it has to move to be clear by 5 mm", () => {
    const under: DrawingView = { ...front, id: "v2", at: [150, 75] };
    const sheet = sheetOf([dim([e(0, "start"), e(9, "end")], { at: [0, -40] })], [front, under]);
    // The size reaches 42 mm under the front view's middle; the view below has its top edge 45 mm under it.
    expect(crowded(sheet, () => bar, 2)).toEqual([]);
    const nearer = { ...sheet, views: [front, { ...under, at: [150, 85] as V2 }] };
    expect(crowded(nearer, () => bar, 2)).toEqual([{ view: "v1", into: "v2", by: [0, -12] }]);
    const beside = { ...sheet, dimensions: [dim([e(12)], { at: [62, 0] })], views: [front, { ...under, at: [262, 150] as V2 }] };
    const found = crowded(beside, () => bar, 2);
    expect(found).toHaveLength(1);
    expect(found[0]!.by[0]).toBeGreaterThan(5);
    expect(found[0]!.by[1]).toBe(0);
    expect(contextOf(sheet, "nope", bar, 2)).toBeUndefined();
  });
});
