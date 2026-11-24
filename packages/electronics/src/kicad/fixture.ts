import { GRID, capacitor, header, headerFootprint, led, power, resistor } from "../basics";
import { boardPads } from "../board";
import { addJunction, addLabel, addNoConnect, addWire, placePart } from "../edit";
import { pinDirOnSheet, placeOnSheet, turn } from "../geom";
import { eid, emptyDesign, emptySheet, withFixedIds, type ComponentDef, type ElectronicsDesign, type Id, type P2, type Rot } from "../model";
import { addPour, wholeBoard } from "../pcb/pour";
import { addHole, addKeepout, addText, addTrack, addVia, roundedOutline, setBoard, setPlacement } from "../pcb/route";
import { pushToBoard } from "../sync";

const G = GRID;

/** A part with two units and a pin every unit shares, to check that units go across. */
function dual(): ComponentDef {
  return {
    name: "Dual buffer",
    prefix: "U",
    value: "Dual buffer",
    symbol: {
      name: "Dual buffer",
      units: 2,
      shapes: [
        { kind: "rect", x1: -2 * G, y1: -2 * G, x2: 2 * G, y2: 2 * G, fill: true },
        { kind: "text", x: 0, y: 0, text: "1", size: 1.27, align: "centre", unit: 1 },
        { kind: "text", x: 0, y: 0, text: "2", size: 1.27, align: "centre", unit: 2 },
      ],
      pins: [
        { number: "1", name: "A", type: "input", x: -4 * G, y: 0, length: 2 * G, dir: 0, unit: 1 },
        { number: "2", name: "Y", type: "output", x: 4 * G, y: 0, length: 2 * G, dir: 180, unit: 1 },
        { number: "3", name: "A", type: "input", x: -4 * G, y: 0, length: 2 * G, dir: 0, unit: 2 },
        { number: "4", name: "Y", type: "output", x: 4 * G, y: 0, length: 2 * G, dir: 180, unit: 2 },
        { number: "5", name: "EN", type: "input", x: 0, y: -4 * G, length: 2 * G, dir: 90 },
      ],
    },
    packages: [{ footprint: headerFootprint(5) }],
  };
}

/**
 * A design that turns everything every way (#664, #663): symbols mirrored and turned, a part with two units, power
 * symbols, wires that join at a T, cross with a dot and cross without one, a pin that lands on the middle of a wire,
 * a second sheet joined by name; and on the board, parts on both sides at odd angles, tracks, a via, holes, a cut-out,
 * a pour and a keep-out. The exporters and importers are checked against it.
 */
export function tangle(): ElectronicsDesign {
  return withFixedIds(() => {
    let d = emptyDesign();
    const one = d.sheets[0]!.id;
    const two = { ...emptySheet("Sheet 2"), id: "sh2" };
    d = { ...d, sheets: [...d.sheets, two] };
    const ids: Record<string, Id> = {};
    const put = (ref: string, sheet: Id, def: ComponentDef, x: number, y: number, rot: Rot = 0, mirror = false) => {
      const made = placePart(d, sheet, def, { x: x * G, y: y * G, rot, mirror });
      d = made.design;
      ids[ref] = made.part.id;
      return made;
    };
    const symbolOf = (ref: string, unit = 1) =>
      d.sheets.flatMap((s) => s.symbols.map((sym) => ({ sym, sheet: s.id }))).find((x) => x.sym.part === ids[ref] && x.sym.unit === unit)!;
    /** A pin's wire end, and the way out from the body, one grid step long. */
    const pin = (ref: string, n: string, unit = 1): { at: P2; out: P2; sheet: Id } => {
      const { sym, sheet } = symbolOf(ref, unit);
      const def = d.defs[d.parts.find((p) => p.id === ids[ref])!.def]!;
      const p = def.symbol.pins.find((x) => x.number === n)!;
      return { at: placeOnSheet([p.x, p.y], sym), out: turn([-G, 0], pinDirOnSheet(p, sym)), sheet };
    };
    const far = (p: { at: P2; out: P2 }, steps: number): P2 => [p.at[0] + p.out[0] * steps, p.at[1] + p.out[1] * steps];
    /** A short wire out of a pin, with a label on its end. */
    const label = (ref: string, n: string, name: string, unit = 1) => {
      const p = pin(ref, n, unit);
      const end = far(p, 2);
      d = addWire(d, p.sheet, p.at, end);
      d = addLabel(d, p.sheet, name, end[0], end[1]);
    };
    /** A short wire out of a pin, with a power symbol on its end. */
    const supply = (ref: string, n: string, name: string) => {
      const p = pin(ref, n);
      const end = far(p, 2);
      d = addWire(d, p.sheet, p.at, end);
      const def = power(name);
      const at = def.symbol.pins[0]!;
      d = placePart(d, p.sheet, def, { x: end[0] - at.x, y: end[1] - at.y }).design;
    };

    put("R1", one, resistor(), 0, 0);
    put("D1", one, led(), 20, 0, 90, true);
    put("J1", one, header(3), 40, 0, 180);
    put("C1", one, capacitor(), 0, -20, 270, true);
    put("U1", one, dual(), 20, -20);
    // The second unit of U1 is the same part drawn again.
    d = {
      ...d,
      sheets: d.sheets.map((s) =>
        s.id === one ? { ...s, symbols: [...s.symbols, { id: eid("sy"), part: ids.U1!, unit: 2, x: 40 * G, y: -20 * G, rot: 90 as Rot, mirror: true }] } : s,
      ),
    };
    supply("R1", "1", "5V");
    label("R1", "2", "LED");
    label("D1", "1", "LED");
    supply("D1", "2", "GND");
    label("J1", "1", "5V");
    label("J1", "2", "SIG");
    supply("J1", "3", "GND");
    label("C1", "1", "5V");
    supply("C1", "2", "GND");
    label("U1", "1", "SIG", 1);
    label("U1", "2", "MID", 1);
    label("U1", "3", "MID", 2);
    label("U1", "4", "OUT", 2);
    label("U1", "5", "5V", 1);

    // Wires that meet every way, off a six pin header.
    put("J2", one, header(6), 70, 10);
    const e = (n: number) => pin("J2", String(n));
    const run = far(e(1), 22);
    const y1 = e(1).at[1];
    const up = y1 + 3 * G;
    d = addWire(d, one, e(1).at, run);
    d = addLabel(d, one, "TEE", run[0], run[1]);
    // An end that lands on the middle of a wire joins it.
    const t = far(e(2), 5);
    d = addWire(d, one, e(2).at, t);
    d = addWire(d, one, t, [t[0], y1]);
    // Wires that only cross stay apart.
    const x = far(e(3), 10);
    d = addWire(d, one, e(3).at, x);
    d = addWire(d, one, x, [x[0], up]);
    d = addLabel(d, one, "OVER", x[0], up);
    // With a dot on the crossing they join.
    const j = far(e(4), 15);
    d = addWire(d, one, e(4).at, j);
    d = addWire(d, one, j, [j[0], up]);
    d = addJunction(d, one, j[0], y1);
    d = addNoConnect(d, one, e(5).at[0], e(5).at[1]);
    label("J2", "6", "SIG");
    // A pin that lands on the middle of a wire joins it too.
    const r2 = resistor();
    const p1 = r2.symbol.pins.find((p) => p.number === "1")!;
    const on = far(e(1), 18);
    const made = placePart(d, one, r2, { x: on[0] - p1.x, y: on[1] - p1.y });
    d = made.design;
    ids.R2 = made.part.id;
    label("R2", "2", "OUT");

    // The second sheet joins the first by name.
    put("R3", two.id, resistor(), 0, 0, 90);
    label("R3", "1", "SIG");
    label("R3", "2", "LED");

    d = pushToBoard(d).design;
    d = setBoard(d, {
      outline: roundedOutline(80, 60, 4),
      cutouts: [
        [
          { x: 34, y: 6 },
          { x: 46, y: 6 },
          { x: 46, y: 10 },
          { x: 34, y: 10 },
        ],
      ],
    });
    d = setPlacement(d, ids.R1!, { x: 12, y: 48, rot: 30 });
    d = setPlacement(d, ids.D1!, { x: 24, y: 48, rot: 90, side: "bottom" });
    d = setPlacement(d, ids.J1!, { x: 40, y: 46, rot: 45, side: "bottom" });
    d = setPlacement(d, ids.C1!, { x: 60, y: 48, rot: 270 });
    d = setPlacement(d, ids.U1!, { x: 12, y: 20, rot: 0, side: "bottom" });
    d = setPlacement(d, ids.J2!, { x: 30, y: 16, rot: 90 });
    d = setPlacement(d, ids.R2!, { x: 56, y: 30, rot: 135 });
    d = setPlacement(d, ids.R3!, { x: 68, y: 20, rot: 180, side: "bottom" });
    const pads = boardPads(d);
    const pad = (ref: string, n: string) => pads.find((p) => p.ref === ref && p.pad.number === n)!;
    d = addTrack(d, "LED", "top", [pad("R1", "2").at, [20, 54], [22, 54]], 0.25);
    d = addVia(d, "LED", 22, 54);
    d = addTrack(d, "LED", "bottom", [[22, 54], pad("D1", "1").at], 0.3);
    d = addTrack(d, "5V", "top", [pad("R1", "1").at, [8, 40], [60, 40], pad("C1", "1").at], 0.5);
    d = addPour(d, "GND", "bottom", wholeBoard(d.board!), true);
    d = addKeepout(d, [50, 12], [58, 18], { tracks: true });
    d = addHole(d, 5, 5, 3.2);
    d = addHole(d, 75, 55, 1, 2);
    d = addText(d, 6, 30, "Top", "silk-top", 1.5);
    d = addText(d, 70, 30, "Under", "silk-bottom", 1.5);
    return d;
  });
}
