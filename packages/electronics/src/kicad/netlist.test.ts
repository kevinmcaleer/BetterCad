import { GRID, capacitor, power, resistor } from "../basics";
import { addWire, changePart, placePart } from "../edit";
import { emptyDesign } from "../model";
import { kicadNetlist } from "./netlist";
import { parseSexpr } from "./sexpr";

describe("KiCad netlist", () => {
  it("lists every part and every net the way KiCad writes them", () => {
    let d = emptyDesign();
    const r = placePart(d, "sh1", resistor(), { x: 0, y: 0 });
    d = placePart(r.design, "sh1", capacitor(), { x: 0, y: -4 * GRID }).design;
    d = placePart(d, "sh1", power("GND"), { x: 0, y: -7 * GRID }).design;
    d = addWire(d, "sh1", [0, -1.5 * GRID], [0, -2.5 * GRID]);
    d = addWire(d, "sh1", [0, -5.5 * GRID], [0, -7 * GRID]);
    d = changePart(d, r.part.id, { value: 'say "hi"', fitted: false });
    const text = kicadNetlist(d, { title: "Blinky", date: "2026-11-24" });
    expect(text).toContain('(export (version "E")');
    expect(text).toContain('(comp (ref "R1")\n      (value "say \\"hi\\"")');
    expect(text).toContain(`(footprint "${resistor().packages[0]!.footprint.name}")`);
    expect(text).toContain('(net (code "1") (name "GND")\n      (node (ref "C1") (pin "2") (pintype "passive")))');
    expect(text).toContain('(node (ref "C1") (pin "1") (pintype "passive"))\n      (node (ref "R1") (pin "2") (pintype "passive")))');
    expect(text).not.toContain("#PWR");
    // Balanced, and readable by our own KiCad reader.
    const tree = parseSexpr(text);
    expect(JSON.stringify(tree)).toContain("components");
  });
});
