import { describe, expect, it } from "vitest";
import { moveOnBoard, removeFromBoard } from "../edit";
import { gerberFiles, notesFile } from "../fab/gerber";
import { orderPack } from "../fab/pack";
import { readGerber } from "../fab/read";
import { kicadProject } from "../kicad/export";
import { importKicadProject } from "../kicad/project";
import type { BoardNote, ElectronicsDesign } from "../model";
import { sampleBoard } from "../sample";
import { addDimension, addNoteLine, addNoteText, dimensionParts, dimensionText, noteStrokes, offsetThrough, setNote } from "./notes";

type Dim = Extract<BoardNote, { kind: "dimension" }>;
const dim = (a: [number, number], b: [number, number], offset: number): Dim => ({ id: "d", kind: "dimension", a, b, offset });

/** The sample board with a dimension across its bottom, a line and a word. */
function noted(): ElectronicsDesign {
  let d = sampleBoard();
  d = addDimension(d, [0, 0], [50, 0], -4).design;
  d = addNoteLine(d, [
    [5, 45],
    [20, 45],
  ]).design;
  return addNoteText(d, 5, 47, "ENIG, 1.6 mm").design;
}

describe("notes on the board (#749)", () => {
  it("draws a dimension: two extension lines, its line with an arrow each end, and its length above it", () => {
    const parts = dimensionParts(dim([0, 0], [10, 0], 3));
    // Extension lines from just off each point to just past the line.
    expect(parts.lines[0]).toEqual([
      [0, 0.5],
      [0, 4],
    ]);
    expect(parts.lines[2]).toEqual([
      [0, 3],
      [10, 3],
    ]);
    expect(parts.lines).toHaveLength(7);
    expect(parts.text).toMatchObject({ x: 5, text: "10 mm", angle: 0 });
    expect(parts.text.y).toBeGreaterThan(3);
    expect(dimensionText(dim([0, 0], [3, 4], 0))).toBe("5 mm");
  });

  it("keeps a dimension's words the right way up whichever way it was drawn", () => {
    expect(dimensionParts(dim([10, 0], [0, 0], 3)).text.angle).toBe(0);
    expect(dimensionParts(dim([0, 0], [0, 10], 3)).text.angle).toBe(90);
    expect(dimensionParts(dim([0, 10], [0, 0], 3)).text.angle).toBe(90);
    // The offset that puts a dimension's line through a point, and the side it lands on.
    expect(offsetThrough([0, 0], [10, 0], [4, -2])).toBe(-2);
    expect(dimensionParts(dim([0, 0], [10, 0], -2)).lines[2]).toEqual([
      [0, -2],
      [10, -2],
    ]);
  });

  it("are added, changed, moved and deleted like the rest of the board", () => {
    let d = noted();
    const [a, line, words] = d.board!.notes!;
    expect([a!.kind, line!.kind, words!.kind]).toEqual(["dimension", "line", "text"]);
    d = setNote(d, a!.id, { offset: -6 });
    expect((d.board!.notes![0] as Dim).offset).toBe(-6);
    d = moveOnBoard(d, [a!.id, line!.id, words!.id], 1, 2);
    expect(d.board!.notes![0]).toMatchObject({ a: [1, 2], b: [51, 2] });
    expect(d.board!.notes![1]).toMatchObject({ pts: [[6, 47], [21, 47]] }); // prettier-ignore
    expect(d.board!.notes![2]).toMatchObject({ x: 6, y: 49 });
    expect(removeFromBoard(d, [line!.id]).board!.notes!.map((n) => n.kind)).toEqual(["dimension", "text"]);
    // Nothing to measure: no dimension.
    expect(addDimension(d, [1, 1], [1, 1], 2).design).toBe(d);
  });

  it("go in a notes file of their own, and never in copper or on the silkscreen", () => {
    const plain = sampleBoard();
    expect(notesFile(plain.board!)).toBeNull();
    const d = noted();
    expect(gerberFiles(d).map((f) => f.text)).toEqual(gerberFiles(plain).map((f) => f.text));
    const text = notesFile(d.board!)!;
    expect(text).toContain("%TF.FileFunction,OtherDrawing,Notes*%");
    const image = readGerber(text);
    const strokes = d.board!.notes!.flatMap((n) => noteStrokes(n).lines).reduce((k, l) => k + l.length - 1, 0);
    const drawn = image.ops.reduce((k, o) => k + (o.kind === "draw" ? o.pts.length - 1 : 0), 0);
    expect(drawn).toBeGreaterThanOrEqual(strokes);
    const pack = orderPack(d, "jlcpcb", "Noted")!;
    expect(pack.gerbers.find((g) => g.layer === "notes")).toMatchObject({ name: "Noted-Notes.gbr" });
    expect(orderPack(plain, "jlcpcb", "Plain")!.gerbers.some((g) => g.layer === "notes")).toBe(false);
  });

  it("go to KiCad on its drawings layer and come back the same", () => {
    const d = noted();
    const files = kicadProject(d, "trip").files;
    const pcb = files.find((f) => f.name.endsWith(".kicad_pcb"))!.text;
    expect(pcb).toMatch(/\(dimension\s+\(type aligned\)\s+\(layer "Dwgs\.User"\)/);
    expect(pcb).toMatch(/\(height 4\)/);
    const back = importKicadProject(files, { licence: "CC0" }).design.board!.notes!;
    const strip = (n: BoardNote) => ({ ...n, id: "" });
    for (const [i, kind] of (["dimension", "line", "text"] as const).entries())
      expect(strip(back.find((n) => n.kind === kind)!)).toEqual(strip(d.board!.notes![i]!));
  });

  it("come in from KiCad's fabrication and comment layers, and from orthogonal dimensions", () => {
    const files = kicadProject(sampleBoard(), "fab").files;
    const i = files.findIndex((f) => f.name.endsWith(".kicad_pcb"));
    const extra = [
      `(gr_rect (start 10 -10) (end 20 -5) (stroke (width 0.1) (type solid)) (fill none) (layer "F.Fab"))`,
      `(gr_text "Rev B" (at 30 -10) (layer "Cmts.User") (effects (font (size 1 1)) (justify left bottom)))`,
      `(dimension (type orthogonal) (layer "Dwgs.User") (pts (xy 0 0) (xy 10 -3)) (height -2) (orientation 0))`,
      `(dimension (type leader) (layer "Dwgs.User") (pts (xy 0 0) (xy 10 -3)))`,
    ].join("\n");
    files[i] = { ...files[i]!, text: files[i]!.text.replace(/\)\s*$/, `${extra}\n)`) };
    const got = importKicadProject(files, { licence: "CC0" });
    const notes = got.design.board!.notes!;
    expect(notes.map((n) => n.kind).sort()).toEqual(["dimension", "line", "text"]);
    expect((notes.find((n) => n.kind === "line") as Extract<BoardNote, { kind: "line" }>).pts).toHaveLength(5);
    expect(dimensionText(notes.find((n) => n.kind === "dimension") as Dim)).toBe("10 mm");
    expect(got.notes.map((n) => n.why).join(" ")).toContain("dimensions other than straight ones");
  });
});
