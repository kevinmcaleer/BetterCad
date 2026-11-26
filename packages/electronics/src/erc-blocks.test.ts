import { describe, expect, it } from "vitest";
import { buildBlock, placeBlock } from "./blocks";
import { lookup } from "./blocks.test";
import { joinI2c, joinPoint } from "./connect";
import { placePart } from "./edit";
import { check } from "./erc";
import { STARTER_BLOCKS } from "./library/blocks";
import { emptyDesign, type ElectronicsDesign } from "./model";

const spec = (id: string) => STARTER_BLOCKS.find((b) => b.id === id)!;
const place = (d: ElectronicsDesign, id: string, at: [number, number]) => placeBlock(d, "sh1", buildBlock(spec(id), lookup), at).design;
const pointAt = (d: ElectronicsDesign, block: number, name: string): [number, number] => {
  const sheet = d.sheets[0]!;
  const g = sheet.groups![block]!;
  const label = g.block!.points.find((p) => p.name === name)!.label;
  const l = sheet.labels.find((x) => x.id === label)!;
  return [l.x, l.y];
};

describe("the rules check on circuit blocks (#771)", () => {
  it.each(STARTER_BLOCKS.map((b) => b.id))("passes %s on its own, saying only which points it needs", (id) => {
    const results = check(place(emptyDesign(), id, [0, 0]));
    expect(results.filter((r) => r.rule !== "block-point-open").map((r) => r.text)).toEqual([]);
  });

  it("says in plain words that a motor driver needs its motor supply", () => {
    const results = check(place(emptyDesign(), "drv8833", [0, 0]));
    const vm = results.find((r) => r.rule === "block-point-open" && r.text.includes(" VM "));
    expect(vm?.text).toMatch(/needs VM joined \(2\.7 to 10\.8 V\)\. Motor supply\./);
    expect(vm?.fix).toMatch(/Connect to/);
    expect(vm?.level).toBe("error");
  });

  it("catches 5 V joined to a 3.3 V input", () => {
    let d = place(emptyDesign(), "boost-5v", [0, 0]);
    d = place(d, "qwiic", [200, 0]);
    d = joinPoint(d, "sh1", pointAt(d, 0, "5V"), pointAt(d, 1, "3V3"));
    const volts = check(d).find((r) => r.rule === "block-volts");
    expect(volts?.text).toMatch(/3V3 takes 3\.3 V, but it is joined to 5 V\./);
    expect(volts?.fix).toMatch(/regulator/);
  });

  it("catches two supplies joined together", () => {
    let d = place(emptyDesign(), "reg-3v3-linear", [0, 0]);
    d = place(d, "reg-3v3-buck", [200, 0]);
    d = joinPoint(d, "sh1", pointAt(d, 0, "3V3"), pointAt(d, 1, "3V3"));
    expect(check(d).some((r) => r.rule === "block-two-outputs")).toBe(true);
  });

  it("is happy with one pair of I2C pull-ups and warns about too many", () => {
    const pico = placePart(emptyDesign(), "sh1", lookup("pico")!, { x: 0, y: 0 }).design;
    let d = place(pico, "qwiic", [60, 40]);
    d = joinI2c(d, "sh1", d.sheets[0]!.groups![0]!.id).design;
    expect(check(d).filter((r) => r.rule === "i2c-pullups")).toEqual([]);
    for (const at of [
      [200, 40],
      [340, 40],
    ] as [number, number][]) {
      d = place(d, "qwiic", at);
      const groups = d.sheets[0]!.groups!;
      d = joinPoint(d, "sh1", pointAt(d, groups.length - 1, "SDA"), pointAt(d, 0, "SDA"));
    }
    expect(check(d).some((r) => r.rule === "i2c-pullups" && /QW1\.SDA has 3 pull-up resistors/.test(r.text))).toBe(true);
    expect(check(d).some((r) => r.rule === "net-two-names")).toBe(false);
  });
});
