import { describe, expect, it } from "vitest";
import { sampleBoard } from "@bettercad/electronics/sample";
import { setPlacement } from "@bettercad/electronics/pcb/route";
import { sceneSvg } from "../drawing/export/svg";
import { assemblyScene, sidesWithParts } from "./sheetScene";

describe("an assembly drawing (#662)", () => {
  const d = sampleBoard();
  const top = assemblyScene(d, "top", { size: "A4", title: { title: "Pico servo", date: "2026-11-25" }, index: 1, count: 1 });

  it("is a drawing sheet with the title block saying which side it is", () => {
    expect([top.w, top.h]).toEqual([297, 210]);
    const words = top.labels.map((l) => l.text);
    expect(words).toEqual(expect.arrayContaining(["Pico servo", "Assembly drawing, top side"]));
  });

  it("names every part on the side, inside the frame, with its outline and pads", () => {
    const refs = top.labels.filter((l) => l.layer === "visible").map((l) => l.text);
    const onTop = d.board!.placements.filter((p) => p.side === "top").map((p) => d.parts.find((x) => x.id === p.part)!.ref);
    expect(refs.sort()).toEqual(onTop.filter((r) => !r.startsWith("#")).sort());
    for (const l of top.labels.filter((x) => x.layer === "visible")) {
      expect(l.at[0]).toBeGreaterThan(10);
      expect(l.at[0]).toBeLessThan(287);
      expect(l.at[1]).toBeGreaterThan(10);
      expect(l.at[1]).toBeLessThan(200);
    }
    expect(top.strokes.filter((s) => s.layer === "visible").length).toBeGreaterThan(onTop.length * 2);
    // Pin 1 dots for parts with more than two pads.
    expect(top.fills?.length).toBeGreaterThan(0);
    expect(sceneSvg(top)).toContain("<svg");
  });

  it("draws the bottom turned over, and only when parts are on it", () => {
    expect(sidesWithParts(d)).toEqual(["top"]);
    const one = d.board!.placements[0]!;
    const turned = setPlacement(d, one.part, { side: "bottom" });
    expect(sidesWithParts(turned)).toEqual(["top", "bottom"]);
    const bottom = assemblyScene(turned, "bottom", { size: "A4", title: { title: "Pico servo" } });
    const ref = d.parts.find((p) => p.id === one.part)!.ref;
    const label = bottom.labels.find((l) => l.text === ref)!;
    const above = top.labels.find((l) => l.text === ref)!;
    expect(bottom.labels.map((l) => l.text)).toContain("Assembly drawing, bottom side, seen from below");
    // Seen from below, a part on the left of the board is on the right of the drawing.
    const middle = 297 / 2;
    expect(Math.sign(label.at[0] - middle)).toBe(-Math.sign(above.at[0] - middle) || 0);
  });
});
