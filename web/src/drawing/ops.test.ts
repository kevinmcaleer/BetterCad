import { beforeEach, describe, expect, it } from "vitest";
import { newDoc } from "../state/document";
import { drawingChange, makeDrawing, sheetChange, titleChange } from "./ops";
import { FIRST_PICK, lastSheet, rememberSheet } from "./prefs";

beforeEach(() => localStorage.clear());

describe("drawing changes", () => {
  it("makes a drawing from the card's choice, titled, dated and signed", () => {
    const made = makeDrawing({ ...newDoc(), name: "Rover" }, { size: "A3", landscape: false, border: true, standard: "iso" }, "Kev");
    const d = made.doc.drawings![0]!;
    expect(d.id).toBe(made.id);
    expect(d.name).toBe("Drawing 1");
    const s = d.sheets[0]!;
    expect([s.size, s.landscape, s.standard, s.border]).toEqual(["A3", false, "iso", true]);
    expect(s.title).toMatchObject({ title: "Rover", author: "Kev", revision: "A", type: "Part drawing" });
    expect(s.title.date).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  it("remembers the page for next time, and the standard only when you picked against the page size", () => {
    expect(lastSheet()).toEqual(FIRST_PICK);
    makeDrawing(newDoc(), { size: "tabloid", landscape: true, border: false, standard: "asme" });
    expect(lastSheet()).toEqual({ size: "tabloid", landscape: true, border: false });
    makeDrawing(newDoc(), { size: "A2", landscape: true, border: true, standard: "asme" });
    expect(lastSheet()).toEqual({ size: "A2", landscape: true, border: true, standard: "asme" });
  });

  it("falls back to A4 landscape when what was remembered is not a page", () => {
    localStorage.setItem("bettercad.sheet", '{"size":"B5"}');
    expect(lastSheet()).toEqual(FIRST_PICK);
    localStorage.setItem("bettercad.sheet", "not json");
    expect(lastSheet()).toEqual(FIRST_PICK);
    rememberSheet({ size: "letter", landscape: false, border: true });
    expect(lastSheet().size).toBe("letter");
  });

  it("changes the sheet, a title block field, the name, and deletes", () => {
    const made = makeDrawing(newDoc(), { size: "A4", landscape: true, border: true, standard: "iso" });
    const id = made.id;
    let doc = made.doc;
    const now = () => doc.drawings!.find((d) => d.id === id)!;
    const run = ([fn]: [(d: typeof doc) => typeof doc, string]) => (doc = fn(doc));

    run(sheetChange(now(), { size: "ansiC", landscape: false, border: false, standard: "asme", scale: 0.5, title: { title: "Arm" } }));
    expect(now().sheets[0]).toMatchObject({ size: "ansiC", landscape: false, border: false, standard: "asme", scale: 0.5, title: { title: "Arm" } });

    run(titleChange(now(), "number", "BC-001"));
    expect(now().sheets[0]!.title).toEqual({ title: "Arm", number: "BC-001" });
    run(titleChange(now(), "title", ""));
    expect(now().sheets[0]!.title).toEqual({ number: "BC-001" });

    expect(drawingChange(id, "rename", "Arm drawing")[1]).toBe("Rename drawing");
    run(drawingChange(id, "rename", "Arm drawing"));
    expect(now().name).toBe("Arm drawing");
    run(drawingChange(id, "delete"));
    expect(doc.drawings).toBeUndefined();
  });
});
