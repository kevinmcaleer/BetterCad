import { describe, expect, it } from "vitest";
import { buildBlock, placeBlock } from "./blocks";
import { lookup } from "./blocks.test";
import { joinI2c, joinPoint, pointsJoined, suggestTargets } from "./connect";
import { placePart } from "./edit";
import { STARTER_BLOCKS } from "./library/blocks";
import { emptyDesign } from "./model";
import { netlist } from "./nets";

const spec = (id: string) => STARTER_BLOCKS.find((b) => b.id === id)!;
/** A Pico on the left and a block on the right. */
function picoAnd(id: string) {
  const pico = placePart(emptyDesign(), "sh1", lookup("pico")!, { x: 0, y: 0 });
  const placed = placeBlock(pico.design, "sh1", buildBlock(spec(id), lookup), [60, 40]);
  const sheet = placed.design.sheets[0]!;
  const g = sheet.groups![0]!;
  const point = (name: string) => g.block!.points.find((p) => p.name === name)!;
  return { d: placed.design, g, point, pico: pico.part.id };
}

describe("hooking a block up (#770)", () => {
  it("offers a Pico's I2C pins for a Qwiic socket's SDA and SCL, best first", () => {
    const { d, g, point } = picoAnd("qwiic");
    const sda = suggestTargets(d, "sh1", g.id, point("SDA").label);
    expect(sda[0]).toMatchObject({ kind: "pin", name: "GPIO0" });
    expect(sda.slice(0, 6).map((t) => t.name)).toEqual(["GPIO0", "GPIO2", "GPIO4", "GPIO6", "GPIO8", "GPIO10"]);
    expect(suggestTargets(d, "sh1", g.id, point("SCL").label)[0]!.name).toBe("GPIO1");
    expect(suggestTargets(d, "sh1", g.id, point("3V3").label)[0]!.name).toBe("3V3");
  });

  it("joins SDA and SCL on one bus with Join all I2C, and the nets follow", () => {
    const { d, g, point, pico } = picoAnd("qwiic");
    const { design, joined } = joinI2c(d, "sh1", g.id);
    expect(joined).toEqual(["SDA to P1 GPIO0", "SCL to P1 GPIO1"].map((t) => t.replace("P1", design.parts.find((p) => p.id === pico)!.ref)));
    const nl = netlist(design);
    expect(nl.of.get(`${pico}:1`)).toBe("QW1.SDA");
    expect(nl.of.get(`${pico}:2`)).toBe("QW1.SCL");
    const sheet = design.sheets[0]!;
    const state = pointsJoined(sheet, sheet.groups![0]!);
    expect(state.filter((p) => p.joined).map((p) => p.point.name)).toEqual(["SDA", "SCL", "GND"]);
    expect(point("SDA").required).toBe(true);
  });

  it("suggests another block's power out for a power in, the same voltage first", () => {
    const reg = placeBlock(emptyDesign(), "sh1", buildBlock(spec("reg-3v3-linear"), lookup), [0, 0]);
    const both = placeBlock(reg.design, "sh1", buildBlock(spec("qwiic"), lookup), [80, 0]);
    const sheet = both.design.sheets[0]!;
    const qw = sheet.groups![1]!;
    const v = qw.block!.points.find((p) => p.name === "3V3")!;
    const [best] = suggestTargets(both.design, "sh1", qw.id, v.label);
    expect(best).toMatchObject({ kind: "point", text: "3.3 V regulator: 3V3" });
    const joined = joinPoint(both.design, "sh1", [sheet.labels.find((l) => l.id === v.label)!.x, sheet.labels.find((l) => l.id === v.label)!.y], best!.at);
    const nl = netlist(joined);
    expect(nl.nets.find((n) => n.names.includes("QW1.3V3"))!.names).toContain("REG1.3V3");
  });
});
