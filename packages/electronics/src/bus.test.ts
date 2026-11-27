import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASICS } from "./basics";
import { addBus, addBusEntry, busAt, busMembers, entryEnd, freeMembers, renameBus } from "./bus";
import { check } from "./erc";
import { addLabel, moveOnSheet, placePart, removeFromSheet } from "./edit";
import { importEagleProject } from "./eagle/project";
import { kicadProject } from "./kicad/export";
import { importKicadProject } from "./kicad/project";
import { emptyDesign, type ElectronicsDesign, type P2 } from "./model";
import { netlist, placedPins } from "./nets";

/** Two resistors, each pin 1 named D0 or D1 by a label, and a bus with an entry for each. */
function bused(): ElectronicsDesign {
  let d = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 }).design;
  d = placePart(d, "sh1", BASICS.resistor!(), { x: 0, y: -20.32 }).design;
  placedPins(d)
    .filter((p) => p.pin === "1")
    .forEach((p, i) => (d = addLabel(d, "sh1", `D${i}`, p.at[0], p.at[1])));
  d = addBus(d, "sh1", [[-20.32, 10.16], [-20.32, -30.48]], "D[0..7]").design; // prettier-ignore
  const bus = d.sheets[0]!.buses![0]!.id;
  d = addBusEntry(d, "sh1", bus, [-19, 0], "D0");
  d = addBusEntry(d, "sh1", bus, [-19, -20.32], "D1");
  return d;
}
const nets = (d: ElectronicsDesign) =>
  netlist(d)
    .nets.map(
      (n) =>
        `${n.name}: ${n.pins
          .map((p) => `${p.part}.${p.pin}`)
          .sort()
          .join(" ")}`,
    )
    .sort();

describe("buses (#756)", () => {
  it("knows the nets a bus name stands for", () => {
    expect(busMembers("D[0..3]")).toEqual(["D0", "D1", "D2", "D3"]);
    expect(busMembers("A[2..0]")).toEqual(["A2", "A1", "A0"]);
    expect(busMembers("I2C{SDA SCL}")).toEqual(["I2C.SDA", "I2C.SCL"]);
    expect(busMembers("{SDA, SCL}")).toEqual(["SDA", "SCL"]);
    expect(busMembers("GND")).toBeNull();
  });

  it("takes wires off with a slanted entry, a short wire and a label", () => {
    const d = bused();
    const sheet = d.sheets[0]!;
    expect(sheet.buses).toHaveLength(1);
    expect(sheet.busEntries).toHaveLength(2);
    const [e] = sheet.busEntries!;
    // The entry starts on the bus, at the grid point nearest the click, and leans to that side.
    expect([e!.x, e!.y]).toEqual([-20.32, 0]);
    expect(e!.dx).toBe(1);
    const end = entryEnd(e!);
    const wire = sheet.wires.find((w) => w.a[0] === end[0] && w.a[1] === end[1])!;
    expect(wire).toBeDefined();
    expect(sheet.labels.some((l) => l.name === "D0" && l.x === wire.b[0] && l.y === wire.b[1])).toBe(true);
    // The next net it offers is the first not yet on the sheet.
    expect(freeMembers(sheet, sheet.buses![0]!.id)[0]).toBe("D2");
    expect(busAt(sheet, [-20.4, -5], 0.2)?.id).toBe(sheet.buses![0]!.id);
    expect(renameBus(d, "sh1", sheet.buses![0]!.id, "DATA[0..7]").sheets[0]!.buses![0]!.name).toBe("DATA[0..7]");
  });

  it("gives the same nets as the labels alone", () => {
    const d = bused();
    const bare: ElectronicsDesign = { ...d, sheets: d.sheets.map((s) => ({ ...s, buses: [], busEntries: [] })) };
    expect(nets(d)).toEqual(nets(bare));
    const of = netlist(d).nets.find((n) => n.name === "D0")!;
    expect(of.pins).toHaveLength(1);
    // A wire that leaves the bus by an entry is not left in mid air.
    expect(check(d).filter((r) => r.rule === "wire-open")).toEqual([]);
  });

  it("moves its entries with it, and goes when deleted", () => {
    const d = bused();
    const bus = d.sheets[0]!.buses![0]!;
    const moved = moveOnSheet(d, "sh1", [bus.id], -2.54, 0).sheets[0]!;
    expect(moved.buses![0]!.pts[0]).toEqual([-22.86, 10.16]);
    expect(moved.busEntries!.every((e) => e.x === -22.86)).toBe(true);
    const gone = removeFromSheet(d, "sh1", [bus.id, ...d.sheets[0]!.busEntries!.map((e) => e.id)]).sheets[0]!;
    expect(gone.buses).toEqual([]);
    expect(gone.busEntries).toEqual([]);
  });

  it("goes out to KiCad as a bus with its label and entries, and comes back the same", () => {
    const d = bused();
    const out = kicadProject(d, "bus");
    const sch = out.files.find((f) => f.name.endsWith(".kicad_sch"))!.text;
    expect(sch).toMatch(/\(bus\s+\(pts/);
    expect(sch).toMatch(/\(bus_entry\s+\(at/);
    expect(sch).toMatch(/\(label "D\[0\.\.7\]"/);
    const back = importKicadProject(out.files.map((f) => ({ name: f.name, text: f.text })));
    const sheet = back.design.sheets[0]!;
    expect(sheet.buses?.map((b) => b.name)).toEqual(["D[0..7]"]);
    expect(sheet.busEntries).toHaveLength(2);
    const at = (p: P2) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    // Each entry still starts on the bus.
    for (const e of sheet.busEntries!) expect(busAt(sheet, [e.x, e.y], 0.01)).not.toBeNull();
    expect(new Set(sheet.busEntries!.map((e) => at(entryEnd(e)))).size).toBe(2);
    expect(back.notes.some((n) => /buses/.test(n.why))).toBe(false);
    expect(nets(back.design).filter((n) => n.startsWith("D"))).toHaveLength(2);
  });

  it("comes in from Eagle drawn, by name", () => {
    const dir = join(__dirname, "eagle/fixtures");
    const got = importEagleProject(["turns.sch", "turns.brd"].map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") })));
    const buses = got.design.sheets.flatMap((s) => s.buses ?? []);
    expect(buses).toHaveLength(1);
    expect(buses[0]!.pts.length).toBeGreaterThan(1);
    expect(got.notes.some((n) => /buses/.test(n.why))).toBe(false);
  });
});
