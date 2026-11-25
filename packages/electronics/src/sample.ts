import { GRID, capacitor, header, led, power, resistor } from "./basics";
import { boardPads } from "./board";
import { addLabel, addNoConnect, changePart, placePart } from "./edit";
import { placeOnSheet } from "./geom";
import { emptyDesign, withFixedIds, type ComponentDef, type ElectronicsDesign, type Id, type P2 } from "./model";
import { addPour, wholeBoard } from "./pcb/pour";
import { addHole, addText, addTrack, addVia, roundedOutline, setBoard, setPlacement } from "./pcb/route";
import parts from "./sample.parts.json";
import { pushToBoard } from "./sync";

/**
 * The sample board (#666): a carrier for a Raspberry Pi Pico that runs a small rover. Two rows of sockets take the
 * Pico, an L293D drives two motors, two three-pin headers take servos, a Qwiic socket takes I2C sensors, a two-pin
 * header brings 5 V in through a slide switch, and an LED shows the power is on. It is built from the same calls the
 * tools make, so it doubles as the fixture that goes from a schematic to an order pack, and it passes both rules
 * checks.
 *
 * Pico pins, as they sit in the sockets: J1 is pins 1 to 20 (pin 1 is GP0, 2 is GP1, 3 is GND) and J2 is pins 40
 * down to 21 (its pin 1 is VBUS, 2 is VSYS, 3 is GND, 5 is 3V3, 9 is GP27 and 10 is GP26).
 *
 * The motor driver, the Qwiic socket and the switch are starter library parts, kept in `sample.parts.json` so the
 * sample does not load the whole library; a test holds the copies to the library's own.
 */
export const SAMPLE_BOARD = {
  width: 60,
  height: 80,
  holes: [
    [4, 4],
    [56, 4],
    [4, 76],
    [56, 76],
  ] as P2[],
  hole: 3.2,
};
const LIBRARY = parts as unknown as Record<"l293d" | "jst-sh-4" | "slide-switch", ComponentDef>;

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
    put("U1", LIBRARY.l293d, 66, 0);
    put("J6", header(2), 84, 6, "Motor A");
    put("J7", header(2), 84, -4, "Motor B");
    put("J8", LIBRARY["jst-sh-4"], 28, -18);
    put("SW1", LIBRARY["slide-switch"], 44, -16, "Power");
    // The rails are named by power symbols, which is what tells the rules check the motor driver has a supply.
    put("#5V", power("5V"), 54, -12);
    put("#GND", power("GND"), 60, -12);

    /** Where a pin's wire end is on the sheet. */
    const pin = (name: string, n: number): P2 => {
      const part = d.parts.find((p) => p.id === ids[name])!;
      const sym = d.sheets[0]!.symbols.find((s) => s.part === part.id)!;
      const p = d.defs[part.def]!.symbol.pins.find((x) => x.number === String(n))!;
      return placeOnSheet([p.x, p.y], sym);
    };
    // Nets are joined by name: a label on each pin, the way a tidy schematic is drawn.
    const nets: Record<string, [string, number][]> = {
      VIN: [
        ["J5", 1],
        ["SW1", 2],
      ],
      "5V": [
        ["#5V", 1],
        ["SW1", 3],
        ["U1", 1],
        ["U1", 8],
        ["U1", 9],
        ["U1", 16],
        ["J2", 2],
        ["J3", 2],
        ["J4", 2],
        ["R1", 1],
        ["C1", 1],
      ],
      GND: [
        ["#GND", 1],
        ["U1", 4],
        ["U1", 5],
        ["U1", 12],
        ["U1", 13],
        ["J8", 1],
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
      // The motor driver's inputs, on GP2 to GP5.
      MOTOR_A1: [
        ["J1", 5],
        ["U1", 2],
      ],
      MOTOR_A2: [
        ["J1", 6],
        ["U1", 7],
      ],
      MOTOR_B1: [
        ["J1", 7],
        ["U1", 10],
      ],
      MOTOR_B2: [
        ["J1", 4],
        ["U1", 15],
      ],
      MOTOR_A_OUT1: [
        ["U1", 3],
        ["J6", 2],
      ],
      MOTOR_A_OUT2: [
        ["U1", 6],
        ["J6", 1],
      ],
      MOTOR_B_OUT1: [
        ["U1", 11],
        ["J7", 2],
      ],
      MOTOR_B_OUT2: [
        ["U1", 14],
        ["J7", 1],
      ],
      // Qwiic: ground, 3.3 V, data and clock, on the Pico's second I2C bus.
      "3V3": [
        ["J2", 5],
        ["J8", 2],
      ],
      SDA: [
        ["J2", 10],
        ["J8", 3],
      ],
      SCL: [
        ["J2", 9],
        ["J8", 4],
      ],
    };
    const used = new Set<string>();
    for (const [net, pins] of Object.entries(nets))
      for (const [name, n] of pins) {
        const at = pin(name, n);
        d = addLabel(d, sheet, net, at[0], at[1]);
        used.add(`${name}.${n}`);
      }
    // The Pico's other pins are left free on purpose, and so is the switch's other throw.
    for (const [name, count] of [
      ["J1", 20],
      ["J2", 20],
      ["SW1", 3],
    ] as const)
      for (let n = 1; n <= count; n += 1)
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
    // The motor driver lies along the top of the board, pins 1 to 8 nearest the Pico, with its motors' plugs by it.
    d = setPlacement(d, ids.U1!, { x: 16, y: 63, rot: 90 });
    d = setPlacement(d, ids.J6!, { x: 8, y: 66 });
    d = setPlacement(d, ids.J7!, { x: 23.62, y: 76, rot: 90 });
    // Qwiic beside the Pico's I2C pins, its pads facing them; the switch above the power plug.
    d = setPlacement(d, ids.J8!, { x: 45, y: 31.18, rot: 90 });
    d = setPlacement(d, ids.SW1!, { x: 50, y: 62, rot: 180 });
    const pads = boardPads(d);
    const pad = (ref: string, n: number): P2 => pads.find((p) => p.ref === ref && p.pad.number === String(n))!.at;

    // Signals on top, clear of each other.
    d = addTrack(d, "SERVO1", "top", [pad("J1", 1), [14, 53], [14, 32], [12, 30], pad("J3", 1)], 0.3);
    d = addTrack(d, "SERVO2", "top", [pad("J1", 2), [16, 50.46], [16, 20], [14, 18], pad("J4", 1)], 0.3);
    d = addTrack(d, "LED", "top", [pad("R1", 2), pad("D1", 1)], 0.3);
    // Power is wider. It comes in at J5, through the switch, and out along the top to the motor driver.
    const [sw, on, r1, c1] = [pad("SW1", 2), pad("SW1", 3), pad("R1", 1), pad("C1", 1)];
    d = addTrack(d, "VIN", "top", [pad("J5", 1), [50, 56], [sw[0], 56 + (50 - sw[0])], sw], 0.5);
    d = addTrack(d, "5V", "top", [on, [on[0], 58], [37, 58], [pad("U1", 8)[0], 58 + (37 - pad("U1", 8)[0])], pad("U1", 8)], 0.5);
    // A branch goes down past the power plug to the LED's resistor and the capacitor.
    d = addTrack(d, "5V", "top", [[on[0], 58], [on[0], 45.5], [53.5, 45.5], [53.5, r1[1]], r1], 0.5);
    d = addTrack(d, "5V", "top", [[53.5, r1[1]], [53.5, c1[1]], c1], 0.5);
    // Underneath it joins the driver's four supply pins, and runs to the Pico and over its sockets to the servos.
    d = addTrack(d, "5V", "bottom", [pad("U1", 1), pad("U1", 16)], 0.5);
    d = addTrack(d, "5V", "bottom", [pad("U1", 8), pad("U1", 9)], 0.5);
    d = addTrack(
      d,
      "5V",
      "bottom",
      [
        [pad("U1", 1)[0], 66.8],
        [pad("U1", 8)[0], 66.8],
      ],
      0.5,
    );
    d = addTrack(d, "5V", "bottom", [pad("U1", 8), [pad("U1", 8)[0], 58], [35.5, 56.28], [35.5, 56]], 0.5);
    d = addTrack(d, "5V", "bottom", [pad("J2", 2), [35.5, 50.46], [35.5, 56], [11, 56], [11, pad("J3", 2)[1]], pad("J3", 2)], 0.5);
    d = addTrack(d, "5V", "bottom", [[11, pad("J3", 2)[1]], [11, pad("J4", 2)[1]], pad("J4", 2)], 0.5);

    // The driver's inputs run up between the Pico's sockets on top, each in its own lane, and fan out to its pins.
    const lane = (net: string, from: number, x: number, y: number, to: P2[]) =>
      (d = addTrack(d, net, "top", [pad("J1", from), [x, pad("J1", from)[1]], [x, y], ...to], 0.3));
    const u = (n: number) => pad("U1", n);
    lane("MOTOR_B2", 4, 22, 58.6, [[u(1)[0] + 1.27, 58.6], [u(1)[0] + 1.27, u(15)[1] - 1.27], u(15)]);
    lane("MOTOR_A1", 5, 23, 59.4, [[u(2)[0], 59.4], u(2)]);
    lane("MOTOR_A2", 6, 24, 60.2, [[u(7)[0], 60.2], u(7)]);
    lane("MOTOR_B1", 7, 25, 59.4, [[u(7)[0] + 1.27, 59.4], [u(7)[0] + 1.27, u(10)[1] - 1.27], u(10)]);
    // Its outputs go underneath: motor B straight up to its plug, motor A round to the left.
    d = addTrack(d, "MOTOR_B_OUT1", "bottom", [u(11), [u(11)[0], 73.46], pad("J7", 2)], 0.5);
    d = addTrack(d, "MOTOR_B_OUT2", "bottom", [u(14), [u(14)[0], 73.46], pad("J7", 1)], 0.5);
    const [m1, m2] = [pad("J6", 1), pad("J6", 2)];
    d = addTrack(d, "MOTOR_A_OUT1", "bottom", [u(3), [u(3)[0], 60.8], [m2[0] + (m2[1] - 60.8), 60.8], m2], 0.5);
    d = addTrack(d, "MOTOR_A_OUT2", "bottom", [u(6), [u(6)[0], 59.6], [6.5, 59.6], [5.5, 60.6], [5.5, m1[1] - 1], [6.5, m1[1]], m1], 0.5);

    // Qwiic: clock and data straight across from the Pico, and 3.3 V underneath to a via behind its pad.
    d = addTrack(d, "SCL", "top", [pad("J2", 9), pad("J8", 4)], 0.3);
    d = addTrack(d, "SDA", "top", [pad("J2", 10), [39.7, pad("J2", 10)[1]], [39.7 + (pad("J8", 3)[1] - pad("J2", 10)[1]), pad("J8", 3)[1]], pad("J8", 3)], 0.3);
    const v3: P2 = [44.9, pad("J8", 2)[1]];
    d = addTrack(d, "3V3", "top", [pad("J8", 2), v3], 0.3);
    d = addVia(d, "3V3", v3[0], v3[1]);
    d = addTrack(d, "3V3", "bottom", [pad("J2", 5), [v3[0], pad("J2", 5)[1]], v3], 0.3);
    // Ground is a pour on both sides, which joins every ground pad without a track.
    d = addPour(d, "GND", "top", wholeBoard(d.board!), true);
    d = addPour(d, "GND", "bottom", wholeBoard(d.board!), true);
    for (const [x, y] of SAMPLE_BOARD.holes) d = addHole(d, x, y, SAMPLE_BOARD.hole);
    d = addText(d, 24, 2, "Pico servo board", "silk-top", 1.6);
    return d;
  });
}
