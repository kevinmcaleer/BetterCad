import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { changePart } from "../edit";
import type { ElectronicsDesign } from "../model";
import { addPour, setPour } from "../pcb/pour";
import { addTrack, setPlacement } from "../pcb/route";
import { drillFiles, holesOf } from "./drill";
import { fabBoard } from "./fixture";
import { gerberFiles } from "./gerber";
import { HOUSES, bomTable, csv, fileBase, houseOf, orderPack, placeTable } from "./pack";
import { byRef } from "../nets";
import { bom, pinOnes, placeList, setFitted, setSupplier } from "./parts";
import { inkAt, readDrill, readGerber } from "./read";

const id = (d: ElectronicsDesign, ref: string) => d.parts.find((p) => p.ref === ref)!.id;

describe("drill files", () => {
  it("writes plated and bare holes apart, in millimetres, and matches the golden files", async () => {
    const { d } = fabBoard();
    const f = drillFiles(d)!;
    await expect(f.plated).toMatchFileSnapshot("./golden/fab-board.plated.drl");
    await expect(f.bare).toMatchFileSnapshot("./golden/fab-board.bare.drl");
    expect(f.plated).toContain("METRIC");
    expect(f.plated).toContain("TF.FileFunction,Plated,1,2,PTH");
    expect(f.bare).toContain("TF.FileFunction,NonPlated,1,2,NPTH");
    // The table: a via, two header pins and a plated hole share 1 mm; the mounting hole is bare.
    expect(f.tools).toEqual([
      { tool: 1, d: 0.3, plated: true, holes: 1, slots: 0 },
      { tool: 2, d: 1, plated: true, holes: 3, slots: 0 },
      { tool: 1, d: 3.2, plated: false, holes: 1, slots: 0 },
    ]);
  });

  it("reads back to the same holes, which sit on the Gerbers' copper", () => {
    const { d, pad } = fabBoard();
    const f = drillFiles(d)!;
    const plated = readDrill(f.plated);
    expect(plated.plated).toBe(true);
    expect(plated.hits).toHaveLength(4);
    expect(readDrill(f.bare)).toEqual({ plated: false, hits: [{ d: 3.2, at: [45, 35] }] });
    // Overlay: every plated hole lands on copper on both sides, at the same coordinates.
    const files = gerberFiles(d);
    for (const layer of ["copper-top", "copper-bottom"] as const) {
      const image = readGerber(files.find((x) => x.layer === layer)!.text);
      for (const h of plated.hits) expect(inkAt(image, h.at), `${layer} at ${h.at}`).toBe(true);
    }
    const j = pad("J1", "1");
    expect(plated.hits.some((h) => Math.abs(h.at[0] - j[0]) < 1e-3 && Math.abs(h.at[1] - j[1]) < 1e-3 && h.d === 1)).toBe(true);
  });

  it("routes a slot from end to end along the pad", () => {
    const { d } = fabBoard();
    const j = d.parts.find((p) => p.ref === "J1")!;
    const def = d.defs[j.def]!;
    const pkg = def.packages[j.pkg]!;
    const slotted: ElectronicsDesign = {
      ...d,
      defs: {
        ...d.defs,
        [j.def]: {
          ...def,
          packages: [
            {
              ...pkg,
              footprint: { ...pkg.footprint, pads: pkg.footprint.pads.map((p) => (p.number === "2" ? { ...p, shape: "oval" as const, w: 3, slot: 2.2 } : p)) },
            },
          ],
        },
      },
    };
    const at = boardPads(slotted).find((p) => p.ref === "J1" && p.pad.number === "2")!.at;
    const slot = holesOf(slotted).find((h) => h.to)!;
    expect(slot).toMatchObject({ d: 1, plated: true });
    expect(slot.at[0]).toBeCloseTo(at[0] - 0.6, 6);
    expect(slot.to![0]).toBeCloseTo(at[0] + 0.6, 6);
    const text = drillFiles(slotted)!.plated;
    expect(text).toMatch(/G00X29\.400Y[\d.]+\nM15\nG01X30\.600Y[\d.]+\nM16\nG05/);
    const back = readDrill(text).hits.find((h) => h.to)!;
    expect(back.d).toBe(1);
    expect(back.to![0]).toBeCloseTo(30.6, 6);
    expect(drillFiles(slotted)!.tools.find((t) => t.slots)).toMatchObject({ d: 1, holes: 2, slots: 1 });
  });
});

describe("the parts list", () => {
  it("puts like parts on one row and leaves unfitted parts off", () => {
    const { d } = fabBoard();
    const list = bom(d);
    expect(list.rows.map((r) => [r.line, r.refs.join(" "), r.qty, r.mounting])).toEqual([
      [1, "J1", 1, "thru"],
      [2, "R1", 1, "smd"],
    ]);
    expect(list.rows[1]).toMatchObject({ value: "10 kΩ", footprint: "0805 (2012 metric)" });
    expect(list.noLcsc).toEqual(["J1", "R1"]);
    const off = bom(setFitted(d, [id(d, "J1")], false));
    expect(off.rows.map((r) => r.refs)).toEqual([["R1"]]);
    expect(off.unfitted).toEqual(["J1"]);
    expect(bom(setFitted(setFitted(d, [id(d, "J1")], false), [id(d, "J1")], true)).rows).toHaveLength(2);
  });

  it("takes supplier numbers from the part before its component, and splits rows that differ", () => {
    const { d } = fabBoard();
    const r1 = d.parts.find((p) => p.ref === "R1")!;
    let two: ElectronicsDesign = { ...d, parts: [...d.parts, { ...r1, id: "r2", ref: "R2" }, { ...r1, id: "r10", ref: "R10" }] };
    expect(bom(two).rows.find((r) => r.refs[0] === "R1")).toMatchObject({ refs: ["R1", "R2", "R10"], qty: 3 });
    two = setSupplier(two, [r1.id, "r2"], { lcsc: " C17414 ", mpn: "0805W8F1002T5E" });
    const rows = bom(two).rows;
    expect(rows.map((r) => [r.refs.join(" "), r.lcsc])).toEqual([
      ["J1", ""],
      ["R1 R2", "C17414"],
      ["R10", ""],
    ]);
    expect(bom(two).noLcsc).toEqual(["J1", "R10"]);
    // The component's own number fills in where the part has none.
    const withDef: ElectronicsDesign = {
      ...two,
      defs: { ...two.defs, [r1.def]: { ...two.defs[r1.def]!, supplier: { lcsc: "C1", manufacturer: "Uniroyal" } } },
    };
    expect(bom(withDef).rows.map((r) => [r.refs.join(" "), r.lcsc, r.manufacturer])).toEqual([
      ["J1", "", ""],
      ["R1 R2", "C17414", "Uniroyal"],
      ["R10", "C1", "Uniroyal"],
    ]);
    expect(setSupplier(two, [r1.id], { lcsc: "", mpn: "" }).parts.find((p) => p.id === r1.id)!.supplier).toBeUndefined();
    expect(["R10", "C1", "R2", "R1"].sort(byRef)).toEqual(["C1", "R1", "R2", "R10"]);
    expect(changePart(two, r1.id, { value: "1 kΩ" }).parts.find((p) => p.id === r1.id)!.supplier).toEqual({ lcsc: "C17414", mpn: "0805W8F1002T5E" });
  });

  it("lists where each part goes, with a component's own corrections", () => {
    const { d } = fabBoard();
    expect(placeList(d)).toEqual([
      {
        part: id(d, "J1"),
        ref: "J1",
        value: d.parts.find((p) => p.ref === "J1")!.value,
        footprint: expect.any(String),
        x: 30,
        y: 18.73,
        side: "top",
        rotation: 0,
        mounting: "thru",
      },
      { part: id(d, "R1"), ref: "R1", value: "10 kΩ", footprint: "0805 (2012 metric)", x: 10, y: 20, side: "top", rotation: 30, mounting: "smd" },
    ]);
    expect(placeList(d, { thru: false }).map((r) => r.ref)).toEqual(["R1"]);
    expect(placeList(setFitted(d, [id(d, "R1")], false)).map((r) => r.ref)).toEqual(["J1"]);
    // A correction of 90° and 1 mm along the footprint's x: the part is at 90° on the bottom, so x runs down... mirrored first.
    const r1 = d.parts.find((p) => p.ref === "R1")!;
    let fixed: ElectronicsDesign = { ...d, defs: { ...d.defs, [r1.def]: { ...d.defs[r1.def]!, pnp: { rotation: 300, dx: 1 } } } };
    fixed = setPlacement(fixed, r1.id, { rot: 90 });
    expect(placeList(fixed).find((r) => r.ref === "R1")).toMatchObject({ x: 10, y: 21, rotation: 30 });
    fixed = setPlacement(fixed, r1.id, { side: "bottom" });
    expect(placeList(fixed).find((r) => r.ref === "R1")).toMatchObject({ x: 10, y: 19, side: "bottom" });
  });

  it("shows pin 1 against its pad: on it as the list stands, and off it by a component's correction (#659)", () => {
    const { d } = fabBoard();
    const ones = pinOnes(d, placeList(d));
    expect(ones.map((o) => o.ref)).toEqual(["J1", "R1"]);
    // No correction on the resistor: its row puts pin 1 on its pad, and the pad is where the copper is.
    expect(ones.find((o) => o.ref === "R1")!.apart).toBe(0);
    // The header's row is its body's middle, 1.27 mm from where the footprint is drawn from, so its pin 1 shows off by that.
    expect(ones.find((o) => o.ref === "J1")).toMatchObject({ pad: [30, 20], dot: [30, 18.73], apart: 1.27 });
    const r1 = d.parts.find((p) => p.ref === "R1")!;
    const pad1 = boardPads(d).find((p) => p.part === r1.id && p.pad.number === "1")!;
    const one = ones.find((o) => o.ref === "R1")!;
    expect(one.pad[0]).toBeCloseTo(pad1.at[0], 3);
    expect(one.pad[1]).toBeCloseTo(pad1.at[1], 3);
    expect(one).toMatchObject({ side: "top", centre: [10, 20], rotation: 30 });
    // A half turn of correction: the line would set pin 1 down on the other pad.
    const turned: ElectronicsDesign = { ...d, defs: { ...d.defs, [r1.def]: { ...d.defs[r1.def]!, pnp: { rotation: 180 } } } };
    const off = pinOnes(turned, placeList(turned)).find((o) => o.ref === "R1")!;
    const pad2 = boardPads(d).find((p) => p.part === r1.id && p.pad.number === "2")!;
    expect(off.dot[0]).toBeCloseTo(pad2.at[0], 3);
    expect(off.dot[1]).toBeCloseTo(pad2.at[1], 3);
    expect(off.apart).toBeGreaterThan(1);
    // On the bottom, mirrored with the part.
    const under = setPlacement(d, r1.id, { side: "bottom" });
    const below = pinOnes(under, placeList(under)).find((o) => o.ref === "R1")!;
    const padB = boardPads(under).find((p) => p.part === r1.id && p.pad.number === "1")!;
    expect(below.side).toBe("bottom");
    expect(below.apart).toBe(0);
    expect(below.pad[0]).toBeCloseTo(padB.at[0], 3);
    expect(below.pad[1]).toBeCloseTo(padB.at[1], 3);
  });
});

describe("the order pack", () => {
  it("keeps each board house's columns as data, with where they came from", () => {
    expect(HOUSES.map((h) => h.id)).toEqual(["jlcpcb", "pcbway", "generic"]);
    for (const h of HOUSES) {
      expect(h.checked).toMatch(/^\d{4}-\d\d-\d\d$/);
      if (h.id !== "generic") expect(h.source.length).toBeGreaterThan(0);
      for (const s of [...h.source, ...(h.site ? [h.site] : [])]) expect(s).toMatch(/^https:\/\//);
    }
    expect(houseOf("jlcpcb").bom.map((c) => c.heading)).toEqual(["Comment", "Designator", "Footprint", "LCSC Part #"]);
    expect(houseOf("jlcpcb").place.map((c) => c.heading)).toEqual(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"]);
    expect(houseOf("nobody").id).toBe("generic");
  });

  it("writes the tables a house asks for", async () => {
    const { d } = fabBoard();
    const numbered = setSupplier(d, [id(d, "R1")], { lcsc: "C17414" });
    const jlc = orderPack(numbered, "jlcpcb", "My board: rev A")!;
    expect(jlc.bomTable).toEqual([
      ["Comment", "Designator", "Footprint", "LCSC Part #"],
      [expect.any(String), "J1", expect.any(String), ""],
      ["10 kΩ", "R1", "0805 (2012 metric)", "C17414"],
    ]);
    expect(jlc.placeTable).toEqual([
      ["Designator", "Mid X", "Mid Y", "Layer", "Rotation"],
      ["J1", 30, 18.73, "Top", 0],
      ["R1", 10, 20, "Top", 30],
    ]);
    await expect(csv(jlc.placeTable)).toMatchFileSnapshot("./golden/fab-board.jlcpcb-cpl.csv");
    await expect(csv(jlc.bomTable)).toMatchFileSnapshot("./golden/fab-board.jlcpcb-bom.csv");
    // PCBWay places surface parts only, and names the type of each row.
    const way = orderPack(numbered, "pcbway", "x")!;
    expect(way.placeTable.slice(1).map((r) => r[0])).toEqual(["R1"]);
    expect(bomTable(way.house, way.bom.rows)[2]).toEqual([
      2,
      1,
      "R1",
      "",
      expect.stringContaining("esistor"),
      "0805 (2012 metric)",
      "Surface mount",
      "",
      "",
      "C17414",
    ]);
    expect(placeTable(way.house, way.place)[0]).toEqual(["Reference Designator", "X (mm)", "Y (mm)", "Rotation", "Side"]);
    await expect(csv(way.bomTable)).toMatchFileSnapshot("./golden/fab-board.pcbway-bom.csv");
  });

  it("quotes what a spreadsheet would misread", () => {
    expect(csv([["a", "b,c", 'd "e"', 1.5, " f"]])).toBe('a,"b,c","d ""e""",1.5," f"\r\n');
    expect(fileBase("My board: rev A")).toBe("My-board-rev-A");
    expect(fileBase(" / ")).toBe("board");
  });

  it("names the files and says what an order form asks", () => {
    const { d } = fabBoard();
    const pack = orderPack(d, "jlcpcb", "Blinky")!;
    expect(pack.zipName).toBe("Blinky-gerbers.zip");
    expect(pack.bomName).toBe("Blinky-bom");
    expect(pack.placeName).toBe("Blinky-cpl");
    expect(pack.gerbers.map((g) => g.name)).toEqual([
      "Blinky.GTL",
      "Blinky.GBL",
      "Blinky.GTS",
      "Blinky.GBS",
      "Blinky.GTP",
      "Blinky.GBP",
      "Blinky.GTO",
      "Blinky.GBO",
      "Blinky.GKO",
      "Blinky-PTH.DRL",
      "Blinky-NPTH.DRL",
    ]);
    expect(pack.facts).toEqual({ width: 50, height: 40, thickness: 1.6, layers: 2, minTrack: 0.25, minGap: 0.2, minHole: 0.3 });
    expect(orderPack({ ...d, board: undefined }, "jlcpcb", "x")).toBeNull();
  });

  it("checks what would make the order go wrong", () => {
    const { d, nets, pad } = fabBoard();
    const pack = orderPack(d, "jlcpcb", "x")!;
    const by = (p: typeof pack) => Object.fromEntries(p.checks.map((c) => [c.id, c]));
    expect(by(pack).outline).toMatchObject({ ok: true, blocks: true });
    expect(by(pack).pours).toMatchObject({ ok: true, text: "1 pour is filled." });
    expect(by(pack)["part-numbers"]).toMatchObject({
      ok: false,
      blocks: false,
      text: "No part number for assembly: J1, R1. Add them in the parts list, or order the bare board.",
    });
    expect(by(pack)["pour-clash"]).toBeUndefined();
    expect(by(pack).parts!.text).toBe("2 parts on 2 rows of the parts list.");
    expect(by(orderPack(d, "generic", "x")!)["part-numbers"]).toBeUndefined();
    const done = orderPack(setSupplier(d, [id(d, "R1"), id(d, "J1")], { lcsc: "C1" }), "jlcpcb", "x")!;
    expect(by(done)["part-numbers"]).toMatchObject({ ok: true });
    // Two pours that cut into each other stop the export.
    const p = pad("J1", "2");
    let two = addTrack(d, nets[1], "bottom", [p, [p[0] + 3, p[1]]], 0.25);
    two = addPour(two, nets[0], "bottom", [
      [p[0] + 2, p[1] - 2],
      [p[0] + 8, p[1] - 2],
      [p[0] + 8, p[1] + 2],
      [p[0] + 2, p[1] + 2],
    ]);
    two = setPour(two, two.board!.pours[1]!.id, { priority: 1 });
    expect(by(orderPack(two, "jlcpcb", "x")!)["pour-clash"]).toMatchObject({ ok: false, blocks: true });
  });
});
