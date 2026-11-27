/**
 * The "Robot board from blocks" sample (#776): a Raspberry Pi Pico with the blocks a small robot needs, placed from
 * the Blocks shelf and joined with Connect to… and Join I2C, the way a beginner would. USB-C power charges a LiPo
 * cell through the charger and the protection block; the 5 V boost runs the Pico, the servos and the motor driver;
 * the 3.3 V regulator feeds the Qwiic socket and keeps the motor driver awake. It passes the rules check and is
 * pushed to a board, so it shows the whole path once.
 */
import { buildBlock, placeBlock } from "./blocks";
import { joinI2c, joinPoint } from "./connect";
import { addLabel, addNoConnect, placePart } from "./edit";
import { STARTER_BLOCKS } from "./library/blocks";
import { inflate, type LibraryPack } from "./library/pack";
import starter from "../library/starter.json";
import { emptyDesign, withFixedIds, type ElectronicsDesign, type Id, type P2 } from "./model";
import { placedPins } from "./nets";
import { pushToBoard } from "./sync";

const pack = starter as unknown as LibraryPack;
const lookup = (id: string) => {
  const p = pack.parts.find((x) => x.id === id);
  return p && inflate(pack, p);
};

/** Where each block goes on the sheet, mm: power down the left, the Pico in the middle, what it drives on the right. */
const LAYOUT: [id: string, at: P2][] = [
  ["usb-c-power", [-300, 120]],
  ["lipo-charger", [-300, 20]],
  ["lipo-protect", [-300, -90]],
  ["boost-5v", [-180, 120]],
  ["reg-3v3-linear", [-180, 20]],
  ["qwiic", [-180, -90]],
  ["drv8833", [140, 120]],
  ["servo-headers", [140, -40]],
];

export function robotBlocksBoard(): ElectronicsDesign {
  return withFixedIds(() => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    const pico = placePart(d, sheet, lookup("pico")!, { x: 0, y: 0 });
    d = pico.design;
    const groups: Record<string, Id> = {};
    for (const [id, at] of LAYOUT) {
      const placed = placeBlock(
        d,
        sheet,
        buildBlock(
          STARTER_BLOCKS.find((b) => b.id === id)!,
          lookup,
        ),
        at,
      );
      d = placed.design;
      groups[id] = placed.group!;
    }
    const point = (block: string, name: string): P2 => {
      const s = d.sheets[0]!;
      const g = s.groups!.find((x) => x.id === groups[block])!;
      const l = s.labels.find((x) => x.id === g.block!.points.find((p) => p.name === name)!.label)!;
      return [l.x, l.y];
    };
    const pin = (part: Id, number: string): P2 => placedPins(d).find((p) => p.part === part && p.pin === number)!.at;
    const join = (a: P2, b: P2) => (d = joinPoint(d, sheet, a, b));

    // Power: USB-C into the charger, the charger and the cell into the protection, the cell out to the boost.
    join(point("usb-c-power", "5V"), point("lipo-charger", "5V"));
    join(point("lipo-charger", "BAT+"), point("lipo-protect", "B+"));
    join(point("lipo-protect", "B+"), point("boost-5v", "VIN"));
    const cell = placePart(d, sheet, lookup("jst-ph-2")!, { x: -420, y: -90 });
    d = cell.design;
    join(pin(cell.part.id, "1"), point("lipo-protect", "B+"));
    join(pin(cell.part.id, "2"), point("lipo-protect", "B-"));
    // 5 V to the 3.3 V regulator, the Pico's VSYS, the servos and the motors.
    join(point("boost-5v", "5V"), point("reg-3v3-linear", "VIN"));
    join(point("boost-5v", "5V"), pin(pico.part.id, "39"));
    join(point("boost-5v", "5V"), point("servo-headers", "V+"));
    join(point("boost-5v", "5V"), point("drv8833", "VM"));
    // 3.3 V to the Qwiic socket, and to the motor driver's SLEEP to keep it running.
    join(point("reg-3v3-linear", "3V3"), point("qwiic", "3V3"));
    join(point("reg-3v3-linear", "3V3"), point("drv8833", "SLEEP"));
    // The Qwiic socket on the Pico's first I2C pair.
    d = joinI2c(d, sheet, groups.qwiic!).design;
    // Four Pico pins drive the two motors, two more the first servos.
    for (const [name, gp] of [
      ["AIN1", "4"],
      ["AIN2", "5"],
      ["BIN1", "6"],
      ["BIN2", "7"],
    ] as const)
      join(point("drv8833", name), pin(pico.part.id, gp));
    join(point("servo-headers", "S1"), pin(pico.part.id, "9"));
    join(point("servo-headers", "S2"), pin(pico.part.id, "10"));
    // Two motors on the driver's outputs.
    for (const [i, side] of (["A", "B"] as const).entries()) {
      const motor = placePart(d, sheet, lookup("motor-dc")!, { x: 280, y: 160 - i * 60 });
      d = motor.design;
      join(point("drv8833", `${side}+`), pin(motor.part.id, "1"));
      join(point("drv8833", `${side}-`), pin(motor.part.id, "2"));
    }

    // The Pico's grounds join the blocks' ground by name; the pins it does not use are marked Not connected.
    const used = new Set(
      placedPins(d)
        .filter((p) => p.part === pico.part.id && p.name === "GND")
        .map((p) => p.pin),
    );
    for (const n of used) {
      const at = pin(pico.part.id, n);
      d = addLabel(d, sheet, "GND", at[0], at[1]);
    }
    const joined = (at: P2) => d.sheets[0]!.wires.some((w) => (w.a[0] === at[0] && w.a[1] === at[1]) || (w.b[0] === at[0] && w.b[1] === at[1]));
    for (const p of placedPins(d).filter((x) => x.part === pico.part.id && !x.hidden && x.name !== "GND"))
      if (!joined(p.at)) d = addNoConnect(d, sheet, p.at[0], p.at[1]);
    return pushToBoard(slim(d)).design;
  });
}

/**
 * Keeps only the packages the design's parts use, so the sample file carries one footprint per part rather than every
 * one the library offers. Each part's package number follows.
 */
function slim(d: ElectronicsDesign): ElectronicsDesign {
  const used = new Map<string, number[]>();
  for (const p of d.parts)
    used.set(
      p.def,
      [...new Set([...(used.get(p.def) ?? []), p.pkg ?? 0])].sort((a, b) => a - b),
    );
  const defs = Object.fromEntries(
    Object.entries(d.defs).map(([k, def]) => {
      const keep = used.get(k) ?? [];
      return [k, { ...def, packages: keep.flatMap((i) => (def.packages[i] ? [def.packages[i]!] : [])) }];
    }),
  );
  return { ...d, defs, parts: d.parts.map((p) => ({ ...p, pkg: Math.max(0, (used.get(p.def) ?? []).indexOf(p.pkg ?? 0)) })) };
}
