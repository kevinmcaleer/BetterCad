import { describe, expect, it } from "vitest";
import { boardPads } from "./board";
import { check } from "./erc";
import { netlist } from "./nets";
import { drillFiles } from "./fab/drill";
import { gerberFiles } from "./fab/gerber";
import { csv, orderPack } from "./fab/pack";
import { inkAt, readGerber } from "./fab/read";
import { checkBoard } from "./pcb/drc";
import { boardState } from "./pcb/state";
import { sampleBoard } from "./sample";

describe("the sample board", () => {
  const d = sampleBoard();

  it("is the same every time it is built", () => {
    expect(JSON.stringify(sampleBoard())).toBe(JSON.stringify(d));
  });

  it("has the nets its schematic names and passes the electrical rules", () => {
    const nl = netlist(d);
    expect(nl.nets.map((n) => n.name).sort()).toEqual(["5V", "GND", "LED", "SERVO1", "SERVO2"]);
    expect(nl.nets.find((n) => n.name === "5V")!.pins).toHaveLength(6);
    expect(nl.nets.find((n) => n.name === "GND")!.pins).toHaveLength(7);
    expect(
      check(d)
        .filter((r) => !r.waived)
        .map((r) => `${r.rule}: ${r.text}`),
    ).toEqual([]);
  });

  it("is routed, with every ground pad joined by the pours, and passes the board rules", () => {
    expect(d.board!.placements).toHaveLength(8);
    expect(
      checkBoard(d)
        .filter((r) => !r.waived)
        .map((r) => `${r.rule}: ${r.text}`),
    ).toEqual([]);
    const state = boardState(d);
    const pads = boardPads(d);
    const groups = new Set(pads.map((p, i) => (p.net === "GND" ? state.groups[i] : -1)).filter((g) => g !== -1));
    expect(groups.size).toBe(1);
  });

  it("goes all the way to an order pack", async () => {
    const pack = orderPack(d, "jlcpcb", "Pico servo board")!;
    expect(pack.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(["part-numbers"]);
    expect(pack.facts).toEqual({ width: 60, height: 58, thickness: 1.6, layers: 2, minTrack: 0.3, minGap: 0.2, minHole: 1 });
    expect(pack.tools).toEqual([
      { tool: 1, d: 1, plated: true, holes: 48, slots: 0 },
      { tool: 1, d: 3.2, plated: false, holes: 4, slots: 0 },
    ]);
    expect(pack.bom.rows.map((r) => `${r.qty} ${r.refs.join(" ")}`)).toEqual(["1 C1", "1 D1", "1 J1", "1 J2", "1 J3", "1 J4", "1 J5", "1 R1"]);
    await expect(csv(pack.placeTable)).toMatchFileSnapshot("./fab/golden/sample.jlcpcb-cpl.csv");
    await expect(csv(pack.bomTable)).toMatchFileSnapshot("./fab/golden/sample.jlcpcb-bom.csv");
    for (const f of gerberFiles(d)) await expect(f.text).toMatchFileSnapshot(`./fab/golden/sample.${f.layer}.gbr`);
    await expect(drillFiles(d)!.plated).toMatchFileSnapshot("./fab/golden/sample.plated.drl");
    // In the files, the servo's ground pin is joined to the pour by spokes and its signal pin is not.
    const bottom = readGerber(gerberFiles(d).find((f) => f.layer === "copper-bottom")!.text);
    const gnd = pads(d, "J3", 3);
    const sig = pads(d, "J3", 1);
    expect(inkAt(bottom, [gnd[0] + 1.0, gnd[1]])).toBe(true);
    expect(inkAt(bottom, [sig[0] - 1.0, sig[1]])).toBe(false);
    expect(inkAt(bottom, [sig[0] - 1.3, sig[1]])).toBe(true);
  });
});

const pads = (d: ReturnType<typeof sampleBoard>, ref: string, n: number) => boardPads(d).find((p) => p.ref === ref && p.pad.number === String(n))!.at;
