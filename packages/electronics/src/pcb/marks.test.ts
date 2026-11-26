import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { moveOnBoard, removeFromBoard } from "../edit";
import { fabBoard } from "../fab/fixture";
import { gerberFiles, type GerberLayer } from "../fab/gerber";
import { placeList } from "../fab/parts";
import { inkAt, readGerber } from "../fab/read";
import { kicadProject } from "../kicad/export";
import { importKicadProject } from "../kicad/project";
import type { ElectronicsDesign, P2 } from "../model";
import { sampleBoard } from "../sample";
import { copperOf } from "./copper";
import { checkBoard } from "./drc";
import { addMark, nextMarkRef, setMark } from "./marks";

/** A clear spot inside the fab board, away from its parts. */
const spot = (d: ElectronicsDesign): P2 => {
  const xs = d.board!.outline.map((c) => c.x);
  const ys = d.board!.outline.map((c) => c.y);
  return [Math.min(...xs) + 3, Math.min(...ys) + 3];
};

describe("fiducials and test points (#735)", () => {
  it("numbers each kind on its own: FID1, FID2, TP1", () => {
    let d = fabBoard().d;
    d = addMark(d, "fiducial", 1, 1).design;
    d = addMark(d, "fiducial", 2, 2).design;
    d = addMark(d, "testpoint", 3, 3, "bottom", "GND").design;
    expect(d.board!.marks!.map((m) => [m.ref, m.kind, m.side, m.net])).toEqual([
      ["FID1", "fiducial", "top", undefined],
      ["FID2", "fiducial", "top", undefined],
      ["TP1", "testpoint", "bottom", "GND"],
    ]);
    expect(nextMarkRef(d.board!, "testpoint")).toBe("TP2");
  });

  it("is a pad of the board's own, so a test point joins its net's unrouted lines", () => {
    const { d: base, nets } = fabBoard();
    const { design: d, id } = addMark(base, "testpoint", 5, 5, "top", nets[0]);
    const pad = boardPads(d).find((p) => p.part === id)!;
    expect(pad).toMatchObject({ ref: "TP1", net: nets[0], at: [5, 5], side: "top", pad: { kind: "smd", shape: "circle", w: 1, noPaste: true } });
    // A fiducial is on no net, and a test point can be taken off its net.
    expect(setMark(d, id, { net: "" }).board!.marks![0]!.net).toBeUndefined();
    // Fiducials have no net to take.
    const f = addMark(base, "fiducial", 5, 5, "top", nets[0]);
    expect(f.design.board!.marks![0]!.net).toBeUndefined();
  });

  it("makes copper, a clear ring twice its size in the mask for a fiducial, and no paste", () => {
    const { d: base } = fabBoard();
    const at = spot(base);
    const d = addMark(base, "fiducial", at[0], at[1]).design;
    const image = (layer: GerberLayer) => readGerber(gerberFiles(d).find((f) => f.layer === layer)!.text);
    expect(inkAt(image("copper-top"), at)).toBe(true);
    // The opening reaches 1 mm out from the middle: twice the dot's 0.5 mm.
    expect(inkAt(image("mask-top"), [at[0] + 0.9, at[1]])).toBe(true);
    expect(inkAt(image("paste-top"), at)).toBe(false);
  });

  it("keeps other copper out of a fiducial's clear ring", () => {
    const { d: base } = fabBoard();
    const { design: d, id } = addMark(base, "fiducial", 5, 5);
    expect(copperOf(d).find((c) => c.id === id)).toMatchObject({ r: 1, what: "fiducial FID1" });
    const tp = addMark(base, "testpoint", 5, 5);
    expect(copperOf(tp.design).find((c) => c.id === tp.id)).toMatchObject({ r: 0.5, what: "TP1 pad 1" });
  });

  it("adds nothing to the board check when clear, and a test point on a net wants routing", () => {
    const { d: base, nets } = fabBoard();
    const at = spot(base);
    const before = checkBoard(base).map((r) => r.text);
    const fid = addMark(base, "fiducial", at[0], at[1]).design;
    expect(checkBoard(fid).map((r) => r.text)).toEqual(before);
    const tp = addMark(base, "testpoint", at[0], at[1], "top", nets[0]).design;
    expect(
      checkBoard(tp)
        .map((r) => r.text)
        .filter((t) => !before.includes(t))
        .join("\n"),
    ).toMatch(/still has 1 connection to route/);
  });

  it("puts fiducials in the pick and place list, so the line's camera knows where they are", () => {
    let d = fabBoard().d;
    d = addMark(d, "fiducial", 4, 6, "bottom").design;
    d = addMark(d, "testpoint", 8, 8).design;
    const marks = placeList(d).filter((r) => r.value === "Fiducial" || r.ref.startsWith("TP"));
    expect(marks).toEqual([
      { part: d.board!.marks![0]!.id, ref: "FID1", value: "Fiducial", footprint: "Fiducial_1mm", x: 4, y: 6, side: "bottom", rotation: 0, mounting: "smd" },
    ]);
  });

  it("moves and deletes like anything else on the board", () => {
    const { design: d, id } = addMark(fabBoard().d, "testpoint", 5, 5);
    expect(moveOnBoard(d, [id], 2, 3).board!.marks![0]).toMatchObject({ x: 7, y: 8 });
    expect(removeFromBoard(d, [id]).board!.marks).toEqual([]);
  });

  it("goes out to KiCad as Fiducial and TestPoint footprints, and comes back", () => {
    let d = sampleBoard();
    const net = boardPads(d).find((p) => p.net)!.net;
    d = addMark(d, "fiducial", 3, 3).design;
    d = addMark(d, "testpoint", 6, 4, "bottom", net).design;
    const files = kicadProject(d, "trip").files;
    const pcb = files.find((f) => f.name.endsWith(".kicad_pcb"))!.text;
    expect(pcb).toContain('(footprint "trip:Fiducial_1mm"');
    expect(pcb).toContain('(footprint "trip:TestPoint_1mm"');
    expect(files.some((f) => f.name.endsWith("Fiducial_1mm.kicad_mod"))).toBe(true);
    const back = importKicadProject(files, { licence: "CC0" }).design.board!.marks!;
    expect(back.map((m) => [m.kind, m.ref, m.side, m.size, m.net])).toEqual([
      ["fiducial", "FID1", "top", 1, undefined],
      ["testpoint", "TP1", "bottom", 1, net],
    ]);
    const was = d.board!.marks!;
    for (const [i, m] of back.entries()) {
      expect(m.x).toBeCloseTo(was[i]!.x, 3);
      expect(m.y).toBeCloseTo(was[i]!.y, 3);
    }
  });
});
