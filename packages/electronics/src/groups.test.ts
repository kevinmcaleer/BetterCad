import { GRID, resistor } from "./basics";
import { addWire, copyFromSheet, moveOnSheet, pasteOnSheet, placePart, removeFromSheet } from "./edit";
import { GROUP_PAD, addToGroup, groupBoxes, groupOf, groupOnSheet, groupsIn, leaveGroup, placedBox, renameGroup, ungroupOnSheet, wholeGroups } from "./groups";
import { emptyDesign } from "./model";
import { duplicateSheet } from "./sheets";

const two = () => {
  const a = placePart(emptyDesign(), "sh1", resistor(), { x: 0, y: 0 });
  const b = placePart(a.design, "sh1", resistor(), { x: 10 * GRID, y: 0 });
  const d = addWire(b.design, "sh1", [0, -1.5 * GRID], [10 * GRID, -1.5 * GRID]);
  return { d, a: a.symbol.id, b: b.symbol.id, wire: d.sheets[0]!.wires[0]!.id };
};
const sheet = (d: ReturnType<typeof emptyDesign>) => d.sheets[0]!;

describe("schematic groups (#766)", () => {
  it("gathers things into a named group, numbered when no name is given", () => {
    const { d, a, wire } = two();
    const g = groupOnSheet(d, "sh1", [a, wire, "nothing"]);
    expect(sheet(g.design).groups).toEqual([{ id: g.id, name: "Group 1", members: [a, wire] }]);
    const named = groupOnSheet(g.design, "sh1", [two().b], "Motor driver");
    expect(named.id).toBeNull();
    expect(groupOnSheet(d, "sh1", []).design).toBe(d);
  });

  it("keeps a thing in one group at most", () => {
    const { d, a, b, wire } = two();
    const one = groupOnSheet(d, "sh1", [a, wire], "Power");
    const both = groupOnSheet(one.design, "sh1", [a, b], "Motor");
    expect(sheet(both.design).groups!.map((g) => [g.name, g.members])).toEqual([
      ["Power", [wire]],
      ["Motor", [a, b]],
    ]);
    const all = groupOnSheet(both.design, "sh1", [a, b, wire], "All");
    expect(sheet(all.design).groups!.map((g) => g.name)).toEqual(["All"]);
  });

  it("picks the whole group from one member, except inside a group gone into", () => {
    const { d, a, b, wire } = two();
    const g = groupOnSheet(d, "sh1", [a, wire]);
    const s = sheet(g.design);
    expect(wholeGroups(s, [a]).sort()).toEqual([a, wire].sort());
    expect(wholeGroups(s, [a], g.id)).toEqual([a]);
    expect(wholeGroups(s, [b])).toEqual([b]);
    expect(groupsIn(s, [a, wire, b]).map((x) => x.id)).toEqual([g.id]);
    expect(groupsIn(s, [a])).toEqual([]);
  });

  it("moves as one block: members move and wires to parts outside stretch", () => {
    const { d, a, b } = two();
    const g = groupOnSheet(d, "sh1", [a]);
    const members = groupOf(sheet(g.design), a)!.members;
    const moved = moveOnSheet(g.design, "sh1", members, 0, 4 * GRID);
    expect(sheet(moved).symbols.find((s) => s.id === a)).toMatchObject({ x: 0, y: 4 * GRID });
    expect(sheet(moved).symbols.find((s) => s.id === b)).toMatchObject({ x: 10 * GRID, y: 0 });
    expect(sheet(moved).wires[0]!.a).toEqual([0, 2.5 * GRID]);
    expect(sheet(moved).groups).toEqual(sheet(g.design).groups);
  });

  it("renames, adds, takes out and ungroups", () => {
    const { d, a, b, wire } = two();
    const g = groupOnSheet(d, "sh1", [a]);
    const id = g.id!;
    let x = renameGroup(g.design, "sh1", id, "  Regulator ");
    expect(sheet(x).groups![0]!.name).toBe("Regulator");
    expect(renameGroup(x, "sh1", id, " ")).toBe(x);
    x = addToGroup(x, "sh1", id, [b, wire]);
    expect(sheet(x).groups![0]!.members).toEqual([a, b, wire]);
    x = leaveGroup(x, "sh1", [a, b, wire]);
    expect(sheet(x).groups).toBeUndefined();
    const back = ungroupOnSheet(g.design, "sh1", id);
    expect(sheet(back).groups).toBeUndefined();
    expect(sheet(back).symbols).toEqual(sheet(g.design).symbols);
  });

  it("forgets deleted members and drops a group left empty", () => {
    const { d, a, b } = two();
    const g = groupOnSheet(d, "sh1", [a, b]);
    const one = removeFromSheet(g.design, "sh1", [a]);
    expect(sheet(one).groups![0]!.members).toEqual([b]);
    expect(sheet(removeFromSheet(one, "sh1", [b])).groups).toBeUndefined();
  });

  it("copies, pastes and duplicates a whole group as a new group", () => {
    const { d, a, wire, b } = two();
    const g = groupOnSheet(d, "sh1", [a, wire], "Pull-up");
    const clip = copyFromSheet(g.design, "sh1", [a, wire])!;
    expect(clip.groups).toEqual([{ name: "Pull-up", members: [a, wire] }]);
    expect(copyFromSheet(g.design, "sh1", [a, b])!.groups).toBeUndefined();
    const pasted = pasteOnSheet(g.design, "sh1", clip, 0, -10 * GRID);
    const groups = sheet(pasted.design).groups!;
    expect(groups.map((x) => x.name)).toEqual(["Pull-up", "Pull-up"]);
    expect(groups[1]!.members.sort()).toEqual([...pasted.ids].sort());
    const dup = duplicateSheet(g.design, "sh1")!;
    expect(dup.design.sheets[1]!.groups!.map((x) => [x.name, x.members.length])).toEqual([["Pull-up", 2]]);
  });
});

describe("group outlines", () => {
  it("boxes the members with a margin, and goes to KiCad as a box with its name", async () => {
    const { d, a } = two();
    const g = groupOnSheet(d, "sh1", [a], "Pull-up");
    const [o] = groupBoxes(g.design, sheet(g.design));
    const sym = placedBox(g.design.defs[g.design.parts[0]!.def]!.symbol, sheet(g.design).symbols[0]!);
    expect(o!.box.x1).toBeCloseTo(sym.x1 - 1.5 - GROUP_PAD);
    expect(o!.box.y2).toBeCloseTo(sym.y2 + 1.5 + GROUP_PAD);
    const { kicadProject } = await import("./kicad/export");
    const sch = kicadProject(g.design, "Groups").files.find((f) => f.name.endsWith(".kicad_sch"))!.text;
    expect(sch).toContain('(text "Pull-up"');
    expect(sch).toMatch(/\(rectangle/);
  });
});

describe("folding a block (#775)", () => {
  it("hides only the inside, keeps the points, and leaves the nets as they were", async () => {
    const { buildBlock, placeBlock } = await import("./blocks");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { inflate } = await import("./library/pack");
    const pack = JSON.parse(readFileSync(join(__dirname, "../library/starter.json"), "utf8")) as import("./library/pack").LibraryPack;
    const lookup = (id: string) => {
      const p = pack.parts.find((x) => x.id === id);
      return p && inflate(pack, p);
    };
    const { STARTER_BLOCKS } = await import("./library/blocks");
    const { foldedAway, setFolded } = await import("./groups");
    const { netlist } = await import("./nets");
    const { emptyDesign } = await import("./model");
    const d = placeBlock(
      emptyDesign(),
      "sh1",
      buildBlock(
        STARTER_BLOCKS.find((b) => b.id === "drv8833")!,
        lookup,
      ),
      [0, 0],
    ).design;
    const g = d.sheets[0]!.groups![0]!;
    const folded = setFolded(d, "sh1", [g.id], true);
    expect(folded.sheets[0]!.groups![0]!.folded).toBe(true);
    const away = foldedAway(folded.sheets[0]!);
    expect(away.size).toBe(g.members.length - g.block!.points.length);
    for (const p of g.block!.points) expect(away.has(p.label)).toBe(false);
    expect(netlist(folded).nets).toEqual(netlist(d).nets);
    const open = setFolded(folded, "sh1", [g.id], false);
    expect("folded" in open.sheets[0]!.groups![0]!).toBe(false);
    expect(foldedAway(open.sheets[0]!).size).toBe(0);
  });
});
