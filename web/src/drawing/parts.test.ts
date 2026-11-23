import { describe, expect, it, vi } from "vitest";
import { newSheet, viewScale, type DrawingNote, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newDoc, type ModelDoc } from "../state/document";
import { makeEveryPart, partDrawings } from "./everyPart";
import { sheetScene } from "./export/scene";
import { firstDirections, standardViews } from "./firstViews";
import { sheetLayout } from "./layout";
import { noteArt, noteName } from "./notes";
import { autoBalloons, BOUGHT, itemOf, modelParts, partsRows, partsTable, setPartsList, type ListedBody, type ListedComponent } from "./parts";
import { slides } from "./projected";
import type { ViewCall } from "./useModelViews";
import { freeSpace, toPage } from "./views";

const PLA = { material: "PLA" };

describe("the parts list", () => {
  const components: ListedComponent[] = [
    { id: "base", name: "Base" },
    { id: "arm", name: "Arm" },
    { id: "grip", name: "Gripper", parent: "arm" },
    { id: "w1", name: "Wheel" },
    { id: "w2", name: "Wheel" },
  ];
  const bodies: ListedBody[] = [
    { id: "b1", name: "Plate", link: "base" },
    { id: "b2", name: "Post", link: "base" },
    { id: "b3", name: "Beam", link: "arm" },
    { id: "b4", name: "Jaw", link: "grip" },
    { id: "w1/t", name: "Tyre", link: "w1" },
    { id: "w2/t", name: "Tyre", link: "w2" },
    { id: "s1", name: "SG90 servo", catalogue: { id: "sg90", name: "SG90 servo" }, reference: true },
    { id: "s2", name: "SG90 servo (2)", catalogue: { id: "sg90", name: "SG90 servo" }, reference: true },
    { id: "foot", name: "Foot" },
    { id: "foot2", name: "Foot (2)", copy: { body: { id: "foot" }, by: { turn: {} } } },
    { id: "foot3", name: "Foot mirrored", copy: { body: { id: "foot" }, by: { mirror: {} } } },
    { id: "cut", name: "Cutter", hole: true },
    { id: "off", name: "Spare", hidden: true },
  ];
  const rows = partsRows(bodies, components, { ...PLA, sourceOf: (c) => (c.startsWith("w") ? "account:wheel" : undefined) });

  it("has a row for each top-level component and each loose body, numbered in build order", () => {
    expect(rows.map((r) => [r.item, r.name, r.count, r.material])).toEqual([
      [1, "Base", 1, "PLA"],
      [2, "Arm", 1, "PLA"],
      [3, "Wheel", 2, "PLA"],
      [4, "SG90 servo", 2, BOUGHT],
      [5, "Foot", 2, "PLA"],
      [6, "Foot mirrored", 1, "PLA"],
    ]);
  });

  it("counts two inserts of one model once, a patterned copy with its original, and a mirrored copy on its own", () => {
    expect(rows[2]!.bodies).toEqual(["w1/t", "w2/t"]);
    expect(rows[4]!.bodies).toEqual(["foot", "foot2"]);
    expect(rows[5]!.bodies).toEqual(["foot3"]);
  });

  it("puts a component inside another in its parent's row, and leaves holes and hidden bodies out", () => {
    expect(itemOf(rows, "b4")).toBe(2);
    expect(itemOf(rows, "cut")).toBeUndefined();
    expect(itemOf(rows, "off")).toBeUndefined();
    expect(rows[1]!.shows).toEqual({ component: "arm" });
    expect(rows[4]!.shows).toEqual({ bodies: ["foot"] });
  });

  it("reads the material and what was inserted from the model", () => {
    const doc = {
      ...newDoc(),
      print: { material: "petg" },
      features: [
        { id: "w1", type: "model", source: { kind: "account", id: "m9", version: 1, name: "Wheel" } },
        { id: "w2", type: "model", source: { kind: "account", id: "m9", version: 2, name: "Wheel" } },
      ],
    } as unknown as ModelDoc;
    const got = modelParts(doc, bodies, components);
    expect(got.find((r) => r.name === "Wheel")).toMatchObject({ count: 2, material: "PETG" });
    // Without a source two components of one name are two rows.
    expect(modelParts(newDoc(), bodies, components).filter((r) => r.name === "Wheel")).toHaveLength(2);
  });

  it("is laid out above the title block, as wide as it, the heading on top", () => {
    const sheet = newSheet("Sheet 1", { size: "A3" });
    const l = sheetLayout(sheet);
    const t = partsTable(rows, l);
    expect(t.box.x + t.box.w).toBeCloseTo(l.block.x + l.block.w, 6);
    expect(t.box.y + t.box.h).toBeCloseTo(l.block.y, 6);
    expect(t.box.h).toBe(6 * 7);
    expect(t.rows[0]!.cells.map((c) => c.text)).toEqual(["Item", "Part", "Qty", "Material"]);
    expect(t.rows[3]!.cells.map((c) => c.text)).toEqual(["3", "Wheel", "2", "PLA"]);
    // Three lines between the four columns, and one under the heading and each row but the last.
    expect(t.lines).toHaveLength(3 + 6);
    expect(setPartsList(sheet, true).partsList).toBe(true);
    expect("partsList" in setPartsList({ ...sheet, partsList: true }, false)).toBe(false);
  });
});

const edge = (body: string, index: number, a: V2, b: V2) => ({
  curve: { kind: "line", a, b },
  visible: true,
  type: "sharp",
  source: { body, kind: "edge", index },
});
const boxOf = (body: string, x0: number, y0: number, x1: number, y1: number, from = 0) => [
  edge(body, from, [x0, y0], [x1, y0]),
  edge(body, from + 1, [x1, y0], [x1, y1]),
  edge(body, from + 2, [x1, y1], [x0, y1]),
  edge(body, from + 3, [x0, y1], [x0, y0]),
];
/** Two blocks side by side and a small one on top of the left one. */
const assembly = {
  edges: [...boxOf("left", -40, -10, -5, 10), ...boxOf("right", 5, -10, 40, 10), ...boxOf("cap", -30, 10, -15, 18)],
  box: { min: [-40, -10], max: [40, 18] },
  rounds: [],
  bodies: ["left", "right", "cap"],
  ms: 1,
} as unknown as ModelView;
const three = partsRows(
  [
    { id: "left", name: "Left" },
    { id: "right", name: "Right" },
    { id: "cap", name: "Cap" },
  ],
  [],
  PLA,
);

describe("balloons", () => {
  let n = 0;
  const made = autoBalloons(assembly, "v1", 1, three, [], () => `n${++n}`);

  it("gives every part a view shows one balloon, set out round the view and clear of it", () => {
    expect(made).toHaveLength(3);
    expect(made.every((b) => b.kind === "balloon" && b.on?.view === "v1")).toBe(true);
    expect(new Set(made.map((b) => itemOf(three, b.on!.body)))).toEqual(new Set([1, 2, 3]));
    for (const b of made) {
      const c: V2 = [b.at[0] + 4, b.at[1] + 4];
      // Outside the view's box (80 by 28 about its middle) by at least a balloon.
      expect(Math.abs(c[0]) >= 40 + 8 || Math.abs(c[1]) >= 14 + 8).toBe(true);
    }
    // No two touch.
    for (const a of made) for (const b of made) if (a !== b) expect(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])).toBeGreaterThan(8);
  });

  it("goes on the side of the view its part is on, and skips parts that have one already", () => {
    const of = (item: number) => made.find((b) => itemOf(three, b.on!.body) === item)!;
    expect(of(1).at[0]).toBeLessThan(0);
    expect(of(2).at[0]).toBeGreaterThan(0);
    expect(autoBalloons(assembly, "v1", 1, three, made, () => "x")).toHaveLength(0);
    expect(autoBalloons(assembly, "v1", 1, three, made.slice(0, 1), () => "x")).toHaveLength(2);
    // Another view's balloons do not count for this one.
    expect(autoBalloons(assembly, "v2", 1, three, made, () => "x")).toHaveLength(3);
  });

  it("draws the part's number in a circle with an arrow to the part, and follows the list", () => {
    const b = made.find((x) => itemOf(three, x.on!.body) === 2)!;
    const ctx = { view: assembly, scale: 1, itemOf: (body: string) => itemOf(three, body) };
    const art = noteArt(b, ctx)!;
    expect(art.curves).toEqual([{ kind: "circle", c: [b.at[0] + 4, b.at[1] + 4], r: 4 }]);
    expect(art.texts).toEqual([{ at: [b.at[0] + 4, b.at[1] + 4], text: "2", anchor: "middle" }]);
    expect(art.lines).toHaveLength(1);
    expect(art.fills).toHaveLength(1);
    expect(noteName(b, art)).toBe("Balloon 2");
    // With the first part gone from the list, the same balloon reads 1.
    const fewer = partsRows(
      [
        { id: "right", name: "Right" },
        { id: "cap", name: "Cap" },
      ],
      [],
      PLA,
    );
    expect(noteArt(b, { ...ctx, itemOf: (body) => itemOf(fewer, body) })!.says).toBe("1");
    expect(noteArt(b, { view: assembly, scale: 1 })!.says).toBe("?");
  });

  it("export with the sheet: the table on the title layer and the balloons with the notes", () => {
    const view: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
    const sheet: DrawingSheet = { ...newSheet("Sheet 1", { size: "A3" }), views: [view], notes: made as DrawingNote[], partsList: true };
    const l = sheetLayout(sheet);
    const scene = sheetScene(sheet, l, () => assembly, 2, { parts: three });
    const title = scene.labels.filter((x) => x.layer === "title").map((x) => x.text);
    expect(title).toEqual(expect.arrayContaining(["Item", "Qty", "Left", "Right", "Cap", "PLA"]));
    expect(
      scene.labels
        .filter((x) => x.layer === "dimension")
        .map((x) => x.text)
        .sort(),
    ).toEqual(["1", "2", "3"]);
    expect(scene.strokes.filter((x) => x.layer === "dimension" && x.curve.kind === "circle")).toHaveLength(3);
    // A sheet without the list has no table.
    const plain = sheetScene({ ...sheet, partsList: false }, l, () => assembly, 2, { parts: three });
    expect(plain.labels.some((x) => x.text === "Qty")).toBe(false);
  });
});

/** A block 60 wide, 20 deep and 40 tall, from each way a first sheet looks at it. */
const block = (w: number, h: number) =>
  ({ edges: boxOf("b1", 0, 0, w, h), box: { min: [0, 0], max: [w, h] }, rounds: [], bodies: ["b1"], ms: 1 }) as unknown as ModelView;
const pics = { front: block(60, 40), up: block(60, 20), side: block(20, 40), iso: block(70, 60) };

describe("a finished first sheet", () => {
  for (const standard of ["iso", "asme"] as const) {
    it(`${standard}: a front view with the views round it where the standard puts them, all inside the clear space`, () => {
      const sheet = newSheet("Sheet 1", { size: standard === "iso" ? "A3" : "tabloid", standard });
      const l = sheetLayout(sheet);
      let n = 0;
      const next = standardViews(sheet, l, { all: true }, pics, () => `v${++n}`);
      expect(next.views.map((v) => v.kind)).toEqual(["base", "projected", "projected", "projected"]);
      const [front, up, side, iso] = next.views as [DrawingView, DrawingView, DrawingView, DrawingView];
      const ways = firstDirections(l.angle);
      expect(up.direction).toEqual(ways.up);
      expect(iso.hidden).toBe(false);
      expect(front.hidden).toBe(true);
      // Third angle puts the top view above the front view, first angle below; both hold it in line.
      expect(Math.sign(up.at[1] - front.at[1])).toBe(l.angle === "third" ? 1 : -1);
      expect(up.at[0]).toBeCloseTo(front.at[0], 6);
      expect(side.at[1]).toBeCloseTo(front.at[1], 6);
      expect(side.at[0]).toBeGreaterThan(front.at[0]);
      expect(slides(next, up)).toBe("y");
      expect(slides(next, side)).toBe("x");
      // The largest standard scale that fits: every view's box is inside the clear space.
      const s = viewScale(next, front);
      expect(next.scale).toBe(s);
      const free = freeSpace(l);
      const sizes = [pics.front, pics.up, pics.side, pics.iso];
      next.views.forEach((v, i) => {
        const [x, y] = toPage(v.at, l.page.h);
        const [w, h] = [sizes[i]!.box.max[0] * s, sizes[i]!.box.max[1] * s];
        expect(x - w / 2).toBeGreaterThanOrEqual(free.x);
        expect(x + w / 2).toBeLessThanOrEqual(free.x + free.w);
        expect(y - h / 2).toBeGreaterThanOrEqual(free.y);
        expect(y + h / 2).toBeLessThanOrEqual(free.y + free.h);
      });
      expect(s).toBeGreaterThanOrEqual(1);
    });
  }

  it("leaves the sheet alone when there is nothing to draw", () => {
    const sheet = newSheet("Sheet 1", { size: "A3" });
    const empty = { ...block(0, 0), edges: [] } as ModelView;
    expect(standardViews(sheet, sheetLayout(sheet), { all: true }, { ...pics, front: empty }, () => "v")).toBe(sheet);
  });
});

describe("Make drawings of every part", () => {
  const rows = partsRows(
    [
      { id: "b1", name: "Plate", link: "base" },
      { id: "foot", name: "Foot" },
    ],
    [{ id: "base", name: "Base" }],
    PLA,
  );
  const call = vi.fn<ViewCall>((p) => Promise.resolve(p.frame.toEye[2] ? pics.iso : pics.front));
  let n = 0;
  const newId = (kind: string) => `${kind}${++n}`;

  it("makes a drawing named for each part, each with four views of that part alone", async () => {
    const doc = { ...newDoc(), name: "Robot" };
    const r = await partDrawings(doc, rows, call, undefined, { author: "Kev", newId });
    expect(r.made).toEqual(["Base", "Foot"]);
    const [base, foot] = r.doc.drawings!;
    expect(base!.name).toBe("Base");
    expect(base!.sheets[0]!.title).toMatchObject({ title: "Base", author: "Kev" });
    expect(base!.sheets[0]!.views).toHaveLength(4);
    expect(base!.sheets[0]!.views.every((v) => "component" in v.shows && v.shows.component === "base")).toBe(true);
    expect(foot!.sheets[0]!.views[0]!.shows).toEqual({ bodies: ["foot"] });
    // The kernel was asked for quick pictures of the part on its own, never of the drawings.
    expect(call.mock.calls.every(([p]) => p.trace === false && p.doc.drawings === undefined)).toBe(true);
    // Run again: nothing new to make.
    const again = await partDrawings(r.doc, rows, call, undefined, { newId });
    expect(again.made).toEqual([]);
    expect(again.skipped).toBe(2);
    expect(again.doc).toBe(r.doc);
  });

  it("skips a part with nothing to draw, and waits for the geometry engine", async () => {
    const empty = { ...pics.front, edges: [] } as ModelView;
    const none = await partDrawings(newDoc(), rows, () => Promise.resolve(empty), undefined, { newId });
    expect(none.made).toEqual([]);
    const off = await partDrawings(newDoc(), rows, () => null, undefined, { newId });
    expect(off.made).toEqual([]);
    expect(off.skipped).toBe(2);
  });

  it("as the editor runs it: one step in Undo, and it says how it went", async () => {
    let doc: ModelDoc = { ...newDoc(), name: "Robot" };
    const edits: string[] = [];
    const store = {
      get: () => doc,
      edit: (change: (d: ModelDoc) => ModelDoc, label: string) => {
        doc = change(doc);
        edits.push(label);
      },
    };
    const said: string[] = [];
    const bodies = [
      { id: "b1", name: "Plate", link: "base" },
      { id: "foot", name: "Foot" },
    ];
    const run = () => makeEveryPart(store, bodies, [{ id: "base", name: "Base" }], call, undefined, (t) => said.push(t), "Kev");
    await run();
    expect(edits).toEqual(["Make drawings of every part"]);
    expect(doc.drawings!.map((d) => d.name)).toEqual(["Base", "Foot"]);
    expect(said).toEqual(["Making a drawing of every part.", "Made 2 drawings. They are under Drawings in the browser."]);
    await run();
    expect(edits).toHaveLength(1);
    expect(said.at(-1)).toBe("Every part already has a drawing.");
  });
});
