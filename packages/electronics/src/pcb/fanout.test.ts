import { describe, expect, it } from "vitest";
import { addLabel, placePart } from "../edit";
import { placeOnSheet } from "../geom";
import { dualFootprint, headerPins, icSymbol, quadFootprint } from "../library/wizards";
import { emptyDesign, withFixedIds, type ComponentDef, type ElectronicsDesign, type FootprintDef } from "../model";
import { pushToBoard } from "../sync";
import { applyRoutes, autoroute, type Route } from "./autoroute";
import { checkBoard } from "./drc";
import { fanOut } from "./fanout";
import { roundedOutline, setBoard, setPlacement } from "./route";
import { boardState } from "./state";

/** A chip with every pad wired out to a header across the board, nothing routed. */
function chipBoard(fp: FootprintDef): ElectronicsDesign {
  return withFixedIds(() => {
    const n = fp.pads.length;
    const def = (name: string, prefix: string, footprint: FootprintDef): ComponentDef => ({
      name,
      prefix,
      symbol: icSymbol(
        name,
        footprint.pads.map((p) => ({ number: p.number, name: `P${p.number}`, type: "passive" })),
      ),
      packages: [{ footprint }],
    });
    let d = emptyDesign();
    const chip = placePart(d, "sh1", def("Chip", "U", fp), { x: 0, y: 0 });
    const head = placePart(chip.design, "sh1", def("Header", "J", headerPins("Header", { rows: 2, pins: Math.ceil(n / 2), pitch: 2.54, drill: 1, pad: 1.7 })), {
      x: 200,
      y: 0,
    });
    d = head.design;
    for (const { part, def: id } of [chip.part, head.part].map((p) => ({ part: p, def: d.parts.find((x) => x.id === p.id)!.def }))) {
      const sym = d.sheets[0]!.symbols.find((s) => s.part === part.id)!;
      for (const pin of d.defs[id]!.symbol.pins) {
        const [x, y] = placeOnSheet([pin.x, pin.y], sym);
        d = addLabel(d, "sh1", `N${pin.number}`, x, y);
      }
    }
    d = pushToBoard(d).design;
    d = setBoard(d, { outline: roundedOutline(90, 60) });
    d = setPlacement(d, chip.part.id, { x: 25, y: 30, rot: 0, side: "top" });
    // The header's pin 1 is at its origin, and its rows run down from there.
    d = setPlacement(d, head.part.id, { x: 70, y: 55, rot: 0, side: "top" });
    return d;
  });
}

const FAMILIES: [string, FootprintDef][] = [
  ["SOIC-8, 1.27 mm", dualFootprint("SOIC-8", { pins: 8, pitch: 1.27, span: 5.4, padW: 1.55, padH: 0.6, bodyW: 3.9, bodyL: 4.9 })],
  ["TSSOP-20, 0.65 mm", dualFootprint("TSSOP-20", { pins: 20, pitch: 0.65, span: 5.8, padW: 1.5, padH: 0.4, bodyW: 4.4, bodyL: 6.5 })],
  ["QFP-44, 0.8 mm", quadFootprint("QFP-44", { pins: 44, pitch: 0.8, span: 11.2, padW: 1.5, padH: 0.55, body: 10 })],
  ["QFN-32, 0.5 mm", quadFootprint("QFN-32", { pins: 32, pitch: 0.5, span: 4.8, padW: 0.8, padH: 0.25, body: 5 })],
];

const chipOf = (d: ElectronicsDesign) => d.parts.find((p) => p.ref.startsWith("U"))!.id;
const errors = (d: ElectronicsDesign) => checkBoard(d).filter((r) => r.rule !== "unrouted" && r.rule !== "track-open" && r.level === "error");

describe("fan-out (#746)", () => {
  for (const [name, fp] of FAMILIES)
    it(`gives every pad of a ${name} chip a track and a via, clear of everything`, () => {
      const d = chipBoard(fp);
      const r = fanOut(d, [chipOf(d)]);
      expect(r.stuck.map((x) => x.pad)).toEqual([]);
      expect(r.fanned).toBe(fp.pads.length);
      expect(r.design.board!.vias).toHaveLength(fp.pads.length);
      expect(r.design.board!.tracks).toHaveLength(fp.pads.length);
      expect(errors(d)).toEqual([]);
      expect(errors(r.design)).toEqual([]);
      // Each via is on its pad's net, and each pad's connection now starts from copper of its own.
      const s = boardState(r.design);
      for (const v of r.design.board!.vias) expect(s.pads.some((p) => p.net === v.net)).toBe(true);
    });

  it("leaves pads already joined, and pads with no connection to make", () => {
    const d = chipBoard(FAMILIES[0]![1]);
    const once = fanOut(d, [chipOf(d)]).design;
    const again = fanOut(once, [chipOf(d)]);
    expect(again.fanned).toBe(0);
    const none = fanOut(d, [d.parts.find((p) => p.ref.startsWith("J"))!.id]);
    expect(none.fanned).toBe(0);
  });

  it("lets the autorouter get away from pads it could not leave", () => {
    // On a coarse grid the router's cells miss a fine-pitch chip's pads, and the pads hem each other in.
    const d = chipBoard(FAMILIES[1]![1]);
    const plain = autoroute(d, { fanout: false, pitch: 0.25 });
    const seen: Route[] = [];
    const fanned = autoroute(d, { pitch: 0.25, onProgress: (p) => p.route && seen.push(p.route) });
    expect(fanned.failed.length).toBeLessThan(plain.failed.length);
    expect(fanned.design.board!.vias.length).toBeGreaterThan(plain.design.board!.vias.length);
    expect(errors(fanned.design)).toEqual([]);
    // What the page hears about lays the same board, the fan-outs' smaller vias included.
    expect(seen).toEqual(fanned.routes);
    expect(applyRoutes(d, seen).board!.vias.map((v) => [v.x, v.y, v.diameter])).toEqual(fanned.design.board!.vias.map((v) => [v.x, v.y, v.diameter]));
  });
});
