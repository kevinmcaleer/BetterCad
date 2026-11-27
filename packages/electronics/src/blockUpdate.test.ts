import { describe, expect, it } from "vitest";
import { buildBlock } from "./blocks";
import { lookup } from "./blocks.test";
import { changedInside, placeBlockKept, updateBlock, whatChanged } from "./blockUpdate";
import { joinPoint } from "./connect";
import { changePart, placePart } from "./edit";
import { STARTER_BLOCKS } from "./library/blocks";
import { emptyDesign, type ElectronicsDesign } from "./model";
import { netAt, netlist } from "./nets";
import { pushToBoard } from "./sync";

const qwiic = STARTER_BLOCKS.find((b) => b.id === "qwiic")!;
const v2 = {
  ...qwiic,
  version: 2,
  changes: "Stronger pull-ups for long cables",
  parts: qwiic.parts.map((p) => (p.ref.startsWith("R") ? { ...p, value: "2.2 kΩ" } : p)),
  points: qwiic.points.filter((p) => p.name !== "SCL"),
};

function joined(): { d: ElectronicsDesign; group: string; pico: string; far: [number, number] } {
  const pico = placePart(emptyDesign(), "sh1", lookup("pico")!, { x: 0, y: 0 });
  const placed = placeBlockKept(pico.design, "sh1", buildBlock(qwiic, lookup), [60, 40]);
  let d = placed.design;
  const sheet = d.sheets[0]!;
  const g = sheet.groups![0]!;
  const at = (name: string) => {
    const l = sheet.labels.find((x) => x.id === g.block!.points.find((p) => p.name === name)!.label)!;
    return [l.x, l.y] as [number, number];
  };
  // Join SDA and SCL somewhere outside the block: a stub wire off each point.
  const far: [number, number] = [at("SDA")[0] - 20, at("SDA")[1]];
  d = joinPoint(d, "sh1", at("SDA"), far);
  d = joinPoint(d, "sh1", at("SCL"), [at("SCL")[0] - 20, at("SCL")[1] - 5.08]);
  return { d, group: g.id, pico: pico.part.id, far };
}

describe("a placed block's Update (#773)", () => {
  it("says what a newer version changes", () => {
    const { d, group } = joined();
    expect(whatChanged(d, "sh1", group, v2)).toEqual([
      "Stronger pull-ups for long cables",
      "R1 becomes 2.2 kΩ, from 4.7 kΩ",
      "R2 becomes 2.2 kΩ, from 4.7 kΩ",
      "Point SCL is gone",
    ]);
  });

  it("swaps the inside, keeps the tag and keeps joined points joined; a point that is gone is listed", () => {
    const { d, group, far } = joined();
    expect(netAt(netlist(d), "sh1", far)).toBe("QW1.SDA");
    const r = updateBlock(d, "sh1", group, buildBlock(v2, lookup));
    expect(r.gone).toEqual(["SCL"]);
    const g = r.design.sheets[0]!.groups!.find((x) => x.id === r.group)!;
    expect(g.block).toMatchObject({ version: 2, tag: "QW1" });
    expect(r.design.parts.filter((p) => p.ref.startsWith("R")).map((p) => p.value)).toEqual(["2.2 kΩ", "2.2 kΩ"]);
    // The wire that led off SDA still ends on the new block's SDA.
    const after = netlist(r.design);
    expect(netAt(after, "sh1", far)).toBe("QW1.SDA");
    expect(after.nets.find((n) => n.name === "QW1.SDA")!.pins.length).toBe(2);
    expect(changedInside(r.design, "sh1", r.group!)).toBe(false);
  });

  it("knows when the inside was changed by hand", () => {
    const { d, group } = joined();
    expect(changedInside(d, "sh1", group)).toBe(false);
    const r1 = d.parts.find((p) => p.ref === "R1")!;
    const edited = changePart(d, r1.id, { value: "10 kΩ" });
    expect(changedInside(edited, "sh1", group)).toBe(true);
  });

  it("keeps parts' places on the board", () => {
    const { d, group } = joined();
    const pushed = pushToBoard(d).design;
    const j1 = pushed.board!.placements.find((p) => p.ref === "J1")!;
    const r = updateBlock(pushed, "sh1", group, buildBlock(v2, lookup));
    const now = r.design.board!.placements.find((p) => r.design.parts.find((x) => x.id === p.part)?.ref === "J1")!;
    expect([now.x, now.y]).toEqual([j1.x, j1.y]);
    expect(r.design.parts.some((p) => p.id === now.part)).toBe(true);
  });
});
