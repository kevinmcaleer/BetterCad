import { GRID, headerFootprint } from "../basics";
import type { ComponentDef, FootprintDef, PinType, SymbolDef } from "../model";

/** A breakout board that plugs in on one row of pins: what its pins are called and how big the board is. */
export interface Breakout {
  name: string;
  description: string;
  value: string;
  prefix?: string;
  pins: { name: string; type?: PinType }[];
  /** The board's size, mm, and where pin 1 sits from its top left corner. The outline is a guide, not a datasheet. */
  board: { w: number; h: number; pin1: [number, number]; across?: boolean };
  height: number;
  keywords: string[];
}

/** A symbol for a module: a box with its pins down the left, named. */
export function boxSymbol(name: string, pins: Breakout["pins"]): SymbolDef {
  const top = ((pins.length - 1) / 2) * GRID;
  const wide = Math.max(4, Math.ceil(Math.max(...pins.map((p) => p.name.length)) * 0.55) + 2) * GRID;
  return {
    name,
    units: 1,
    shapes: [{ kind: "rect", x1: 0, y1: -top - GRID, x2: wide, y2: top + GRID, fill: true }],
    pins: pins.map((p, i) => ({
      number: String(i + 1),
      name: p.name,
      type: p.type ?? "bidirectional",
      x: -GRID,
      y: Math.round((top - i * GRID) * 1e4) / 1e4,
      length: GRID,
      dir: 0 as const,
    })),
    refAt: [0, top + GRID * 1.6],
    valueAt: [0, -top - GRID * 1.8],
  };
}

/** A module on a single row of 2.54 mm pins, with the board's outline round it. */
export function breakout(b: Breakout): ComponentDef {
  const base = headerFootprint(b.pins.length);
  // The header runs down from pin 1; `across` lays it along the board's top edge instead.
  const pads = b.board.across ? base.pads.map((p) => ({ ...p, x: -p.y, y: 0 })) : base.pads;
  const x1 = -b.board.pin1[0];
  const y2 = b.board.pin1[1];
  const footprint: FootprintDef = {
    name: `${b.name} (1×${b.pins.length} pins)`,
    pads,
    shapes: [
      { kind: "rect", layer: "fab", x1, y1: y2 - b.board.h, x2: x1 + b.board.w, y2, width: 0.1, fill: false },
      { kind: "rect", layer: "silk", x1, y1: y2 - b.board.h, x2: x1 + b.board.w, y2, width: 0.12, fill: false },
      { kind: "rect", layer: "courtyard", x1: x1 - 0.25, y1: y2 - b.board.h - 0.25, x2: x1 + b.board.w + 0.25, y2: y2 + 0.25, width: 0.05, fill: false },
    ],
    refAt: [x1, y2 + 1],
  };
  return {
    name: b.name,
    description: b.description,
    prefix: b.prefix ?? "U",
    value: b.value,
    symbol: boxSymbol(b.name, b.pins),
    packages: [
      {
        footprint,
        model: { source: { kind: "box", size: [b.board.w, b.board.h, b.height] }, offset: [x1 + b.board.w / 2, y2 - b.board.h / 2, 0] },
      },
    ],
    keywords: b.keywords,
  };
}

const power = { type: "power_in" as const };
const out = { type: "output" as const };
const inp = { type: "input" as const };

/** Modules people solder on by a row of pins, which the KiCad libraries do not carry. Sizes are the usual boards'. */
export const BREAKOUTS: Record<string, Breakout> = {
  "hc-sr04": {
    name: "HC-SR04 ultrasonic sensor",
    description: "Ultrasonic distance sensor module, 4 pins. The outline is a guide: check your module.",
    value: "HC-SR04",
    pins: [
      { name: "VCC", ...power },
      { name: "Trig", ...inp },
      { name: "Echo", ...out },
      { name: "GND", ...power },
    ],
    board: { w: 45, h: 20, pin1: [18.7, 18.5], across: true },
    height: 15,
    keywords: ["ultrasonic", "distance", "range", "sonar", "sensor", "module"],
  },
  "ssd1306-i2c": {
    name: "SSD1306 OLED display, 0.96 in, I2C",
    description: "128 × 64 OLED module, 4 pins, I2C. The outline is a guide: pin order differs between makers.",
    value: "SSD1306",
    prefix: "DS",
    pins: [{ name: "GND", ...power }, { name: "VCC", ...power }, { name: "SCL", ...inp }, { name: "SDA" }],
    board: { w: 27.3, h: 27.8, pin1: [9.84, 1.5], across: true },
    height: 4,
    keywords: ["oled", "display", "screen", "i2c", "module"],
  },
  "gy-521": {
    name: "MPU-6050 module (GY-521)",
    description: "Accelerometer and gyro module, 8 pins, I2C.",
    value: "GY-521",
    pins: [
      { name: "VCC", ...power },
      { name: "GND", ...power },
      { name: "SCL", ...inp },
      { name: "SDA" },
      { name: "XDA" },
      { name: "XCL", ...out },
      { name: "AD0", ...inp },
      { name: "INT", ...out },
    ],
    board: { w: 15.6, h: 20.5, pin1: [1.3, 1.36] },
    height: 3,
    keywords: ["imu", "accelerometer", "gyro", "mpu6050", "i2c", "sensor", "module"],
  },
  vl53l0x: {
    name: "VL53L0X distance sensor module",
    description: "Time-of-flight distance sensor module, 6 pins, I2C. The outline is a guide: check your module.",
    value: "VL53L0X",
    pins: [
      { name: "VIN", ...power },
      { name: "GND", ...power },
      { name: "SCL", ...inp },
      { name: "SDA" },
      { name: "GPIO1", ...out },
      { name: "XSHUT", ...inp },
    ],
    board: { w: 13, h: 18, pin1: [1.27, 2.65] },
    height: 3,
    keywords: ["tof", "distance", "range", "laser", "i2c", "sensor", "module"],
  },
};
