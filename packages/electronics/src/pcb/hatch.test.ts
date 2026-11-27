import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../board";
import { importEagleProject } from "../eagle/project";
import { gerberFiles } from "../fab/gerber";
import { inkAt, readGerber } from "../fab/read";
import { kicadProject } from "../kicad/export";
import { importKicadProject } from "../kicad/project";
import { withFixedIds, type ElectronicsDesign } from "../model";
import { sampleBoard } from "../sample";
import { checkBoard } from "./drc";
import { HATCH, hatchHoles, pourFill, pourShape, setPour } from "./pour";

const hatched = (hatch = HATCH): ElectronicsDesign => {
  const d = sampleBoard();
  return setPour(d, d.board!.pours[0]!.id, { hatch });
};

describe("hatched pours (#747)", () => {
  it("cut the area into lines, a line all round its edge, and go back to solid", () => {
    const d = hatched();
    const pour = d.board!.pours[0]!;
    const holes = hatchHoles(pour);
    expect(holes.length).toBeGreaterThan(50);
    for (const sq of holes) {
      expect(sq[1]![0] - sq[0]![0]).toBeCloseTo(HATCH.gap, 6);
      for (const p of sq) expect(pointInPolygon(p, pour.outline)).toBe(true);
    }
    expect(pourShape(d, pour).holes).toEqual(holes);
    expect(setPour(d, pour.id, { hatch: null }).board!.pours[0]).not.toHaveProperty("hatch");
  });

  it("fill less copper, still joined to their pads, and pass the board check", () => {
    const solid = sampleBoard();
    const d = hatched();
    const [before, after] = [pourFill(solid, solid.board!.pours[0]!), pourFill(d, d.board!.pours[0]!)];
    expect(after.area).toBeLessThan(before.area * 0.6);
    expect(after.joins.filter((j) => j.length).length).toBeGreaterThan(0);
    expect(checkBoard(d).map((r) => r.text)).toEqual(checkBoard(solid).map((r) => r.text));
  });

  it("are bare in their openings and copper on their lines in the Gerber file", () => {
    const d = hatched();
    const pour = d.board!.pours[0]!;
    const layer = pour.layer === "bottom" ? "copper-bottom" : "copper-top";
    const image = readGerber(gerberFiles(d).find((f) => f.layer === layer)!.text);
    const fill = pourFill(d, pour);
    // An opening whose middle the solid fill would cover.
    const solid = pourFill(sampleBoard(), sampleBoard().board!.pours[0]!);
    const cell = (f: typeof fill, p: [number, number]) => f.cells[Math.round((p[1] - f.y0) / f.step) * f.w + Math.round((p[0] - f.x0) / f.step)];
    const sq = hatchHoles(pour).find((s) => cell(solid, [(s[0]![0] + s[2]![0]) / 2, (s[0]![1] + s[2]![1]) / 2]))!;
    const mid: [number, number] = [(sq[0]![0] + sq[2]![0]) / 2, (sq[0]![1] + sq[2]![1]) / 2];
    expect(inkAt(image, mid)).toBe(false);
    expect(cell(fill, mid)).toBe(0);
    // The line beside it.
    const line: [number, number] = [sq[0]![0] - HATCH.width / 2, mid[1]];
    if (cell(solid, line)) expect(inkAt(image, line)).toBe(true);
  });

  it("are checked for lines too thin to make", () => {
    const thin = checkBoard(hatched({ width: 0.1, gap: 1 })).filter((r) => r.rule === "track-width");
    expect(thin.map((r) => r.text)).toEqual([expect.stringMatching(/hatched pour on .* has lines 0\.1 mm wide/)]);
  });

  it("go to KiCad as hatched zones and come back the same", () => {
    const files = kicadProject(hatched({ width: 0.3, gap: 0.8 }), "trip").files;
    const pcb = files.find((f) => f.name.endsWith(".kicad_pcb"))!.text;
    expect(pcb).toMatch(/\(mode hatch\)/);
    expect(pcb).toMatch(/\(hatch_thickness 0\.3\)/);
    const back = importKicadProject(files, { licence: "CC0" }).design.board!;
    expect(back.pours.find((p) => p.hatch)!.hatch).toEqual({ width: 0.3, gap: 0.8 });
  });

  it("come in from Eagle hatched, with its line width and spacing", () => {
    const dir = join(__dirname, "../eagle/fixtures");
    const read = (name: string) => ({ name, text: readFileSync(join(dir, name), "utf8") });
    const brd = read("turns.brd");
    brd.text = brd.text.replace('<polygon width="0.254" layer="16" rank="2">', '<polygon width="0.254" layer="16" rank="2" pour="hatch" spacing="1.27">');
    const got = withFixedIds(() => importEagleProject([read("turns.sch"), brd], { licence: "CC0" }));
    expect(got.design.board!.pours.find((p) => p.hatch)!.hatch).toEqual({ width: 0.254, gap: 1.016 });
    expect(got.notes.map((n) => n.why).join(" ")).not.toContain("Hatched pours");
  });
});
