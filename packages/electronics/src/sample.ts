import { GRID, capacitor, header, led, power as powerSymbol, resistor } from "./basics";
import { boardPads } from "./board";
import { addLabel, addNoConnect, addNote, addWires, changePart, placePart } from "./edit";
import { pinDirOnSheet, placeOnSheet } from "./geom";
import { emptyDesign, withFixedIds, type ComponentDef, type ElectronicsDesign, type Id, type P2, type Rot, type Supplier } from "./model";
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
/** From a pin's wire end towards its part, for each way a pin can point on the sheet. */
const DIRS: Record<number, P2> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
const LIBRARY = parts as unknown as Record<"l293d" | "jst-sh-4" | "slide-switch", ComponentDef>;

export function sampleBoard(): ElectronicsDesign {
  return withFixedIds(() => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    const ids: Record<string, Id> = {};
    let power = 0;
    /**
     * Where a point given in grid steps goes on the sheet. The groups are laid out on a loose grid and then drawn in
     * closer, so the whole sheet reads at Fit on a laptop's screen (#729): the second socket, then the servos and power
     * in, then the motor driver with the power light over it.
     */
    const g = (x: number, y: number): P2 => [(x + (x < 10 ? 0 : x < 30 ? -6 : x < 49 ? -12 : y >= 12 ? -10 : -16)) * GRID, y * GRID];
    /** Places a part, in grid steps. Power symbols can be placed as often as a group needs one. */
    const put = (name: string, def: ComponentDef, x: number, y: number, o: { value?: string; mirror?: boolean; rot?: Rot; buy?: Supplier } = {}) => {
      const [px, py] = g(x, y);
      const made = placePart(d, sheet, def, { x: px, y: py, ...(o.rot ? { rot: o.rot } : {}), ...(o.mirror ? { mirror: true } : {}) });
      d = made.design;
      if (o.value || o.buy) d = changePart(d, made.part.id, { ...(o.value ? { value: o.value } : {}), ...(o.buy ? { supplier: o.buy } : {}) });
      ids[name.startsWith("#") ? `${name}${(power += 1)}` : name] = made.part.id;
    };
    // Every fitted part has its JLCPCB (LCSC) number, read from jlcpcb.com's part pages on 2026-11-26 (#729).
    const buy = (lcsc: string, mpn: string, manufacturer: string): Supplier => ({ lcsc, mpn, manufacturer });
    const socket = buy("C2905423", "KH-2.54FH-1X20P-H8.5", "Shenzhen Kinghelm Elec");
    const pins3 = buy("C2937625", "PZ254V-11-03P", "XFCN");
    const pins2 = buy("C492401", "PZ254V-11-02P", "XFCN");
    // The schematic reads in groups (#729): the Pico's sockets on the left, then servos and the sensor socket, then
    // the motor driver with its motors' plugs; power in and the power light along the top. Short runs are drawn as
    // wires, and the long ones between groups are joined by name.
    put("J1", header(20, true), 0, 0, { value: "Pico 1 to 20", mirror: true, buy: socket });
    put("J2", header(20, true), 18, 0, { value: "Pico 40 to 21", mirror: true, buy: socket });
    put("J3", header(3), 36, 8, { value: "Servo 1", buy: pins3 });
    put("J4", header(3), 36, 2, { value: "Servo 2", buy: pins3 });
    put("J5", header(2), 36, 20, { value: "5 V in", mirror: true, buy: pins2 });
    put("R1", resistor(), 56, 21, { value: "1 kΩ", buy: buy("C17513", "0805W8F1001T5E", "UNI-ROYAL(Uniroyal Elec)") });
    put("D1", led(), 56, 16, { rot: 180, buy: buy("C84256", "NCD0805R1", "Foshan NationStar Optoelectronics") });
    put("C1", capacitor(), 52, 20, { value: "10 µF", buy: buy("C15850", "CL21A106KAYNNNE", "Samsung Electro-Mechanics") });
    put("U1", LIBRARY.l293d, 56, -2, { buy: buy("C701118", "L293DNE", "Texas Instruments") });
    // The motors' plugs are flipped top to bottom so each driver output runs straight across to its pin.
    put("J6", header(2), 69, 3, { value: "Motor A", mirror: true, rot: 180, buy: pins2 });
    put("J7", header(2), 69, -3, { value: "Motor B", mirror: true, rot: 180, buy: pins2 });
    put("J8", LIBRARY["jst-sh-4"], 36, -6, { buy: buy("C160404", "SM04B-SRSS-TB(LF)(SN)", "JST") });
    put("SW1", LIBRARY["slide-switch"], 44, 20, { value: "Power", buy: buy("C221841", "PCM12SMTR", "C&K") });
    // The rails are named by power symbols, which is what tells the rules check the motor driver has a supply.
    const rail = (net: "5V" | "GND", x: number, y: number) => put(`#${net}`, powerSymbol(net), x, y);

    /** Where a pin's wire end is on the sheet, and the way out from it, away from its part. */
    const end = (name: string, n: number): { at: P2; out: P2 } => {
      const part = d.parts.find((p) => p.id === ids[name])!;
      const sym = d.sheets[0]!.symbols.find((s) => s.part === part.id)!;
      const p = d.defs[part.def]!.symbol.pins.find((x) => x.number === String(n))!;
      const into = DIRS[pinDirOnSheet(p, sym)]!;
      return { at: placeOnSheet([p.x, p.y], sym), out: [-into[0], -into[1]] };
    };
    /** A wire through points given in grid steps. */
    const wire = (...pts: P2[]) =>
      (d = addWires(
        d,
        sheet,
        pts.map(([x, y]) => g(x, y)),
      ));
    const used = new Set<string>();
    /** Joins a pin to a net by name: a short stub out from the pin, with the label over it. */
    const tag = (net: string, name: string, n: number) => {
      const { at, out } = end(name, n);
      const far: P2 = [at[0] + out[0] * 3 * GRID, at[1] + out[1] * 3 * GRID];
      d = addWires(d, sheet, [at, far]);
      // The label sits on the stub's far end, so the stub ends on it and not in mid air.
      d = addLabel(d, sheet, net, far[0], far[1]);
      used.add(`${name}.${n}`);
    };
    const wired = (...pins: [string, number][]) => pins.forEach(([name, n]) => used.add(`${name}.${n}`));

    // The Pico's sockets: each pin it uses is named, and the rest are marked as left open.
    tag("SERVO1", "J1", 1);
    tag("SERVO2", "J1", 2);
    tag("GND", "J1", 3);
    // The motor driver's inputs, on GP2 to GP5.
    tag("MOTOR_B2", "J1", 4);
    tag("MOTOR_A1", "J1", 5);
    tag("MOTOR_A2", "J1", 6);
    tag("MOTOR_B1", "J1", 7);
    tag("5V", "J2", 2);
    tag("GND", "J2", 3);
    // Qwiic: 3.3 V, data and clock, on the Pico's second I2C bus.
    tag("3V3", "J2", 5);
    tag("SCL", "J2", 9);
    tag("SDA", "J2", 10);

    // Servos and the sensor socket: named, as their wires come from the Pico across the sheet.
    for (const [j, signal] of [
      ["J3", "SERVO1"],
      ["J4", "SERVO2"],
    ] as const) {
      tag(signal, j, 1);
      tag("5V", j, 2);
      tag("GND", j, 3);
    }
    tag("GND", "J8", 1);
    tag("3V3", "J8", 2);
    tag("SDA", "J8", 3);
    tag("SCL", "J8", 4);

    // The motor driver: its inputs named, its supply and ground pins wired to the rails, its outputs wired to the plugs.
    tag("MOTOR_A1", "U1", 2);
    tag("MOTOR_A2", "U1", 7);
    tag("MOTOR_B1", "U1", 10);
    tag("MOTOR_B2", "U1", 15);
    tag("5V", "U1", 1);
    tag("5V", "U1", 9);
    wire([55, 8], [55, 10]);
    wire([57, 8], [57, 9], [55, 9]);
    rail("5V", 55, 10);
    for (const x of [54, 55, 57, 58]) wire([x, -10], [x, -11]);
    wire([54, -11], [58, -11]);
    wire([56, -11], [56, -12]);
    rail("GND", 56, -12);
    wire([61, 4], [67, 4], [67, 3.5]);
    wire([61, 2], [67, 2], [67, 2.5]);
    wire([61, -2], [67, -2], [67, -2.5]);
    wire([61, -4], [67, -4], [67, -3.5]);
    wired(
      ["U1", 16],
      ["U1", 8],
      ["U1", 4],
      ["U1", 5],
      ["U1", 12],
      ["U1", 13],
      ["U1", 3],
      ["U1", 6],
      ["U1", 11],
      ["U1", 14],
      ["J6", 1],
      ["J6", 2],
      ["J7", 1],
      ["J7", 2],
    );
    // Names for the driver's outputs, so the board keeps calling them what it always has.
    d = addLabel(d, sheet, "MOTOR_A_OUT1", ...g(62, 4));
    d = addLabel(d, sheet, "MOTOR_A_OUT2", ...g(62, 2));
    d = addLabel(d, sheet, "MOTOR_B_OUT1", ...g(62, -2));
    d = addLabel(d, sheet, "MOTOR_B_OUT2", ...g(62, -4));

    // Power in: the plug, through the switch, to the 5 V rail; and the power light, with its capacitor beside it.
    wire([38, 20.5], [42, 20.5], [42, 20]);
    d = addLabel(d, sheet, "VIN", ...g(38, 20.5));
    wire([38, 19.5], [39, 19.5], [39, 17]);
    rail("GND", 39, 17);
    wire([46, 19], [48, 19]);
    rail("5V", 48, 19);
    wire([52, 24], [52, 21.5]);
    wire([52, 24], [56, 24], [56, 22.5]);
    rail("5V", 52, 24);
    wire([56, 19.5], [56, 17.5]);
    d = addLabel(d, sheet, "LED", ...g(56, 18.5));
    wire([52, 18.5], [52, 13]);
    wire([52, 13], [56, 13], [56, 14.5]);
    rail("GND", 52, 13);
    wired(["J5", 1], ["J5", 2], ["SW1", 2], ["SW1", 3], ["R1", 1], ["R1", 2], ["D1", 1], ["D1", 2], ["C1", 1], ["C1", 2]);

    // What each group is, written on the sheet (#733).
    for (const [text, x, y] of [
      ["Raspberry Pi Pico", -1, 12],
      ["Servos and sensor", 30, 12],
      ["Motor driver", 44.5, 11],
      ["Power in", 34, 25],
      ["Power light", 50, 27],
    ] as const)
      d = addNote(d, sheet, { kind: "text", x: g(x, y)[0], y: y * GRID, text, size: 2.5, align: "left" }).design;

    // The Pico's other pins are left free on purpose, and so is the switch's other throw.
    for (const [name, count] of [
      ["J1", 20],
      ["J2", 20],
      ["SW1", 3],
    ] as const)
      for (let n = 1; n <= count; n += 1)
        if (!used.has(`${name}.${n}`)) {
          const { at } = end(name, n);
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
