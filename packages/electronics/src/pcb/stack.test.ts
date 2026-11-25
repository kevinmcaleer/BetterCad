import { describe, expect, it } from "vitest";
import { boardPads, ratsnest } from "../board";
import type { ElectronicsDesign, P2 } from "../model";
import { drillFiles } from "../fab/drill";
import { gerberFiles, gerberLayers } from "../fab/gerber";
import { orderPack } from "../fab/pack";
import { kicadProject } from "../kicad/export";
import { importKicadProject } from "../kicad/project";
import { sampleBoard } from "../sample";
import { autoroute } from "./autoroute";
import { checkBoard } from "./drc";
import { addPour, wholeBoard } from "./pour";
import { addTrack, addVia } from "./route";
import { STACKS, buildOf, layerDepths, layerName, layersOf, setStack, setViaSpan, stackLoses, stackOf, viaKind, viaLayers } from "./stack";
import { boardState } from "./state";

const bare = (d: ElectronicsDesign): ElectronicsDesign => ({ ...d, board: { ...d.board!, tracks: [], vias: [], pours: [] } });
const four = () => setStack(bare(sampleBoard()), "4");
const rules = (d: ElectronicsDesign) => checkBoard(d).map((r) => r.rule);

describe("the board's layers (#648)", () => {
  it("names the layers of two, four and six layer boards, top to bottom", () => {
    expect(layersOf({ copperLayers: 2 })).toEqual(["top", "bottom"]);
    expect(layersOf({ copperLayers: 4 })).toEqual(["top", "in1", "in2", "bottom"]);
    expect(layersOf({ copperLayers: 6 }).map(layerName)).toEqual([
      "Top copper",
      "Inner 1 copper",
      "Inner 2 copper",
      "Inner 3 copper",
      "Inner 4 copper",
      "Bottom copper",
    ]);
  });

  it("has a build for each count whose sheets add up, and fits it to the board's thickness", () => {
    for (const s of STACKS) {
      expect(s.plies.filter((p) => p.kind === "copper").map((p) => p.layer)).toEqual(layersOf({ copperLayers: s.layers }));
      expect(s.thickness).toBeCloseTo(1.6, 6);
    }
    const thin = { copperLayers: 4 as const, thickness: 0.8 };
    expect(stackOf(thin).id).toBe("4");
    expect(buildOf(thin).reduce((n, p) => n + p.thickness, 0)).toBeCloseTo(0.8, 2);
    const z = layerDepths({ copperLayers: 4, thickness: 1.6 });
    expect(z.top).toBe(0);
    expect(z.in1).toBeCloseTo(0.235, 3);
    expect(z.bottom).toBeCloseTo(1.565, 3);
  });

  it("says which layers a via joins, and what kind that makes it", () => {
    const b = { copperLayers: 4 as const };
    expect(viaLayers(b, {})).toEqual(["top", "in1", "in2", "bottom"]);
    expect(viaLayers(b, { span: ["in1", "top"] })).toEqual(["top", "in1"]);
    expect(viaKind(b, { span: ["top", "in1"] })).toBe("blind");
    expect(viaKind(b, { span: ["in1", "in2"] })).toBe("buried");
    expect(viaKind(b, { span: ["top", "bottom"] })).toBe("through");
    // A span the board no longer has is a via right through.
    expect(viaLayers({ copperLayers: 2 }, { span: ["top", "in1"] })).toEqual(["top", "bottom"]);
  });

  it("gives a via a span, and takes it back when the span is the whole board", () => {
    let d = addVia(four(), "5V", 30, 40);
    const id = d.board!.vias[0]!.id;
    d = setViaSpan(d, id, ["in2", "top"]);
    expect(d.board!.vias[0]!.span).toEqual(["top", "in2"]);
    expect(setViaSpan(d, id, ["top", "bottom"]).board!.vias[0]!.span).toBeUndefined();
    expect(setViaSpan(d, id).board!.vias[0]!.span).toBeUndefined();
    expect(addVia(four(), "5V", 30, 40, ["top", "in1"]).board!.vias[0]!.span).toEqual(["top", "in1"]);
    expect(addVia(four(), "5V", 30, 40, ["top", "bottom"]).board!.vias[0]!.span).toBeUndefined();
  });

  it("going back to two layers takes the inner copper with it", () => {
    let d = four();
    d = addTrack(d, "5V", "in1", [
      [5, 5],
      [10, 5],
    ]);
    d = addPour(d, "GND", "in2", wholeBoard(d.board!));
    d = addVia(d, "5V", 5, 5, ["top", "in1"]);
    expect(stackLoses(d.board!, "2")).toEqual({ tracks: 1, pours: 1 });
    expect(stackLoses(d.board!, "6")).toEqual({ tracks: 0, pours: 0 });
    const two = setStack(d, "2").board!;
    expect(two).toMatchObject({ copperLayers: 2, stack: "2", tracks: [], pours: [] });
    expect(two.vias[0]!.span).toBeUndefined();
    expect(two.thickness).toBe(d.board!.thickness);
  });
});

describe("copper on inner layers", () => {
  const pad = (d: ElectronicsDesign, net: string): P2 => boardPads(d).find((p) => p.net === net && p.pad.kind === "thru")!.at;

  it("joins through pads on an inner layer, and an inner plane joins its net", () => {
    const d = four();
    const todo = (x: ElectronicsDesign) => {
      const s = boardState(x);
      return ratsnest(s.pads, s.joined).filter((a) => a.net === "GND").length;
    };
    expect(todo(d)).toBeGreaterThan(0);
    const plane = addPour(d, "GND", "in1", wholeBoard(d.board!));
    expect(todo(plane)).toBeLessThan(todo(d));
    expect(rules(plane)).not.toContain("short");
    expect(rules(plane)).not.toContain("clearance");
  });

  it("checks an inner track against what shares its layer, and not against the outside", () => {
    const d = four();
    const a = pad(d, "5V");
    const other = boardPads(d).find((p) => p.net && p.net !== "5V" && p.pad.kind === "thru")!;
    // Across another net's through pad: it has copper on every layer, so this is a short.
    const across = addTrack(d, "5V", "in1", [a, other.at]);
    expect(rules(across)).toContain("short");
    // Under a surface pad of another net: nothing of it is on the inner layer.
    const smd = boardPads(d).find((p) => p.net && p.net !== "5V" && p.pad.kind === "smd")!;
    const under = addTrack(d, "5V", "in1", [
      [smd.at[0] - 0.4, smd.at[1]],
      [smd.at[0] + 0.4, smd.at[1]],
    ]);
    expect(checkBoard(under).filter((r) => r.rule === "short" || r.rule === "clearance")).toEqual([]);
    expect(
      checkBoard(
        addTrack(d, "5V", "top", [
          [smd.at[0] - 0.4, smd.at[1]],
          [smd.at[0] + 0.4, smd.at[1]],
        ]),
      ).some((r) => r.rule === "short"),
    ).toBe(true);
  });

  it("warns of a via that stops part of the way, and of copper on a layer the board lacks", () => {
    const d = addVia(four(), "5V", 30, 40, ["top", "in1"]);
    const found = checkBoard(d).find((r) => r.rule === "via-span")!;
    expect(found).toMatchObject({ level: "warning", text: "A via on 5V is blind: it joins Top copper to Inner 1 copper only." });
    const lost = {
      ...d,
      board: {
        ...d.board!,
        copperLayers: 2 as const,
        tracks: [
          {
            id: "t1",
            net: "5V",
            layer: "in2" as const,
            width: 0.25,
            pts: [
              [5, 5],
              [9, 5],
            ] as P2[],
          },
        ],
      },
    };
    expect(checkBoard(lost).find((r) => r.rule === "layer-gone")!.text).toBe("A track on 5V is on Inner 2 copper, a layer this board does not have.");
  });

  it("the autorouter uses the inner layers, leaves a plane whole, and passes the check", () => {
    const d = addPour(four(), "GND", "in1", wholeBoard(four().board!));
    const r = autoroute(d);
    expect(r.failed).toEqual([]);
    expect(r.design.board!.tracks.some((t) => t.layer === "in1")).toBe(false);
    expect(checkBoard(r.design).filter((x) => x.level === "error")).toEqual([]);
    const sides = autoroute(four(), { layers: ["in1", "in2"] });
    expect(sides.routed).toBeGreaterThan(0);
    expect(new Set(sides.design.board!.tracks.map((t) => t.layer))).toEqual(new Set(["in1", "in2"]));
  });
});

describe("files for a board with inner layers", () => {
  const made = () => {
    let d = four();
    const at = boardPads(d).find((p) => p.net === "5V" && p.pad.kind === "thru")!.at;
    d = addTrack(d, "5V", "in2", [at, [at[0] + 3, at[1] + 3]]);
    d = addVia(d, "5V", at[0] + 3, at[1] + 3, ["in2", "bottom"]);
    return addPour(d, "GND", "in1", wholeBoard(d.board!));
  };

  it("writes a copper file a layer, numbered down from the top", () => {
    const d = made();
    expect(
      gerberLayers(d.board!)
        .slice(0, 4)
        .map((l) => `${l.id} ${l.fn}`),
    ).toEqual(["copper-top Copper,L1,Top", "copper-in1 Copper,L2,Inr", "copper-in2 Copper,L3,Inr", "copper-bottom Copper,L4,Bot"]);
    expect(
      gerberLayers({ copperLayers: 2 })
        .map((l) => l.fn)
        .slice(0, 2),
    ).toEqual(["Copper,L1,Top", "Copper,L2,Bot"]);
    const files = gerberFiles(d);
    const text = (id: string) => files.find((f) => f.layer === id)!.text;
    expect(text("copper-in2")).toContain("%TF.FileFunction,Copper,L3,Inr*%");
    // The inner track is in its own layer's file only; the blind via is on the layers it joins.
    expect(text("copper-in2")).toContain("Conductor");
    expect(text("copper-top")).not.toContain("Conductor");
    expect(text("copper-in2")).toContain("ViaPad");
    expect(text("copper-bottom")).toContain("ViaPad");
    expect(text("copper-in1")).not.toContain("ViaPad");
    expect(text("copper-top")).not.toContain("ViaPad");
    // Through pads have copper on the inner layers; surface pads do not.
    expect(text("copper-in1")).toContain("ComponentPad");
    expect(text("copper-in1")).not.toContain("SMDPad");
  });

  it("drills blind and buried vias in files of their own, and names every file", () => {
    const d = made();
    const drills = drillFiles(d)!;
    expect(drills.plated).toContain("TF.FileFunction,Plated,1,4,PTH");
    expect(drills.spans.map((s) => `${s.from}-${s.to}`)).toEqual(["3-4"]);
    expect(drills.spans[0]!.text).toContain("TF.FileFunction,Plated,3,4,Blind");
    expect(drills.holes.filter((h) => h.span)).toHaveLength(1);
    const pack = orderPack(d, "jlcpcb", "Rover")!;
    expect(pack.facts.layers).toBe(4);
    expect(pack.gerbers.map((g) => g.name)).toEqual(
      expect.arrayContaining(["Rover.GTL", "Rover.G1", "Rover.G2", "Rover.GBL", "Rover-PTH.DRL", "Rover-L3-L4.DRL"]),
    );
  });

  it("goes out to KiCad with its inner layers and its blind via, and comes back the same", () => {
    const d = made();
    const files = kicadProject(d, "trip").files;
    const text = files.find((f) => f.name.endsWith(".kicad_pcb"))!.text;
    expect(text).toContain('(1 "In1.Cu" signal)');
    expect(text).toContain('(2 "In2.Cu" signal)');
    expect(text).toMatch(/\(segment[\s\S]*?\(layer "In2\.Cu"\)/);
    expect(text).toMatch(/\(via blind[\s\S]*?\(layers "In2\.Cu" "B\.Cu"\)/);
    expect(text).toMatch(/\(zone[\s\S]*?\(layer "In1\.Cu"\)/);

    const back = importKicadProject(files, { licence: "CC0" }).design.board!;
    expect(back.copperLayers).toBe(4);
    expect(back.tracks.map((t) => t.layer)).toEqual(["in2"]);
    expect(back.vias.map((v) => v.span)).toEqual([["in2", "bottom"]]);
    expect(back.pours.map((p) => `${p.net} ${p.layer}`)).toEqual(["GND in1"]);
  });
});
