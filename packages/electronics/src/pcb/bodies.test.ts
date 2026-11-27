import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHIP_0805, header, headerFootprint } from "../basics";
import type { LibraryPack } from "../library/pack";
import type { FootprintDef, Model3D } from "../model";
import { sampleBoard } from "../sample";
import { drawnBody, type BodyPiece } from "./bodies";
import { boardSolid, drawBodiesWith } from "./solid";

drawBodiesWith(drawnBody);

const starter = JSON.parse(readFileSync(join(__dirname, "../../library/starter.json"), "utf8")) as LibraryPack;
const fp = (name: string): FootprintDef => (starter.footprints as unknown as Record<string, FootprintDef>)[name]!;
const modelOf = (name: string): Model3D | undefined => starter.parts.flatMap((p) => p.packages).find((p) => p.footprint === name)?.model;
const ask = (name: string, prefix = "U") => drawnBody({ name, prefix, footprint: fp(name), ...(modelOf(name) ? { model: modelOf(name)! } : {}) });
const of = (pieces: BodyPiece[] | null, material: BodyPiece["material"]) => pieces?.find((p) => p.material === material)?.blocks ?? [];
const top = (b: { at: number[]; size: number[] }) => b.at[2]! + b.size[2]!;

describe("true bodies for the starter parts (#752)", () => {
  it("gives every part on the sample board a true body, in more than one material", () => {
    const solid = boardSolid(sampleBoard())!;
    expect(solid.bodies.length).toBeGreaterThan(10);
    for (const b of solid.bodies) {
      expect(b.drawn, b.ref).toBeDefined();
      expect(b.drawn!.length, b.ref).toBeGreaterThan(1);
    }
    // Asked for boxes, it still has them.
    expect(boardSolid(sampleBoard(), undefined, false)!.bodies.every((b) => !b.drawn)).toBe(true);
  });

  it("draws a pin header as a black strip with gold pins through it, and a socket as a tall housing", () => {
    const pins = drawnBody({ name: headerFootprint(3).name, prefix: "J", footprint: headerFootprint(3), model: header(3).packages[0]!.model! })!;
    const [strip] = of(pins, "plastic-black");
    expect(strip).toMatchObject({ size: [2.54, 7.62, 2.5] });
    const gold = of(pins, "gold");
    expect(gold).toHaveLength(3);
    expect(gold.every((g) => g.at[2] < 0 && top(g) > 8)).toBe(true);
    const socket = drawnBody({ name: headerFootprint(20).name, prefix: "J", footprint: headerFootprint(20), model: header(20, true).packages[0]!.model! })!;
    expect(of(socket, "plastic-black")[0]!.size[2]).toBe(8.5);
    expect(of(socket, "gold").every((g) => top(g) <= 0)).toBe(true);
    expect(ask("PinSocket_2x05_P2.54mm_Vertical", "J")).not.toBeNull();
  });

  it("tells a resistor from a capacitor and an LED of the same size, by its reference", () => {
    const fp0805 = CHIP_0805();
    const box: Model3D = { source: { kind: "box", size: [2, 1.25, 0.5] } };
    const r = drawnBody({ name: fp0805.name, prefix: "R", footprint: fp0805, model: box })!;
    const c = drawnBody({ name: fp0805.name, prefix: "C", footprint: fp0805, model: box })!;
    const d = drawnBody({ name: fp0805.name, prefix: "D", footprint: fp0805, model: box })!;
    expect(r.map((p) => p.material)).toEqual(["metal", "plastic-black"]);
    expect(c.map((p) => p.material)).toEqual(["metal", "ceramic"]);
    expect(d.map((p) => p.material)).toEqual(["metal", "plastic-white", "led"]);
    // The tinned ends are at the two ends, the full width and height.
    const ends = of(r, "metal");
    expect(ends.map((e) => e.at[0])).toEqual([-0.8, 0.8]);
    expect(ends[0]!.size).toEqual([0.4, 1.25, 0.5]);
  });

  it("gives a DIP a lead through the board at every pad, and a gull-wing chip a lead out to every pad", () => {
    const dip = ask("DIP-16_W7.62mm")!;
    const legs = of(dip, "metal").filter((b) => b.at[2] < 0);
    expect(legs).toHaveLength(16);
    const pads = fp("DIP-16_W7.62mm").pads;
    for (const p of pads) expect(legs.some((l) => Math.abs(l.at[0] - p.x) < 1e-6 && Math.abs(l.at[1] - p.y) < 1e-6)).toBe(true);
    const [body] = of(dip, "plastic-black");
    expect(body!.at[2]).toBe(0.5);
    const soic = ask("SOIC-8_3.9x4.9mm_P1.27mm")!;
    // A foot on each pad and a riser up to the body.
    expect(of(soic, "metal")).toHaveLength(16);
    const sot = ask("SOT-23")!;
    expect(of(sot, "metal")).toHaveLength(6);
  });

  it("covers the most used connectors, switches, modules and chips in the starter library", () => {
    const names = Object.keys(starter.footprints);
    const covered = names.filter((n) => ask(n) !== null);
    for (const family of [
      /^PinHeader_1x\d+_P2.54mm_Vertical$/,
      /^PinSocket_/,
      /^JST_(SH|PH|XH)_/,
      /^DIP-/,
      /^SOIC-/,
      /^TSSOP-/,
      /^SOT-23/,
      /^(R|C|L|LED)_0805/,
      /^SW_SPDT_PCM12$/,
      /^SW_PUSH_6mm$/,
      /^USB_C_/,
      /^ESP32-WROOM-32$/,
      /^LED_D5.0mm$/,
      /^CP_Radial/,
      /^TO-220-3_Vertical$/,
      /^QFN-/,
      /^BarrelJack_/,
      /^TerminalBlock_/,
      /^TO-92_Inline$/,
      /^ESP32-C3-DevKitM-1$/,
      /^USB_Micro-B_/,
      /^PinHeader_2x20_P2.54mm_Vertical$/,
      /^(R|C)_0402/,
      /^(R|C)_1206/,
      /^LED_D3.0mm$/,
    ])
      expect(
        covered.some((n) => family.test(n)),
        String(family),
      ).toBe(true);
    // Every block of every body has a size.
    for (const n of covered)
      for (const p of ask(n)!)
        for (const b of p.blocks)
          expect(
            b.size.every((v) => v > 0),
            n,
          ).toBe(true);
    // An ESP module's can leaves its antenna bare.
    const esp = ask("ESP32-WROOM-32")!;
    const [board] = of(esp, "module");
    const [can] = of(esp, "metal");
    expect(can!.size[0] * can!.size[1]).toBeLessThan(board!.size[0] * board!.size[1] * 0.85);
    // A part no rule knows keeps its box.
    expect(ask("Relay_SPDT_Omron-G5LE-1")).toBeNull();
  });
});
