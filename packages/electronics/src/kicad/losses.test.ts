import { describe, expect, it } from "vitest";
import { boardTextLook, textStrokes } from "../fab/font";
import { gerberFiles } from "../fab/gerber";
import { addPicture, packInk, pictureRects } from "../pcb/picture";
import { addText, setText } from "../pcb/route";
import { sampleBoard } from "../sample";
import { kicadProject } from "./export";
import { importKicadProject } from "./project";

/** The board file of a design written out to KiCad. */
const pcbOf = (files: { name: string; text: string }[]) => files.find((f) => f.name.endsWith(".kicad_pcb"))!.text;

describe("small losses on the way to and from KiCad (#751)", () => {
  it("writes pictures on the silkscreen as filled shapes, a rectangle for each run of ink", () => {
    // A 4 by 2 picture: a bar along the top and a dot below its left end.
    const ink = [1, 1, 1, 0, 1, 0, 0, 0];
    const d = addPicture(sampleBoard(), { layer: "silk-top", x: 5, y: 30, w: 4, cols: 4, rows: 2, bits: packInk(ink, 4, 2) });
    const rects = pictureRects(d.board!.pictures![0]!);
    const files = kicadProject(d, "pic").files;
    const polys = pcbOf(files).match(/\(gr_poly[\s\S]*?\(layer "F\.SilkS"\)/g) ?? [];
    expect(polys.filter((p) => /\(fill solid\)/.test(p))).toHaveLength(rects.length);
    // They come back as filled silkscreen drawings in the same places.
    const back = importKicadProject(files, { licence: "CC0" }).design.board!;
    const filled = back.shapes.filter((s) => s.layer === "silk-top" && s.kind === "line" && s.fill);
    expect(filled).toHaveLength(rects.length);
    const boxes = filled.map((s) => (s.kind === "line" ? [Math.min(...s.pts.map((p) => p[0])), Math.min(...s.pts.map((p) => p[1]))] : []));
    for (const r of rects) expect(boxes.some(([x, y]) => Math.abs(x! - r.x1) < 1e-3 && Math.abs(y! - r.y1) < 1e-3)).toBe(true);
  });

  it("keeps text's letter width and mirror flag both ways, and draws them", () => {
    let d = addText(sampleBoard(), 10, 35, "WIDE", "silk-top", 1.5);
    const id = d.board!.texts.at(-1)!.id;
    d = setText(d, id, { width: 2, mirror: true });
    const t = d.board!.texts.at(-1)!;
    expect(boardTextLook(t)).toEqual({ angle: 0, mirror: true, stretch: 2 / 1.5 });
    // Mirrored, it runs to the left of its anchor; wider, it runs further.
    const xs = textStrokes(t.text, t.size * 0.72, [t.x, t.y], boardTextLook(t))
      .flat()
      .map((p) => p[0]);
    const plain = textStrokes(t.text, t.size * 0.72, [t.x, t.y])
      .flat()
      .map((p) => p[0]);
    expect(Math.max(...xs)).toBeLessThanOrEqual(t.x + 1e-6);
    expect(t.x - Math.min(...xs)).toBeCloseTo((Math.max(...plain) - t.x) * (2 / 1.5), 6);
    const silk = gerberFiles(d).find((f) => f.layer === "silk-top")!.text;
    expect(silk).not.toEqual(gerberFiles(addText(sampleBoard(), 10, 35, "WIDE", "silk-top", 1.5)).find((f) => f.layer === "silk-top")!.text);

    const files = kicadProject(d, "text").files;
    expect(pcbOf(files)).toMatch(/\(gr_text "WIDE"[\s\S]*?\(size 1\.5 2\)[\s\S]*?\(justify left bottom mirror\)/);
    const back = importKicadProject(files, { licence: "CC0" }).design.board!.texts.find((x) => x.text === "WIDE")!;
    expect(back).toMatchObject({ layer: "silk-top", x: 10, y: 35, size: 1.5, width: 2, mirror: true });
    // Text on the bottom reads mirrored as it always has, with nothing to say so.
    const under = importKicadProject(kicadProject(addText(sampleBoard(), 10, 35, "BACK", "silk-bottom", 1.5), "b").files, { licence: "CC0" });
    const b = under.design.board!.texts.find((x) => x.text === "BACK")!;
    expect(b.mirror).toBeUndefined();
    expect(b.width).toBeUndefined();
    expect(b).toMatchObject({ x: 10, y: 35 });
  });

  it("keeps a local label apart from a global label of the same name, and says so", () => {
    const files = kicadProject(sampleBoard(), "labels").files;
    const i = files.findIndex((f) => f.name.endsWith(".kicad_sch"));
    const add = [
      `(label "SPARE" (at 10 10 0) (effects (font (size 1.27 1.27))) (uuid "00000000-0000-0000-0000-00000000aaa1"))`,
      `(global_label "SPARE" (shape input) (at 30 10 0) (effects (font (size 1.27 1.27))) (uuid "00000000-0000-0000-0000-00000000aaa2"))`,
    ].join("\n");
    files[i] = { ...files[i]!, text: files[i]!.text.replace(/\)\s*$/, `${add}\n)`) };
    const got = importKicadProject(files, { licence: "CC0" });
    const names = got.design.sheets.flatMap((s) => s.labels.map((l) => l.name));
    expect(names).toContain("SPARE");
    expect(names).toContain("/SPARE");
    expect(got.notes.map((n) => n.why).join(" ")).toContain("A local label and a global label are both called SPARE");
  });
});
