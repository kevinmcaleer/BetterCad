import { GRID, addWire, emptyDesign, netlist, placePart, power, pushToBoard, resistor } from "@bettercad/electronics";
import { BcadError, loadBcad, saveBcad } from "./bcad";
import { newDoc } from "./document";

/** The electronics design is saved in the model file (#615). */
describe("electronics in a .bcad file", () => {
  const design = () => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    d = placePart(d, sheet, resistor(), { x: 0, y: 0 }).design;
    d = placePart(d, sheet, power("GND"), { x: 0, y: -3 * GRID }).design;
    d = addWire(d, sheet, [0, -1.5 * GRID], [0, -3 * GRID]);
    return pushToBoard(d).design;
  };

  it("round-trips with its parts, nets and board", () => {
    const doc = { ...newDoc("Controller"), electronics: design() };
    const r = loadBcad(saveBcad(doc, { now: new Date("2026-11-24T00:00:00Z") }));
    if (r instanceof BcadError) throw r;
    expect(r.doc.electronics).toEqual(JSON.parse(JSON.stringify(doc.electronics)));
    expect(netlist(r.doc.electronics!).nets.map((n) => n.name)).toEqual(["GND"]);
    expect(r.doc.electronics!.board!.placements.map((p) => p.ref)).toEqual(["R1"]);
  });

  it("leaves a model without electronics exactly as it was", () => {
    const doc = newDoc("Plain");
    const text = saveBcad(doc, { now: new Date("2026-11-24T00:00:00Z") });
    expect(text).not.toContain("electronics");
    const r = loadBcad(text);
    if (r instanceof BcadError) throw r;
    expect(r.doc.electronics).toBeUndefined();
  });

  it("says when the electronics section is damaged", () => {
    const file = JSON.parse(saveBcad({ ...newDoc("Bad"), electronics: design() }));
    delete file.document.electronics.sheets;
    const r = loadBcad(JSON.stringify(file));
    expect(r).toBeInstanceOf(BcadError);
    expect((r as BcadError).message).toMatch(/damaged/);
  });
});
