import { describe, expect, it } from "vitest";
import { newSheet, SHEET_SIZES, type DrawingSheet, type DrawingStandard, type SheetSize } from "@bettercad/kernel/drawing";
import { sheetLayout, sizeName, STRIP, today, type Box } from "./layout";

const SIZES = Object.keys(SHEET_SIZES) as SheetSize[];
const sheet = (o: Partial<DrawingSheet> = {}): DrawingSheet => ({ ...newSheet("Sheet 1", { size: "A3", title: "Bracket", date: "2026-11-22" }), ...o });
const inside = (b: Box, of: Box, slack = 1e-6) =>
  b.x >= of.x - slack && b.y >= of.y - slack && b.x + b.w <= of.x + of.w + slack && b.y + b.h <= of.y + of.h + slack;

describe("sheet layout", () => {
  for (const size of SIZES)
    for (const landscape of [true, false])
      for (const standard of ["iso", "asme"] as DrawingStandard[])
        it(`${size} ${landscape ? "landscape" : "portrait"} ${standard}: the frame, zones and title block sit inside the page`, () => {
          const l = sheetLayout(sheet({ size, landscape, standard }));
          const page = { x: 0, y: 0, ...l.page };
          expect(l.page.w > l.page.h).toBe(landscape);
          expect(inside(l.frame, page)).toBe(true);
          expect(inside(l.block, l.frame)).toBe(true);
          // The block is in the frame's bottom right corner.
          expect(l.block.x + l.block.w).toBeCloseTo(l.frame.x + l.frame.w);
          expect(l.block.y + l.block.h).toBeCloseTo(l.frame.y + l.frame.h);
          // Its cells tile it: all inside, and their areas add up to the block's.
          for (const c of l.cells) expect(inside(c, l.block)).toBe(true);
          expect(l.cells.reduce((s, c) => s + c.w * c.h, 0)).toBeCloseTo(l.block.w * l.block.h);
          for (const s of [...l.ticks, ...l.centring])
            for (const [x, y] of [
              [s.x1, s.y1],
              [s.x2, s.y2],
            ] as const) {
              expect(x).toBeGreaterThanOrEqual(0);
              expect(y).toBeGreaterThanOrEqual(0);
              expect(x).toBeLessThanOrEqual(l.page.w);
              expect(y).toBeLessThanOrEqual(l.page.h);
            }
          // Zone labels sit in the strip outside the frame, never on the drawing.
          for (const z of l.labels)
            expect(inside({ x: z.x, y: z.y, w: 0, h: 0 }, { x: l.frame.x + 0.1, y: l.frame.y + 0.1, w: l.frame.w - 0.2, h: l.frame.h - 0.2 })).toBe(false);
          expect(l.centring).toHaveLength(4);
        });

  it("an ISO sheet leaves 20 mm on the left for filing and 10 mm elsewhere; an ASME sheet half an inch all round", () => {
    expect(sheetLayout(sheet()).frame).toEqual({ x: 20, y: 10, w: 390, h: 277 });
    const us = sheetLayout(sheet({ size: "letter", standard: "asme" })).frame;
    expect([us.x, us.y]).toEqual([12.7, 12.7]);
    expect(us.w).toBeCloseTo(279.4 - 25.4);
  });

  it("numbers zones from the left and letters them from the top on ISO, the other way on ASME, skipping I and O", () => {
    const iso = sheetLayout(sheet());
    const top = iso.labels.filter((z) => z.y < iso.frame.y).sort((a, b) => a.x - b.x);
    expect(top.map((z) => z.text)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    const left = iso.labels.filter((z) => z.x < iso.frame.x).sort((a, b) => a.y - b.y);
    expect(left.map((z) => z.text)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(left[0]!.x).toBeCloseTo(iso.frame.x - STRIP / 2);
    const asme = sheetLayout(sheet({ standard: "asme" }));
    expect(
      asme.labels
        .filter((z) => z.y < asme.frame.y)
        .sort((a, b) => a.x - b.x)
        .map((z) => z.text)[0],
    ).toBe("8");
    expect(
      asme.labels
        .filter((z) => z.x < asme.frame.x)
        .sort((a, b) => a.y - b.y)
        .map((z) => z.text)
        .at(-1),
    ).toBe("A");
    const big = sheetLayout(sheet({ size: "A0" }));
    const letters = new Set(big.labels.filter((z) => z.x < big.frame.x).map((z) => z.text));
    expect(letters.has("I") || letters.has("O")).toBe(false);
  });

  it("an even number of zones each way, so the centring marks fall between two", () => {
    for (const size of SIZES) {
      const l = sheetLayout(sheet({ size }));
      expect(l.labels.filter((z) => z.y < l.frame.y).length % 2).toBe(0);
      expect(l.labels.filter((z) => z.x < l.frame.x).length % 2).toBe(0);
    }
  });

  it("draws no frame, zones or centring marks with the border off, and keeps the title block", () => {
    const l = sheetLayout(sheet({ border: false }));
    expect([l.border, l.ticks.length, l.labels.length, l.centring.length]).toEqual([false, 0, 0, 0]);
    expect(l.cells.length).toBeGreaterThan(0);
  });

  it("fills the title block in: what you typed, and the scale, size, sheet count and units worked out", () => {
    const l = sheetLayout(sheet({ scale: 0.5, title: { title: "Bracket", author: "Kev", date: "2026-11-22", revision: "B", number: "BC-001" } }), {
      index: 1,
      count: 2,
    });
    const value = (key: string) => l.cells.find((c) => c.key === key)!.value;
    expect(["title", "author", "date", "revision", "number", "scale", "size", "sheet", "units"].map(value)).toEqual([
      "Bracket",
      "Kev",
      "2026-11-22",
      "B",
      "BC-001",
      "1:2",
      "A3",
      "1/2",
      "mm",
    ]);
    expect(l.cells.filter((c) => c.edit).map((c) => c.key)).toEqual(["author", "approved", "type", "status", "title", "number", "revision", "date"]);
    expect(l.angle).toBe("first");
    expect(sheetLayout(sheet({ standard: "asme" })).angle).toBe("third");
  });

  it("the ISO block is 180 mm wide, which is the whole frame of an A4 sheet stood up", () => {
    const l = sheetLayout(sheet({ size: "A4", landscape: false }));
    expect(l.block.w).toBe(180);
    expect(l.block.x).toBeCloseTo(l.frame.x);
  });

  it("shrinks a long title until it fits its cell", () => {
    const short = sheetLayout(sheet()).cells.find((c) => c.key === "title")!;
    const long = sheetLayout(sheet({ title: { title: "Left hand motor mount bracket for the six wheeled rover, second version" } })).cells.find(
      (c) => c.key === "title",
    )!;
    expect(long.size).toBeLessThan(short.size);
    expect(long.value.length * long.size * 0.62).toBeLessThanOrEqual(long.w);
  });

  it("names sizes the short way and writes today as the standard does", () => {
    expect(SIZES.map(sizeName)).toEqual(["A4", "A3", "A2", "A1", "A0", "Letter", "Legal", "Tabloid", "C", "D", "E"]);
    expect(today(new Date(2026, 10, 2))).toBe("2026-11-02");
  });
});
