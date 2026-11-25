import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { moveOnBoard, removeFromBoard } from "../edit";
import { fabBoard } from "../fab/fixture";
import { gerberFiles } from "../fab/gerber";
import { inkAt, readGerber } from "../fab/read";
import type { BoardPicture, P2 } from "../model";
import { copperOf } from "./copper";
import { checkBoard } from "./drc";
import { addPicture, inkFromPixels, invertInk, packInk, pictureHeight, pictureRects, setPicture } from "./picture";
import { addText } from "./route";

// A 4 by 2 picture: the top row inked on its left half, the bottom row inked right across.
const bits = packInk([1, 1, 0, 0, 1, 1, 1, 1], 4, 2);
const pic = (over: Partial<BoardPicture> = {}): BoardPicture => ({ id: "pi1", layer: "silk-top", x: 10, y: 5, w: 4, cols: 4, rows: 2, bits, ...over });

describe("pictures on the silkscreen", () => {
  it("keeps ink a bit a cell, each row starting a new byte", () => {
    expect(bits).toBe(btoa(String.fromCharCode(0b11000000, 0b11110000)));
    expect(pictureHeight(pic())).toBe(2);
  });

  it("gives the ink as rectangles, rows from the top", () => {
    expect(pictureRects(pic())).toEqual([
      { x1: 10, y1: 6, x2: 12, y2: 7 },
      { x1: 10, y1: 5, x2: 14, y2: 6 },
    ]);
    // Twice as wide: every cell is 2 mm.
    expect(pictureRects(pic({ w: 8 }))[0]).toEqual({ x1: 10, y1: 7, x2: 14, y2: 9 });
  });

  it("flips a picture on the bottom left to right, so it reads from underneath", () => {
    expect(pictureRects(pic({ layer: "silk-bottom" }))[0]).toEqual({ x1: 12, y1: 6, x2: 14, y2: 7 });
  });

  it("changes ink and bare board over", () => {
    expect(pictureRects(invertInk(pic()))).toEqual([{ x1: 12, y1: 6, x2: 14, y2: 7 }]);
    expect(invertInk(invertInk(pic())).bits).toBe(bits);
  });

  it("makes ink of dark, solid pixels and keeps the picture's shape", () => {
    // 8 by 4 pixels: the left half black, the right half white, and the last row see-through black.
    const rgba: number[] = [];
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 8; x += 1) rgba.push(...(y === 3 ? [0, 0, 0, 0] : x < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const ink = inkFromPixels(rgba, 8, 4, 4);
    expect(ink).toMatchObject({ cols: 4, rows: 2 });
    // The top row covers two solid pixel rows; the bottom one is half see-through, which is not dark enough.
    expect(pictureRects(pic({ ...ink }))).toEqual([{ x1: 10, y1: 6, x2: 12, y2: 7 }]);
    // Never more cells than the image has pixels.
    expect(inkFromPixels(rgba, 8, 4, 500).cols).toBe(8);
  });

  it("is added, changed, moved and deleted like anything else on the board", () => {
    const { d } = fabBoard();
    const blank = packInk([0, 0, 0, 0], 2, 2);
    expect(addPicture(d, { ...pic(), bits: blank, cols: 2 })).toBe(d);
    let b = addPicture(d, pic(), "pi1");
    expect(b.board!.pictures).toEqual([pic()]);
    b = setPicture(b, "pi1", { w: 8, layer: "silk-bottom" });
    expect(b.board!.pictures![0]).toMatchObject({ w: 8, layer: "silk-bottom" });
    expect(setPicture(b, "pi1", { w: 0 })).toBe(b);
    const moved = moveOnBoard(b, ["pi1"], 2, -1);
    expect(moved.board!.pictures![0]).toMatchObject({ x: 12, y: 4 });
    expect(removeFromBoard(moved, ["pi1"]).board!.pictures ?? []).toEqual([]);
  });

  it("is printed on its own side's silkscreen file", () => {
    const { d } = fabBoard();
    const b = addPicture(d, pic({ x: 36, y: 30 }), "pi1");
    const image = (layer: string) => readGerber(gerberFiles(b).find((f) => f.layer === layer)!.text);
    const top = image("silk-top");
    expect(top.skipped).toEqual([]);
    expect(inkAt(top, [36.5, 31.5])).toBe(true);
    expect(inkAt(top, [39.5, 31.5])).toBe(false);
    expect(inkAt(top, [39.5, 30.5])).toBe(true);
    expect(inkAt(image("silk-bottom"), [36.5, 31.5])).toBe(false);
  });

  it("loses its ink over a pad, and the board check says so", () => {
    const { d, pad } = fabBoard();
    const at = pad("J1", "1");
    const b = addPicture(d, pic({ x: at[0] - 1, y: at[1] - 1 }), "pi1");
    const top = readGerber(gerberFiles(b).find((f) => f.layer === "silk-top")!.text);
    expect(inkAt(top, at)).toBe(false);
    expect(checkBoard(b).find((r) => r.rule === "silk-pad")).toMatchObject({
      level: "warning",
      text: "A picture is printed over J1 pad 1. The ink is cut away there.",
    });
    expect(checkBoard(addPicture(d, pic({ x: 36, y: 30 }), "pi1")).filter((r) => r.rule === "silk-pad")).toEqual([]);
  });
});

describe("text on the board", () => {
  it("warns when silkscreen text crosses a pad", () => {
    const { d, pad } = fabBoard();
    const at = pad("J1", "2");
    const over = checkBoard(addText(d, at[0] - 1, at[1] - 0.5, "GND", "silk-top", 1.5)).find((r) => r.rule === "silk-pad" && r.text.startsWith("The text"));
    expect(over!.text).toBe('The text "GND" is printed over J1 pad 2. The ink is cut away there.');
    // A surface pad on the top does not trouble text on the bottom.
    const r1 = pad("R1", "1");
    expect(
      checkBoard(addText(d, r1[0] - 1, r1[1] - 0.5, "GND", "silk-bottom", 1.5)).filter((r) => r.rule === "silk-pad" && r.text.startsWith("The text")),
    ).toEqual([]);
  });

  it("written in copper is copper on no net, in the copper file and in the check", () => {
    const { d } = fabBoard();
    const b = addText(d, 36, 12, "V1", "copper-top", 2);
    const text = copperOf(b).filter((c) => c.kind === "text");
    expect(text.length).toBeGreaterThan(2);
    expect(text[0]).toMatchObject({ net: "", layers: ["top"], what: 'the text "V1"' });
    const on = text[0]!.pts[0] as P2;
    const file = (layer: string, design = b) => readGerber(gerberFiles(design).find((f) => f.layer === layer)!.text);
    expect(inkAt(file("copper-top"), on)).toBe(true);
    expect(inkAt(file("copper-top", d), on)).toBe(false);
    expect(inkAt(file("silk-top"), on)).toBe(false);
    // Laid over a pad of a net, it is a short the check finds.
    const pads = boardPads(d);
    const p = pads.find((x) => x.ref === "J1" && x.pad.number === "1")!.at;
    const bad = checkBoard(addText(d, p[0] - 0.5, p[1] - 0.5, "V1", "copper-top", 2));
    expect(bad.some((r) => r.level === "error" && r.text.includes('the text "V1"'))).toBe(true);
  });

  it("can have several lines, each below the last", () => {
    const { d } = fabBoard();
    const one = copperOf(addText(d, 36, 12, "A", "copper-top", 2)).filter((c) => c.kind === "text");
    const two = copperOf(addText(d, 36, 12, "A\nA", "copper-top", 2)).filter((c) => c.kind === "text");
    expect(two).toHaveLength(one.length * 2);
    expect(two[one.length]!.pts[0]![1]).toBeLessThan(one[0]!.pts[0]![1]);
    expect(two[one.length]!.pts[0]![0]).toBe(one[0]!.pts[0]![0]);
  });
});
