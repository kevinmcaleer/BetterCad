import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parse } from "opentype.js";
import { describe, expect, it } from "vitest";
import { newSheet, type DrawingSheet } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import { adapt } from "../../sketch/text/glyphs";
import { sheetLayout } from "../layout";
import { pixels, printPage } from "./browser";
import { sceneDxf } from "./dxf";
import { outline, outlines } from "./outline";
import { deflated, pdfContent, scenePdf } from "./pdf";
import { cubics, placed, roundAt, roundOf, sheetScene, viewScene } from "./scene";
import { sceneSvg } from "./svg";

const require = createRequire(import.meta.url);
const file = readFileSync(require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff"));
const inter = adapt(parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));

/** A plate with one of every kind of curve: an outline, a hole, a rounded corner, a slanted hole and a traced edge. */
const plate: ModelView = {
  edges: [
    { curve: { kind: "line", a: [0, 0], b: [40, 0] }, visible: true, type: "sharp" },
    { curve: { kind: "line", a: [40, 0], b: [40, 15] }, visible: true, type: "sharp" },
    { curve: { kind: "arc", c: [35, 15], r: 5, from: 0, to: Math.PI / 2 }, visible: true, type: "sharp" },
    { curve: { kind: "line", a: [35, 20], b: [0, 20] }, visible: true, type: "sharp" },
    { curve: { kind: "line", a: [0, 20], b: [0, 0] }, visible: true, type: "sharp" },
    { curve: { kind: "circle", c: [10, 10], r: 4 }, visible: true, type: "sharp" },
    { curve: { kind: "ellipse", c: [24, 10], rx: 5, ry: 3, turn: Math.PI / 6 }, visible: true, type: "sharp" },
    {
      curve: {
        kind: "poly",
        pts: [
          [2, 2],
          [4, 3],
          [6, 2],
        ],
      },
      visible: true,
      type: "outline",
    },
    { curve: { kind: "line", a: [0, 14], b: [40, 14] }, visible: false, type: "sharp" },
    { curve: { kind: "ellipse", c: [24, 10], rx: 2, ry: 1, turn: 0, from: 0, to: Math.PI }, visible: false, type: "sharp" },
  ],
  box: { min: [0, 0], max: [40, 20] },
  rounds: [],
  bodies: ["b1"],
  ms: 1,
};
const sheet: DrawingSheet = {
  ...newSheet("Sheet 1", { size: "A4", title: "Plate (A & B)", author: "Kev", date: "2026-11-22" }),
  id: "sh1",
  scale: 2,
  title: { title: "Plate (A & B)", author: "Kev", date: "2026-11-22", revision: "B", number: "BC-001", type: "Part drawing" },
  views: [
    { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [110, 140] },
    { id: "v2", kind: "base", shows: { all: true }, direction: "top", hidden: true, tangent: false, scale: 1, at: [220, 150] },
  ],
};
const layout = sheetLayout(sheet);
const scene = sheetScene(sheet, layout, () => plate);
const text = outlines(scene.labels, inter);
const golden = (name: string) => `./golden/${name}`;

describe("the scene", () => {
  it("is the page in millimetres from its bottom left corner, with each view's lines at its scale", () => {
    expect([scene.w, scene.h]).toEqual([297, 210]);
    const visible = scene.strokes.filter((s) => s.layer === "visible");
    // The first view is at 2:1 about (110, 140): its bottom edge runs 80 mm, 20 mm below the middle.
    expect(visible[0]).toEqual({ layer: "visible", width: 0.5, curve: { kind: "line", a: [70, 120], b: [150, 120] } });
    expect(visible.find((s) => s.curve.kind === "circle")!.curve).toEqual({ kind: "circle", c: [90, 140], r: 8 });
    // The second keeps its own 1:1, and says so underneath.
    expect(visible.filter((s) => s.curve.kind === "circle")[1]!.curve).toEqual({ kind: "circle", c: [210, 150], r: 4 });
    expect(scene.labels.find((l) => l.text === "Scale 1:1")).toMatchObject({ at: [220, 133.5], anchor: "middle", baseline: "alphabetic" });
    const hidden = scene.strokes.filter((s) => s.layer === "hidden");
    expect(hidden).toHaveLength(4);
    expect(hidden[0]).toMatchObject({ width: 0.25, dash: [2, 1] });
  });

  it("has the frame, the title block and what is typed in it", () => {
    const frame = scene.strokes.find((s) => s.layer === "border" && s.curve.kind === "poly")!;
    expect(frame.width).toBe(0.7);
    expect((frame.curve as { pts: number[][] }).pts.slice(0, 3)).toEqual([
      [20, 10],
      [287, 10],
      [287, 200],
    ]);
    const said = scene.labels.filter((l) => l.layer === "title").map((l) => l.text);
    for (const t of ["Title", "Plate (A & B)", "Kev", "BC-001", "B", "2:1", "A4", "1/1", "mm"]) expect(said).toContain(t);
    // First angle: the cone on the left of its cell, the two circles on the right.
    expect(scene.strokes.filter((s) => s.layer === "title" && s.curve.kind === "circle")).toHaveLength(2);
  });

  it("leaves the border out when the sheet has none, and a view out until it has a picture", () => {
    const bare = sheetScene({ ...sheet, border: false }, sheetLayout({ ...sheet, border: false }), (id) => (id === "v1" ? plate : undefined));
    expect(bare.strokes.some((s) => s.layer === "border")).toBe(false);
    expect(bare.strokes.filter((s) => s.curve.kind === "circle" && s.layer === "visible")).toHaveLength(1);
  });

  it("one view on its own is at full size from its corner, without hidden edges unless asked", () => {
    const one = viewScene({ ...plate, box: { min: [-5, -5], max: [35, 15] } }, false);
    expect([one.w, one.h]).toEqual([40, 20]);
    expect(one.strokes.every((s) => s.layer === "visible")).toBe(true);
    expect(one.strokes[0]!.curve).toEqual({ kind: "line", a: [5, 5], b: [45, 5] });
    expect(viewScene(plate, true).strokes.filter((s) => s.layer === "hidden")).toHaveLength(2);
  });

  describe("view styles", () => {
    const styled = (style: "shaded" | "rendered" | "wireframe") => ({ ...sheet, views: [{ ...sheet.views[0]!, style }] });
    const pic = { data: "data:image/jpeg;base64,AA==", px: { w: 640, h: 320 } };
    const v1 = (s: { strokes: { layer: string; curve: { kind: string } }[] }) => s.strokes.filter((x) => x.layer === "visible" || x.layer === "hidden");

    it("puts a shaded view's picture over its box, under the edges you see, with no hidden ones", () => {
      const s = sheetScene(styled("shaded"), layout, () => plate, undefined, { pictures: () => pic });
      // At 2:1 about (110, 140): 80 by 40 mm from (70, 120).
      expect(s.images).toEqual([{ data: pic.data, px: pic.px, at: [70, 120], w: 80, h: 40 }]);
      expect(v1(s).every((x) => x.layer === "visible")).toBe(true);
      expect(v1(s)).toHaveLength(8);
    });

    it("draws a rendered view as its picture alone", () => {
      const s = sheetScene(styled("rendered"), layout, () => plate, undefined, { pictures: () => pic });
      expect(s.images).toHaveLength(1);
      expect(v1(s)).toHaveLength(0);
    });

    it("draws every edge of a wireframe solid", () => {
      const s = sheetScene(styled("wireframe"), layout, () => plate);
      expect(v1(s)).toHaveLength(10);
      expect(v1(s).every((x) => x.layer === "visible")).toBe(true);
    });

    it("falls back to line art with no picture, as DXF asks, or when the view has breaks", () => {
      const lines = (sh: DrawingSheet, pictures?: () => typeof pic) => v1(sheetScene(sh, layout, () => plate, undefined, { pictures })).length;
      expect(lines(styled("rendered"))).toBe(10);
      const broken = { ...sheet, views: [{ ...sheet.views[0]!, style: "shaded" as const, breaks: [{ axis: "x" as const, from: 10, to: 20 }] }] };
      expect(lines(broken, () => pic)).toBe(10);
    });
  });

  it("turns round curves into Béziers that stay on the curve", () => {
    const r = roundOf({ kind: "ellipse", c: [0, 0], rx: 5, ry: 3, turn: 0.5 });
    const { start, pieces } = cubics(r);
    expect(pieces).toHaveLength(4);
    expect(pieces[3]![2][0]).toBeCloseTo(start[0]);
    // The middle of each piece is within a hundredth of a millimetre of the true ellipse.
    pieces.forEach((b, i) => {
      const from = i ? pieces[i - 1]![2] : start;
      const mid = [0, 1].map((k) => (from[k]! + 3 * b[0][k]! + 3 * b[1][k]! + b[2][k]!) / 8);
      const truth = roundAt(r, (i + 0.5) * (Math.PI / 2)).p;
      expect(Math.hypot(mid[0]! - truth[0], mid[1]! - truth[1])).toBeLessThan(0.01);
    });
    expect(cubics(roundOf({ kind: "arc", c: [0, 0], r: 1, from: 0, to: Math.PI / 2 })).pieces).toHaveLength(1);
    expect(placed({ kind: "arc", c: [1, 2], r: 3, from: 0.1, to: 0.2 }, 2, 10, 20)).toEqual({ kind: "arc", c: [12, 24], r: 6, from: 0.1, to: 0.2 });
  });
});

describe("text as outlines", () => {
  it("centres a label on its anchor and sits it about its middle", () => {
    const cmds = outline({ layer: "title", at: [100, 50], size: 5, anchor: "middle", baseline: "central", text: "HH" }, inter);
    const xs = cmds.flatMap((c) => ("x" in c ? [c.x] : []));
    const ys = cmds.flatMap((c) => ("y" in c ? [c.y] : []));
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(100, 1);
    // Capitals of a 5 mm font stand about 3.6 mm, a little above the middle of the letters' box.
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3.6, 0);
    expect(Math.min(...ys)).toBeGreaterThan(47.5);
    expect(Math.max(...ys)).toBeLessThan(52.5);
    expect(outline({ layer: "title", at: [0, 0], size: 5, anchor: "start", baseline: "alphabetic", text: " " }, inter)).toEqual([]);
  });
});

describe("SVG", () => {
  it("matches the golden file", async () => {
    await expect(sceneSvg(scene)).toMatchFileSnapshot(golden("plate.svg"));
  });

  it("is the page in millimetres, black on white, with text as text", () => {
    const svg = sceneSvg(scene);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="297mm" height="210mm" viewBox="0 0 297 210">/);
    expect(svg).toContain('<rect width="297" height="210" fill="white"/>');
    expect(svg).toContain('stroke="black"');
    expect(svg).toContain(">Plate (A &amp; B)</text>");
    expect(svg).toMatch(/<path class="hidden" stroke-width="0.25" stroke-dasharray="2 1"/);
    // y runs down an SVG page: the first view's bottom edge is 120 mm up, so 90 mm down.
    expect(svg).toContain("M70 90L150 90");
  });

  it("can carry its text as outlines, at a size in pixels, for a picture", () => {
    const svg = sceneSvg(scene, { outlines: text, pixels: { w: 1754, h: 1240 } });
    expect(svg).toContain('width="1754" height="1240" viewBox="0 0 297 210"');
    expect(svg).not.toContain("<text");
    expect(svg).toMatch(/<path class="text" fill="black" d="M/);
  });
});

describe("PDF", () => {
  const pdf = new TextDecoder().decode(scenePdf(scene, text, { title: "Plate (A & B) rev B", author: "Kev" }));

  it("matches the golden file", async () => {
    await expect(pdf).toMatchFileSnapshot(golden("plate.pdf"));
  });

  it("has one page the sheet's exact size, to a tenth of a millimetre", () => {
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)!;
    expect(Math.abs((Number(box[1]) / 72) * 25.4 - 297)).toBeLessThan(0.1);
    expect(Math.abs((Number(box[2]) / 72) * 25.4 - 210)).toBeLessThan(0.1);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(pdf).toContain("/Title (Plate \\(A & B\\) rev B)");
  });

  it("is a file a reader can walk: every object where the table says, and the stream as long as it says", () => {
    const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const length = Number(/\/Length (\d+)/.exec(pdf)![1]);
    const start = pdf.indexOf("stream\n") + 7;
    expect(pdf.slice(start + length, start + length + 9)).toBe("endstream");
  });

  it("draws in millimetres at paper line widths, with text filled as outlines and no fonts", () => {
    const content = pdfContent(scene, text);
    expect(content.startsWith("q 2.835 0 0 2.835 0 0 cm\n")).toBe(true);
    expect(content).toContain("0.5 w 1 J [] 0 d\n70 120 m 150 120 l S");
    expect(content).toContain("0.25 w 0 J [2 1] 0 d");
    expect(content).toMatch(/ c h? ?.* f\nQ\n$/s);
    expect(pdf).not.toContain("/Font");
  });
});

describe("PDF, squeezed", () => {
  it("is the same page in about a fifth of the bytes, and still where its table says", async () => {
    const packed = await deflated(pdfContent(scene, text));
    const small = scenePdf(scene, text, {}, packed);
    expect(small.length).toBeLessThan(scenePdf(scene, text).length / 2);
    const s = new TextDecoder("latin1").decode(small);
    expect(s).toContain(`/Length ${packed!.length} /Filter /FlateDecode`);
    const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const start = s.indexOf("stream\n") + 7;
    expect(s.slice(start + packed!.length, start + packed!.length + 10)).toBe("\nendstream");
  });
});

describe("DXF", () => {
  const dxf = sceneDxf(scene);
  const pairs = dxf.split("\r\n");
  const on = (layer: string, type: string) => pairs.filter((v, i) => v === type && pairs[i - 1] === "  0" && pairs[i + 2] === layer).length;

  it("matches the golden file", async () => {
    await expect(dxf).toMatchFileSnapshot(golden("plate.dxf"));
  });

  it("puts everything on its layer, with hidden lines dashed", () => {
    for (const name of ["VISIBLE", "HIDDEN", "CENTRE", "DIMENSIONS", "BORDER", "TITLE"]) expect(dxf).toContain(`  2\r\n${name}\r\n 70\r\n0\r\n 62`);
    expect(dxf).toContain("  2\r\nHIDDEN\r\n 70\r\n0\r\n 62\r\n8\r\n  6\r\nHIDDEN\r\n");
    expect(on("VISIBLE", "LINE")).toBe(8);
    expect(on("VISIBLE", "CIRCLE")).toBe(2);
    expect(on("VISIBLE", "ARC")).toBe(2);
    expect(on("HIDDEN", "LINE")).toBe(2);
    // Ellipses and traced edges are polylines: two whole ellipses, two traced edges, and two half ellipses behind.
    expect(on("VISIBLE", "POLYLINE")).toBe(4);
    expect(on("HIDDEN", "POLYLINE")).toBe(2);
    expect(on("TITLE", "TEXT")).toBeGreaterThan(15);
    expect(on("BORDER", "LINE")).toBeGreaterThan(10);
  });

  it("is in millimetres at paper scale, y up", () => {
    expect(dxf).toContain("$INSUNITS\r\n 70\r\n4\r\n");
    expect(dxf).toContain("$EXTMAX\r\n 10\r\n297\r\n 20\r\n210\r\n");
    expect(dxf).toContain("LINE\r\n  8\r\nVISIBLE\r\n 10\r\n70\r\n 20\r\n120\r\n 30\r\n0\r\n 11\r\n150\r\n 21\r\n120\r\n");
    expect(dxf).toContain("ARC\r\n  8\r\nVISIBLE\r\n 10\r\n140\r\n 20\r\n150\r\n 30\r\n0\r\n 40\r\n10\r\n 50\r\n0\r\n 51\r\n90\r\n");
  });

  it("one view at full size has only its lines", () => {
    const one = sceneDxf(viewScene(plate, false));
    expect(one).toContain("$EXTMAX\r\n 10\r\n40\r\n 20\r\n20\r\n");
    expect(one).not.toContain("TEXT");
    expect(one).toContain("CIRCLE\r\n  8\r\nVISIBLE\r\n 10\r\n10\r\n 20\r\n10\r\n 30\r\n0\r\n 40\r\n4\r\n");
  });
});

describe("PNG and print", () => {
  it("sizes a picture from the page and the dots per inch", () => {
    expect(pixels({ w: 297, h: 210 }, 150)).toEqual({ w: 1754, h: 1240 });
    expect(pixels({ w: 297, h: 210 }, 300)).toEqual({ w: 3508, h: 2480 });
    expect(pixels({ w: 215.9, h: 279.4 }, 300)).toEqual({ w: 2550, h: 3300 });
  });

  it("prints the sheet alone at its own size with no margins", () => {
    const page = printPage("<svg/>", { w: 297, h: 210 }, "Plate <B>");
    expect(page).toContain("@page{size:297mm 210mm;margin:0}");
    expect(page).toContain("<title>Plate &lt;B></title>");
    expect(page).toContain("<body><svg/></body>");
  });
});
