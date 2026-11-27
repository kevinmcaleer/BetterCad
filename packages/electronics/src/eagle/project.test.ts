import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { placeOnSheet } from "../geom";
import { withFixedIds } from "../model";
import { netlist } from "../nets";
import { checkBoard } from "../pcb/drc";
import { boardChanges } from "../sync";
import { importEagleLibraries } from "./import";
import { arcOf, chordsOf, deviceName, lengthOf, rotOf } from "./library";
import { eagleKind, importEagleProject } from "./project";
import { parseXml } from "./xml";

const file = (name: string) => ({ name, text: readFileSync(join(__dirname, "fixtures", name), "utf8") });
/**
 * `fixtures/turns.*` is an Eagle 7 project written for this test: parts turned and mirrored every way on two sheets
 * and both sides of a board, a part with three gates, supply symbols, nets in several pieces, wires that cross, a
 * curved edge and track, pours, a cut-out, restrict areas and holes. Where its pads are was checked against KiCad's
 * own Eagle reader (`kicadReads.test.ts`).
 */
const open = () => withFixedIds(() => importEagleProject([file("turns.sch"), file("turns.brd")], { licence: "CC-BY-SA 4.0" }));

describe("the little XML reader", () => {
  it("reads elements, attributes, text and entities, and skips the rest", () => {
    const root = parseXml(
      `<?xml version="1.0"?>\n<!DOCTYPE eagle SYSTEM "eagle.dtd" [ <!ENTITY x "y"> ]>\n<!-- hello -->\n<a n="1 &lt; 2" m='q'><b/>T&amp;C &#65;&#x42;<c k="v">in</c><![CDATA[<raw>]]></a>`,
    );
    expect(root.tag).toBe("a");
    expect(root.attrs).toEqual({ n: "1 < 2", m: "q" });
    expect(root.kids.map((k) => k.tag)).toEqual(["b", "c"]);
    expect(root.text).toBe("T&C AB<raw>");
    expect(root.kids[1]).toMatchObject({ attrs: { k: "v" }, text: "in" });
  });

  it("says where a broken file breaks", () => {
    expect(() => parseXml("<a>\n<b>\n</a>")).toThrow("</a> closes nothing on line 3");
    expect(() => parseXml("<a><b></b>")).toThrow("<a> is never closed");
    expect(() => parseXml("just words")).toThrow("it has no elements");
  });
});

describe("Eagle's numbers", () => {
  it("reads turns, lengths with units and device names", () => {
    expect(rotOf("MR90")).toEqual({ deg: 90, mirror: true });
    expect(rotOf("SR270")).toEqual({ deg: 270, mirror: false });
    expect(rotOf(undefined)).toEqual({ deg: 0, mirror: false });
    expect(lengthOf("8mil")).toBe(0.2032);
    expect(lengthOf("0.35mm")).toBe(0.35);
    expect(lengthOf("nonsense", 1)).toBe(1);
    expect(deviceName("NPN-*", "SOT23", "BC817")).toBe("NPN-BC817SOT23");
    expect(deviceName("74*00?", "N", "LS")).toBe("74LS00N");
  });

  it("turns a curved line into its arc, and into chords that stay on it", () => {
    // A quarter turn anticlockwise from (1, 0) to (0, 1) is the unit circle.
    expect(arcOf([1, 0], [0, 1], 90)).toEqual({ cx: 0, cy: 0, r: 1, a0: 0, a1: 90 });
    // The same ends the other way round bulge away from the origin.
    expect(arcOf([1, 0], [0, 1], -90)).toEqual({ cx: 1, cy: 1, r: 1, a0: 180, a1: 270 });
    const pts = chordsOf([1, 0], [0, 1], 90, 0.001);
    expect(pts[pts.length - 1]).toEqual([0, 1]);
    for (const p of pts) expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 3);
  });
});

describe("opening an Eagle project", () => {
  it("tells Eagle's files apart", () => {
    expect(eagleKind(file("turns.sch").text)).toBe("schematic");
    expect(eagleKind(file("turns.brd").text)).toBe("board");
    expect(eagleKind(file("turns.lbr").text)).toBe("library");
    expect(eagleKind("(kicad_sch (version 20230121))")).toBeNull();
    expect(eagleKind("<svg/>")).toBeNull();
  });

  it("has the nets Eagle lists, pin for pin", () => {
    const got = open();
    const nets = netlist(got.design).nets.map((n) => `${n.name}: ${n.pins.map((p) => `${p.ref}:${p.pin}`).join(" ")}`);
    expect(nets).toEqual([
      "GND: D1:K J1:3 Q1:2 R3:1 U1:4",
      "MID: U1:2 U1:3",
      "Net-(D1-A): D1:A Q1:3 R1:2",
      "Net-(Q1-1): Q1:1 R2:1",
      "OUT: R3:2 U1:5",
      "SIG: J1:2 R2:2 U1:1",
      "VCC: J1:1 R1:1 U1:8",
    ]);
    // Nothing is said about nets, because none came out differently.
    expect(got.notes.filter((n) => /joined differently/.test(n.why))).toEqual([]);
  });

  it("brings the parts in with their values, packages, pads and where they came from", () => {
    const { design } = open();
    expect(design.parts.map((p) => `${p.ref} ${p.value}`)).toEqual([
      "R1 330",
      "R2 10k",
      "R3 1k",
      "D1 red",
      "Q1 NPN-BC817SOT23",
      "J1 HDR3",
      "U1 DUALBUFD",
      "#PWR1 GND",
      "#PWR2 GND",
      "#PWR3 GND",
      "#PWR4 VCC",
    ]);
    const def = (ref: string) => design.defs[design.parts.find((p) => p.ref === ref)!.def]!;
    expect(def("R1")).toMatchObject({
      prefix: "R",
      description: "Resistor",
      supplier: { mpn: "RC0805FR-0710KL" },
      source: { library: "test", licence: "CC-BY-SA 4.0" },
    });
    // Three gates are three units of one part; a pin on two pads has a pin map.
    const u1 = def("U1");
    expect(u1.symbol.units).toBe(3);
    expect(u1.symbol.pins.map((p) => `${p.number} ${p.name} ${p.unit} ${p.type}`)).toEqual([
      "1 IN 1 input",
      "2 OUT 1 output",
      "3 IN 2 input",
      "5 OUT 2 output",
      "8 VCC 3 power_in",
      "4 GND 3 power_in",
    ]);
    expect(u1.packages[0]!.pinMap).toEqual({ "8": ["8", "7"] });
    // A pin goes by its pad's name, and keeps its own as its name.
    expect(def("D1").symbol.pins.map((p) => `${p.number} ${p.name}`)).toEqual(["K C", "A A"]);
    expect(def("#PWR1").symbol.power).toBe(true);
    // The frame has no pins, so it is no part, and its component is not kept.
    expect(Object.values(design.defs).map((d) => d.name)).not.toContain("FRAME");
    // Pads: a square one, one with no size of its own (a ring of 10 mil round its hole), a long one turned.
    expect(def("J1").packages[0]!.footprint.pads).toEqual([
      { number: "1", kind: "thru", shape: "rect", x: -2.54, y: 0, w: 1.8, h: 1.8, drill: 1 },
      { number: "2", kind: "thru", shape: "circle", x: 0, y: 0, w: 1.508, h: 1.508, drill: 1 },
      { number: "3", kind: "thru", shape: "oval", x: 2.54, y: 0, w: 3.2, h: 1.6, drill: 1, angle: 90 },
    ]);
    expect(def("R1").packages[0]!.footprint.pads[1]).toEqual({ number: "2", kind: "smd", shape: "roundrect", x: 0.95, y: 0, w: 0.9, h: 1.3, round: 0.25 });
    expect(def("R1").packages[0]!.footprint.refAt).toEqual([-0.65, 1.7]);
  });

  it("puts every pin where its net's wires end, turned and mirrored as Eagle does", () => {
    const { design } = open();
    const at = (ref: string, number: string, unit = 1) => {
      const part = design.parts.find((p) => p.ref === ref)!;
      const pin = design.defs[part.def]!.symbol.pins.find((p) => p.number === number)!;
      const symbol = design.sheets.flatMap((s) => s.symbols).find((s) => s.part === part.id && s.unit === unit)!;
      return placeOnSheet([pin.x, pin.y], symbol);
    };
    // J1 is turned half round, D1 mirrored, Q1 mirrored and turned half round, U1's second gate mirrored and turned.
    expect(at("J1", "1")).toEqual([15.24, 48.26]);
    expect(at("D1", "A")).toEqual([50.8, 48.26]);
    expect(at("Q1", "1")).toEqual([58.42, 27.94]);
    expect(at("Q1", "3")).toEqual([63.5, 22.86]);
    expect(at("Q1", "2")).toEqual([63.5, 33.02]);
    expect(at("U1", "3", 2)).toEqual([50.8, 58.42]);
    expect(at("U1", "5", 2)).toEqual([50.8, 43.18]);
    expect(design.sheets.map((s) => `${s.name}: ${s.symbols.length} symbols, ${s.wires.length} wires, ${s.junctions.length} dots`)).toEqual([
      "Sheet 1: 10 symbols, 29 wires, 4 dots",
      "Second half: 3 symbols, 3 wires, 0 dots",
    ]);
    // A net in pieces gets a name on each piece that no supply symbol names, at the end left in mid air when there
    // is one; a net Eagle numbered gets none.
    expect(design.sheets[0]!.labels.map((l) => `${l.name} ${l.x},${l.y}`)).toEqual(["VCC 119.38,63.5", "SIG 60.96,60.96", "MID 109.22,50.8"]);
    expect(design.sheets[1]!.labels.map((l) => l.name)).toEqual(["MID", "OUT"]);
    expect(design.sheets[0]!.notes?.map((n) => n.kind)).toEqual(["text", "line"]);
  });

  it("brings the board in where Eagle has it, both sides", () => {
    const { design } = open();
    const board = design.board!;
    // Measured from the outline's corner, which Eagle had at (12.7, 7.62). One corner is rounded; the circle is a cut-out.
    expect(board.outline).toEqual([
      { x: 0, y: 0 },
      { x: 46, y: 0, bulge: 0.4142 },
      { x: 50, y: 4 },
      { x: 50, y: 40 },
      { x: 0, y: 40 },
    ]);
    expect(board.cutouts).toEqual([
      [
        { x: 23, y: 20, bulge: 1 },
        { x: 27, y: 20, bulge: 1 },
      ],
    ]);
    expect(board.placements.map((p) => `${p.ref} ${p.x},${p.y} ${p.rot} ${p.side}${p.locked ? " locked" : ""}`)).toEqual([
      "R1 10,30 0 top",
      "R2 20,30 90 top",
      "R3 30,31 315 bottom",
      "D1 40,30 270 top",
      "Q1 10,15 270 bottom",
      "J1 25,6 180 top locked",
      "U1 38,15 90 top",
    ]);
    // Where KiCad's own Eagle reader puts these pads too.
    const pads = new Map(boardPads(design).map((p) => [`${p.ref}.${p.pad.number}`, `${p.at[0].toFixed(3)},${p.at[1].toFixed(3)} ${p.side} ${p.net}`]));
    expect(pads.get("R3.1")).toBe("30.672,30.328 bottom GND");
    expect(pads.get("R3.2")).toBe("29.328,31.672 bottom OUT");
    expect(pads.get("Q1.1")).toBe("8.900,14.050 bottom Net-(Q1-1)");
    expect(pads.get("Q1.3")).toBe("11.100,15.000 bottom Net-(D1-A)");
    expect(pads.get("J1.1")).toBe("27.540,6.000 top VCC");
    expect(pads.get("U1.1")).toBe("40.600,13.095 top SIG");
    expect(pads.get("U1.7")).toBe("35.400,14.365 top VCC");
    expect(pads.get("U1.6")).toBe("35.400,15.635 top ");
  });

  it("brings the copper in under the schematic's names, with the rules and classes", () => {
    const { design } = open();
    const board = design.board!;
    expect(board.tracks.map((t) => `${t.net} ${t.layer} ${t.width} ${t.pts.length}`)).toEqual([
      "VCC top 0.5 6",
      "GND in1 0.2 2",
      "Net-(D1-A) top 0.3 2",
      // The run with the curved piece in it, which stays one curved piece (#755).
      "Net-(D1-A) top 0.3 4",
      "Net-(D1-A) top 0.3 2",
      "Net-(D1-A) bottom 0.3 2",
      "MID top 0.254 2",
    ]);
    // The board's one inside layer with copper makes it a four-layer board (#648), and its blind via keeps its span.
    expect(board.copperLayers).toBe(4);
    // A via with no size of its own gets a ring of 8 mil.
    expect(board.vias.filter((v) => !v.span).map((v) => `${v.net} ${v.x},${v.y} ${v.diameter} ${v.drill}`)).toEqual([
      "VCC 6,20 1.2 0.5",
      "Net-(D1-A) 12,22 0.8064 0.4",
    ]);
    expect(board.vias.filter((v) => v.span).map((v) => v.span)).toEqual([["top", "in1"]]);
    expect(board.pours.map((p) => `${p.net} ${p.layer} ${p.thermal} ${p.priority ?? 0}`)).toEqual(["GND bottom true -1", "GND top false 0"]);
    expect(
      board.keepouts.map((k) =>
        Object.keys(k)
          .filter((key) => key !== "id" && key !== "outline")
          .join(),
      ),
    ).toEqual(["pours", "tracks", "parts"]);
    expect(board.holes.map((h) => `${h.x},${h.y} ${h.drill}`)).toEqual(["4,4 3.2", "46,4 2.2"]);
    expect(board.texts.map((t) => `${t.layer} ${t.x},${t.y} ${t.text} ${t.angle ?? 0}`)).toEqual([
      "silk-top 3,37 Top side 0",
      "silk-bottom 47,26 Under 0",
      "silk-top 48,12 v1 90",
    ]);
    expect(board.rules).toMatchObject({
      clearance: 0.1778,
      minTrackWidth: 0.1524,
      trackWidth: 0.254,
      minDrill: 0.35,
      copperToEdge: 0.254,
      minRing: 0.254,
      minViaRing: 0.2032,
    });
    expect(board.classes.map((c) => ({ ...c, id: "" }))).toEqual([
      { id: "", name: "power", nets: ["VCC", "GND"], trackWidth: 0.5, clearance: 0.3, viaDrill: 0.4 },
    ]);
    // The board is in step with its schematic, and nothing is joined that should not be.
    expect(boardChanges(design, netlist(design))).toEqual([]);
    const errors = checkBoard(design).filter((r) => r.level === "error");
    // The blind via's own hole is smaller than the file's rules allow, which the check now says.
    expect([...new Set(errors.map((r) => r.rule))]).toEqual(["unrouted", "hole-size"]);
    expect(errors.filter((r) => r.rule === "hole-size")).toHaveLength(1);
  });

  it("lists what did not come across", () => {
    const got = open();
    expect(got.found).toEqual({ sheets: 2, parts: 7, placed: 7, tracks: 7, vias: 3, pours: 2 });
    expect(got.notes.map((n) => `${n.name}: ${n.why}`)).toEqual([
      "Board: Left out: 3 drawings in packages on layers that are not kept (stop, cream, restrict and document layers)",
      "Board: Left out: 1 packages with no pads (logos and marks)",
      "Board: Left out: 1 dimensions",
      "Board: Left out: 1 drawings on layers that are not kept (document, stop, cream and user layers)",
      "Schematic: Left out: 1 frames and other symbols with no pins",
      "Schematic: Left out: 1 buses, which are not drawn (the wires they carry still join by name)",
    ]);
  });

  it("opens a schematic on its own, with packages from its libraries", () => {
    const got = importEagleProject([file("turns.sch")]);
    expect(got.design.board).toBeUndefined();
    expect(got.found).toMatchObject({ parts: 7, placed: 0 });
    const r1 = got.design.parts.find((p) => p.ref === "R1")!;
    expect(got.design.defs[r1.def]!.packages[0]!.footprint.name).toBe("R0805");
    expect(got.design.defs[r1.def]!.source).toEqual({ library: "test", licence: "Not stated" });
  });

  it("says why when the files are not enough", () => {
    expect(() => importEagleProject([file("turns.brd")])).toThrow("A board needs its schematic. Add the project's .sch file too.");
    expect(() => importEagleProject([{ name: "notes.txt", text: "hello" }])).toThrow("There is no Eagle schematic (.sch) among these files.");
    expect(() => importEagleProject([{ name: "old.sch", text: "\u0010\u0000binary" }])).toThrow(
      "old.sch: It was saved by an Eagle older than 6, which is not XML. Open and save it in a newer Eagle first.",
    );
    const got = importEagleProject([file("turns.sch"), file("turns.lbr"), { name: "readme.md", text: "# hi" }]);
    expect(got.notes.slice(0, 2).map((n) => `${n.name}: ${n.why}`)).toEqual([
      "turns.lbr: A library. Bring it in from Components, Import parts",
      "readme.md: Not an Eagle schematic or board, so it was not read",
    ]);
  });

  it("names a net that comes out joined differently", () => {
    // A wire of SIG dragged onto VCC's pin: Eagle still lists two nets, but the drawing now joins them.
    const text = file("turns.sch").text.replace('<wire x1="15.24" y1="50.8" x2="25.4" y2="50.8"', '<wire x1="15.24" y1="48.26" x2="25.4" y2="50.8"');
    const got = importEagleProject([{ name: "turns.sch", text }]);
    expect(got.notes.find((n) => /joined differently/.test(n.why))?.why).toBe(
      "2 nets are joined differently here than in Eagle: VCC, SIG. Check them against the original",
    );
  });
});

describe("importing an Eagle library", () => {
  it("makes a component of each device set, with every package it comes in", () => {
    const got = importEagleLibraries([file("turns.lbr")], { licence: "CC-BY-SA 4.0" });
    expect(got.found).toEqual({ symbols: 9, footprints: 7 });
    expect(got.parts.map((p) => `${p.name}: ${p.packages.map((k) => k.footprint.name).join(", ")}`)).toEqual([
      "R: R0805, HDR3",
      "LED: LED5MM",
      "NPN: SOT23",
      "HDR3: HDR3",
      "DUALBUF: SO8",
    ]);
    const r = got.parts[0]!;
    // The first package numbers the pins; the next says which of its pads each pin is on.
    expect(r.symbol.pins.map((p) => p.number)).toEqual(["2", "1"]);
    expect(r.packages[1]!.pinMap).toEqual({ "2": ["3"] });
    expect(r.packages[0]!.model).toBeDefined();
    expect(r.source).toEqual({ library: "turns", licence: "CC-BY-SA 4.0" });
    expect(got.notes.map((n) => `${n.name}: ${n.why}`)).toEqual([
      "GND: A power symbol. BetterCad has its own, so it was left out",
      "VCC: A power symbol. BetterCad has its own, so it was left out",
      "FRAME: It has no pins (a frame or a mark), so it was left out",
      "HOLE3: No device here uses this package, so it was left out",
      "LOGO: No device here uses this package, so it was left out",
    ]);
  });

  it("says what a file is when it is not a library", () => {
    const got = importEagleLibraries([file("turns.sch"), { name: "old.lbr", text: "\u0010binary" }, { name: "x.lbr", text: "<svg/>" }], { licence: "MIT" });
    expect(got.parts).toEqual([]);
    expect(got.notes.map((n) => n.why)).toEqual([
      "An Eagle schematic or board, not a library. Open it from Open project",
      "It was saved by an Eagle older than 6, which is not XML. Open and save it in a newer Eagle first",
      "Not an Eagle library",
    ]);
  });
});

/** The way Fusion Electronics draws a net: a short wire from the pin, and its name written just past the end. */
const STUBS = `<?xml version="1.0" encoding="utf-8"?>
<eagle version="9.7.0"><drawing><schematic><libraries><library name="lib">
<packages><package name="P2"><pad name="1" x="0" y="0" drill="1"/><pad name="2" x="2.54" y="0" drill="1"/></package></packages>
<symbols><symbol name="S"><pin name="1" x="-5.08" y="0" length="short"/><pin name="2" x="5.08" y="0" length="short" rot="R180"/></symbol></symbols>
<devicesets>
<deviceset name="CONN_02" prefix="J" uservalue="yes"><gates><gate name="G$1" symbol="S" x="0" y="0"/></gates>
<devices><device name="" package="P2"><connects><connect gate="G$1" pin="1" pad="1"/><connect gate="G$1" pin="2" pad="2"/></connects><technologies><technology name=""/></technologies></device></devices></deviceset>
<deviceset name="DRV_8411" prefix="IC"><gates><gate name="G$1" symbol="S" x="0" y="0"/></gates>
<devices><device name="" package="P2"><connects><connect gate="G$1" pin="1" pad="1"/><connect gate="G$1" pin="2" pad="2"/></connects><technologies><technology name=""/></technologies></device></devices></deviceset>
</devicesets></library></libraries>
<parts><part name="MOTOR" library="lib" deviceset="CONN_02" device=""/><part name="IC1" library="lib" deviceset="DRV_8411" device=""/><part name="IC2" library="lib" deviceset="DRV_8411" device="" value="spare"/></parts>
<sheets><sheet><instances><instance part="MOTOR" gate="G$1" x="0" y="0"/><instance part="IC1" gate="G$1" x="50.8" y="0"/><instance part="IC2" gate="G$1" x="50.8" y="25.4"/></instances>
<nets><net name="AOUT1" class="0">
<segment><pinref part="MOTOR" gate="G$1" pin="2"/><wire x1="5.08" y1="0" x2="12.7" y2="0" width="0.1524" layer="91"/><label x="15.24" y="0" size="1.778" layer="95"/></segment>
<segment><pinref part="IC1" gate="G$1" pin="1"/><wire x1="45.72" y1="0" x2="38.1" y2="0" width="0.1524" layer="91"/><label x="33.02" y="0" size="1.778" layer="95"/></segment>
</net></nets></sheet></sheets></schematic></drawing></eagle>`;

describe("a schematic drawn the way Fusion Electronics draws one", () => {
  const got = importEagleProject([{ name: "stubs.sch", text: STUBS }], { licence: "Not stated" });

  it("puts a name written past the end of a wire on that end, so the pieces join and nothing hangs", () => {
    expect(got.notes).toEqual([]);
    expect(got.design.sheets[0]!.labels.map((l) => `${l.name} ${l.x},${l.y}`)).toEqual(["AOUT1 12.7,0", "AOUT1 38.1,0"]);
    const nl = netlist(got.design);
    expect(nl.nets.find((n) => n.name === "AOUT1")!.pins.map((p) => `${p.ref}:${p.pin}`)).toEqual(["IC1:1", "MOTOR:2"]);
    expect(nl.nets.flatMap((n) => n.openEnds)).toEqual([]);
  });

  it("gives a part the value Eagle shows: its own, else its device's name, else none where the value is yours to give", () => {
    expect(got.design.parts.map((p) => `${p.ref}=${p.value}`)).toEqual(["MOTOR=", "IC1=DRV_8411", "IC2=spare"]);
  });
});
