import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { check } from "../erc";
import type { ElectronicsDesign } from "../model";
import { netlist } from "../nets";
import { checkBoard } from "../pcb/drc";
import { sampleBoard } from "../sample";
import { boardChanges } from "../sync";
import { kicadProject } from "./export";
import { tangle } from "./fixture";
import { importKicadProject } from "./project";

/** Nets as sorted lists of "R1:2", so two designs can be compared whatever they call a net. */
const pinSets = (d: ElectronicsDesign) =>
  netlist(d)
    .nets.filter((n) => n.pins.length > 1)
    .map(
      (n) =>
        `${n.named ? n.name : ""}: ${n.pins
          .map((p) => `${p.ref}:${p.pin}`)
          .sort()
          .join(" ")}`,
    )
    .sort();
const padsOf = (d: ElectronicsDesign) =>
  boardPads(d)
    .map((p) => `${p.ref}:${p.pad.number} ${p.net} ${p.side} ${p.at[0].toFixed(3)},${p.at[1].toFixed(3)} ${(((p.angle % 180) + 180) % 180).toFixed(1)}`)
    .sort();

describe.each([
  ["the sample board", sampleBoard],
  ["a design that turns everything every way", tangle],
])("out to KiCad and back in: %s (#663, #664)", (_what, make) => {
  const d = make();
  const back = importKicadProject(kicadProject(d, "trip").files, { licence: "CC0" });

  it("comes back with the same parts and nets", () => {
    expect(
      back.design.parts
        .filter((p) => !p.ref.startsWith("#"))
        .map((p) => `${p.ref} ${p.value}`)
        .sort(),
    ).toEqual(
      d.parts
        .filter((p) => !d.defs[p.def]!.symbol.power)
        .map((p) => `${p.ref} ${p.value}`)
        .sort(),
    );
    expect(pinSets(back.design)).toEqual(pinSets(d));
    expect(back.design.sheets).toHaveLength(d.sheets.length);
    // Every part says where it came from.
    for (const part of back.design.parts.filter((p) => !p.ref.startsWith("#"))) expect(back.design.defs[part.def]!.source?.licence).toBe("CC0");
  });

  it("comes back with every pad where it was, on its net and its side", () => {
    expect(padsOf(back.design)).toEqual(padsOf(d));
    const b = back.design.board!;
    const o = d.board!;
    expect(b.outline.length).toBe(o.outline.length);
    expect(b.cutouts?.length ?? 0).toBe(o.cutouts?.length ?? 0);
    expect(b.holes.map((h) => `${h.x},${h.y} ${h.drill} ${h.pad ?? ""}`).sort()).toEqual(o.holes.map((h) => `${h.x},${h.y} ${h.drill} ${h.pad ?? ""}`).sort());
    expect(b.vias.map((v) => `${v.net} ${v.x},${v.y}`).sort()).toEqual(o.vias.map((v) => `${v.net} ${v.x},${v.y}`).sort());
    expect(b.pours.map((p) => `${p.net} ${p.layer} ${p.thermal}`).sort()).toEqual(o.pours.map((p) => `${p.net} ${p.layer} ${p.thermal ?? true}`).sort());
    expect(b.keepouts.length).toBe(o.keepouts.length);
    expect(b.texts.map((t) => `${t.text} ${t.layer}`).sort()).toEqual(o.texts.map((t) => `${t.text} ${t.layer}`).sort());
    const length = (board: typeof b) =>
      board.tracks.reduce((n, t) => n + t.pts.slice(1).reduce((m, p, i) => m + Math.hypot(p[0] - t.pts[i]![0], p[1] - t.pts[i]![1]), 0), 0);
    expect(length(b)).toBeCloseTo(length(o), 3);
    expect(b.rules).toMatchObject({ clearance: o.rules.clearance, trackWidth: o.rules.trackWidth, viaDiameter: o.rules.viaDiameter });
  });

  it("is in step and passes the checks it passed before", () => {
    expect(boardChanges(back.design)).toEqual([]);
    const errors = (x: ElectronicsDesign) =>
      checkBoard(x)
        .filter((r) => r.level === "error" && !r.waived)
        .map((r) => r.rule)
        .sort();
    expect(errors(back.design)).toEqual(errors(d));
    const erc = (x: ElectronicsDesign) =>
      check(x)
        .filter((r) => r.level === "error" && !r.waived)
        .map((r) => r.rule)
        .sort();
    expect(erc(back.design)).toEqual(erc(d));
  });
});

describe("opening a KiCad project", () => {
  it("says what it needs when the files are not a project", () => {
    expect(() => importKicadProject([{ name: "a.txt", text: "hello" }])).toThrow("There is no KiCad schematic");
    const pcb = kicadProject(sampleBoard(), "x").files.find((f) => f.name.endsWith(".kicad_pcb"))!;
    expect(() => importKicadProject([pcb])).toThrow("A board needs its schematic");
  });

  it("opens a schematic with no board, and says the parts have no footprints", () => {
    const sch = kicadProject(sampleBoard(), "x").files.filter((f) => f.name.endsWith(".kicad_sch"));
    const got = importKicadProject(sch);
    expect(got.design.board).toBeUndefined();
    expect(got.found).toMatchObject({ sheets: 1, parts: 13, placed: 0 });
    expect(got.notes.map((n) => n.why)).toContain("There is no board among the files, so parts came in with no footprint");
  });

  it("names a sheet whose file was not opened", () => {
    const files = kicadProject(tangle(), "x").files.filter((f) => f.name === "x.kicad_sch" || f.name.endsWith(".kicad_pcb"));
    const got = importKicadProject(files);
    expect(got.notes.some((n) => n.name === "x-2.kicad_sch" && /was not among the ones opened/.test(n.why))).toBe(true);
  });
});
