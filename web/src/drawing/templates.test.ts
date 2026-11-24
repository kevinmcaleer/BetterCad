import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type TitleLogo } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import { newDoc, type ModelDoc } from "../state/document";
import { pdfContent, jpegBytes, pagesPdf } from "./export/pdf";
import { sheetScene } from "./export/scene";
import { sceneSvg } from "./export/svg";
import { sheetLayout } from "./layout";
import { makeDrawing, sheetChange, startDrawing } from "./ops";
import { carried, defaultTemplate, loadLocal, logoSize, merge, readFields, readTemplate, saveLocal, type DrawingTemplate } from "./templates";
import type { ViewCall } from "./useModelViews";

beforeEach(() => localStorage.clear());

// The smallest thing that reads as a JPEG data URL: the bytes FF D8 FF D9.
const logo: TitleLogo = { data: "data:image/jpeg;base64,/9j/2Q==", w: 300, h: 100 };
const workshop: DrawingTemplate = {
  id: "dt_1",
  name: "Workshop A3",
  size: "A3",
  landscape: true,
  standard: "iso",
  border: true,
  title: { approved: "Kev", type: "Robot part" },
  logo,
  fields: [{ label: "Material", value: "PETG" }],
  views: "four",
};

describe("drawing templates", () => {
  it("reads a stored template, and turns away what isn't one", () => {
    expect(readTemplate(workshop)).toEqual(workshop);
    expect(readTemplate({ ...workshop, size: "B5" })).toBeNull();
    expect(readTemplate({ ...workshop, name: " " })).toBeNull();
    expect(readTemplate(null)).toBeNull();
    // What it doesn't say starts as a new drawing does, and a logo that isn't a JPEG is left out.
    const bare = readTemplate({ id: "x", name: "Letter", size: "letter", logo: { data: "data:image/png;base64,AAAA", w: 1, h: 1 } })!;
    expect(bare).toEqual({ id: "x", name: "Letter", size: "letter", landscape: true, standard: "asme", border: true, title: {}, views: "none" });
  });

  it("carries the title block over without the title and the date", () => {
    expect(carried({ title: "Bracket", date: "2026-11-23", author: " Kev ", revision: "B", status: "" })).toEqual({ author: "Kev", revision: "B" });
  });

  it("keeps fields that say something, eight at most", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `F${i}`, value: "" }));
    expect(readFields([{ label: " ", value: "" }, ...many])).toHaveLength(8);
    expect(readFields("no")).toEqual([]);
  });

  it("stays in this browser between visits", () => {
    saveLocal([workshop]);
    expect(loadLocal()).toEqual([workshop]);
    localStorage.setItem("bettercad.drawingTemplates", "not json");
    expect(loadLocal()).toEqual([]);
  });

  it("merges the account's with this browser's: the account's copy and the account's default win", () => {
    const here = [
      { ...workshop, name: "Old name", default: true as const },
      { ...workshop, id: "dt_2", name: "Mine" },
    ];
    const there = [workshop, { ...workshop, id: "dt_3", name: "Theirs", default: true as const }];
    const all = merge(here, there);
    expect(all.map((t) => t.name)).toEqual(["Workshop A3", "Mine", "Theirs"]);
    expect(defaultTemplate(all)?.id).toBe("dt_3");
    expect(all.filter((t) => t.default)).toHaveLength(1);
    // With none in the account, this browser's default stands.
    expect(defaultTemplate(merge(here, [workshop]))?.id).toBe("dt_1");
  });

  it("brings a big picture down to 480 pixels, and leaves a small one alone", () => {
    expect(logoSize(1920, 960)).toEqual({ w: 480, h: 240 });
    expect(logoSize(200, 900)).toEqual({ w: 107, h: 480 });
    expect(logoSize(120, 40)).toEqual({ w: 120, h: 40 });
  });
});

describe("a title block of your own", () => {
  const sheet = { ...newSheet("Sheet 1", { size: "A3", title: "Bracket" }), id: "s1" };
  const plain = sheetLayout(sheet);

  it("puts the logo and your fields in a row above the standard's, and the block grows to hold them", () => {
    const l = sheetLayout(sheet, {
      logo,
      fields: [
        { label: "Material", value: "PETG" },
        { label: "", value: "" },
        { label: "Finish", value: "As printed" },
      ],
    });
    expect(l.block.h).toBe(plain.block.h + 16);
    expect(l.block.y).toBe(plain.block.y - 16);
    const own = l.cells.slice(0, 3);
    expect(own.map((c) => [c.key, c.label, c.value])).toEqual([
      ["logo", "Logo", ""],
      ["field-0", "Material", "PETG"],
      ["field-1", "Finish", "As printed"],
    ]);
    // Four to a row; the last cell of a short row takes what is left.
    expect(own.map((c) => c.w)).toEqual([45, 45, 90]);
    expect(own.every((c) => c.y === l.block.y && c.h === 16)).toBe(true);
    // The picture keeps its 3:1 shape inside its cell.
    const box = own[0]!.image!.box;
    expect(box.w / box.h).toBeCloseTo(3);
    expect(box.h).toBeCloseTo(14);
    // The standard's cells sit where they did.
    expect(l.cells.slice(3)).toEqual(plain.cells);
  });

  it("starts a second row after four, and takes no room with nothing to show", () => {
    const fields = Array.from({ length: 6 }, (_, i) => ({ label: `F${i}`, value: String(i) }));
    const l = sheetLayout(sheet, { fields });
    expect(l.block.h).toBe(plain.block.h + 24);
    expect(l.cells.filter((c) => c.key.startsWith("field-")).map((c) => c.y - l.block.y)).toEqual([0, 0, 0, 0, 12, 12]);
    expect(sheetLayout(sheet, { fields: [{ label: " ", value: "" }] }).block).toEqual(plain.block);
  });

  it("exports the logo: an image in SVG, a JPEG as it is in PDF, once for every sheet that shows it", () => {
    const l = sheetLayout(sheet, { logo, fields: [{ label: "Material", value: "PETG" }] });
    const scene = sheetScene(sheet, l, () => undefined, 2, {});
    expect(scene.images).toHaveLength(1);
    expect(scene.labels.map((x) => x.text)).toEqual(expect.arrayContaining(["Material", "PETG"]));
    expect(scene.labels.map((x) => x.text)).not.toContain("Logo");
    expect(sceneSvg(scene)).toContain(`<image href="${logo.data}"`);
    expect(pdfContent(scene, [])).toMatch(/ cm \/Im0 Do Q/);
    expect([...jpegBytes(logo.data)!]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect(jpegBytes("data:image/png;base64,AAAA")).toBeUndefined();
    const pdf = new TextDecoder("latin1").decode(
      pagesPdf([
        { scene, outlines: [] },
        { scene, outlines: [] },
      ]),
    );
    expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(1);
    expect(pdf).toContain("/Width 300 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 4");
    expect(pdf.match(/\/XObject << \/Im0 7 0 R >>/g)).toHaveLength(2);
    // Without a logo a page's resources stay empty.
    expect(sheetScene(sheet, plain, () => undefined, 2, {}).images).toBeUndefined();
  });
});

describe("new drawings and sheet settings", () => {
  const edge = { curve: { kind: "line", a: [0, 0], b: [60, 0] }, visible: true, type: "sharp" };
  const box = { edges: [edge], box: { min: [0, 0], max: [60, 40] }, rounds: [], bodies: ["b1"], ms: 1 } as unknown as ModelView;
  const store = (doc: ModelDoc) => {
    let now = doc;
    return { get: () => now, edit: (change: (d: ModelDoc) => ModelDoc) => void (now = change(now)) };
  };
  const pick = { size: "A3", landscape: true, border: true, standard: "iso" } as const;

  it("a drawing from a template starts with its title block, logo and fields; a Created by you typed stands", () => {
    const made = makeDrawing(
      { ...newDoc(), name: "Rover" },
      { ...pick, block: { approved: "Kev", type: "Robot part" }, logo, fields: workshop.fields },
      "Account",
    );
    const d = made.doc.drawings![0]!;
    expect(d.sheets[0]!.title).toMatchObject({ title: "Rover", author: "Account", approved: "Kev", type: "Robot part", revision: "A" });
    expect([d.logo, d.fields]).toEqual([logo, workshop.fields]);
    const signed = makeDrawing(newDoc(), { ...pick, block: { author: "K. McAleer" } }, "Account");
    expect(signed.doc.drawings![0]!.sheets[0]!.title.author).toBe("K. McAleer");
  });

  it("First views lays four views of the whole model on the new sheet, in one step", async () => {
    const s = store({ ...newDoc(), name: "Rover" });
    const call = vi.fn<ViewCall>(() => Promise.resolve(box));
    const id = await startDrawing(s, { ...pick, views: "four" }, "Kev", call, 3);
    const d = s.get().drawings!.find((x) => x.id === id)!;
    expect(d.sheets[0]!.views.map((v) => v.kind)).toEqual(["base", "projected", "projected", "projected"]);
    expect(d.sheets[0]!.views[0]).toMatchObject({ shows: { all: true }, direction: "front" });
    expect(call).toHaveBeenCalledTimes(4);
    expect(call.mock.calls[0]![0]).toMatchObject({ upTo: 3 });
    // The kernel is asked about the model, not its drawings.
    expect(call.mock.calls[0]![0].doc.drawings).toBeUndefined();
  });

  it("starts with an empty sheet when there is nothing to draw, the kernel fails, or no views were asked for", async () => {
    const empty = { ...box, edges: [], bodies: [], box: { min: [0, 0], max: [0, 0] } } as unknown as ModelView;
    for (const call of [vi.fn<ViewCall>(() => Promise.resolve(empty)), vi.fn<ViewCall>(() => Promise.reject(new Error("no"))), vi.fn<ViewCall>(() => null)]) {
      const s = store(newDoc());
      await startDrawing(s, { ...pick, views: "four" }, undefined, call);
      expect(s.get().drawings![0]!.sheets[0]!.views).toEqual([]);
    }
    const s = store(newDoc());
    const call = vi.fn<ViewCall>(() => Promise.resolve(box));
    await startDrawing(s, pick, undefined, call);
    expect(call).not.toHaveBeenCalled();
    expect(s.get().drawings).toHaveLength(1);
  });

  it("Sheet settings puts the logo and fields on the drawing, and takes them off again", () => {
    const made = makeDrawing(newDoc(), pick);
    const of = (doc: ModelDoc): Drawing => doc.drawings![0]!;
    const title = of(made.doc).sheets[0]!.title;
    const fields = [{ label: "Material", value: "PETG" }];
    const [put] = sheetChange(of(made.doc), { ...pick, title, logo, fields });
    const withBoth = put(made.doc);
    expect([of(withBoth).logo, of(withBoth).fields]).toEqual([logo, fields]);
    const [off] = sheetChange(of(withBoth), { ...pick, title });
    const bare = of(off(withBoth));
    expect("logo" in bare || "fields" in bare).toBe(false);
  });
});
