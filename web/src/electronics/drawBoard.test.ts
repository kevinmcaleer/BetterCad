import { describe, expect, it } from "vitest";
import { textStrokes, textWidth } from "@bettercad/electronics/fab/font";
import { emptyBoard, emptyDesign, type ElectronicsDesign } from "@bettercad/electronics";
import { setNetLook } from "@bettercad/electronics/pcb/netclass";
import type { Colours } from "./colours";
import { FAR_ALPHA, NET_COLOUR, boardTextStrokes, drawBoard, pourAlpha } from "./drawBoard";
import { textBox } from "./hitBoard";

describe("pours on screen (#728)", () => {
  it("paints pours light, lighter on the far side, and faint when another net is lit", () => {
    expect(pourAlpha(true, true)).toBeLessThan(0.5);
    expect(pourAlpha(false, true)).toBeLessThan(pourAlpha(true, true));
    expect(pourAlpha(true, false)).toBeLessThan(pourAlpha(false, true));
    expect(FAR_ALPHA).toBeLessThan(0.75);
  });
});

describe("board text in the files' own font (#730)", () => {
  const t = { id: "t1", layer: "silk-top" as const, x: 10, y: 5, text: "BetterCad", size: 2 };

  it("draws the same strokes the silkscreen file has", () => {
    const { lines, pen } = boardTextStrokes(t);
    expect(lines).toEqual(textStrokes("BetterCad", 1.44, [10, 5], { angle: 0, mirror: false }));
    expect(pen).toBeCloseTo(0.216, 3);
  });

  it("mirrors text on the bottom, as it reads from below", () => {
    const { lines } = boardTextStrokes({ ...t, layer: "silk-bottom" });
    expect(Math.max(...lines.flat().map((p) => p[0]))).toBeLessThanOrEqual(10.2);
  });

  it("picks text by the box round what is drawn", () => {
    const b = textBox(t);
    const w = textWidth("BetterCad", 1.44);
    expect(b.x1).toBeCloseTo(10 - 0.108, 2);
    expect(b.x2).toBeGreaterThan(10 + w * 0.9);
    expect(b.x2).toBeLessThanOrEqual(10 + w + 0.108 + 1e-9);
    expect(b.y2).toBeCloseTo(5 + 1.44 + 0.108, 2);
    // A second line goes below the first, and the box takes it in.
    expect(textBox({ ...t, text: "A\nB" }).y1).toBeLessThan(5 - 1.44);
  });
});

describe("a net's own colour and hidden lines (#740)", () => {
  /** A canvas that writes down the colour of each line drawn. */
  const recorder = () => {
    const strokes: string[] = [];
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get: (t, k) => (k === "stroke" ? () => strokes.push(String(t.strokeStyle)) : k in t ? t[k as string] : () => undefined),
      set: (t, k, v) => ((t[k as string] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, strokes };
  };
  const colours = new Proxy({}, { get: (_, k) => `c:${String(k)}` }) as Colours;
  const draw = (d: ElectronicsDesign) => {
    const { ctx, strokes } = recorder();
    const air = [
      { net: "GND", a: [0, 0] as [number, number], b: [5, 0] as [number, number] },
      { net: "SDA", a: [0, 5] as [number, number], b: [5, 5] as [number, number] },
    ];
    drawBoard(ctx, { scale: 4, ox: 0, oy: 0 }, { w: 100, h: 100 }, d, colours, { selected: new Set(), hidden: new Set(), active: "top", pads: [], air });
    return strokes.filter((s) => s === "c:ec-pcb-ink" || Object.values(NET_COLOUR).some((k) => s === `c:${k}`));
  };

  it("draws a coloured net's unrouted lines in its colour, and leaves a hidden net's out", () => {
    let d: ElectronicsDesign = { ...emptyDesign(), board: emptyBoard() };
    expect(draw(d)).toEqual(["c:ec-pcb-ink", "c:ec-pcb-ink"]);
    d = setNetLook(d, "SDA", { colour: "teal" });
    expect(draw(d)).toEqual(["c:ec-pcb-ink", "c:ec-copper-in3"]);
    d = setNetLook(d, "GND", { hideAir: true });
    expect(draw(d)).toEqual(["c:ec-copper-in3"]);
    expect(d.board!.netLooks).toEqual({ SDA: { colour: "teal" }, GND: { hideAir: true } });
    // Taking every setting off leaves nothing behind.
    d = setNetLook(setNetLook(d, "SDA", { colour: undefined }), "GND", { hideAir: undefined });
    expect(d.board).not.toHaveProperty("netLooks");
  });
});
