import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { sampleBoard } from "../sample";
import { copperOf, gap } from "./copper";
import { checkBoard } from "./drc";
import { pourFill } from "./pour";
import { addStitching, stitchPlan } from "./stitch";

const board = () => {
  const d = sampleBoard();
  const top = d.board!.pours.find((p) => p.layer === "top")!;
  return { d, top };
};

describe("stitching vias (#737)", () => {
  it("fills a pour with vias on a grid, all on its net", () => {
    const { d, top } = board();
    const plan = stitchPlan(d, top.id, 5);
    expect(plan.at.length).toBeGreaterThan(3);
    for (const [x, y] of plan.at) {
      expect(Math.abs(x / 5 - Math.round(x / 5))).toBeLessThan(1e-6);
      expect(Math.abs(y / 5 - Math.round(y / 5))).toBeLessThan(1e-6);
    }
    const made = addStitching(d, top.id, 5);
    expect(made.added).toBe(plan.at.length);
    const added = made.design.board!.vias.slice(d.board!.vias.length);
    expect(added.every((v) => v.net === top.net)).toBe(true);
    // Closer together, more of them.
    expect(stitchPlan(d, top.id, 3).at.length).toBeGreaterThan(plan.at.length);
  });

  it("puts them only where both pours fill and every clearance holds", () => {
    const { d, top } = board();
    const made = addStitching(d, top.id, 4).design;
    const before = checkBoard(d).map((r) => r.text);
    expect(checkBoard(made).filter((r) => !before.includes(r.text))).toEqual([]);
    const pads = boardPads(made);
    const copper = copperOf(made, pads);
    const added = made.board!.vias.slice(d.board!.vias.length);
    const fills = made.board!.pours.map((pour) => pourFill(made, pour, pads, copper));
    for (const v of added) {
      // Never on a pad, its own net's included.
      for (const c of copper.filter((x) => x.kind === "pad")) expect(gap({ pts: [[v.x, v.y]], r: v.diameter / 2 }, c)).toBeGreaterThan(0);
      for (const f of fills) {
        const i = Math.round((v.x - f.x0) / f.step);
        const j = Math.round((v.y - f.y0) / f.step);
        expect(f.cells[j * f.w + i], `${f.pour.layer} at ${v.x},${v.y}`).toBeGreaterThan(0);
      }
    }
  });

  it("leaves room round the vias already there, so a second go adds none", () => {
    const { d, top } = board();
    const once = addStitching(d, top.id, 5).design;
    const again = addStitching(once, top.id, 5);
    expect(again.added).toBe(0);
    expect(again.design).toBe(once);
  });

  it("says why when there is nothing to join to", () => {
    const { d, top } = board();
    const alone = { ...d, board: { ...d.board!, pours: [top] } };
    expect(stitchPlan(alone, top.id).why).toMatch(/There is no GND pour on another layer/);
    expect(addStitching(alone, top.id).design).toBe(alone);
  });
});
