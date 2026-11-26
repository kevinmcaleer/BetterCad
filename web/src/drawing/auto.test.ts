import { describe, expect, it } from "vitest";
import type { Feature } from "@bettercad/kernel/document";
import { newSheet, type AutoRecipe, type DrawingDimension, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { AUTO_START, autoDimension, candidates, copiedBodies, keep, RANKS, repeatsOf, suggested, type AutoOptions, type Candidate } from "./auto";
import { dimArt, dimStyle } from "./dimensions";
import { targets } from "./marks";

const TAU = Math.PI * 2;
const edge = (index: number) => ({ body: "b1", kind: "edge" as const, index });
const face = (index: number, name: string) => ({ body: "b1", kind: "face" as const, index, name });
const line = (index: number, a: V2, b: V2) => ({ curve: { kind: "line", a, b }, visible: true, type: "sharp", source: edge(index) });
const hole = (index: number, name: string, c: V2, r: number) => ({ seen: "end", c, r, hole: true, sweep: TAU, source: face(index, name) });

/**
 * A stepped plate from the front: 60 mm long, 40 mm tall at the left and 20 mm at the right with the step at 40 mm,
 * its top left corner cut off at 45°, a 2 mm lip at the bottom right, two 5 mm holes and one 8 mm hole.
 */
const front = {
  edges: [
    line(0, [0, 0], [58, 0]),
    line(1, [58, 0], [58, 2]),
    line(2, [58, 2], [60, 2]),
    line(3, [60, 2], [60, 20]),
    line(4, [60, 20], [40, 20]),
    line(5, [40, 20], [40, 40]),
    line(6, [40, 40], [10, 40]),
    line(7, [10, 40], [0, 30]),
    line(8, [0, 30], [0, 0]),
  ],
  box: { min: [0, 0], max: [60, 40] },
  rounds: [hole(20, "a", [10, 10], 2.5), hole(21, "b", [50, 10], 2.5), hole(22, "bore", [25, 25], 4)],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
/** The same plate from above, 8 mm deep: its length and its step show again, and its depth is new. */
const top = {
  edges: [
    line(30, [0, 0], [40, 0]),
    line(31, [40, 0], [60, 0]),
    line(32, [60, 0], [60, 8]),
    line(33, [60, 8], [0, 8]),
    line(34, [0, 8], [0, 0]),
    line(35, [40, 0], [40, 8]),
  ],
  box: { min: [0, 0], max: [60, 8] },
  rounds: [],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;

const v1: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 190] };
const v2: DrawingView = { ...v1, id: "v2", direction: "top", at: [150, 110] };
const iso: DrawingView = { ...v1, id: "v3", direction: "iso", at: [300, 190] };
const models: Record<string, ModelView> = { v1: front, v2: top, v3: front };
const viewOf = (id: string) => models[id];
const sheetOf = (views: DrawingView[] = [v1, v2], dimensions: DrawingDimension[] = []): DrawingSheet => ({
  ...newSheet("Sheet 1", { size: "A3" }),
  views,
  dimensions,
});
const opts = (o: Partial<AutoOptions> = {}): AutoOptions => ({ ...AUTO_START, density: 1, ...o });

/** A candidate as you would read it off the sheet: "v1 overall 60 mm". */
function said(c: Pick<Candidate, "rank"> & { dim: Pick<DrawingDimension, "view" | "kind" | "refs" | "across"> }): string {
  const model = viewOf(c.dim.view)!;
  const art = dimArt({ ...c.dim, id: "x", at: [0, -60] } as DrawingDimension, {
    view: model,
    scale: 1,
    style: dimStyle("iso"),
    decimals: 2,
    all: targets(model),
  });
  return `${c.dim.view} ${RANKS[c.rank]}: ${art ? art.text.text : "?"}${c.dim.across ? ` ${c.dim.across}` : ""}`;
}
const listed = (o: Partial<AutoOptions> = {}, sheet = sheetOf()) => candidates(sheet, viewOf, opts(o)).map(said);

const count = () => {
  let n = 0;
  return (kind: string) => `${kind}${++n}`;
};

describe("what Auto dimension offers", () => {
  it("measures every position from the bottom left corner to begin with, the sizes you would add first at the top", () => {
    expect(listed()).toEqual([
      "v1 overall: 60 x",
      "v1 overall: 40 y",
      "v2 overall: 8 y",
      "v1 hole position: 50 x",
      "v1 hole position: 25 x",
      "v1 hole position: 25 y",
      "v1 hole position: 10 y",
      "v1 hole size: Ø8",
      "v1 hole size: 2× Ø5",
      "v1 step: 40 x",
      "v1 step: 30 y",
      "v1 step: 20 y",
      "v1 step: 10 x",
      "v1 small step: 58 x",
      "v1 small step: 2 y",
      "v1 radius or angle: 135°",
    ]);
  });

  it("measures each position from the one before as a chain, leaving out the link at the far end, which the overall size gives", () => {
    expect(listed({ recipe: "chain" })).toEqual([
      "v1 overall: 60 x",
      "v1 overall: 40 y",
      "v2 overall: 8 y",
      "v1 hole position: 15 x",
      "v1 hole position: 15 x",
      "v1 hole position: 10 x",
      "v1 hole position: 10 y",
      "v1 hole position: 8 x",
      "v1 hole position: 8 y",
      "v1 hole position: 5 y",
      "v1 hole position: 5 y",
      "v1 hole size: Ø8",
      "v1 hole size: 2× Ø5",
      "v1 step: 10 x",
      "v1 small step: 2 y",
      "v1 radius or angle: 135°",
    ]);
  });

  it("offers the same sizes with centre marks as without", () => {
    expect(listed({ recipe: "centre-baseline" })).toEqual(listed());
    expect(listed({ recipe: "centre-chain" })).toEqual(listed({ recipe: "chain" }));
  });

  it("measures from the corner you choose", () => {
    const from = listed({ datum: "top-right" });
    // The holes are 10 and 35 mm in from the right, 15 and 30 mm down from the top.
    expect(from.filter((t) => t.includes("hole position"))).toEqual([
      "v1 hole position: 35 x",
      "v1 hole position: 30 y",
      "v1 hole position: 15 y",
      "v1 hole position: 10 x",
    ]);
    expect(from).toContain("v1 step: 20 x");
    expect(from).not.toContain("v1 step: 40 x");
  });

  it("measures from the middle when something is there, and leaves the halves to the overall size", () => {
    const from = listed({ datum: "centre" });
    // Nothing is at the middle of the length, so that still starts at the left; the step's top is at half the height.
    expect(from).toContain("v1 hole position: 50 x");
    expect(from).toContain("v1 hole position: 5 y");
    expect(from.filter((t) => t.endsWith(": 20 y"))).toEqual([]);
  });

  it("shows a size once: a later view leaves out what an earlier one has, however it would measure it", () => {
    for (const recipe of ["baseline", "chain"] as AutoRecipe[]) {
      const list = candidates(sheetOf(), viewOf, opts({ recipe }));
      expect(new Set(list.map((c) => c.key)).size).toBe(list.length);
      // The top view repeats the length and the step, so only its depth is new.
      expect(list.filter((c) => c.dim.view === "v2").map(said)).toEqual(["v2 overall: 8 y"]);
    }
    // Turned round, the top view comes first and the front view leaves the step to it.
    const swapped = candidates(sheetOf([v2, v1]), viewOf, opts()).map(said);
    expect(swapped).toContain("v2 step: 40 x");
    expect(swapped).not.toContain("v1 step: 40 x");
  });

  it("leaves a pictorial view alone", () => {
    expect(listed({}, sheetOf([iso]))).toEqual([]);
    expect(listed({}, sheetOf([v1, v2, iso]))).toEqual(listed());
  });

  it("does not offer a size you have put on by hand", () => {
    const [length] = candidates(sheetOf(), viewOf, opts());
    const byHand: DrawingDimension = { ...length!.dim, id: "d1", at: [0, -40], auto: false };
    expect(listed({}, sheetOf([v1, v2], [byHand]))).toEqual(listed().slice(1));
  });

  it("gives the same list every time", () => {
    expect(candidates(sheetOf(), viewOf, opts())).toEqual(candidates(sheetOf(), viewOf, opts()));
  });
});

describe("how many sizes", () => {
  const list = candidates(sheetOf(), viewOf, opts());
  it("keeps the overall sizes at least, everything at most, and more as the slider goes up", () => {
    expect(list).toHaveLength(16);
    expect(keep(list, 0)).toBe(3);
    // Half way is the suggested amount: the overall sizes, the holes, and up to five steps a view.
    expect(keep(list, 0.5)).toBe(13);
    expect(suggested(list)).toBe(13);
    expect(keep(list, 1)).toBe(16);
    expect(keep(list, 7)).toBe(16);
    expect(keep(list, -1)).toBe(3);
    let last = 0;
    for (let d = 0; d <= 1.0001; d += 0.05) {
      expect(keep(list, d)).toBeGreaterThanOrEqual(last);
      last = keep(list, d);
    }
    expect(keep([], 1)).toBe(0);
  });
});

describe("Auto dimension", () => {
  it("adds the sizes the slider keeps, laid out in rows, and remembers what you chose", () => {
    const got = autoDimension(sheetOf(), viewOf, 2, opts({ density: 0 }), count());
    expect([got.count, got.total]).toEqual([3, 16]);
    expect(got.sheet.dimensions.map((d) => [d.id, d.view, d.auto])).toEqual([
      ["dm1", "v1", true],
      ["dm2", "v1", true],
      ["dm3", "v2", true],
    ]);
    // The length goes in the first row under the front view, the height in the first row to its left.
    expect(got.sheet.dimensions.map((d) => d.at)).toEqual([
      [0, -30],
      [-40, 0],
      [-40, 0],
    ]);
    expect(got.sheet.auto).toEqual({ recipe: "baseline", datum: "bottom-left", density: 0 });
    expect(got.sheet.marks).toEqual([]);
  });

  it("puts shorter sizes nearer the part than longer ones on the same side", () => {
    const { sheet } = autoDimension(sheetOf([v1]), viewOf, 2, opts(), count());
    const across = sheet.dimensions.filter((d) => d.view === "v1" && d.across === "x" && d.at[1] < -20);
    const texts = across.map((d) => ({ y: d.at[1], size: Number(said({ rank: 0, dim: d }).split(" ")[2]) })).sort((a, b) => b.y - a.y);
    expect(texts.length).toBeGreaterThan(3);
    for (let i = 1; i < texts.length; i++) expect(texts[i]!.size).toBeGreaterThanOrEqual(texts[i - 1]!.size);
  });

  it("run again, replaces the sizes it added and keeps the ones you placed", () => {
    const first = autoDimension(sheetOf(), viewOf, 2, opts({ density: 0 }), count());
    const mine: DrawingDimension = { id: "mine", view: "v1", kind: "diameter", refs: [{ view: "v1", ...face(22, "bore") }], at: [20, 30] };
    const again = autoDimension({ ...first.sheet, dimensions: [...first.sheet.dimensions, mine] }, viewOf, 2, opts({ recipe: "chain" }), count());
    expect(again.sheet.dimensions[0]).toEqual(mine);
    expect(again.sheet.dimensions.filter((d) => d.auto)).toHaveLength(again.count);
    // The bore has its size from you, so it is not given another.
    expect(again.total).toBe(15);
    expect(again.sheet.dimensions).toHaveLength(16);
    expect(again.sheet.auto!.recipe).toBe("chain");
  });

  it("marks every hole first with the centre mark recipes, once", () => {
    const plain = autoDimension(sheetOf(), viewOf, 2, opts({ recipe: "chain" }), count());
    expect(plain.sheet.marks).toEqual([]);
    const marked = autoDimension(sheetOf(), viewOf, 2, opts({ recipe: "centre-chain" }), count());
    expect(marked.sheet.marks).toHaveLength(3);
    expect(marked.sheet.dimensions.map((d) => d.refs)).toEqual(plain.sheet.dimensions.map((d) => d.refs));
    const again = autoDimension(marked.sheet, viewOf, 2, opts({ recipe: "centre-baseline" }), count());
    expect(again.sheet.marks).toHaveLength(3);
  });

  it("says there is nothing to do on an empty sheet", () => {
    const got = autoDimension(sheetOf([]), viewOf, 2, opts(), count());
    expect([got.count, got.total, got.sheet.dimensions.length]).toEqual([0, 0, 0]);
  });
});

/**
 * A 60 × 20 bar from the front with four 4 mm pins along it, made by a Pattern step (p1) from the first (f1), and a
 * second bar the same, a copy of the body, 30 mm above it. Each pin's sides are lines from the bar up 5 mm.
 */
function patterned(): ModelView {
  const named = (body: string, index: number, name: string, a: V2, b: V2) => ({
    curve: { kind: "line", a, b },
    visible: true,
    type: "sharp",
    source: { body, kind: "edge" as const, index, name },
  });
  const bar = (body: string, y: number) => {
    const out = [
      named(body, 0, "base:f1|base:f2", [0, y], [60, y]),
      named(body, 1, "base:f2|base:f3", [60, y], [60, y + 20]),
      named(body, 2, "base:f3|base:f4", [60, y + 20], [0, y + 20]),
      named(body, 3, "base:f4|base:f1", [0, y + 20], [0, y]),
    ];
    [8, 22, 36, 50].forEach((x, i) => {
      const step = i === 0 ? "f1" : "p1";
      const k = i === 0 ? "" : `#${i}`;
      out.push(
        named(body, 10 + i * 3, `base:f3|${step}:side(l1)${k}`, [x, y + 20], [x, y + 25]),
        named(body, 11 + i * 3, `${step}:cap.end${k}|${step}:side(l2)${k}`, [x, y + 25], [x + 4, y + 25]),
        named(body, 12 + i * 3, `base:f3|${step}:side(l3)${k}`, [x + 4, y + 25], [x + 4, y + 20]),
      );
    });
    return out;
  };
  return { edges: [...bar("b1", 0), ...bar("b2", 30)], box: { min: [0, 0], max: [60, 55] }, rounds: [], bodies: ["b1", "b2"], ms: 1 } as unknown as ModelView;
}
const pattern = {
  id: "p1",
  type: "pattern",
  name: "Pattern 1",
  kind: "rect",
  of: "features",
  features: ["f1"],
  count1: 4,
  spacing1: 14,
  count2: 1,
  spacing2: 10,
} as unknown as Feature;

describe("patterns and copies", () => {
  const models2: Record<string, ModelView> = { v1: patterned() };
  const viewOf2 = (id: string) => models2[id];
  const repeats = repeatsOf([pattern]);
  const words = (list: Candidate[]) =>
    list.map((c) => {
      const art = dimArt({ ...c.dim, at: [0, -60] } as DrawingDimension, { view: models2.v1!, scale: 1, style: dimStyle("iso"), decimals: 2 });
      return `${RANKS[c.rank]}: ${art?.text.text}${c.dim.across ? ` ${c.dim.across}` : ""}`;
    });

  it("reads what each Pattern or Mirror of features makes, and leaves out patterns of bodies", () => {
    const more = [
      pattern,
      { ...pattern, id: "p2", kind: "circle", count: 8, angle: 360 },
      { ...pattern, id: "p3", kind: "circle", count: 3, angle: 90 },
      { ...pattern, id: "p4", kind: "mirror" },
      { ...pattern, id: "p5", count2: 2, spacing2: 10 },
      { ...pattern, id: "p6", of: "bodies" },
      { ...pattern, id: "p7", suppressed: true },
    ] as Feature[];
    expect([...repeatsOf(more).entries()].map(([id, r]) => `${id} ${r.count} ${r.says}`)).toEqual([
      "p1 4 4× 14 mm apart",
      "p2 8 8× equally spaced",
      "p3 3 3× over 90°",
      "p4 2 2×, mirrored",
      "p5 8 4 × 2, 14 mm and 10 mm apart",
    ]);
  });

  it("knows a body that is a copy of one before it, wherever it is", () => {
    expect([...copiedBodies(patterned())]).toEqual(["b2"]);
  });

  it("measures the first of a pattern and the first copy of a body only", () => {
    const sheet = sheetOf([v1]);
    const before = candidates(sheet, viewOf2, opts({ recipe: "chain" }));
    const after = candidates(sheet, viewOf2, opts({ recipe: "chain" }), repeats);
    expect(after.length).toBeLessThan(before.length);
    // Across: the bar's end to the first pin and the pin; the far end is the overall size, the other pins have the note.
    expect(words(after).filter((w) => w.endsWith(" x"))).toEqual(["overall: 60 x", "small step: 8 x", "small step: 4 x"]);
    // Up: only the first bar, the copy above it says nothing again.
    expect(words(after).filter((w) => w.endsWith(" y"))).toEqual(["overall: 25 y", "step: 20 y"]);
  });

  it("puts a note on the first of a pattern, and replaces it when run again", () => {
    let n = 0;
    const id = (k: string) => `${k}${++n}`;
    const got = autoDimension(sheetOf([v1]), viewOf2, 2, opts(), id, repeats);
    expect(got.sheet.notes).toEqual([
      {
        id: expect.any(String),
        kind: "leader",
        text: "4× 14 mm apart",
        on: expect.objectContaining({ view: "v1", body: "b1", name: "base:f3|f1:side(l1)" }),
        at: expect.any(Array),
        auto: true,
      },
    ]);
    const mine = { id: "mine", kind: "text" as const, text: "Print in PETG", at: [10, 10] as V2 };
    const again = autoDimension({ ...got.sheet, notes: [...got.sheet.notes!, mine] }, viewOf2, 2, opts(), id, repeats);
    expect(again.sheet.notes!.map((x) => x.text)).toEqual(["Print in PETG", "4× 14 mm apart"]);
    // With no sizes kept there is nothing for a note to go with.
    expect(autoDimension(sheetOf([]), viewOf2, 2, opts(), id, repeats).sheet.notes).toBeUndefined();
  });

  it("places a bolt circle by one hole, and leaves slivers to the corner beside them", () => {
    const ring = {
      edges: [line(0, [0, 0], [60, 0]), line(1, [60, 0], [60, 60]), line(2, [60, 60], [0.3, 60]), line(3, [0.3, 60], [0, 59.7]), line(4, [0, 59.7], [0, 0])],
      box: { min: [0, 0], max: [60, 60] },
      rounds: [
        hole(10, "bore", [30, 30], 8),
        hole(11, "a", [10, 30], 2.5),
        hole(12, "b", [30, 10], 2.5),
        hole(13, "c", [50, 30], 2.5),
        hole(14, "d", [30, 50], 2.5),
      ],
      bodies: ["b1"],
      ms: 1,
    } as unknown as ModelView;
    const list = candidates(sheetOf([v1]), (id) => (id === "v1" ? ring : undefined), opts());
    const texts = list.map((c) => {
      const art = dimArt({ ...c.dim, at: [0, -60] } as DrawingDimension, { view: ring, scale: 1, style: dimStyle("iso"), decimals: 2 });
      return `${RANKS[c.rank]}: ${art?.text.text}${c.dim.across ? ` ${c.dim.across}` : ""}`;
    });
    expect(texts).toEqual([
      "overall: 60 x",
      "overall: 60 y",
      "hole position: 30 x",
      "hole position: 30 y",
      "hole position: 10 x",
      "hole size: Ø16",
      "hole size: 4× Ø5",
      "radius or angle: 135°",
    ]);
  });
});
