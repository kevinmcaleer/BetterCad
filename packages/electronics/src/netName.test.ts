import { describe, expect, it } from "vitest";
import { GRID as G, header, power, resistor } from "./basics";
import { addLabel, addNoConnect, addWires, placePart } from "./edit";
import { placeOnSheet } from "./geom";
import { emptyDesign } from "./model";
import { netlist } from "./nets";
import { renameNet, setPinNet } from "./netName";
import { addTrack } from "./pcb/route";
import { boardChanges, pushToBoard } from "./sync";

function wired() {
  let d = emptyDesign();
  const sheet = d.sheets[0]!.id;
  const r = placePart(d, sheet, resistor(), { x: 0, y: 0 });
  const j = placePart(r.design, sheet, header(2), { x: 10 * G, y: 0 });
  d = addWires(j.design, sheet, [
    [0, 1.5 * G],
    [8 * G, 1.5 * G],
    [8 * G, 0.5 * G],
  ]);
  return { d, sheet, r: r.part.id, j: j.part.id };
}
const nets = (d: ReturnType<typeof wired>["d"]) => netlist(d).nets.map((n) => `${n.name}: ${n.pins.map((p) => `${p.ref}.${p.pin}`).join(" ")}`);

describe("naming a pin's net", () => {
  it("labels a net that has no name yet, on a short wire out from the pin", () => {
    const { d, r } = wired();
    expect(nets(d)).toEqual(["Net-(J1-1): J1.1 R1.1"]);
    const named = setPinNet(d, r, "1", " LED ");
    expect(nets(named)).toEqual(["LED: J1.1 R1.1"]);
    const sheet = named.sheets[0]!;
    expect(sheet.labels).toHaveLength(1);
    expect(sheet.wires).toHaveLength(d.sheets[0]!.wires.length + 1);
  });

  it("renames every label and power symbol a net goes by", () => {
    const { d: start, sheet, r } = wired();
    let d = addLabel(start, sheet, "SIG", 4 * G, 1.5 * G);
    d = addLabel(d, sheet, "SIG", 6 * G, 1.5 * G);
    expect(nets(setPinNet(d, r, "1", "LED"))).toEqual(["LED: J1.1 R1.1"]);
    expect(setPinNet(d, r, "1", "LED").sheets[0]!.labels.map((l) => l.name)).toEqual(["LED", "LED"]);
    // A power symbol names the net: its value changes with it.
    const gnd = placePart(d, sheet, power("GND"), { x: 4 * G, y: 1.5 * G });
    const renamed = renameNet(gnd.design, "GND", "0V");
    expect(renamed.parts.find((p) => p.id === gnd.part.id)!.value).toBe("0V");
    expect(netlist(renamed).nets.map((n) => n.name)).toEqual(["0V"]);
  });

  it("joins a pin left open to a net by name, and takes its mark off", () => {
    const { d: start, sheet, r, j } = wired();
    const pin = start.defs[start.parts.find((p) => p.id === j)!.def]!.symbol.pins.find((p) => p.number === "2")!;
    const at = placeOnSheet(
      [pin.x, pin.y],
      start.sheets[0]!.symbols.find((s) => s.part === j)!,
    );
    let d = addNoConnect(start, sheet, at[0], at[1]);
    expect(netlist(d).noConnect.has(`${j}:2`)).toBe(true);
    d = setPinNet(d, j, "2", "SDA");
    d = setPinNet(d, r, "2", "SDA");
    expect(nets(d)).toContain("SDA: J1.2 R1.2");
    expect(d.sheets[0]!.noConnects).toEqual([]);
  });

  it("leaves the design alone for an empty name or the same name", () => {
    const { d, r } = wired();
    expect(setPinNet(d, r, "1", "  ")).toBe(d);
    expect(renameNet(d, "Net-(J1-1)", "Net-(J1-1)")).toBe(d);
    expect(renameNet(d, "nothing", "X")).toBe(d);
  });

  it("carries the board's copper, so the board stays in step", () => {
    const { d: start, sheet, r } = wired();
    let d = pushToBoard(addLabel(start, sheet, "SIG", 4 * G, 1.5 * G)).design;
    d = addTrack(d, "SIG", "top", [
      [0, 0],
      [5, 0],
    ]);
    d = {
      ...d,
      board: { ...d.board!, netLooks: { SIG: { colour: "teal" } }, classes: [{ id: "k1", name: "Power", nets: ["SIG"], trackWidth: 0.5, clearance: 0.2 }] },
    };
    const named = setPinNet(d, r, "1", "LED");
    expect(named.board!.tracks.map((t) => t.net)).toEqual(["LED"]);
    expect(named.board!.netLooks).toEqual({ LED: { colour: "teal" } });
    expect(named.board!.classes[0]!.nets).toEqual(["LED"]);
    expect(boardChanges(named)).toEqual([]);
  });
});
