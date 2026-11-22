import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import schema from "./bcad.schema.json";
import { BcadError, loadBcad, saveBcad, validate } from "./bcad";
import { newDoc, type ModelDoc } from "./document";
import {
  addDrawing,
  changeSheet,
  fitScale,
  frameOf,
  newSheet,
  removeDrawing,
  removeView,
  renameDrawing,
  scaleLabel,
  sheetBox,
  SHEET_SIZES,
  standardFor,
  viewScale,
  type DrawingSheet,
  type DrawingView,
  type SheetSize,
} from "./drawing";

const view = (id: string, o: Partial<DrawingView> = {}): DrawingView => ({
  id,
  kind: "base",
  shows: { all: true },
  direction: "front",
  hidden: true,
  tangent: false,
  at: [100, 100],
  ...o,
});

/** A drawing with a base view, a projected view, a centre mark and a dimension. */
function drawn(): { doc: ModelDoc; drawing: string; sheet: string } {
  const made = addDrawing(newDoc("Bracket"), { size: "A3", author: "Kev", date: "2026-11-22" });
  const sheet = made.doc.drawings![0]!.sheets[0]!.id;
  const doc = changeSheet(made.doc, made.id, sheet, (s) => ({
    ...s,
    scale: 0.5,
    views: [view("v1"), view("v2", { kind: "projected", parent: "v1", direction: "top", at: [100, 200] })],
    marks: [{ id: "m1", kind: "centre-mark", on: { view: "v2", body: "base", kind: "edge", name: "f12:f0#2|f5", index: 9 } }],
    dimensions: [
      {
        id: "d1",
        view: "v1",
        kind: "linear",
        refs: [{ view: "v1", body: "base", kind: "edge", name: "f2|f4", index: 4 }],
        across: "x",
        at: [0, -30],
        auto: true,
      },
    ],
    auto: { recipe: "centre-baseline", datum: "bottom-left", density: 0.4 },
  }));
  return { doc, drawing: made.id, sheet };
}

describe("sheets", () => {
  it("has the A series and the US sizes, short side first, in millimetres", () => {
    expect(SHEET_SIZES.A4).toMatchObject({ w: 210, h: 297 });
    expect(SHEET_SIZES.A0).toMatchObject({ w: 841, h: 1189 });
    // 8.5 × 11 in and 34 × 44 in.
    expect(SHEET_SIZES.letter.w / 25.4).toBeCloseTo(8.5);
    expect(SHEET_SIZES.letter.h / 25.4).toBeCloseTo(11);
    expect(SHEET_SIZES.ansiE.w / 25.4).toBeCloseTo(34);
    expect(SHEET_SIZES.ansiE.h / 25.4).toBeCloseTo(44);
    for (const s of Object.values(SHEET_SIZES)) expect(s.w).toBeLessThan(s.h);
  });

  it("turns a sheet on its side for landscape", () => {
    expect(sheetBox({ size: "A3", landscape: true })).toEqual({ w: 420, h: 297 });
    expect(sheetBox({ size: "A3", landscape: false })).toEqual({ w: 297, h: 420 });
  });

  it("starts A sizes as ISO and US sizes as ASME, unless told otherwise", () => {
    for (const size of Object.keys(SHEET_SIZES) as SheetSize[]) expect(standardFor(size)).toBe(/^A\d$/.test(size) ? "iso" : "asme");
    expect(newSheet("Sheet 1", { size: "A3" }).standard).toBe("iso");
    expect(newSheet("Sheet 1", { size: "tabloid" }).standard).toBe("asme");
    expect(newSheet("Sheet 1", { size: "tabloid", standard: "iso" }).standard).toBe("iso");
  });

  it("picks the largest standard scale that fits, and names it", () => {
    expect(fitScale({ w: 100, h: 50 }, { w: 300, h: 200 })).toBe(2);
    expect(fitScale({ w: 400, h: 50 }, { w: 300, h: 200 })).toBe(0.5);
    expect(fitScale({ w: 300, h: 200 }, { w: 300, h: 200 })).toBe(1);
    expect([2, 1, 0.5, 0.2, 0.3].map(scaleLabel)).toEqual(["2:1", "1:1", "1:2", "1:5", "0.3:1"]);
  });

  it("knows the named view directions", () => {
    expect(frameOf("top")).toEqual({ toEye: [0, 0, 1], up: [0, 1, 0] });
    expect(frameOf({ toEye: [1, 2, 3], up: [0, 0, 1] })).toEqual({ toEye: [1, 2, 3], up: [0, 0, 1] });
  });
});

describe("drawings in a model", () => {
  it("adds a drawing with one landscape sheet, titled from the model", () => {
    const { doc, id } = addDrawing(newDoc("Bracket"), { author: "Kev", date: "2026-11-22" });
    expect(doc.drawings).toHaveLength(1);
    const d = doc.drawings![0]!;
    expect(d).toMatchObject({ id, name: "Drawing 1", decimals: 2 });
    expect(d.sheets[0]).toMatchObject({
      name: "Sheet 1",
      size: "A4",
      landscape: true,
      standard: "iso",
      border: true,
      scale: 1,
      title: { title: "Bracket", author: "Kev", date: "2026-11-22", revision: "A" },
      views: [],
      marks: [],
      dimensions: [],
    });
    // Nothing on the timeline: a drawing is not a step.
    expect(doc.features).toEqual([]);
    expect(addDrawing(doc).doc.drawings![1]!.name).toBe("Drawing 2");
  });

  it("leaves the author blank when nobody is signed in", () => {
    expect(addDrawing(newDoc()).doc.drawings![0]!.sheets[0]!.title.author).toBeUndefined();
  });

  it("renames and removes a drawing, and drops the list with the last one", () => {
    const { doc, id } = addDrawing(newDoc());
    expect(renameDrawing(doc, id, "  Plate  ").drawings![0]!.name).toBe("Plate");
    expect(renameDrawing(doc, id, " ")).toBe(doc);
    expect(renameDrawing(doc, "nope", "x")).toBe(doc);
    expect("drawings" in removeDrawing(doc, id)).toBe(false);
  });

  it("gives a view its own scale, its parent's, or the sheet's", () => {
    const sheet = drawn().doc.drawings![0]!.sheets[0]!;
    expect(viewScale(sheet, sheet.views[1]!)).toBe(0.5);
    const scaled: DrawingSheet = { ...sheet, views: [{ ...sheet.views[0]!, scale: 2 }, sheet.views[1]!] };
    expect(viewScale(scaled, scaled.views[1]!)).toBe(2);
    expect(viewScale(scaled, { ...scaled.views[1]!, scale: 5 })).toBe(5);
  });

  it("removes a view with what was fixed to it, and keeps its projected views as base views", () => {
    const sheet = drawn().doc.drawings![0]!.sheets[0]!;
    const without = removeView(sheet, "v1");
    expect(without.views).toEqual([{ ...view("v2", { direction: "top", at: [100, 200] }), kind: "base", scale: 0.5 }]);
    expect(without.dimensions).toEqual([]);
    expect(without.marks).toHaveLength(1);
    expect(removeView(sheet, "v2").marks).toEqual([]);
    expect(removeView(sheet, "nope")).toBe(sheet);
  });
});

describe("drawings in a .bcad file (#557)", () => {
  it("come back as they were saved", () => {
    const { doc } = drawn();
    const text = saveBcad(doc);
    const back = loadBcad(text);
    if (back instanceof BcadError) throw back;
    expect(back.doc).toEqual(doc);
    expect(back.warning).toBeUndefined();
    expect(validate(schema as never, JSON.parse(text), "")).toBeNull();
    // The same model writes the same document (the header's times move on).
    expect(JSON.stringify(JSON.parse(saveBcad(back.doc)).document)).toBe(JSON.stringify(JSON.parse(text).document));
  });

  it("are checked against the schema", () => {
    const file = JSON.parse(saveBcad(drawn().doc));
    file.document.drawings[0].sheets[0].size = "A5";
    expect(validate(schema as never, file, "")).toContain("document.drawings[0].sheets[0].size");
    const r = loadBcad(JSON.stringify(file));
    expect(r).toBeInstanceOf(BcadError);
  });

  it("are absent from every older file", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "testdata", "bcad");
    for (const f of ["schema0-parts.json", "schema0-timeline.bettercad.json", "schema1.bcad"]) {
      const r = loadBcad(readFileSync(join(dir, f), "utf8"));
      if (r instanceof BcadError) throw new Error(`${f}: ${r.message}`);
      expect(r.doc.drawings, f).toBeUndefined();
      expect(saveBcad(r.doc)).not.toContain("drawings");
    }
  });
});
