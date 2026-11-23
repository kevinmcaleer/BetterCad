import { describe, expect, it } from "vitest";
import { newSheet, type Drawing, type DrawingDimension, type DrawingMark, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import { newDoc, type ModelDoc } from "../state/document";
import { pagesPdf, scenePdf } from "./export/pdf";
import type { Scene } from "./export/scene";
import { drawingEdit, sheetChange, sheetEdit, sheetOf, titleChange } from "./ops";
import { addSheet, duplicateSheet, moveSheet, moveViewToSheet, nextSheetName, removeSheet, renameSheet } from "./sheets";

const view = (id: string, more: Partial<DrawingView> = {}): DrawingView => ({
  id,
  kind: "base",
  shows: { all: true },
  direction: "front",
  hidden: true,
  tangent: false,
  at: [150, 150],
  ...more,
});
const ref = (v: string, index: number) => ({ view: v, body: "b1", kind: "edge" as const, index });
const dim = (id: string, v: string): DrawingDimension => ({ id, view: v, kind: "linear", refs: [ref(v, 0)], across: "aligned", at: [0, -30] });
const mark = (id: string, v: string): DrawingMark => ({ id, kind: "centre-mark", on: { view: v, body: "b1", kind: "face", index: 20, name: "bore" } });
const first: DrawingSheet = {
  ...newSheet("Sheet 1", { size: "A3", title: "Bracket", author: "Kev" }),
  id: "s1",
  scale: 2,
  rows: { first: 12, next: 9 },
  views: [
    view("front"),
    view("top", { kind: "projected", parent: "front", direction: "top", at: [150, 60] }),
    view("iso", { direction: "iso", at: [300, 200] }),
  ],
  dimensions: [dim("d1", "front"), dim("d2", "top"), dim("d3", "iso")],
  marks: [mark("m1", "front"), mark("m2", "top")],
};
const drawing: Drawing = { id: "dr1", name: "Drawing 1", decimals: 2, sheets: [first] };
const ids = () => {
  let n = 0;
  return (kind: string) => `${kind}${++n}`;
};

describe("sheets of a drawing", () => {
  it("a new sheet is blank, goes after the open one, and takes its page, standard, scale, rows and title block", () => {
    const two = addSheet(drawing, "s1", "s2");
    expect(two.sheets.map((s) => s.name)).toEqual(["Sheet 1", "Sheet 2"]);
    expect(two.sheets[1]).toMatchObject({ id: "s2", size: "A3", landscape: true, standard: "iso", scale: 2, rows: { first: 12, next: 9 }, title: first.title });
    expect(two.sheets[1]).toMatchObject({ views: [], marks: [], dimensions: [] });
    const three = addSheet(two, "s1", "s3");
    expect(three.sheets.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
    expect(three.sheets[1]!.name).toBe("Sheet 3");
    expect(nextSheetName(three)).toBe("Sheet 4");
  });

  it("a copy has everything on it under ids of its own, still tied together", () => {
    const two = duplicateSheet(drawing, "s1", ids());
    const copy = two.sheets[1]!;
    expect(copy.name).toBe("Sheet 1 copy");
    expect(copy.id).not.toBe("s1");
    const [front, top] = copy.views;
    expect(front!.id).not.toBe("front");
    expect(top!.parent).toBe(front!.id);
    expect(copy.dimensions.map((d) => [d.view, d.refs[0]!.view])).toEqual([
      [front!.id, front!.id],
      [top!.id, top!.id],
      [copy.views[2]!.id, copy.views[2]!.id],
    ]);
    expect(copy.marks.map((m) => (m.kind === "centre-mark" ? m.on.view : ""))).toEqual([front!.id, top!.id]);
    const all = [...copy.views, ...copy.dimensions, ...copy.marks].map((x) => x.id);
    expect(new Set([...all, "front", "top", "iso", "d1", "d2", "d3", "m1", "m2"]).size).toBe(all.length + 8);
    // The first sheet is untouched, and a second copy gets a name of its own.
    expect(two.sheets[0]).toBe(first);
    expect(duplicateSheet(two, "s1", ids()).sheets[1]!.name).toBe("Sheet 1 copy 2");
  });

  it("renames, reorders and deletes, but keeps the last sheet", () => {
    const three = addSheet(addSheet(drawing, "s1", "s2"), "s2", "s3");
    expect(renameSheet(three, "s2", "  Details ").sheets[1]!.name).toBe("Details");
    expect(renameSheet(three, "s2", "  ")).toBe(three);
    expect(moveSheet(three, "s3", 0).sheets.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
    expect(moveSheet(three, "s1", 9).sheets.map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
    expect(moveSheet(three, "s1", 0)).toBe(three);
    expect(removeSheet(three, "s2").sheets.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(removeSheet(drawing, "s1")).toBe(drawing);
  });

  it("moves a view to another sheet with its projected views and everything on them", () => {
    const two = addSheet(drawing, "s1", "s2");
    const moved = moveViewToSheet(two, "front", "s1", "s2");
    const [from, to] = moved.sheets;
    expect(from!.views.map((v) => v.id)).toEqual(["iso"]);
    expect(from!.dimensions.map((d) => d.id)).toEqual(["d3"]);
    expect(from!.marks).toEqual([]);
    expect(to!.views.map((v) => [v.id, v.kind, v.parent, v.at])).toEqual([
      ["front", "base", undefined, [150, 150]],
      ["top", "projected", "front", [150, 60]],
    ]);
    expect(to!.dimensions.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(to!.marks.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(moveViewToSheet(two, "front", "s1", "s1")).toBe(two);
    expect(moveViewToSheet(two, "nope", "s1", "s2")).toBe(two);
  });

  it("a projected view moved on its own becomes a base view at the size it was, and comes in from the edge of a smaller page", () => {
    const small: DrawingSheet = { ...newSheet("Sheet 2", { size: "A4", landscape: false }), id: "s2", scale: 1 };
    const wide = {
      ...drawing,
      sheets: [{ ...first, views: first.views.map((v) => (v.id === "top" ? { ...v, at: [380, 60] as [number, number] } : v)) }, small],
    };
    const moved = moveViewToSheet(wide, "top", "s1", "s2");
    expect(moved.sheets[0]!.views.map((v) => v.id)).toEqual(["front", "iso"]);
    const top = moved.sheets[1]!.views[0]!;
    expect(top).toMatchObject({ id: "top", kind: "base", scale: 2, at: [190, 60] });
    expect(top.parent).toBeUndefined();
    // A base view with no scale of its own keeps the scale of the sheet it came from.
    expect(moveViewToSheet(wide, "iso", "s1", "s2").sheets[1]!.views[0]!.scale).toBe(2);
  });
});

describe("edits to a drawing with sheets", () => {
  const two = addSheet(drawing, "s1", "s2");
  const doc: ModelDoc = { ...newDoc(), drawings: [two] };
  const after = ([change]: [(d: ModelDoc) => ModelDoc, string]) => change(doc).drawings![0]!;

  it("go to the sheet that is open, the first when none is named", () => {
    expect(sheetOf(two, "s2").id).toBe("s2");
    expect(sheetOf(two, "gone").id).toBe("s1");
    expect(sheetOf(two, null).id).toBe("s1");
    const edited = after(sheetEdit(two, (s) => ({ ...s, scale: 5 }), "Scale", "s2"));
    expect(edited.sheets.map((s) => s.scale)).toEqual([2, 5]);
    expect(after(sheetEdit(two, (s) => ({ ...s, scale: 5 }), "Scale")).sheets.map((s) => s.scale)).toEqual([5, 2]);
  });

  it("each sheet has its own page, and they share the title block", () => {
    const choice = { size: "A4" as const, landscape: false, standard: "iso" as const, border: true, title: { ...first.title, number: "BC-7" } };
    const changed = after(sheetChange(two, choice, "s2"));
    expect(changed.sheets.map((s) => [s.size, s.landscape])).toEqual([
      ["A3", true],
      ["A4", false],
    ]);
    expect(changed.sheets.map((s) => s.title.number)).toEqual(["BC-7", "BC-7"]);
    const typed = after(titleChange(two, "approved", "Sam"));
    expect(typed.sheets.map((s) => s.title.approved)).toEqual(["Sam", "Sam"]);
    expect(after(titleChange(typed, "approved", "")).sheets.every((s) => !("approved" in s.title))).toBe(true);
  });

  it("a change to the list of sheets is one step with its own name", () => {
    const [change, label] = drawingEdit(two, (d) => removeSheet(d, "s2"), "Delete sheet");
    expect(label).toBe("Delete sheet");
    expect(change(doc).drawings![0]!.sheets).toHaveLength(1);
  });
});

describe("all the sheets as one PDF", () => {
  const scene = (w: number, h: number): Scene => ({
    w,
    h,
    strokes: [{ layer: "border", width: 0.7, curve: { kind: "line", a: [0, 0], b: [w, h] } }],
    labels: [],
  });
  const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

  it("has a page for each, at its own size, and one sheet alone is the file it always was", () => {
    const pdf = text(
      pagesPdf(
        [
          { scene: scene(420, 297), outlines: [] },
          { scene: scene(210, 297), outlines: [] },
        ],
        { title: "Bracket" },
      ),
    );
    expect(pdf).toContain("/Kids [3 0 R 5 0 R] /Count 2");
    expect(pdf.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(pdf).toMatch(/\/MediaBox \[0 0 1190\.5\d* 841\.8\d*\]/);
    expect(pdf).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
    expect(pdf).toContain("/Contents 4 0 R");
    expect(pdf).toContain("/Contents 6 0 R");
    expect(pdf).toContain("/Info 7 0 R");
    // The cross-reference table points at each object.
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...pdf.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(text(pagesPdf([{ scene: scene(420, 297), outlines: [] }]))).toBe(text(scenePdf(scene(420, 297), [])));
  });
});
