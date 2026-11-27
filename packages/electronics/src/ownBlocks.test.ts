import { describe, expect, it } from "vitest";
import { buildBlock, placeBlock } from "./blocks";
import { lookup } from "./blocks.test";
import { check } from "./erc";
import { STARTER_BLOCKS } from "./library/blocks";
import { emptyDesign, type ElectronicsDesign } from "./model";
import { netlist } from "./nets";
import { blockFileText, blockFromGroup, buildOwn, isOwnBlock, markAsBlock, pointChoices, readBlockFile, tagFor } from "./ownBlocks";

const spec = (id: string) => STARTER_BLOCKS.find((b) => b.id === id)!;

/** Which pins share a net, as sets of "ref.pin" named by the parts' order, so two copies compare. */
function wiring(d: ElectronicsDesign, parts: string[]): string[] {
  const nl = netlist(d);
  const index = new Map(parts.map((id, i) => [id, i]));
  return nl.nets
    .map((n) =>
      n.pins
        .filter((p) => index.has(p.part))
        .map((p) => `${index.get(p.part)}.${p.pin}`)
        .sort()
        .join(" "),
    )
    .filter((s) => s.includes(" "))
    .sort();
}
const partsOf = (d: ElectronicsDesign, group: number) => {
  const sheet = d.sheets[0]!;
  const g = sheet.groups![group]!;
  const ids = new Set(sheet.symbols.filter((y) => g.members.includes(y.id)).map((y) => y.part));
  return d.parts
    .filter((p) => ids.has(p.id))
    .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
    .map((p) => p.id);
};

describe("your own blocks (#772)", () => {
  it("offers the group's supplies and labelled nets as points", () => {
    const d = placeBlock(emptyDesign(), "sh1", buildBlock(spec("qwiic"), lookup), [0, 0]).design;
    const g = d.sheets[0]!.groups![0]!;
    const choices = pointChoices(d, "sh1", g.id);
    expect(choices.map((c) => c.name)).toEqual(["GND", "3V3", "SCL", "SDA"]);
    expect(choices[0]).toMatchObject({ kind: "ground", global: true, pick: true });
  });

  it("saves a group as a block that builds, places and wires the same way, and passes the rules check", () => {
    const d = placeBlock(emptyDesign(), "sh1", buildBlock(spec("drv8833"), lookup), [0, 0]).design;
    const g = d.sheets[0]!.groups![0]!;
    const points = pointChoices(d, "sh1", g.id).map((c) => ({ ...c, pick: true }));
    const own = blockFromGroup(d, "sh1", g.id, { name: "My motor board", summary: "Two motors from one chip.", points })!;
    expect(own.spec).toMatchObject({ name: "My motor board", shelf: "Your blocks", tag: "MMB", version: 1 });
    expect(own.spec.parts).toHaveLength(5);
    // One copy of the capacitor part, used three times.
    expect(Object.keys(own.defs).length).toBeLessThan(own.spec.parts.length);
    expect(Object.values(own.spec.parts.map((p) => p.note)).every(Boolean)).toBe(true);

    const placed = placeBlock(d, "sh1", buildOwn(own), [200, 0]).design;
    expect(wiring(placed, partsOf(placed, 1))).toEqual(wiring(d, partsOf(d, 0)));
    const lone = placeBlock(emptyDesign(), "sh1", buildOwn(own), [0, 0]).design;
    expect(
      check(lone)
        .filter((r) => r.rule !== "block-point-open")
        .map((r) => r.text),
    ).toEqual([]);
  });

  it("makes the group a placed copy of the new block", () => {
    const d = placeBlock(emptyDesign(), "sh1", buildBlock(spec("qwiic"), lookup), [0, 0]).design;
    const g = d.sheets[0]!.groups![0]!;
    const own = blockFromGroup(d, "sh1", g.id, { name: "Sensor plug", summary: "", points: pointChoices(d, "sh1", g.id) })!;
    const marked = markAsBlock(d, "sh1", g.id, own).sheets[0]!.groups![0]!;
    expect(marked).toMatchObject({ name: "Sensor plug", block: { def: own.spec.id, version: 1, tag: "QW1" } });
  });

  it("goes to a file and back", () => {
    const d = placeBlock(emptyDesign(), "sh1", buildBlock(spec("qwiic"), lookup), [0, 0]).design;
    const g = d.sheets[0]!.groups![0]!;
    const own = blockFromGroup(d, "sh1", g.id, { name: "Sensor plug", summary: "", points: pointChoices(d, "sh1", g.id) })!;
    const back = readBlockFile(blockFileText(own));
    expect(isOwnBlock(back)).toBe(true);
    expect(back).toEqual(own);
    expect(readBlockFile("{}")).toBe("That file isn't a BetterCad block.");
    expect(readBlockFile("not json")).toBe("That file isn't a BetterCad block.");
    expect(tagFor("Sensor")).toBe("SE");
  });
});
