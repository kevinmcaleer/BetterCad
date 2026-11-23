import { describe, expect, it } from "vitest";
import { newSheet, removeView, type DrawingNote, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import { VIEWS, type ModelView, type V2 } from "@bettercad/kernel/view";
import type { Feature } from "../state/document";
import { sizeWith } from "./dimensions";
import { sheetScene } from "./export/scene";
import { problems } from "./follow";
import { sheetLayout } from "./layout";
import { refTo, targets } from "./marks";
import { draftOfNote, firstDraft, holeNote, nextDatum, noteArt, noteName, notePicks, noteSpot, noteWords } from "./notes";
import { duplicateSheet, moveViewToSheet } from "./sheets";

const TAU = Math.PI * 2;
const face = (index: number, name: string) => ({ body: "b1", kind: "face" as const, index, name });
const edge = (index: number) => ({ body: "b1", kind: "edge" as const, index });
const corners: V2[] = [
  [-20, -10],
  [20, -10],
  [20, 10],
  [-20, 10],
];
/** A 60 by 40 plate from the top: four 3.4 mm holes near its corners and a 10 mm bore in the middle. */
const plate = {
  edges: [
    { curve: { kind: "line", a: [-30, -20], b: [30, -20] }, visible: true, type: "sharp", source: edge(0) },
    { curve: { kind: "line", a: [30, -20], b: [30, 20] }, visible: true, type: "sharp", source: edge(1) },
    { curve: { kind: "line", a: [30, 20], b: [-30, 20] }, visible: true, type: "sharp", source: edge(2) },
    { curve: { kind: "line", a: [-30, 20], b: [-30, -20] }, visible: true, type: "sharp", source: edge(3) },
  ],
  box: { min: [-30, -20], max: [30, 20] },
  rounds: [
    ...corners.map((c, i) => ({ seen: "end", c, r: 1.7, hole: true, sweep: TAU, source: face(10 + i, `hole${i}`) })),
    { seen: "end", c: [0, 0], r: 5, hole: true, sweep: TAU, source: face(20, "bore") },
  ],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
const all = targets(plate);
const named = (name: string) => all.find((t) => t.source.name === name)!;
const side = (index: number) => all.find((t) => t.kind === "edge" && t.source.index === index)!;
const top: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "top", hidden: true, tangent: false, at: [100, 100] };
const base = { id: "f1", name: "Hole 1", part: "b1", frame: { origin: [0, 0, 5], x: [1, 0, 0], normal: [0, 0, 1] } };
const holes = (more: object) =>
  [{ ...base, type: "hole", points: corners, size: "M3", fit: "normal", head: "none", depth: null, ...more }] as unknown as Feature[];
const ctx = (features?: Feature[]) => ({ view: plate, scale: 2, frame: VIEWS.top, all, ...(features ? { features } : {}) });

describe("hole notes", () => {
  it("read a Hole step: how many, its size and that it goes through", () => {
    const at = { c: corners[0]!, r: 1.7 };
    expect(holeNote(holes({}), VIEWS.top, "b1", at, all)).toEqual(["4× Ø3.4 through"]);
    expect(holeNote(holes({ depth: 6 }), VIEWS.top, "b1", at, all)).toEqual(["4× Ø3.4 6 deep"]);
  });

  it("write a tapped hole by its thread, and a counterbore or countersink on a line of its own", () => {
    const at = { c: corners[2]!, r: 1.25 };
    expect(holeNote(holes({ fit: "tap" }), VIEWS.top, "b1", at, all)).toEqual(["4× M3 × 0.5", "Ø2.5 through"]);
    expect(holeNote(holes({ head: "counterbore" }), VIEWS.top, "b1", at, all)).toEqual(["4× Ø3.4 through", "Ø5.9 counterbore, 3.2 deep"]);
    expect(holeNote(holes({ head: "countersink" }), VIEWS.top, "b1", at, all)[1]).toMatch(/^Ø6\.72 countersink, 90°$/);
  });

  it("fall back to the size seen and how many like it when no Hole step made the hole", () => {
    expect(holeNote([], VIEWS.top, "b1", { c: corners[0]!, r: 1.7 }, all)).toEqual(["4× Ø3.4"]);
    expect(holeNote(holes({}), VIEWS.top, "b1", { c: [0, 0], r: 5 }, all)).toEqual(["Ø10"]);
    // Another body's Hole step is not this hole's.
    expect(holeNote(holes({ part: "b2" }), VIEWS.top, "b1", { c: corners[0]!, r: 1.7 }, all)).toEqual(["4× Ø3.4"]);
  });

  it("can only be put on a whole hole; a leader goes on anything, loose text on nothing", () => {
    expect(notePicks("hole", named("bore"))).toBe(true);
    expect(notePicks("hole", side(0))).toBe(false);
    expect(notePicks("leader", side(0))).toBe(true);
    expect(notePicks("text", side(0))).toBe(false);
  });
});

describe("what a note draws", () => {
  const on = refTo("v1", named("hole1"));
  it("a hole note: its words, a shouldered leader and an arrowhead on the hole's edge", () => {
    const at = noteSpot(named("hole1"), plate, 2);
    const art = noteArt({ kind: "hole", text: "", on, at }, ctx(holes({})))!;
    expect(art.texts.map((t) => t.text)).toEqual(["4× Ø3.4 through"]);
    expect(noteName({ kind: "hole" }, art)).toBe("Hole note, 4× Ø3.4 through");
    expect(art.lines).toHaveLength(2);
    // The arrow's tip is on the hole: 1.7 mm at 2:1 from its centre, which is at (40, -20) on paper.
    const tip = art.fills[0]![0]!;
    expect(Math.hypot(tip[0] - 40, tip[1] + 20)).toBeCloseTo(3.4, 6);
    // The text starts clear of the view's lines, up and to the right of the hole.
    expect(at[0]).toBeGreaterThan(40 + 3.4);
    expect(at[1]).toBeGreaterThan(-20 + 3.4);
  });

  it("a leader keeps each line of its text, and leaves from the side nearer what it points at", () => {
    const art = noteArt({ kind: "leader", text: "Deburr\nboth sides", on: refTo("v1", side(1)), at: [80, 10] }, ctx())!;
    expect(art.texts.map((t) => t.text)).toEqual(["Deburr", "both sides"]);
    expect(art.texts[0]!.at[1]).toBeGreaterThan(art.texts[1]!.at[1]);
    // The right edge is at x = 60 on paper, left of the text: the shoulder goes left.
    const [start, elbow] = art.lines[0]!;
    expect(elbow[0]).toBeLessThan(start[0]);
    expect(art.fills[0]![0]![0]).toBeCloseTo(60, 6);
  });

  it("loose text needs no view; a note whose edge is gone draws nothing and is a problem", () => {
    const loose = noteArt({ kind: "text", text: "Break all sharp edges", at: [20, 30] })!;
    expect(loose.lines).toHaveLength(0);
    expect(loose.box.min[0]).toBeLessThan(20);
    expect(loose.box.max[0]).toBeGreaterThan(40);
    const lost: DrawingNote = { id: "n1", kind: "leader", text: "Gone", on: { view: "v1", body: "b1", kind: "edge", index: 99 }, at: [0, 0] };
    expect(noteArt(lost, ctx())).toBeUndefined();
    const sheet: DrawingSheet = {
      ...newSheet("Sheet 1", { size: "A3" }),
      scale: 2,
      views: [top],
      notes: [lost, { id: "n2", kind: "text", text: "Fine", at: [5, 5] }],
    };
    expect(problems(sheet, () => plate, 2)).toEqual([{ kind: "note", id: "n1", view: "v1", at: [0, 0] }]);
  });

  it("a datum is a boxed letter with a filled triangle; a frame is its symbol and a cell for each part", () => {
    const datum = noteArt({ kind: "datum", text: "A", on: refTo("v1", side(0)), at: [0, -60] }, ctx())!;
    expect(datum.says).toBe("Datum A");
    expect(datum.texts).toEqual([{ at: [3.5, -56.5], text: "A", anchor: "middle" }]);
    expect(datum.fills).toHaveLength(1);
    const frame = noteArt({ kind: "frame", symbol: "flatness", text: "0.05|A|B", on: refTo("v1", side(0)), at: [0, -60] }, ctx())!;
    expect(frame.says).toBe("Flatness 0.05, A, B");
    expect(frame.texts.map((t) => t.text)).toEqual(["0.05", "A", "B"]);
    const position = noteArt({ kind: "frame", symbol: "position", text: "0.1", at: [0, 0] })!;
    expect(position.curves).toEqual([{ kind: "circle", c: [3.5, 3.5], r: 1.75 }]);
  });

  it("a surface finish is a tick with its roughness over the long arm", () => {
    const art = noteArt({ kind: "finish", text: "Ra 3.2", on: refTo("v1", side(2)), at: [10, 60] }, ctx())!;
    expect(art.says).toBe("Surface finish Ra 3.2");
    expect(art.texts[0]!.at[1]).toBeGreaterThan(66);
    // Its point is where the leader leaves from.
    expect(art.lines.some(([a]) => a[0] === 11.7 && a[1] === 60)).toBe(true);
  });
});

describe("a note's card", () => {
  it("starts each kind with something sensible, and the next datum letter", () => {
    const sheet: DrawingSheet = { ...newSheet("Sheet 1", { size: "A3" }), notes: [{ id: "n1", kind: "datum", text: "A", at: [0, 0] }] };
    expect(firstDraft("datum", sheet).text).toBe("B");
    expect(firstDraft("finish", sheet).text).toBe("Ra 3.2");
    expect(firstDraft("leader", sheet).text).toBe("");
    // I, O and Q are never datum letters.
    const used = [..."ABCDEFGH"].map((text, i): DrawingNote => ({ id: `n${i}`, kind: "datum", text, at: [0, 0] }));
    expect(nextDatum({ ...sheet, notes: used })).toBe("J");
  });

  it("keeps a frame's tolerance and datums as cells, and reads them back", () => {
    const words = noteWords("frame", { text: " 0.1 ", symbol: "parallel", datums: "a, b" })!;
    expect(words).toEqual({ text: "0.1|A|B", symbol: "parallel" });
    expect(draftOfNote({ kind: "frame", ...words })).toEqual({ text: "0.1", symbol: "parallel", datums: "A B" });
    expect(noteWords("leader", { text: "  ", symbol: "position", datums: "" })).toBeUndefined();
    expect(noteWords("hole", { text: "", symbol: "position", datums: "" })).toEqual({ text: "" });
    expect(noteWords("datum", { text: "c", symbol: "position", datums: "" })).toEqual({ text: "C" });
  });
});

describe("a size with its tolerance", () => {
  it("writes plus and minus, limits and fits", () => {
    expect(sizeWith(40, 2, undefined)).toBe("40");
    expect(sizeWith(40, 2, { plus: 0.1, minus: 0.1 })).toBe("40 ±0.1");
    expect(sizeWith(40, 2, { plus: 0.2, minus: 0.05 })).toBe("40 +0.2/-0.05");
    expect(sizeWith(40, 2, { plus: 0.2, minus: 0.1, limits: true })).toBe("40.2 / 39.9");
    expect(sizeWith(10, 2, { fit: "sliding", gap: 0.25 }, "Ø")).toBe("Ø10 sliding fit, 0.25 gap");
    expect(sizeWith(5, 1, { plus: 0.025, minus: 0.025 }, "4× Ø")).toBe("4× Ø5 ±0.025");
    expect(sizeWith(40, 2, { plus: 0, minus: 0 })).toBe("40");
  });
});

describe("notes on a sheet", () => {
  const on = refTo("v1", named("bore"));
  const sheet: DrawingSheet = {
    ...newSheet("Sheet 1", { size: "A3" }),
    id: "s1",
    scale: 2,
    views: [top],
    notes: [
      { id: "n1", kind: "hole", text: "", on, at: [20, 20] },
      { id: "n2", kind: "text", text: "Print in PETG", at: [30, 40] },
    ],
  };

  it("go with their view when it is deleted or moved to another sheet; loose text stays", () => {
    expect(removeView(sheet, "v1").notes!.map((n) => n.id)).toEqual(["n2"]);
    const drawing = { id: "d", name: "D", decimals: 2, sheets: [sheet, { ...newSheet("Sheet 2", { size: "A3" }), id: "s2" }] };
    const moved = moveViewToSheet(drawing, "v1", "s1", "s2");
    expect(moved.sheets[0]!.notes!.map((n) => n.id)).toEqual(["n2"]);
    expect(moved.sheets[1]!.notes!.map((n) => n.id)).toEqual(["n1"]);
  });

  it("are copied with a duplicated sheet, pointing into the copy's views", () => {
    let n = 0;
    const copy = duplicateSheet({ id: "d", name: "D", decimals: 2, sheets: [sheet] }, "s1", (kind) => `${kind}${++n}`).sheets[1]!;
    expect(copy.notes).toHaveLength(2);
    expect(copy.notes![0]!.on!.view).toBe(copy.views[0]!.id);
    expect(copy.notes![0]!.id).not.toBe("n1");
  });

  it("export as thin lines, a filled arrowhead and text where the sheet draws them", () => {
    const scene = sheetScene(sheet, sheetLayout(sheet), () => plate, 2, { features: holes({}) });
    const texts = scene.labels.filter((l) => l.layer === "dimension").map((l) => l.text);
    expect(texts).toEqual(["Print in PETG", "Ø10"]);
    const loose = scene.labels.find((l) => l.text === "Print in PETG")!;
    expect(loose.at[0]).toBe(30);
    const hole = scene.labels.find((l) => l.text === "Ø10")!;
    // From the middle of the view at (100, 100).
    expect(hole.at[0]).toBe(120);
    expect(scene.fills).toHaveLength(1);
    // The arrow's tip is on the bore: 5 mm at 2:1 from the view's middle.
    const tip = scene.fills![0]!.pts[0]!;
    expect(Math.hypot(tip[0] - 100, tip[1] - 100)).toBeCloseTo(10, 6);
  });
});
