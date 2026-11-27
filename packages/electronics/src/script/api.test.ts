import { describe, expect, it } from "vitest";
import { BASICS } from "../basics";
import { addLabel, placePart } from "../edit";
import { emptyDesign, type ElectronicsDesign } from "../model";
import { netlist, placedPins } from "../nets";
import { pushToBoard } from "../sync";
import { applyScript, describeChanges, scriptApi, touchedParts } from "./api";
import { runScript } from "./run";
import { STARTER_PLUGINS } from "./starters";

/** Three capacitors, two resistors and four LEDs, R1 and C1 joined on VCC; on a board when `board`. */
function design(board = false): ElectronicsDesign {
  let d = emptyDesign();
  for (const [i, part] of ["capacitor", "capacitor", "capacitor", "resistor", "resistor", "led", "led", "led", "led"].entries())
    d = placePart(d, "sh1", BASICS[part]!(), { x: i * 10, y: 0 }).design;
  for (const ref of ["R1", "C1"]) {
    const id = d.parts.find((p) => p.ref === ref)!.id;
    const pin = placedPins(d).find((p) => p.part === id && p.pin === "1")!;
    d = addLabel(d, "sh1", "VCC", pin.at[0], pin.at[1]);
  }
  return board ? pushToBoard(d).design : d;
}
const plugin = (name: string) => STARTER_PLUGINS.find((p) => p.name === name)!.source;

describe("the bc object scripts are given (#764)", () => {
  it("reads parts, sheets, nets and the board as plain copies", () => {
    const d = design(true);
    const { bc } = scriptApi(d, { erc: () => [{ level: "warning", rule: "r", text: "t" }] });
    expect(bc.parts().map((p) => p.ref)).toEqual(["C1", "C2", "C3", "D1", "D2", "D3", "D4", "R1", "R2"]);
    expect(bc.parts()[0]).toMatchObject({ ref: "C1", value: "100 nF", prefix: "C", fitted: true });
    expect(bc.sheets()[0]).toMatchObject({ name: "Sheet 1", labels: [{ name: "VCC" }, { name: "VCC" }] });
    expect(
      bc
        .nets()
        .find((n) => n.name === "VCC")!
        .pins.sort(),
    ).toEqual(["C1:1", "R1:1"]);
    const board = bc.board()!;
    expect(board.placements).toHaveLength(9);
    // A copy: changing it changes nothing.
    board.placements[0]!.x = 999;
    expect(bc.board()!.placements[0]!.x).not.toBe(999);
    expect(bc.erc()).toEqual([{ level: "warning", rule: "r", text: "t" }]);
    expect(bc.drc()).toEqual([]);
    expect(Object.isFrozen(bc)).toBe(true);
  });

  it("collects each change, checked as it is made, and applies them only when kept", () => {
    const d = design(true);
    const { bc, changes } = scriptApi(d);
    bc.setValue("C2", "1 µF");
    bc.setFitted("D4", false);
    bc.setPartNumber("R1", { lcsc: "C25804" });
    bc.addLabel("GND", [0, -10]);
    bc.wire([0, -10], [10, -10]);
    expect(bc.place("R1", [50, 0], { rot: 90 })).toBe(1);
    bc.move("D1", [5, 6], 45, "bottom");
    bc.addTrack("VCC", [
      [1, 1],
      [5, 1],
    ]);
    bc.addVia("VCC", [5, 1]);
    bc.setRule("clearance", 0.25);
    bc.setNetClass("VCC", "Power");
    bc.renumber();
    expect(changes).toHaveLength(12);
    // Nothing changes until the list is applied.
    expect(d.parts.find((p) => p.ref === "C2")!.value).toBe("100 nF");

    const after = applyScript(d, changes);
    const by = (ref: string) => after.parts.find((p) => p.ref === ref)!;
    expect(by("C2").value).toBe("1 µF");
    expect(by("D4").fitted).toBe(false);
    expect(by("R1").supplier).toEqual({ lcsc: "C25804" });
    expect(after.parts).toHaveLength(10);
    expect(after.sheets[0]!.labels.map((l) => l.name)).toEqual(["VCC", "VCC", "GND"]);
    expect(after.sheets[0]!.wires).toHaveLength(1);
    const d1 = after.board!.placements.find((p) => p.part === by("D1").id)!;
    expect(d1).toMatchObject({ x: 5, y: 6, rot: 45, side: "bottom" });
    expect(after.board!.tracks).toMatchObject([{ net: "VCC", layer: "top" }]);
    expect(after.board!.vias).toMatchObject([{ net: "VCC", x: 5, y: 1 }]);
    expect(after.board!.rules.clearance).toBe(0.25);
    expect(after.board!.classes).toMatchObject([{ name: "Power", nets: ["VCC"] }]);
    expect(describeChanges(changes)).toBe(
      "Moves 1 part, places 1 part, sets C2 to 1 µF, leaves off 1 part, sets 1 part number, numbers the parts again, adds 1 label, adds 1 wire, adds 1 track, adds 1 via, changes 1 rule, puts 1 net in a class",
    );
    expect(touchedParts(d, changes).length).toBe(4);
  });

  it("stops a script with a plain message when a call is wrong", async () => {
    const d = design();
    const bad = async (src: string) => (await runScript(d, src)).error;
    expect(await bad(`bc.setValue("R9", "1k")`)).toBe("There is no part R9");
    expect(await bad(`bc.addLabel("X", [1])`)).toBe("Where the label goes must be a point, such as [10, 5]");
    expect(await bad(`bc.move("R1", [1, 1])`)).toBe("There is no board yet: push the schematic to a PCB first");
    expect(await bad(`bc.wire([0, 0], [1, NaN])`)).toBe("A wire's end must be a number");
    expect(await (async () => (await runScript(design(true), `bc.setRule("speed", 1)`)).error)()).toMatch(/^There is no rule speed; the rules are clearance/);
    // A script that throws keeps nothing it did before.
    const run = await runScript(d, `bc.setValue("R1", "1k"); bc.say("halfway"); throw new Error("stop")`);
    expect(run).toEqual({ changes: [], output: [{ kind: "say", text: "halfway" }], error: "stop" });
  });

  it("shows lines, tables and files, and can await", async () => {
    const run = await runScript(
      design(),
      `await null; bc.say("parts", bc.parts().length, {a: 1}); bc.table([["ref"], ["R1"], [null]]); bc.file("a/b.csv", "x")`,
    );
    expect(run.error).toBeUndefined();
    expect(run.output).toEqual([
      { kind: "say", text: 'parts 9 {"a":1}' },
      { kind: "table", rows: [["ref"], ["R1"], [""]] },
      { kind: "file", name: "a-b.csv", text: "x" },
    ]);
  });

  it("can't see the editor's own names, only bc", async () => {
    const run = await runScript(design(), `bc.say(typeof scriptApi, typeof applyScript, typeof d)`);
    expect(run.output).toEqual([{ kind: "say", text: "undefined undefined undefined" }]);
  });
});

describe("the starter plug-ins (#764)", () => {
  it("Ring of LEDs moves the board's LEDs round a circle, each turned to face out", async () => {
    const d = design(true);
    const run = await runScript(d, plugin("Ring of LEDs"));
    expect(run.error).toBeUndefined();
    expect(run.changes.map((c) => (c.kind === "move" ? [c.ref, c.x.toFixed(2), c.y.toFixed(2), c.rot] : c.kind))).toEqual([
      ["D1", "40.00", "20.00", 90],
      ["D2", "25.00", "35.00", 180],
      ["D3", "10.00", "20.00", 270],
      ["D4", "25.00", "5.00", 360],
    ]);
    expect(describeChanges(run.changes)).toBe("Moves 4 parts");
    expect(run.output).toEqual([{ kind: "say", text: "Placed 4 LEDs round a circle of 15 mm" }]);
    // Without a board it says what to do.
    expect((await runScript(design(), plugin("Ring of LEDs"))).error).toBe("Push the schematic to a PCB first");
  });

  it("Same value for all sets every capacitor, or a range of references", async () => {
    let d = design();
    d = { ...d, parts: d.parts.map((p) => (p.ref === "C3" ? { ...p, value: "10 µF" } : p)) };
    const run = await runScript(d, plugin("Same value for all"));
    expect(run.changes).toEqual([{ kind: "value", ref: "C3", value: "100 nF" }]);
    expect(run.output).toEqual([{ kind: "say", text: "Set C3 to 100 nF" }]);
    const range = await runScript(d, plugin("Same value for all").replace('"C*"', '"D2-D3"').replace('"100 nF"', '"Green"'));
    expect(range.changes).toEqual([
      { kind: "value", ref: "D2", value: "Green" },
      { kind: "value", ref: "D3", value: "Green" },
    ]);
  });

  it("Supplier parts list writes one line per value and package", async () => {
    const run = await runScript(design(), plugin("Supplier parts list"));
    expect(run.changes).toEqual([]);
    const file = run.output.find((o) => o.kind === "file");
    expect(file).toMatchObject({ kind: "file", name: "parts-list.csv" });
    expect((file as { text: string }).text.split("\n")[0]).toBe("quantity,value,package,mpn,ref");
    expect((file as { text: string }).text).toContain("3,100 nF,");
    expect((file as { text: string }).text).toContain(",C1 C2 C3\n");
    expect(run.output.at(-1)).toEqual({ kind: "say", text: "3 lines for 9 parts" });
  });

  it("reads the nets the same way the editor does", () => {
    expect(scriptApi(design()).bc.nets().length).toBe(netlist(design()).nets.length);
  });
});

describe("plug-in files (#764)", () => {
  it("write a plug-in as a runnable script with its name and description on top, and read it back", async () => {
    const { pluginFile, readPluginFile } = await import("./starters");
    const p = STARTER_PLUGINS[0]!;
    const text = pluginFile(p);
    expect(text.split("\n").slice(0, 3)).toEqual(["// @bcplugin", "// @name Ring of LEDs", `// @description ${p.description}`]);
    expect(readPluginFile(text, "x.bcplugin.js")).toEqual(p);
    // A plain script takes its name from the file.
    expect(readPluginFile('bc.say("hi")\n', "hello.bcplugin.js")).toEqual({ name: "hello", description: "", source: 'bc.say("hi")\n' });
    // The file runs as it is: the header is only comments.
    expect((await runScript(design(true), text)).changes).toHaveLength(4);
  });
});
