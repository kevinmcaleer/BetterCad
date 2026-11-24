import { GRID, capacitor, header, led, resistor } from "./basics";
import { boardPads } from "./board";
import { addLabel, addNoConnect, changePart, placePart } from "./edit";
import { placeOnSheet } from "./geom";
import { emptyDesign, withFixedIds, type ComponentDef, type ElectronicsDesign, type Id, type P2 } from "./model";
import { addPour, wholeBoard } from "./pcb/pour";
import { addHole, addText, addTrack, roundedOutline, setBoard, setPlacement } from "./pcb/route";
import { pushToBoard } from "./sync";

/**
 * The sample board (#666): a carrier for a Raspberry Pi Pico that drives two servos. Two rows of sockets take the
 * Pico, two three-pin headers take the servos, a two-pin header brings 5 V in, and an LED shows the power is on. It
 * is built from the same calls the tools make, so it doubles as the fixture that goes from a schematic to an order
 * pack, and it passes both rules checks.
 *
 * Pico pins, as they sit in the sockets: J1 is pins 1 to 20 (pin 1 is GP0, 2 is GP1, 3 is GND) and J2 is pins 40
 * down to 21 (its pin 1 is VBUS, 2 is VSYS, 3 is GND).
 */
export const SAMPLE_BOARD = {
  width: 60,
  height: 58,
  holes: [
    [4, 4],
    [56, 4],
    [4, 54],
    [56, 54],
  ] as P2[],
  hole: 3.2,
};

export function sampleBoard(): ElectronicsDesign {
  return withFixedIds(() => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    const ids: Record<string, Id> = {};
    const put = (name: string, def: ComponentDef, x: number, y: number, value?: string) => {
      const made = placePart(d, sheet, def, { x: x * GRID, y: y * GRID });
      d = value ? changePart(made.design, made.part.id, { value }) : made.design;
      ids[name] = made.part.id;
    };
    put("J1", header(20), 0, 0, "Pico 1 to 20");
    put("J2", header(20), 14, 0, "Pico 40 to 21");
    put("J3", header(3), 28, 8, "Servo 1");
    put("J4", header(3), 28, 0, "Servo 2");
    put("J5", header(2), 28, -8, "5 V in");
    put("R1", resistor(), 40, 6, "1 kΩ");
    put("D1", led(), 40, -2);
    put("C1", capacitor(), 48, 2, "10 µF");

    /** Where a pin's wire end is on the sheet. */
    const pin = (name: string, n: number): P2 => {
      const part = d.parts.find((p) => p.id === ids[name])!;
      const sym = d.sheets[0]!.symbols.find((s) => s.part === part.id)!;
      const p = d.defs[part.def]!.symbol.pins.find((x) => x.number === String(n))!;
      return placeOnSheet([p.x, p.y], sym);
    };
    // Nets are joined by name: a label on each pin, the way a tidy schematic is drawn.
    const nets: Record<string, [string, number][]> = {
      "5V": [
        ["J5", 1],
        ["J2", 2],
        ["J3", 2],
        ["J4", 2],
        ["R1", 1],
        ["C1", 1],
      ],
      GND: [
        ["J5", 2],
        ["J1", 3],
        ["J2", 3],
        ["J3", 3],
        ["J4", 3],
        ["D1", 2],
        ["C1", 2],
      ],
      SERVO1: [
        ["J1", 1],
        ["J3", 1],
      ],
      SERVO2: [
        ["J1", 2],
        ["J4", 1],
      ],
      LED: [
        ["R1", 2],
        ["D1", 1],
      ],
    };
    const used = new Set<string>();
    for (const [net, pins] of Object.entries(nets))
      for (const [name, n] of pins) {
        const at = pin(name, n);
        d = addLabel(d, sheet, net, at[0], at[1]);
        used.add(`${name}.${n}`);
      }
    // The Pico's other pins are left free on purpose.
    for (const name of ["J1", "J2"])
      for (let n = 1; n <= 20; n += 1)
        if (!used.has(`${name}.${n}`)) {
          const at = pin(name, n);
          d = addNoConnect(d, sheet, at[0], at[1]);
        }

    d = pushToBoard(d).design;
    d = setBoard(d, { outline: roundedOutline(SAMPLE_BOARD.width, SAMPLE_BOARD.height, 3) });
    // The Pico's rows are 17.78 mm apart; pin 1 of each is at the top.
    d = setPlacement(d, ids.J1!, { x: 20, y: 53 });
    d = setPlacement(d, ids.J2!, { x: 37.78, y: 53 });
    d = setPlacement(d, ids.J3!, { x: 8, y: 30 });
    d = setPlacement(d, ids.J4!, { x: 8, y: 18 });
    d = setPlacement(d, ids.J5!, { x: 50, y: 50.46 });
    d = setPlacement(d, ids.R1!, { x: 50, y: 38, rot: 270 });
    d = setPlacement(d, ids.D1!, { x: 50, y: 32, rot: 270 });
    d = setPlacement(d, ids.C1!, { x: 50, y: 22, rot: 270 });
    const pads = boardPads(d);
    const pad = (ref: string, n: number): P2 => pads.find((p) => p.ref === ref && p.pad.number === String(n))!.at;

    // Signals on top, clear of each other.
    d = addTrack(d, "SERVO1", "top", [pad("J1", 1), [14, 53], [14, 32], [12, 30], pad("J3", 1)], 0.3);
    d = addTrack(d, "SERVO2", "top", [pad("J1", 2), [16, 50.46], [16, 20], [14, 18], pad("J4", 1)], 0.3);
    d = addTrack(d, "LED", "top", [pad("R1", 2), pad("D1", 1)], 0.3);
    // Power is wider. On top it goes round the input's ground pin to the LED's resistor and the capacitor.
    d = addTrack(d, "5V", "top", [pad("J5", 1), [53.5, 50.46], [53.5, pad("R1", 1)[1]], pad("R1", 1)], 0.5);
    d = addTrack(d, "5V", "top", [[53.5, pad("R1", 1)[1]], [53.5, pad("C1", 1)[1]], pad("C1", 1)], 0.5);
    // Underneath it runs to the Pico and over the top of its sockets to the servos.
    d = addTrack(d, "5V", "bottom", [pad("J5", 1), pad("J2", 2)], 0.5);
    d = addTrack(d, "5V", "bottom", [pad("J2", 2), [35.5, 50.46], [35.5, 56], [11, 56], [11, pad("J3", 2)[1]], pad("J3", 2)], 0.5);
    d = addTrack(d, "5V", "bottom", [[11, pad("J3", 2)[1]], [11, pad("J4", 2)[1]], pad("J4", 2)], 0.5);
    // Ground is a pour on both sides, which joins every ground pad without a track.
    d = addPour(d, "GND", "top", wholeBoard(d.board!), true);
    d = addPour(d, "GND", "bottom", wholeBoard(d.board!), true);
    for (const [x, y] of SAMPLE_BOARD.holes) d = addHole(d, x, y, SAMPLE_BOARD.hole);
    d = addText(d, 24, 2, "Pico servo board", "silk-top", 1.6);
    return d;
  });
}
