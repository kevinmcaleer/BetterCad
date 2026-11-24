import { GRID } from "../basics";
import { emptyBox, grow, type Box } from "../geom";
import type { FootprintDef, Pad, PinType, Shape, SymbolDef, SymbolPin } from "../model";

const r4 = (n: number) => Math.round(n * 1e4) / 1e4 || 0;

// ---------------------------------------------------------------- symbols from a pin table

export type PinSide = "left" | "right" | "top" | "bottom";
export interface TablePin {
  number: string;
  name: string;
  type: PinType;
  side?: PinSide;
}

/** The words people and datasheets use for what a pin does. Longest first, so "power out" wins over "power". */
const TYPE_WORDS: [RegExp, PinType][] = [
  [/^(power[ _-]?out(put)?|pwr[ _-]?out|supply out)$/i, "power_out"],
  [/^(power([ _-]?in(put)?)?|pwr|supply|p|gnd|ground)$/i, "power_in"],
  [/^(in ?(and|&|\/) ?out|i\/o|io|bidi(r(ectional)?)?|b)$/i, "bidirectional"],
  [/^(in(put)?|i)$/i, "input"],
  [/^(out(put)?|o)$/i, "output"],
  [/^(three[ _-]?state|tri[ _-]?state|tristate|t)$/i, "tristate"],
  [/^(passive|pas)$/i, "passive"],
  [/^(open[ _-]?collector|open[ _-]?drain|oc|od)$/i, "open_collector"],
  [/^(open[ _-]?emitter|open[ _-]?source|oe)$/i, "open_emitter"],
  [/^(n\/?c|no[ _-]?connect|not[ _-]?connected|unused)$/i, "no_connect"],
  [/^(not set|unspecified|-|)$/i, "unspecified"],
];
const SIDE_WORDS: [RegExp, PinSide][] = [
  [/^(left|l)$/i, "left"],
  [/^(right|r)$/i, "right"],
  [/^(top|up|u)$/i, "top"],
  [/^(bottom|down|d)$/i, "bottom"],
];

export interface PinTable {
  pins: TablePin[];
  /** Lines that could not be read, as they were typed, with why. */
  skipped: { line: string; why: string }[];
}

/**
 * Reads a pin list pasted from a spreadsheet or a datasheet (#626): one pin a line, as number, name, then optionally
 * what the pin does and the side it sits on. Columns are split by tabs, commas, semicolons or runs of spaces.
 */
export function parsePinTable(text: string): PinTable {
  const out: PinTable = { pins: [], skipped: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = (/[\t,;]/.test(line) ? line.split(/[\t,;]/) : line.split(/\s{2,}|\s/)).map((c) => c.trim());
    if (cells.length < 2 || !cells[0] || !cells[1]) {
      out.skipped.push({ line, why: "It needs a pin number and a name" });
      continue;
    }
    // A heading row: "Pin  Name  Type".
    if (/^(pin|no\.?|number|#)$/i.test(cells[0]) && /^(name|signal|function|pin)$/i.test(cells[1])) continue;
    let [number, name] = cells as [string, string];
    // "VCC 1" for "1 VCC": the number is the one that is all digits.
    if (!/\d/.test(number) && /^\d+$/.test(name)) [number, name] = [name, number];
    let type: PinType = "unspecified";
    let side: PinSide | undefined;
    // Without tabs or commas, a type of two words ("power in") arrives as two cells: try pairs first.
    const rest = cells.slice(2).filter(Boolean);
    for (let i = 0; i < rest.length; i += 1) {
      const two = i + 1 < rest.length ? `${rest[i]} ${rest[i + 1]}` : "";
      const asType = (w: string) => TYPE_WORDS.find(([re]) => w && re.test(w))?.[1];
      const pair = two ? asType(two) : undefined;
      if (pair) {
        type = pair;
        i += 1;
        continue;
      }
      const s = SIDE_WORDS.find(([re]) => re.test(rest[i]!))?.[1];
      // A lone letter reads as a side only after a type has been given: "I" and "O" are types first.
      if (s && (rest[i]!.length > 1 || type !== "unspecified")) {
        side = s;
        continue;
      }
      const t = asType(rest[i]!);
      if (t) type = t;
      else if (s) side = s;
    }
    out.pins.push({ number, name, type, ...(side ? { side } : {}) });
  }
  return out;
}

/** The pin table as text again, tab separated, for the editor's box and for copying out. */
export function formatPinTable(pins: TablePin[]): string {
  return pins.map((p) => [p.number, p.name, p.type === "unspecified" ? "" : p.type.replace("_", " "), p.side ?? ""].join("\t").replace(/\t+$/, "")).join("\n");
}

/**
 * A boxed symbol from a pin list (#626). Pins with no side are set out the way the package is: the first half down the
 * left, the rest up the right. Everything lands on the 2.54 mm grid.
 */
export function icSymbol(name: string, pins: TablePin[]): SymbolDef {
  const free = pins.filter((p) => !p.side);
  const half = Math.ceil(free.length / 2);
  const on = (side: PinSide) => pins.filter((p) => p.side === side);
  const left = [...on("left"), ...free.slice(0, half)];
  // The rest go up the right, so the numbers run round the box as they do round the package.
  const right = [...on("right"), ...free.slice(half).reverse()];
  const top = on("top");
  const bottom = on("bottom");
  const chars = (list: TablePin[]) => Math.max(0, ...list.map((p) => p.name.length));
  const rows = Math.max(left.length, right.length, 1);
  const cols = Math.max(top.length, bottom.length);
  // Half sizes in grid steps, so every pin end is on the grid.
  const halfW = Math.max(2, Math.ceil(((chars(left) + chars(right)) * 0.6 + 2) / 2), Math.ceil((cols + 1) / 2));
  const halfH = Math.floor(rows / 2) + 1 + (cols ? Math.ceil(Math.max(chars(top), chars(bottom)) * 0.3) : 0);
  const w = halfW * GRID;
  const h = halfH * GRID;
  const ys = (n: number) => Array.from({ length: n }, (_, i) => r4((Math.floor(n / 2) - i) * GRID));
  const xs = (n: number) => ys(n).map((y) => r4(-y));
  const pin = (p: TablePin, x: number, y: number, dir: SymbolPin["dir"]): SymbolPin => ({
    number: p.number,
    name: p.name,
    type: p.type,
    x: r4(x),
    y: r4(y),
    length: GRID,
    dir,
  });
  return {
    name,
    units: 1,
    shapes: [{ kind: "rect", x1: -w, y1: -h, x2: w, y2: h, fill: true }],
    pins: [
      ...left.map((p, i) => pin(p, -w - GRID, ys(left.length)[i]!, 0)),
      ...right.map((p, i) => pin(p, w + GRID, ys(right.length)[i]!, 180)),
      ...top.map((p, i) => pin(p, xs(top.length)[i]!, h + GRID, 270)),
      ...bottom.map((p, i) => pin(p, xs(bottom.length)[i]!, -h - GRID, 90)),
    ],
    refAt: [-w, r4(h + GRID * (top.length ? 1.8 : 0.6))],
    valueAt: [-w, r4(-h - GRID * (bottom.length ? 1.8 : 0.6))],
  };
}

// ---------------------------------------------------------------- footprints from a package's sizes

type FpShape = Shape & { layer: FootprintDef["shapes"][number]["layer"] };

function padBox(pads: Pad[]): Box {
  const b = emptyBox();
  for (const p of pads) {
    const turned = Math.abs(((p.angle ?? 0) % 180) - 90) < 1;
    const w = turned ? p.h : p.w;
    const h = turned ? p.w : p.h;
    grow(grow(b, [p.x - w / 2, p.y - h / 2]), [p.x + w / 2, p.y + h / 2]);
  }
  return b;
}

/** The outlines every footprint needs round its pads and body: fabrication, courtyard, silkscreen and a pin 1 mark. */
function dress(name: string, pads: Pad[], body: Box, opts: { silk?: "ends" | "sides" | "box"; margin?: number } = {}): FootprintDef {
  const all = padBox(pads);
  const m = opts.margin ?? 0.25;
  const c: Box = { x1: Math.min(all.x1, body.x1) - m, y1: Math.min(all.y1, body.y1) - m, x2: Math.max(all.x2, body.x2) + m, y2: Math.max(all.y2, body.y2) + m };
  const shapes: FpShape[] = [
    { kind: "rect", layer: "fab", x1: r4(body.x1), y1: r4(body.y1), x2: r4(body.x2), y2: r4(body.y2), width: 0.1 },
    { kind: "rect", layer: "courtyard", x1: r4(c.x1), y1: r4(c.y1), x2: r4(c.x2), y2: r4(c.y2), width: 0.05 },
  ];
  const s = 0.12;
  const line = (a: [number, number], b: [number, number]): FpShape => ({
    kind: "line",
    layer: "silk",
    pts: [a.map(r4) as [number, number], b.map(r4) as [number, number]],
    width: s,
  });
  const gap = 0.2;
  if (opts.silk === "box") {
    // Through-hole rows: a box round everything, clear of the pads.
    const o = { x1: all.x1 - gap, y1: all.y1 - gap, x2: all.x2 + gap, y2: all.y2 + gap };
    shapes.push({ kind: "rect", layer: "silk", x1: r4(o.x1), y1: r4(o.y1), x2: r4(o.x2), y2: r4(o.y2), width: s });
  } else if (opts.silk === "sides") {
    // Two-pad parts: a line each side, between the pads.
    const inner = pads.length === 2 ? Math.abs(pads[0]!.x - pads[1]!.x) / 2 - pads[0]!.w / 2 - gap : 0;
    if (inner > 0.15) {
      const y = Math.max(body.y2, all.y2) + 0.1;
      shapes.push(line([-inner, y], [inner, y]), line([-inner, -y], [inner, -y]));
    }
  } else {
    // Rows of pads left and right, or all round: lines along the ends the pads leave free.
    const y = body.y2 + 0.11;
    const freeTop = !pads.some((p) => p.y + p.h / 2 > body.y2 - 0.05 && Math.abs(p.x) < body.x2 - 0.05);
    if (freeTop) shapes.push(line([body.x1, y], [body.x2, y]), line([body.x1, -y], [body.x2, -y]));
    else {
      // Pads on all four sides: short corner marks.
      const k = 0.4;
      for (const [sx, sy] of [
        [1, 1],
        [-1, -1],
        [1, -1],
      ] as const)
        shapes.push(
          line([sx * (body.x2 + 0.11), sy * (body.y2 + 0.11 - k)], [sx * (body.x2 + 0.11), sy * (body.y2 + 0.11)]),
          line([sx * (body.x2 + 0.11 - k), sy * (body.y2 + 0.11)], [sx * (body.x2 + 0.11), sy * (body.y2 + 0.11)]),
        );
    }
  }
  // Pin 1: a dot to the left of pad 1, which every family here keeps on the left edge.
  const one = pads[0];
  if (one && pads.length > 2)
    shapes.push({ kind: "circle", layer: "silk", cx: r4(Math.min(all.x1, body.x1) - 0.55), cy: one.y, r: 0.15, width: s, fill: "solid" });
  return { name, pads, shapes, refAt: [0, r4(c.y2 + 0.8)] };
}

const smd = (number: string, x: number, y: number, w: number, h: number, round = 0.25): Pad => ({
  number,
  kind: "smd",
  shape: "roundrect",
  round,
  x: r4(x),
  y: r4(y),
  w,
  h,
});

export interface ChipSizes {
  /** Body length (along the pads) and width. */
  bodyL: number;
  bodyW: number;
  padW: number;
  padH: number;
  /** Centre of one pad to the centre of the other. */
  pitch: number;
}
/** A two-pad chip part: resistor, capacitor, LED, diode. */
export function chipFootprint(name: string, s: ChipSizes): FootprintDef {
  const pads = [smd("1", -s.pitch / 2, 0, s.padW, s.padH), smd("2", s.pitch / 2, 0, s.padW, s.padH)];
  return dress(name, pads, { x1: -s.bodyL / 2, y1: -s.bodyW / 2, x2: s.bodyL / 2, y2: s.bodyW / 2 }, { silk: "sides" });
}

export interface DualSizes {
  pins: number;
  pitch: number;
  /** Centre of the left row to the centre of the right row. */
  span: number;
  /** A pad's size, long way across the row. */
  padW: number;
  padH: number;
  /** The plastic body, across the rows and along them. */
  bodyW: number;
  bodyL: number;
}
/** Two rows of surface-mount pads: SOIC, SOP, SSOP, TSSOP, MSOP. Pin 1 is top left; numbers run down, then up the right. */
export function dualFootprint(name: string, s: DualSizes): FootprintDef {
  const n = Math.max(2, Math.floor(s.pins / 2));
  const top = ((n - 1) / 2) * s.pitch;
  const pads: Pad[] = [];
  for (let i = 0; i < n; i += 1) pads.push(smd(String(i + 1), -s.span / 2, top - i * s.pitch, s.padW, s.padH));
  for (let i = 0; i < n; i += 1) pads.push(smd(String(n + i + 1), s.span / 2, -top + i * s.pitch, s.padW, s.padH));
  return dress(name, pads, { x1: -s.bodyW / 2, y1: -s.bodyL / 2, x2: s.bodyW / 2, y2: s.bodyL / 2 });
}

export interface DipSizes {
  pins: number;
  pitch: number;
  /** Row to row: 7.62 mm for a narrow DIP, 15.24 mm for a wide one. */
  span: number;
  drill: number;
  /** Pad diameter. */
  pad: number;
}
/** A through-hole DIP. Pin 1 is at the origin, as KiCad has it, with a squared pad. */
export function dipFootprint(name: string, s: DipSizes): FootprintDef {
  const n = Math.max(1, Math.floor(s.pins / 2));
  const pads: Pad[] = [];
  const thru = (number: string, x: number, y: number, first: boolean): Pad => ({
    number,
    kind: "thru",
    shape: first ? "roundrect" : "circle",
    ...(first ? { round: 0.15 } : {}),
    x: r4(x),
    y: r4(y),
    w: s.pad,
    h: s.pad,
    drill: s.drill,
  });
  for (let i = 0; i < n; i += 1) pads.push(thru(String(i + 1), 0, -i * s.pitch, i === 0));
  for (let i = 0; i < n; i += 1) pads.push(thru(String(n + i + 1), s.span, -(n - 1 - i) * s.pitch, false));
  const len = (n - 1) * s.pitch;
  return dress(name, pads, { x1: s.span / 2 - (s.span - 1.3) / 2, y1: -len - 1.27, x2: s.span / 2 + (s.span - 1.3) / 2, y2: 1.27 }, { silk: "box" });
}

export interface QuadSizes {
  /** All the pins round the edge; the centre pad is extra. */
  pins: number;
  pitch: number;
  /** Centre of one row of pads to the centre of the row opposite. */
  span: number;
  padW: number;
  padH: number;
  body: number;
  /** A centre pad's side, for QFN and exposed-pad QFP. It takes the next number. */
  centre?: number;
}
/** Pads on four sides: QFP, QFN. Pin 1 is at the top of the left side; numbers run anticlockwise. */
export function quadFootprint(name: string, s: QuadSizes): FootprintDef {
  const n = Math.max(1, Math.floor(s.pins / 4));
  const far = ((n - 1) / 2) * s.pitch;
  const pads: Pad[] = [];
  let k = 1;
  const add = (x: number, y: number, turned: boolean) => pads.push({ ...smd(String(k++), x, y, s.padW, s.padH), ...(turned ? { angle: 90 } : {}) });
  for (let i = 0; i < n; i += 1) add(-s.span / 2, far - i * s.pitch, false);
  for (let i = 0; i < n; i += 1) add(-far + i * s.pitch, -s.span / 2, true);
  for (let i = 0; i < n; i += 1) add(s.span / 2, -far + i * s.pitch, false);
  for (let i = 0; i < n; i += 1) add(far - i * s.pitch, s.span / 2, true);
  if (s.centre) pads.push({ number: String(k), kind: "smd", shape: "rect", x: 0, y: 0, w: s.centre, h: s.centre });
  return dress(name, pads, { x1: -s.body / 2, y1: -s.body / 2, x2: s.body / 2, y2: s.body / 2 });
}

export interface HeaderSizes {
  rows: 1 | 2;
  /** Pins in each row. */
  pins: number;
  pitch: number;
  drill: number;
  pad: number;
}
/** A pin header or socket. Pin 1 is at the origin with a square pad; with two rows the numbers zigzag, as KiCad's do. */
export function headerPins(name: string, s: HeaderSizes): FootprintDef {
  const pads: Pad[] = [];
  for (let i = 0; i < s.pins; i += 1)
    for (let r = 0; r < s.rows; r += 1) {
      const number = i * s.rows + r + 1;
      pads.push({
        number: String(number),
        kind: "thru",
        shape: number === 1 ? "rect" : "circle",
        x: r4(r * s.pitch),
        y: r4(-i * s.pitch),
        w: s.pad,
        h: s.pad,
        drill: s.drill,
      });
    }
  const hp = s.pitch / 2;
  return dress(name, pads, { x1: -hp, y1: -(s.pins - 1) * s.pitch - hp, x2: (s.rows - 1) * s.pitch + hp, y2: hp }, { silk: "box", margin: 0.5 });
}

/** Row letters on a ball grid: the alphabet without the ones that read as digits or each other. */
const BGA_ROWS = "ABCDEFGHJKLMNPRTUVWY";
export const bgaRow = (i: number): string =>
  i < BGA_ROWS.length ? BGA_ROWS[i]! : BGA_ROWS[Math.floor(i / BGA_ROWS.length) - 1]! + BGA_ROWS[i % BGA_ROWS.length]!;

export interface BgaSizes {
  rows: number;
  cols: number;
  pitch: number;
  /** Pad diameter. */
  ball: number;
  bodyW: number;
  bodyL: number;
}
/** A ball grid. A1 is top left; rows are lettered down, columns numbered across. */
export function bgaFootprint(name: string, s: BgaSizes): FootprintDef {
  const pads: Pad[] = [];
  const x0 = -((s.cols - 1) / 2) * s.pitch;
  const y0 = ((s.rows - 1) / 2) * s.pitch;
  for (let r = 0; r < s.rows; r += 1)
    for (let c = 0; c < s.cols; c += 1)
      pads.push({ number: `${bgaRow(r)}${c + 1}`, kind: "smd", shape: "circle", x: r4(x0 + c * s.pitch), y: r4(y0 - r * s.pitch), w: s.ball, h: s.ball });
  const fp = dress(name, pads, { x1: -s.bodyW / 2, y1: -s.bodyL / 2, x2: s.bodyW / 2, y2: s.bodyL / 2 }, { silk: "box" });
  // The box sits on the body's edge, not round the balls, and A1 gets its dot at the corner.
  const o = 0.11;
  fp.shapes = fp.shapes.filter((x) => x.layer !== "silk");
  fp.shapes.push(
    { kind: "rect", layer: "silk", x1: r4(-s.bodyW / 2 - o), y1: r4(-s.bodyL / 2 - o), x2: r4(s.bodyW / 2 + o), y2: r4(s.bodyL / 2 + o), width: 0.12 },
    { kind: "circle", layer: "silk", cx: r4(-s.bodyW / 2 - 0.45), cy: r4(s.bodyL / 2 + 0.45), r: 0.15, width: 0.12, fill: "solid" },
  );
  return fp;
}

// ---------------------------------------------------------------- the footprint check

export interface FootprintProblem {
  kind: "no-pads" | "no-courtyard" | "no-pin1" | "pads-close" | "no-number" | "drill-big";
  text: string;
  pads?: string[];
}

/**
 * What a footprint should be told about before it is used (#627): no courtyard, no silkscreen to show which way
 * round it goes, pads nearer each other than the board's rules allow, a pad with no number, a hole wider than its pad.
 */
export function checkFootprint(fp: FootprintDef, clearance = 0.2): FootprintProblem[] {
  const out: FootprintProblem[] = [];
  const copper = fp.pads.filter((p) => p.kind !== "npth");
  if (copper.length === 0) out.push({ kind: "no-pads", text: "It has no pads." });
  if (!fp.shapes.some((s) => s.layer === "courtyard"))
    out.push({ kind: "no-courtyard", text: "It has no courtyard, so the board cannot tell when parts overlap." });
  if (copper.length > 2 && !fp.shapes.some((s) => s.layer === "silk")) out.push({ kind: "no-pin1", text: "Nothing on the silkscreen shows where pin 1 is." });
  const unnamed = copper.filter((p) => !p.number);
  if (unnamed.length) out.push({ kind: "no-number", text: `${unnamed.length} ${unnamed.length === 1 ? "pad has" : "pads have"} no number.` });
  for (const p of fp.pads)
    if (p.drill && p.kind === "thru" && p.drill >= Math.min(p.w, p.h))
      out.push({ kind: "drill-big", text: `Pad ${p.number}: the ${p.drill} mm hole leaves no copper round it.`, pads: [p.number] });
  // Pads as boxes: near enough for a warning, and never quiet about a real clash.
  const boxes = copper.map((p) => padBox([p]));
  let close = 0;
  let worst: { a: string; b: string; gap: number } | null = null;
  for (let i = 0; i < copper.length; i += 1)
    for (let j = i + 1; j < copper.length; j += 1) {
      if (copper[i]!.number === copper[j]!.number) continue;
      const a = boxes[i]!;
      const b = boxes[j]!;
      const dx = Math.max(a.x1 - b.x2, b.x1 - a.x2, 0);
      const dy = Math.max(a.y1 - b.y2, b.y1 - a.y2, 0);
      const gap = Math.hypot(dx, dy);
      if (gap < clearance - 1e-6) {
        close += 1;
        if (!worst || gap < worst.gap) worst = { a: copper[i]!.number, b: copper[j]!.number, gap };
      }
    }
  if (worst)
    out.push({
      kind: "pads-close",
      text: `${close === 1 ? "Two pads are" : `${close} pairs of pads are`} closer than ${clearance} mm. Pads ${worst.a} and ${worst.b} are ${Math.round(worst.gap * 100) / 100} mm apart.`,
      pads: [worst.a, worst.b],
    });
  return out;
}
