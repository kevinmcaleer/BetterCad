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
import starter from "../library/starter.json";
import { inflate, type LibraryPack } from "./library/pack";
import { sampleBoard } from "./sample";
import sampleParts from "./sample.parts.json";

describe("the sample board", () => {
  const d = sampleBoard();

  it("is the same every time it is built", () => {
    expect(JSON.stringify(sampleBoard())).toBe(JSON.stringify(d));
  });

  it("carries its library parts as the starter library has them", () => {
    const pack = starter as unknown as LibraryPack;
    for (const [id, def] of Object.entries(sampleParts))
      expect(def, id).toEqual(
        JSON.parse(
          JSON.stringify(
            inflate(
              pack,
              pack.parts.find((p) => p.id === id)!,
            ),
          ),
        ),
      );
  });

  it("has the nets its schematic names and passes the electrical rules", () => {
    const nl = netlist(d);
    expect(nl.nets.map((n) => n.name).sort()).toEqual(
      [
        "3V3",
        "5V",
        "GND",
        "LED",
        "MOTOR_A1",
        "MOTOR_A2",
        "MOTOR_A_OUT1",
        "MOTOR_A_OUT2",
        "MOTOR_B1",
        "MOTOR_B2",
        "MOTOR_B_OUT1",
        "MOTOR_B_OUT2",
        "SCL",
        "SDA",
        "SERVO1",
        "SERVO2",
        "VIN",
      ].sort(),
    );
    // 5 V comes through the switch to the Pico, the servos, the LED, the capacitor and the motor driver's four supply pins.
    expect(
      nl.nets
        .find((n) => n.name === "5V")!
        .pins.map((p) => `${p.ref}.${p.pin}`)
        .sort(),
    ).toEqual(["C1.1", "J2.2", "J3.2", "J4.2", "R1.1", "SW1.3", "U1.1", "U1.16", "U1.8", "U1.9"].sort());
    expect(
      nl.nets
        .find((n) => n.name === "VIN")!
        .pins.map((p) => `${p.ref}.${p.pin}`)
        .sort(),
    ).toEqual(["J5.1", "SW1.2"]);
    expect(nl.nets.find((n) => n.name === "GND")!.pins).toHaveLength(12);
    expect(
      check(d)
        .filter((r) => !r.waived)
        .map((r) => `${r.rule}: ${r.text}`),
    ).toEqual([]);
  });

  it("is routed, with every ground pad joined by the pours, and passes the board rules", () => {
    expect(d.board!.placements).toHaveLength(13);
    expect(
      checkBoard(d)
        .filter((r) => !r.waived)
        .map((r) => `${r.rule}: ${r.text}`),
    ).toEqual([]);
    const state = boardState(d);
    const pads = boardPads(d);
    const groups = new Set(pads.map((p, i) => (p.net === "GND" ? state.groups[i] : -1)).filter((g) => g !== -1));
    expect(groups.size).toBe(1);
    // Nothing is left unrouted: every net's pads are in one group.
    const nets = new Map<string, Set<number>>();
    pads.forEach((p, i) => p.net && nets.set(p.net, (nets.get(p.net) ?? new Set()).add(state.groups[i]!)));
    expect([...nets].filter(([, g]) => g.size > 1).map(([n]) => n)).toEqual([]);
  });

  it("goes all the way to an order pack", async () => {
    const pack = orderPack(d, "jlcpcb", "Pico servo board")!;
    expect(pack.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(["part-numbers"]);
    expect(pack.facts).toEqual({ width: 60, height: 80, thickness: 1.6, layers: 2, minTrack: 0.3, minGap: 0.2, minHole: 0.3 });
    // One via, the motor driver's 16 pins, the headers' 52, and bare holes for the switch's pegs and the mounting screws.
    expect(pack.tools).toEqual([
      { tool: 1, d: 0.3, plated: true, holes: 1, slots: 0 },
      { tool: 2, d: 0.8, plated: true, holes: 16, slots: 0 },
      { tool: 3, d: 1, plated: true, holes: 52, slots: 0 },
      { tool: 1, d: 0.9, plated: false, holes: 2, slots: 0 },
      { tool: 2, d: 3.2, plated: false, holes: 4, slots: 0 },
    ]);
    expect(pack.bom.rows.map((r) => `${r.qty} ${r.refs.join(" ")}`)).toEqual(BOM);
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

const BOM = ["1 C1", "1 D1", "1 J1", "1 J2", "1 J3", "1 J4", "1 J5", "1 J6", "1 J7", "1 J8", "1 R1", "1 SW1", "1 U1"];
const pads = (d: ReturnType<typeof sampleBoard>, ref: string, n: number) => boardPads(d).find((p) => p.ref === ref && p.pad.number === String(n))!.at;
