import { describe, expect, it } from "vitest";
import { boardSize } from "../board";
import { sampleBoard } from "../sample";
import { drillFiles } from "./drill";
import { gerberFiles } from "./gerber";
import { orderPack } from "./pack";
import { PANEL, TAB, panelLayout, stepGerber } from "./panel";
import { inkAt, readDrill, readGerber } from "./read";

const d = sampleBoard();
const board = d.board!;
const size = boardSize(board);

describe("panels (#662)", () => {
  it("lays out rows and columns with rails, gaps and tabs", () => {
    const l = panelLayout(board, { rows: 2, cols: 3, join: "tabs", rail: 5, gap: 2 });
    expect(l.offsets).toHaveLength(6);
    expect(l.w).toBeCloseTo(3 * size.w + 2 * 2, 6);
    expect(l.h).toBeCloseTo(2 * size.h + 2 + 2 * (5 + 2), 6);
    expect(l.cuts).toEqual([]);
    // Every tab gets holes along each board edge it meets, and the rails get tooling holes.
    expect(l.tabs.length).toBeGreaterThan(6);
    expect(l.holes.filter((h) => h.d === TAB.hole).length).toBeGreaterThan(l.tabs.length * 2);
    expect(l.holes.filter((h) => h.d === 2)).toHaveLength(4);
  });

  it("scores V-cuts right across the panel, between the boards and along the rails", () => {
    const l = panelLayout(board, { rows: 2, cols: 2, join: "vcut", rail: 5, gap: 2 });
    expect(l.w).toBeCloseTo(2 * size.w, 6);
    expect(l.h).toBeCloseTo(2 * size.h + 10, 6);
    // Two along the rails, one between the rows, one between the columns.
    expect(l.cuts).toHaveLength(4);
    expect(l.cuts.every(([a, b]) => (a[0] === 0 && b[0] === l.w) || (a[1] === 0 && b[1] === l.h))).toBe(true);
    expect(l.tabs).toEqual([]);
  });

  it("steps every Gerber file: each copy's copper is where it should be", () => {
    const top = gerberFiles(d).find((f) => f.layer === "copper-top")!;
    const l = panelLayout(board, PANEL);
    const one = readGerber(top.text);
    const all = readGerber(stepGerber(top.text, l.offsets));
    expect(all.skipped).toEqual([]);
    const flashes = (img: typeof one) => img.ops.filter((o) => o.kind === "flash").length;
    expect(flashes(all)).toBe(flashes(one) * l.offsets.length);
    const flash = one.ops.find((o) => o.kind === "flash")!;
    if (flash.kind !== "flash") throw new Error();
    // The first copy is the board less its own corner; every copy has the pad at the same place on it.
    const at = (o: [number, number]): [number, number] => [flash.at[0] + o[0], flash.at[1] + o[1]];
    for (const o of l.offsets) expect(inkAt(all, at(o))).toBe(true);
  });

  it("makes an order pack for the panel, with its outline, tabs and drills read back", () => {
    const panel = { rows: 2, cols: 2, join: "tabs" as const, rail: 5, gap: 2 };
    const pack = orderPack(d, "jlcpcb", "Pico servo", panel)!;
    const l = panelLayout(board, panel);
    expect(pack.facts.width).toBeCloseTo(l.w, 2);
    expect(pack.facts.height).toBeCloseTo(l.h, 2);
    expect(pack.panel).toEqual({ w: l.w, h: l.h, boards: 4, join: "tabs" });
    expect(pack.checks.find((c) => c.id === "panel")).toMatchObject({ ok: true, text: expect.stringContaining("4 boards on a") });
    const bare = readDrill(pack.gerbers.find((g) => g.layer === "drill-bare")!.text);
    const single = readDrill(drillFiles(d)!.bare);
    expect(bare.hits.length).toBe(single.hits.length * 4 + l.holes.length);
    const plated = readDrill(pack.gerbers.find((g) => g.layer === "drill-plated")!.text);
    expect(plated.hits.length).toBe(readDrill(drillFiles(d)!.plated).hits.length * 4);
    // The outline has the panel's edge, and each board's edge is broken where a tab holds it.
    const edge = readGerber(pack.gerbers.find((g) => g.layer === "edge")!.text);
    const box = edge.box!;
    expect(box.x2 - box.x1).toBeCloseTo(l.w + 0.1, 1);
    const tab = l.tabs[0]!;
    const onEdge: [number, number] = [tab.at[0] + (tab.across[0] * l.gap) / 2, tab.at[1] + (tab.across[1] * l.gap) / 2];
    expect(inkAt(edge, onEdge)).toBe(false);
    const beside: [number, number] = [onEdge[0] + tab.across[1] * (TAB.width / 2 + 1), onEdge[1] + tab.across[0] * (TAB.width / 2 + 1)];
    expect(inkAt(edge, beside)).toBe(true);
  });

  it("writes the V-cuts in a file of their own, and warns when the board is not a rectangle", () => {
    const pack = orderPack(d, "jlcpcb", "Pico servo", { rows: 1, cols: 3, join: "vcut", rail: 0, gap: 0 })!;
    const vcut = pack.gerbers.find((g) => g.layer === "vcut")!;
    expect(vcut.name).toBe("Pico-servo-VCUT.gbr");
    expect(readGerber(vcut.text).ops).toHaveLength(2);
    const square = board.outline.length === 4 && !board.outline.some((c) => c.bulge);
    expect(pack.checks.find((c) => c.id === "panel")!.ok).toBe(square);
    // One board is no panel.
    expect(orderPack(d, "jlcpcb", "Pico servo", { ...PANEL, rows: 1, cols: 1 })!.panel).toBeNull();
  });
});
