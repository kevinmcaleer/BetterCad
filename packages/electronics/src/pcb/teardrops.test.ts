import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { gerberFiles } from "../fab/gerber";
import { inkAt, readGerber } from "../fab/read";
import { kicadProject } from "../kicad/export";
import { importKicadProject } from "../kicad/project";
import type { P2 } from "../model";
import { sampleBoard } from "../sample";
import { clearanceBetween, copperOf, gap } from "./copper";
import { checkBoard } from "./drc";
import { setBoard } from "./route";
import { teardrops } from "./teardrops";

const on = () => setBoard(sampleBoard(), { teardrops: true });
const middle = (pts: P2[]): P2 => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];

describe("teardrops (#743)", () => {
  it("are there only when the board asks for them", () => {
    expect(teardrops(sampleBoard())).toEqual([]);
    expect(teardrops(on()).length).toBeGreaterThan(4);
    expect(setBoard(on(), { teardrops: false }).board!.teardrops).toBeUndefined();
  });

  it("flare from a pad or via along its track, on the track's net and layer", () => {
    const d = on();
    const pads = boardPads(d);
    for (const t of teardrops(d, pads)) {
      const track = d.board!.tracks.find(
        (x) => x.net === t.net && x.layer === t.layer && [x.pts[0]!, x.pts.at(-1)!].some((e) => gap({ pts: t.pts, r: 0 }, { pts: [e], r: 0 }) === 0),
      );
      expect(track, `${t.net} on ${t.layer}`).toBeDefined();
    }
  });

  it("keep their clearance, so the board check finds nothing new", () => {
    const d = on();
    const pads = boardPads(d);
    const copper = copperOf(d, pads);
    for (const t of teardrops(d, pads, copper))
      for (const c of copper.filter((x) => x.net !== t.net && x.layers.includes(t.layer)))
        expect(gap({ pts: t.pts, r: 0 }, c)).toBeGreaterThanOrEqual(clearanceBetween(d.board!, t.net, c.net) - 1e-6);
    expect(checkBoard(d).map((r) => r.text)).toEqual(checkBoard(sampleBoard()).map((r) => r.text));
  });

  it("are copper in the Gerber files", () => {
    const d = on();
    const drop = teardrops(d)[0]!;
    const layer = drop.layer === "bottom" ? "copper-bottom" : "copper-top";
    const text = gerberFiles(d).find((f) => f.layer === layer)!.text;
    expect(text).toContain("G36*");
    expect(inkAt(readGerber(text), middle(drop.pts))).toBe(true);
  });

  it("go to KiCad as teardrop zones and come back as the setting", () => {
    const files = kicadProject(on(), "trip").files;
    const pcb = files.find((f) => f.name.endsWith(".kicad_pcb"))!.text;
    expect(pcb).toMatch(/\(attr\s*\(teardrop\s*\(type padvia\)/);
    const back = importKicadProject(files, { licence: "CC0" }).design.board!;
    expect(back.teardrops).toBe(true);
    expect(back.pours).toHaveLength(on().board!.pours.length);
  });
});
