import { describe, expect, it } from "vitest";
import { kicadProject } from "../kicad/export";
import { importKicadProject } from "../kicad/project";
import type { BoardRule, ElectronicsDesign, Track } from "../model";
import { sampleBoard } from "../sample";
import { clearanceBetween, copperOf, edgeLoops, netRules } from "./copper";
import { addRule, areaRect, changeRule, readDru, removeRule } from "./customRules";
import { checkBoard } from "./drc";
import { blockers, roundedOutline } from "./route";

const track = (id: string, net: string, y: number): Track => ({ id, net, layer: "top", width: 0.25, pts: [[10, y], [50, y]] }); // prettier-ignore

/** Two tracks 0.75 mm apart edge to edge, on HV (in class "Mains") and on LOGIC. */
function board(rules: BoardRule[] = []): ElectronicsDesign {
  const d = sampleBoard();
  return {
    ...d,
    parts: [],
    board: {
      ...d.board!,
      outline: roundedOutline(60, 40),
      cutouts: [],
      placements: [],
      vias: [],
      pours: [],
      holes: [],
      texts: [],
      keepouts: [],
      tracks: [track("t1", "HV", 20), track("t2", "LOGIC", 21)],
      classes: [{ id: "k", name: "Mains", nets: ["HV"], trackWidth: 0.5, clearance: 0.2 }],
      ...(rules.length ? { customRules: rules } : {}),
    },
  };
}
const clashes = (d: ElectronicsDesign) => checkBoard(d).filter((e) => e.rule === "clearance");

describe("custom board rules (#760)", () => {
  it("keeps more room between two classes, in the board check and the route tools", () => {
    expect(clashes(board())).toEqual([]);
    const pair: BoardRule = { id: "r", name: "Mains to logic", kind: "classes", a: "Default", b: "Mains", clearance: 1 };
    const d = board([pair]);
    expect(clearanceBetween(d.board!, "HV", "LOGIC")).toBe(1);
    expect(clearanceBetween(d.board!, "LOGIC", "GND")).toBe(d.board!.rules.clearance);
    expect(clashes(d)).toHaveLength(1);
    // A track laid next to HV on another Default net is held off by the rule too.
    const b = d.board!;
    const copper = copperOf(d).filter((c) => c.id !== "t2");
    expect(
      blockers(b, copper, edgeLoops(b), {
        net: "LOGIC",
        layers: ["top"],
        pts: [
          [10, 21],
          [50, 21],
        ],
        width: 0.25,
      }),
    ).not.toEqual([]);
    expect(
      blockers(b, copper, edgeLoops(b), {
        net: "LOGIC",
        layers: ["top"],
        pts: [
          [10, 22],
          [50, 22],
        ],
        width: 0.25,
      }),
    ).toEqual([]);
  });

  it("sets a clearance and a track width inside an area only", () => {
    const area: BoardRule = { id: "a", name: "Fine", kind: "area", area: areaRect(0, 15, 25, 25), clearance: 1, trackWidth: 0.15 };
    const d = board([area]);
    expect(clashes(d)).toHaveLength(1);
    // Moved out of the area, the same pair of tracks passes.
    const away = board([{ ...area, area: areaRect(0, 30, 25, 38) }]);
    expect(clashes(away)).toEqual([]);
    expect(netRules(d.board!, "HV", [5, 20]).trackWidth).toBe(0.15);
    expect(netRules(d.board!, "HV", [55, 5]).trackWidth).toBe(0.5);
  });

  it("is added, changed and taken away", () => {
    let d = board();
    const made = addRule(d, "area");
    d = changeRule(made.design, made.id, { clearance: 0.4, trackWidth: 0.2 });
    expect(d.board!.customRules![0]).toMatchObject({ kind: "area", clearance: 0.4, trackWidth: 0.2 });
    d = changeRule(d, made.id, { trackWidth: undefined });
    expect(d.board!.customRules![0]!.trackWidth).toBeUndefined();
    expect(removeRule(d, made.id).board!.customRules).toBeUndefined();
  });

  it("reads KiCad's simplest rules, and goes out to KiCad and back", () => {
    const read = readDru(
      `(version 1)
(rule "HV" (constraint clearance (min 1.5mm)) (condition "A.NetClass == 'Mains' && B.NetClass == 'Default'"))
(rule "BGA" (constraint clearance (min 0.1mm)) (constraint track_width (min 0.1mm) (opt 0.12mm)) (condition "A.insideArea('BGA')"))
(rule "Holes" (constraint hole_size (min 0.3mm)) (condition "A.Type == 'Via'"))
(rule "Lost" (constraint clearance (min 1mm)) (condition "A.insideArea('Gone')"))`,
      new Map([["BGA", areaRect(0, 0, 5, 5)]]),
    );
    expect(read.rules.map((r) => [r.name, r.kind, r.clearance, r.trackWidth])).toEqual([
      ["HV", "classes", 1.5, undefined],
      ["BGA", "area", 0.1, 0.12],
    ]);
    expect(read.skipped.map((s) => s.name)).toEqual(["Holes", "Lost"]);

    const d = board([
      { id: "r", name: "Mains to logic", kind: "classes", a: "Mains", b: "Default", clearance: 1 },
      { id: "a", name: "Fine", kind: "area", area: areaRect(0, 15, 25, 25), clearance: 0.3, trackWidth: 0.15 },
    ]);
    const out = kicadProject(d, "rules");
    expect(out.files.some((f) => f.name === "rules.kicad_dru")).toBe(true);
    const back = importKicadProject(out.files.map((f) => ({ name: f.name, text: f.text }))).design.board!;
    expect(back.customRules?.map((r) => [r.name, r.kind, r.clearance, r.trackWidth])).toEqual([
      ["Mains to logic", "classes", 1, undefined],
      ["Fine", "area", 0.3, 0.15],
    ]);
    expect(back.keepouts).toEqual([]);
  });
});
