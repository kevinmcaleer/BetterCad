import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { check } from "../erc";
import type { ElectronicsDesign } from "../model";
import { netlist } from "../nets";
import { checkBoard } from "../pcb/drc";
import { setBoard } from "../pcb/route";
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
  it("keeps the board's open vias, as KiCad 7's setting and KiCad 8's (#736)", () => {
    const d = sampleBoard();
    const trip = (x: ElectronicsDesign) => importKicadProject(kicadProject(x, "trip").files, { licence: "CC0" }).design.board!.viaMask;
    expect(trip(d)).toBeUndefined();
    expect(trip(setBoard(d, { viaMask: "open" }))).toBe("open");
    const files = kicadProject(d, "trip").files;
    const pcb = files.find((f) => f.name.endsWith(".kicad_pcb"))!;
    const with8 = (tenting: string) =>
      importKicadProject(
        files.map((f) => (f === pcb ? { ...f, text: f.text.replace(/\(pcbplotparams\s*\(viasonmask \w+\)\s*\)/, tenting) } : f)),
        { licence: "CC0" },
      ).design.board!.viaMask;
    expect(with8("(tenting front back)")).toBeUndefined();
    expect(with8("(tenting)")).toBe("open");
  });

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

  it("reads a name KiCad 8 or 9 wrote with a braced character as the same net", () => {
    // KiCad's own pic_programmer demo, saved by KiCad 9, labels one net both "VPP/MCLR" and "VPP{slash}MCLR".
    const files = kicadProject(sampleBoard(), "x").files.filter((f) => f.name.endsWith(".kicad_sch"));
    const plain = files.map((f) => ({ ...f, text: f.text.replaceAll('(label "SERVO1"', '(label "SERVO/1"') }));
    let first = true;
    const braced = plain.map((f) => ({
      ...f,
      text: f.text.replaceAll('(label "SERVO/1"', (all) => (first ? ((first = false), '(label "SERVO{slash}1"') : all)),
    }));
    expect(braced[0]!.text).toContain("SERVO{slash}1");
    expect(pinSets(importKicadProject(braced).design)).toEqual(pinSets(importKicadProject(plain).design));
    expect(pinSets(importKicadProject(braced).design).some((n) => n.startsWith("SERVO/1: "))).toBe(true);
  });

  describe("a board as newer KiCads save it", () => {
    const files = kicadProject(sampleBoard(), "x").files;
    const plain = importKicadProject(files);
    const withBoard = (change: (pcb: string) => string) => files.map((f) => (f.name.endsWith(".kicad_pcb") ? { ...f, text: change(f.text) } : f));
    const copper = (d: ElectronicsDesign) => [...d.board!.tracks.map((t) => t.net), ...d.board!.vias.map((v) => v.net), ...d.board!.pours.map((p) => p.net)];

    it("reads nets named where they are used, with no table of them (KiCad 10)", () => {
      const ten = withBoard((pcb) => {
        const names = new Map([...pcb.matchAll(/^\t\(net (\d+) "([^"]*)"\)\n/gm)].map((m) => [m[1]!, m[2]!]));
        expect(names.size).toBeGreaterThan(5);
        return pcb
          .replace(/^\t\(net \d+ "[^"]*"\)\n/gm, "")
          .replace(/\(net \d+ ("[^"]*")\)/g, "(net $1)")
          .replace(/\(net (\d+)\)/g, (_all, n: string) => `(net "${names.get(n)}")`);
      });
      expect(ten.find((f) => f.name.endsWith(".kicad_pcb"))!.text).not.toMatch(/\(net \d/);
      const got = importKicadProject(ten);
      expect(got.notes).toEqual(plain.notes);
      expect(padsOf(got.design)).toEqual(padsOf(plain.design));
      expect(copper(got.design)).toEqual(copper(plain.design));
      expect(copper(got.design).filter(Boolean).length).toBeGreaterThan(20);
    });

    it("leaves out teardrops, and says so (KiCad 8)", () => {
      const got = importKicadProject(withBoard((pcb) => pcb.replace(/^\t\(zone\n/m, "\t(zone\n\t\t(attr (teardrop (type padvia)))\n")));
      expect(got.design.board!.pours).toHaveLength(plain.design.board!.pours.length - 1);
      expect(got.notes.map((n) => n.why)).toContain("Left out: 1 teardrops, the copper KiCad adds where a track meets a pad");
    });

    it("leaves out a stub of track on a pin that joins nothing, and says so", () => {
      const got = importKicadProject(
        withBoard((pcb) =>
          pcb
            .replace(/^\t\(net 0 ""\)\n/m, '\t(net 0 "")\n\t(net 999 "unconnected-(J1-Pad9)")\n')
            .replace(/(\t\(segment\n[^]*?\(net )\d+\)/, (_all, lead: string) => `${lead}999)`),
        ),
      );
      expect(got.design.board!.tracks.every((t) => !t.net.startsWith("unconnected-"))).toBe(true);
      expect(got.notes.map((n) => n.why)).toContain("Left out: 1 piece of track on pins that join nothing in the schematic");
    });
  });
});

describe("notes on a sheet go out to KiCad and come back (#733)", () => {
  it("keeps text, lines, boxes and circles, and lists none of them as left out", () => {
    const d = sampleBoard();
    const sheet = d.sheets[0]!;
    const notes = [
      { id: "n1", kind: "text" as const, x: 10.16, y: 20.32, text: "Servo power", size: 1.27, align: "left" as const },
      { id: "n2", kind: "line" as const, pts: [[0, 0] as [number, number], [25.4, 0] as [number, number]] },
      { id: "n3", kind: "rect" as const, x1: 0, y1: 0, x2: 50.8, y2: 25.4, fill: false as const },
      { id: "n4", kind: "circle" as const, cx: 12.7, cy: 12.7, r: 5.08 },
    ];
    const withNotes: ElectronicsDesign = { ...d, sheets: [{ ...sheet, notes }, ...d.sheets.slice(1)] };
    const back = importKicadProject(kicadProject(withNotes, "notes").files, { licence: "CC0" });
    const got = back.design.sheets[0]!.notes ?? [];
    expect(got.map((n) => n.kind).sort()).toEqual(["circle", "line", "rect", "text"]);
    expect(got.find((n) => n.kind === "text")).toMatchObject({ text: "Servo power", size: 1.27 });
    const box = got.find((n) => n.kind === "rect")!;
    const line = got.find((n) => n.kind === "line")!;
    // The sheet may be shifted onto KiCad's page, but each shape keeps its size.
    if (box.kind === "rect") expect([box.x2 - box.x1, box.y2 - box.y1].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([50.8, 25.4]);
    if (line.kind === "line") expect(Math.hypot(line.pts[1]![0] - line.pts[0]![0], line.pts[1]![1] - line.pts[0]![1])).toBeCloseTo(25.4, 4);
    expect(got.find((n) => n.kind === "circle")).toMatchObject({ r: 5.08 });
    expect(back.notes.map((n) => n.why).join(" ")).not.toMatch(/shapes drawn on the sheet/);
  });
});
