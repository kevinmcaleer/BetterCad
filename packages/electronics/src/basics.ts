import type { ComponentDef, FootprintDef, Pad, SymbolDef, SymbolPin } from "./model";

/**
 * A handful of parts drawn here, not taken from a library: two-pin passives, pin headers and the power symbols. They
 * are what a new design has before any library is fetched, and what the tests use. Ours, MIT.
 */
export const GRID = 2.54;
const SOURCE = { library: "BetterCad basics", licence: "MIT" };

/** A chip part's footprint: two pads. Sizes follow the usual IPC nominal lands. */
function chip(name: string, padW: number, padH: number, pitch: number, bodyW: number, bodyH: number): FootprintDef {
  const pad = (number: string, x: number): Pad => ({ number, kind: "smd", shape: "roundrect", round: 0.25, x, y: 0, w: padW, h: padH });
  const cx = pitch / 2 + padW / 2 + 0.25;
  const cy = Math.max(padH, bodyH) / 2 + 0.25;
  return {
    name,
    pads: [pad("1", -pitch / 2), pad("2", pitch / 2)],
    shapes: [
      { kind: "rect", layer: "fab", x1: -bodyW / 2, y1: -bodyH / 2, x2: bodyW / 2, y2: bodyH / 2, width: 0.1 },
      { kind: "rect", layer: "courtyard", x1: -cx, y1: -cy, x2: cx, y2: cy, width: 0.05 },
      {
        kind: "line",
        layer: "silk",
        pts: [
          [-pitch / 2 + padW / 2 + 0.2, cy - 0.1],
          [pitch / 2 - padW / 2 - 0.2, cy - 0.1],
        ],
        width: 0.12,
      },
      {
        kind: "line",
        layer: "silk",
        pts: [
          [-pitch / 2 + padW / 2 + 0.2, -cy + 0.1],
          [pitch / 2 - padW / 2 - 0.2, -cy + 0.1],
        ],
        width: 0.12,
      },
    ],
    refAt: [0, cy + 0.8],
  };
}

export const CHIP_0603 = (): FootprintDef => chip("0603 (1608 metric)", 0.8, 0.95, 1.65, 1.6, 0.8);
export const CHIP_0805 = (): FootprintDef => chip("0805 (2012 metric)", 1.0, 1.45, 1.9, 2.0, 1.25);
export const CHIP_1206 = (): FootprintDef => chip("1206 (3216 metric)", 1.15, 1.8, 2.9, 3.2, 1.6);

const twoPins = (type: SymbolPin["type"] = "passive"): SymbolPin[] => [
  { number: "1", name: "1", type, x: 0, y: GRID * 1.5, length: GRID / 2, dir: 270 },
  { number: "2", name: "2", type, x: 0, y: -GRID * 1.5, length: GRID / 2, dir: 90 },
];

const packages = (h: number) =>
  [CHIP_0805(), CHIP_0603(), CHIP_1206()].map((footprint, i) => ({
    footprint,
    model: {
      source: {
        kind: "box" as const,
        size: [
          [2, 1.25, h],
          [1.6, 0.8, h],
          [3.2, 1.6, h],
        ][i] as [number, number, number],
      },
    },
  }));

export function resistor(): ComponentDef {
  const symbol: SymbolDef = {
    name: "Resistor",
    units: 1,
    shapes: [{ kind: "rect", x1: -1.016, y1: -GRID, x2: 1.016, y2: GRID }],
    pins: twoPins(),
    refAt: [GRID, GRID / 2],
    valueAt: [GRID, -GRID / 2],
  };
  return {
    name: "Resistor",
    description: "Resistor, surface mount",
    prefix: "R",
    value: "10 kΩ",
    symbol,
    packages: packages(0.5),
    keywords: ["resistor", "r"],
    source: SOURCE,
  };
}

export function capacitor(): ComponentDef {
  const symbol: SymbolDef = {
    name: "Capacitor",
    units: 1,
    shapes: [
      {
        kind: "line",
        pts: [
          [-2.032, 0.508],
          [2.032, 0.508],
        ],
        width: 0.4,
      },
      {
        kind: "line",
        pts: [
          [-2.032, -0.508],
          [2.032, -0.508],
        ],
        width: 0.4,
      },
      {
        kind: "line",
        pts: [
          [0, GRID],
          [0, 0.508],
        ],
      },
      {
        kind: "line",
        pts: [
          [0, -GRID],
          [0, -0.508],
        ],
      },
    ],
    pins: twoPins(),
    refAt: [GRID, GRID / 2],
    valueAt: [GRID, -GRID / 2],
  };
  return {
    name: "Capacitor",
    description: "Ceramic capacitor, surface mount",
    prefix: "C",
    value: "100 nF",
    symbol,
    packages: packages(0.8),
    keywords: ["capacitor", "cap", "c"],
    source: SOURCE,
  };
}

export function led(): ComponentDef {
  const symbol: SymbolDef = {
    name: "LED",
    units: 1,
    shapes: [
      {
        kind: "line",
        pts: [
          [-1.27, 1.27],
          [1.27, 1.27],
          [0, -1.27],
          [-1.27, 1.27],
        ],
      },
      {
        kind: "line",
        pts: [
          [-1.27, -1.27],
          [1.27, -1.27],
        ],
      },
      {
        kind: "line",
        pts: [
          [0, GRID],
          [0, 1.27],
        ],
      },
      {
        kind: "line",
        pts: [
          [0, -GRID],
          [0, -1.27],
        ],
      },
      {
        kind: "line",
        pts: [
          [1.9, 0.6],
          [3.1, -0.6],
          [2.5, -0.5],
        ],
      },
      {
        kind: "line",
        pts: [
          [1.9, -0.6],
          [3.1, -1.8],
          [2.5, -1.7],
        ],
      },
    ],
    pins: [
      { number: "2", name: "A", type: "passive", x: 0, y: GRID * 1.5, length: GRID / 2, dir: 270 },
      { number: "1", name: "K", type: "passive", x: 0, y: -GRID * 1.5, length: GRID / 2, dir: 90 },
    ],
    refAt: [GRID * 1.5, GRID / 2],
    valueAt: [GRID * 1.5, -GRID / 2],
  };
  return {
    name: "LED",
    description: "LED, surface mount",
    prefix: "D",
    value: "Red",
    symbol,
    packages: packages(0.7),
    keywords: ["led", "light", "diode"],
    source: SOURCE,
  };
}

/** A pin header footprint: `rows` by `pins` holes at `pitch`, pin 1 square. Pin 1 is at the origin. */
export function headerFootprint(pins: number, rows = 1, pitch = GRID): FootprintDef {
  const pads: Pad[] = [];
  for (let i = 0; i < pins; i += 1)
    for (let r = 0; r < rows; r += 1) {
      const n = i * rows + r + 1;
      pads.push({ number: String(n), kind: "thru", shape: n === 1 ? "rect" : "circle", x: r * pitch, y: -i * pitch, w: 1.7, h: 1.7, drill: 1.0 });
    }
  const x1 = -pitch / 2;
  const x2 = (rows - 1) * pitch + pitch / 2;
  const y1 = -(pins - 1) * pitch - pitch / 2;
  const y2 = pitch / 2;
  return {
    name: `Pin header ${rows}×${pins}, ${pitch} mm`,
    pads,
    shapes: [
      { kind: "rect", layer: "fab", x1, y1, x2, y2, width: 0.1 },
      { kind: "rect", layer: "silk", x1: x1 - 0.06, y1: y1 - 0.06, x2: x2 + 0.06, y2: y2 + 0.06, width: 0.12 },
      { kind: "rect", layer: "courtyard", x1: x1 - 0.5, y1: y1 - 0.5, x2: x2 + 0.5, y2: y2 + 0.5, width: 0.05 },
    ],
    refAt: [x1, y2 + 1],
  };
}

/** A single-row pin header with `pins` pins, drawn as a box with pins down its left side. */
export function header(pins: number): ComponentDef {
  const top = ((pins - 1) / 2) * GRID;
  const symbol: SymbolDef = {
    name: `Header 1×${pins}`,
    units: 1,
    shapes: [{ kind: "rect", x1: -GRID / 2, y1: -top - GRID / 2, x2: GRID * 1.5, y2: top + GRID / 2, fill: true }],
    pins: Array.from({ length: pins }, (_, i) => ({
      number: String(i + 1),
      name: `Pin ${i + 1}`,
      type: "passive" as const,
      x: -GRID * 2,
      y: top - i * GRID,
      length: GRID * 1.5,
      dir: 0 as const,
    })),
    refAt: [-GRID / 2, top + GRID],
    valueAt: [-GRID / 2, -top - GRID * 1.2],
  };
  return {
    name: `Pin header 1×${pins}`,
    description: `Pin header, ${pins} ${pins === 1 ? "pin" : "pins"}, 2.54 mm`,
    prefix: "J",
    value: `1×${pins}`,
    symbol,
    packages: [
      {
        footprint: headerFootprint(pins),
        model: { source: { kind: "header", rows: 1, pins, pitch: GRID, height: 8.5 }, offset: [0, (-(pins - 1) * GRID) / 2, 0] },
      },
    ],
    keywords: ["header", "connector", "pins"],
    source: SOURCE,
  };
}

/** A power symbol. Its value is the net's name. Ground points down; supplies point up. */
export function power(name: string): ComponentDef {
  const ground = /^(gnd|agnd|dgnd|0v|vss)/i.test(name);
  const symbol: SymbolDef = {
    name,
    units: 1,
    power: true,
    shapes: ground
      ? [
          {
            kind: "line",
            pts: [
              [0, 0],
              [0, -1.27],
            ],
          },
          {
            kind: "line",
            pts: [
              [-1.27, -1.27],
              [1.27, -1.27],
            ],
          },
          {
            kind: "line",
            pts: [
              [-0.762, -1.778],
              [0.762, -1.778],
            ],
          },
          {
            kind: "line",
            pts: [
              [-0.254, -2.286],
              [0.254, -2.286],
            ],
          },
        ]
      : [
          {
            kind: "line",
            pts: [
              [0, 0],
              [0, 1.27],
            ],
          },
          {
            kind: "line",
            pts: [
              [-1.27, 1.27],
              [1.27, 1.27],
            ],
          },
        ],
    pins: [{ number: "1", name, type: "power_in", x: 0, y: 0, length: 0, dir: ground ? 270 : 90 }],
    valueAt: ground ? [0, -3.8] : [0, 2.2],
  };
  return { name, description: `Power: ${name}`, prefix: "#PWR", value: name, symbol, packages: [], keywords: ["power", name.toLowerCase()], source: SOURCE };
}

export const BASICS: Record<string, () => ComponentDef> = {
  resistor,
  capacitor,
  led,
  "header-2": () => header(2),
  "header-3": () => header(3),
  "header-4": () => header(4),
  "header-6": () => header(6),
  "header-8": () => header(8),
  gnd: () => power("GND"),
  "3v3": () => power("3V3"),
  "5v": () => power("5V"),
  vbus: () => power("VBUS"),
  vin: () => power("VIN"),
};
