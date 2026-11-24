import { boardPads } from "../board";
import { key, onSegment, placeOnSheet } from "../geom";
import {
  isPower,
  packageOf,
  type Board,
  type BoardLayer,
  type ComponentDef,
  type Corner,
  type ElectronicsDesign,
  type FootprintDef,
  type Fill,
  type FootprintLayer,
  type Id,
  type P2,
  type Pad,
  type Part,
  type PinType,
  type Sheet,
  type Side,
  type SymbolDef,
} from "../model";
import { byRef, netlist, type Netlist } from "../nets";
import { netRules } from "../pcb/copper";
import { SPOKE, THERMAL_GAP } from "../pcb/pour";
import { Str, writeSexpr, type Node } from "./sexpr";

/**
 * Leaving with the whole design (#664): a KiCad project with the schematic, the board and a library of the symbols
 * and footprints the design uses. The files are KiCad 7's formats, which KiCad 7, 8 and 9 all open.
 *
 * KiCad draws its schematic and board with y running down; ours runs up. Symbols in a library keep y up, as KiCad's
 * own do. Pours go out as zone outlines: KiCad fills them itself (Edit, Fill all zones).
 */
export interface KicadFile {
  name: string;
  text: string;
}

export interface KicadProject {
  files: KicadFile[];
  /** What did not go across as it was, in words. */
  notes: string[];
}

const SCH_VERSION = "20230121";
const PCB_VERSION = "20221018";

const s = (t: string): Str => new Str(t);
const n = (v: number): string => String(Math.round(v * 1e6) / 1e6 || 0);

/** A UUID made from a name, so the same design always writes the same files. */
export function uuidOf(seed: string): string {
  let out = "";
  for (let k = 0; k < 4; k += 1) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b9);
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 13;
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-8${out.slice(17, 20)}-${out.slice(20, 32)}`;
}

/** A name KiCad takes for a library, a symbol or a footprint. */
export const kicadName = (text: string): string =>
  text
    .trim()
    .replace(/[^A-Za-z0-9_.+-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "part";

const font = (size = 1.27, ...more: Node[]): Node[] => ["effects", ["font", ["size", n(size), n(size)]], ...more];
const hidden = (size = 1.27): Node[] => [...font(size), "hide"];
const stroke = (width: number | undefined, type = "default"): Node[] => ["stroke", ["width", n(width ?? 0)], ["type", type]];
const xy = (p: P2): Node[] => ["xy", n(p[0]), n(p[1])];

const rad = (deg: number) => (deg * Math.PI) / 180;
/** The start, middle and end of an arc that runs anticlockwise from `a0` to `a1`. */
function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): [P2, P2, P2] {
  const at = (a: number): P2 => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
  const end = a1 < a0 ? a1 + 360 : a1;
  return [at(a0), at((a0 + end) / 2), at(end)];
}

// ---------------------------------------------------------------- symbols

const PIN_TYPES: Record<PinType, string> = {
  input: "input",
  output: "output",
  bidirectional: "bidirectional",
  tristate: "tri_state",
  passive: "passive",
  power_in: "power_in",
  power_out: "power_out",
  open_collector: "open_collector",
  open_emitter: "open_emitter",
  unspecified: "unspecified",
  no_connect: "no_connect",
};

function symbolShape(sh: SymbolDef["shapes"][number]): Node[] {
  const fill = (f: Fill | undefined): Node[] => ["fill", ["type", f === "solid" ? "outline" : f ? "background" : "none"]];
  if (sh.kind === "rect") return ["rectangle", ["start", n(sh.x1), n(sh.y1)], ["end", n(sh.x2), n(sh.y2)], stroke(sh.width), fill(sh.fill)];
  if (sh.kind === "line") return ["polyline", ["pts", ...sh.pts.map(xy)], stroke(sh.width), fill(sh.fill)];
  if (sh.kind === "circle") return ["circle", ["center", n(sh.cx), n(sh.cy)], ["radius", n(sh.r)], stroke(sh.width), fill(sh.fill)];
  if (sh.kind === "arc") {
    const [a, m, b] = arcPoints(sh.cx, sh.cy, sh.r, sh.a0, sh.a1);
    return ["arc", ["start", n(a[0]), n(a[1])], ["mid", n(m[0]), n(m[1])], ["end", n(b[0]), n(b[1])], stroke(sh.width), fill(false)];
  }
  const just = sh.align === "left" ? [["justify", "left"]] : sh.align === "right" ? [["justify", "right"]] : [];
  return ["text", s(sh.text), ["at", n(sh.x), n(sh.y), n((sh.angle ?? 0) * 10)], font(sh.size, ...just)];
}

/** The top of a symbol's drawing, for texts that have no place of their own. */
function symbolTop(sym: SymbolDef): number {
  let top = 0;
  for (const p of sym.pins) top = Math.max(top, p.y);
  for (const sh of sym.shapes) {
    if (sh.kind === "rect") top = Math.max(top, sh.y1, sh.y2);
    else if (sh.kind === "line") top = Math.max(top, ...sh.pts.map((q) => q[1]));
    else if (sh.kind === "circle" || sh.kind === "arc") top = Math.max(top, sh.cy + sh.r);
  }
  return top;
}

const refPlace = (sym: SymbolDef): P2 => sym.refAt ?? [0, symbolTop(sym) + 2.54];
const valuePlace = (sym: SymbolDef): P2 => sym.valueAt ?? [0, symbolTop(sym) + 1.27];

/**
 * One symbol as KiCad keeps it. `id` is its name where it is written: plain in a library, "Library:Name" in a
 * schematic. A power symbol's hidden pin carries the net's name, which is where KiCad 7 reads it from; KiCad 8 and 9
 * read the value, and that says the same.
 */
export function kicadSymbol(def: ComponentDef, name: string, id: string, o: { footprint?: string; power?: string } = {}): Node[] {
  const sym = def.symbol;
  const blocks = new Map<string, Node[]>();
  const block = (unit: number): Node[] => {
    const key = `${name}_${unit}_1`;
    if (!blocks.has(key)) blocks.set(key, ["symbol", s(key)]);
    return blocks.get(key)!;
  };
  for (const sh of sym.shapes) block(sym.units > 1 ? (sh.unit ?? 0) : 0).push(symbolShape(sh));
  for (const pin of sym.pins) {
    const power = o.power !== undefined;
    const item: Node[] = [
      "pin",
      power ? "power_in" : PIN_TYPES[pin.type],
      "line",
      ["at", n(pin.x), n(pin.y), n(pin.dir)],
      ["length", n(pin.length)],
      ["name", s(power ? o.power! : pin.name || "~"), font(1.27)],
      ["number", s(pin.number), font(1.27)],
    ];
    if (pin.hidden || power) item.splice(5, 0, "hide");
    block(sym.units > 1 ? (pin.unit ?? 0) : 1).push(item);
  }
  const prop = (key: string, value: string, at: P2, effects: Node[]): Node[] => ["property", s(key), s(value), ["at", n(at[0]), n(at[1]), "0"], effects];
  const credit = def.source ? ` From ${def.source.library}, ${def.source.licence}.` : "";
  const out: Node[] = ["symbol", s(id)];
  if (o.power !== undefined) out.push(["power"]);
  out.push(
    ["pin_names", ["offset", "0.508"]],
    ["in_bom", "yes"],
    ["on_board", "yes"],
    prop("Reference", o.power !== undefined ? "#PWR" : def.prefix, refPlace(sym), o.power !== undefined ? hidden() : font(1.27, ["justify", "left"])),
    prop("Value", o.power ?? def.value ?? def.name, valuePlace(sym), font(1.27, ["justify", "left"])),
    prop("Footprint", o.footprint ?? "", [0, 0], hidden()),
    prop("Datasheet", def.datasheet ?? "", [0, 0], hidden()),
    prop("ki_description", `${def.description ?? def.name}.${credit}`.replace(/\.\./g, "."), [0, 0], hidden()),
  );
  if (def.keywords?.length) out.push(prop("ki_keywords", def.keywords.join(" "), [0, 0], hidden()));
  out.push(...[...blocks.entries()].sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true })).map((e) => e[1]));
  return out;
}

// ---------------------------------------------------------------- footprints

const FP_LAYERS: Record<FootprintLayer, string> = { silk: "SilkS", fab: "Fab", courtyard: "CrtYd", copper: "Cu" };
const sideLetter = (side: Side) => (side === "bottom" ? "B" : "F");

/** A footprint's own point as KiCad keeps it: y down, and for a part on the bottom, mirrored the way KiCad flips. */
const local = (p: P2, side: Side): P2 => [p[0], side === "bottom" ? p[1] : -p[1]];

function footprintShape(sh: FootprintDef["shapes"][number], side: Side, prefix = "fp"): Node[] | null {
  const layer: Node[] = ["layer", s(`${sideLetter(side)}.${FP_LAYERS[sh.layer]}`)];
  const pen = stroke(sh.kind === "text" ? 0 : (sh.width ?? 0.12), "solid");
  const at = (p: P2) => local(p, side).map(n);
  if (sh.kind === "rect")
    return [`${prefix}_rect`, ["start", ...at([sh.x1, sh.y1])], ["end", ...at([sh.x2, sh.y2])], pen, ["fill", sh.fill ? "solid" : "none"], layer];
  if (sh.kind === "circle")
    return [`${prefix}_circle`, ["center", ...at([sh.cx, sh.cy])], ["end", ...at([sh.cx + sh.r, sh.cy])], pen, ["fill", sh.fill ? "solid" : "none"], layer];
  if (sh.kind === "arc") {
    const [a, m, b] = arcPoints(sh.cx, sh.cy, sh.r, sh.a0, sh.a1);
    return [`${prefix}_arc`, ["start", ...at(a)], ["mid", ...at(m)], ["end", ...at(b)], pen, layer];
  }
  if (sh.kind === "line") {
    if (sh.fill) return [`${prefix}_poly`, ["pts", ...sh.pts.map((p) => xy(local(p, side)))], pen, ["fill", "solid"], layer];
    // A run of lines is one line each in KiCad; `footprintNodes` splits them.
    return null;
  }
  return null;
}

function footprintShapes(fp: FootprintDef, side: Side): Node[][] {
  const out: Node[][] = [];
  for (const sh of fp.shapes) {
    if (sh.kind === "line" && !sh.fill) {
      const layer: Node[] = ["layer", s(`${sideLetter(side)}.${FP_LAYERS[sh.layer]}`)];
      for (let i = 0; i + 1 < sh.pts.length; i += 1)
        out.push([
          "fp_line",
          ["start", ...local(sh.pts[i]!, side).map(n)],
          ["end", ...local(sh.pts[i + 1]!, side).map(n)],
          stroke(sh.width ?? 0.12, "solid"),
          layer,
        ]);
      continue;
    }
    const node = footprintShape(sh, side);
    if (node) out.push(node);
  }
  return out;
}

function padNode(pad: Pad, side: Side, angle: number, net?: { code: number; name: string }): Node[] {
  const f = sideLetter(side);
  const type = pad.kind === "thru" ? "thru_hole" : pad.kind === "npth" ? "np_thru_hole" : "smd";
  const at = local([pad.x, pad.y], side);
  const turnBy = ((angle % 360) + 360) % 360;
  const out: Node[] = [
    "pad",
    s(pad.kind === "npth" ? "" : pad.number),
    type,
    pad.shape,
    ["at", n(at[0]), n(at[1]), ...(turnBy ? [n(turnBy)] : [])],
    ["size", n(pad.w), n(pad.h)],
  ];
  if (pad.kind !== "smd" && pad.drill) out.push(pad.slot && pad.slot > pad.drill ? ["drill", "oval", n(pad.slot), n(pad.drill)] : ["drill", n(pad.drill)]);
  out.push(pad.kind === "smd" ? ["layers", s(`${f}.Cu`), ...(pad.noPaste ? [] : [s(`${f}.Paste`)]), s(`${f}.Mask`)] : ["layers", s("*.Cu"), s("*.Mask")]);
  if (pad.shape === "roundrect") out.push(["roundrect_rratio", n(pad.round ?? 0.25)]);
  if (pad.maskMargin !== undefined) out.push(["solder_mask_margin", n(pad.maskMargin)]);
  if (net && pad.kind !== "npth") out.push(["net", String(net.code), s(net.name)]);
  return out;
}

const mount = (fp: FootprintDef): string => (fp.pads.some((p) => p.kind === "thru") ? "through_hole" : fp.pads.some((p) => p.kind === "smd") ? "smd" : "");

const fpText = (kind: string, text: string, at: P2, side: Side, layer: string, angle: number, hide = false): Node[] => {
  const out: Node[] = ["fp_text", kind, s(text), ["at", n(at[0]), n(at[1]), ...(angle ? [n(angle)] : [])], ["layer", s(`${sideLetter(side)}.${layer}`)]];
  if (hide) out.push("hide");
  out.push(["effects", ["font", ["size", "1", "1"], ["thickness", "0.15"]], ...(side === "bottom" ? [["justify", "mirror"]] : [])]);
  return out;
};

/** A footprint as a `.kicad_mod` file of a library. */
export function kicadFootprint(fp: FootprintDef, name: string, credit?: string): string {
  const out: Node[] = ["footprint", s(name), ["version", PCB_VERSION], ["generator", "bettercad"], ["layer", s("F.Cu")]];
  if (credit) out.push(["descr", s(credit)]);
  if (mount(fp)) out.push(["attr", mount(fp)]);
  out.push(fpText("reference", "REF**", local(fp.refAt ?? [0, 0], "top"), "top", "SilkS", 0));
  out.push(fpText("value", name, [0, 0], "top", "Fab", 0, true));
  out.push(...footprintShapes(fp, "top"));
  out.push(...fp.pads.map((p) => padNode(p, "top", p.angle ?? 0)));
  return `${writeSexpr(out)}\n`;
}

// ---------------------------------------------------------------- names

interface Names {
  lib: string;
  /** A component's symbol in the library, by its id in the design. */
  symbol: Map<Id, string>;
  /** A package's footprint in the library, by "def id:package". */
  footprint: Map<string, string>;
  footprints: Map<string, { fp: FootprintDef; credit?: string }>;
}

function nameThings(d: ElectronicsDesign, lib: string): Names {
  const names: Names = { lib, symbol: new Map(), footprint: new Map(), footprints: new Map() };
  const taken = new Set<string>();
  const free = (want: string) => {
    let name = want;
    for (let i = 2; taken.has(name.toLowerCase()); i += 1) name = `${want}_${i}`;
    taken.add(name.toLowerCase());
    return name;
  };
  const used = new Set(d.parts.map((p) => p.def));
  const drawn = new Map<string, string>();
  for (const id of Object.keys(d.defs).sort()) {
    if (!used.has(id)) continue;
    const def = d.defs[id]!;
    names.symbol.set(id, free(kicadName(def.name)));
    def.packages.forEach((pkg, i) => {
      // Two parts with one footprint share it.
      const key = JSON.stringify(pkg.footprint);
      let name = drawn.get(key);
      if (!name) {
        name = kicadName(pkg.footprint.name);
        for (let k = 2; names.footprints.has(name); k += 1) name = `${kicadName(pkg.footprint.name)}_${k}`;
        drawn.set(key, name);
        names.footprints.set(name, { fp: pkg.footprint, ...(def.source ? { credit: `From ${def.source.library}, ${def.source.licence}` } : {}) });
      }
      names.footprint.set(`${id}:${i}`, name);
    });
  }
  return names;
}

const footprintOf = (d: ElectronicsDesign, part: Part, names: Names): string | undefined => {
  const def = d.defs[part.def];
  if (!def?.packages.length) return undefined;
  const i = def.packages[part.pkg] ? part.pkg : 0;
  const name = names.footprint.get(`${part.def}:${i}`);
  return name ? `${names.lib}:${name}` : undefined;
};

/** The symbol a part is drawn with: its component's, or for a power symbol, one for its net. */
const symbolOf = (d: ElectronicsDesign, part: Part, names: Names): string => {
  const base = names.symbol.get(part.def) ?? "part";
  return isPower(d, part) ? `${base}_${kicadName(part.value)}` : base;
};

// ---------------------------------------------------------------- the schematic

const PAPERS: [string, number, number][] = [
  ["A4", 297, 210],
  ["A3", 420, 297],
  ["A2", 594, 420],
  ["A1", 841, 594],
  ["A0", 1189, 841],
];
const GRID = 2.54;
const MARGIN = 10 * GRID;

interface Page {
  paper: string;
  /** Our point on the sheet as KiCad's. */
  at: (p: P2) => P2;
  right: number;
}

function pageOf(d: ElectronicsDesign, sheet: Sheet): Page {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const see = (p: P2) => {
    x1 = Math.min(x1, p[0]);
    y1 = Math.min(y1, p[1]);
    x2 = Math.max(x2, p[0]);
    y2 = Math.max(y2, p[1]);
  };
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  for (const sym of sheet.symbols) {
    see([sym.x, sym.y]);
    const def = d.defs[parts.get(sym.part)?.def ?? ""];
    for (const pin of def?.symbol.pins ?? []) see(placeOnSheet([pin.x, pin.y], sym));
  }
  for (const w of sheet.wires) {
    see(w.a);
    see(w.b);
  }
  for (const l of [...sheet.labels, ...sheet.junctions, ...sheet.noConnects]) see([l.x, l.y]);
  if (x1 > x2) [x1, y1, x2, y2] = [0, 0, 0, 0];
  const snap = (v: number) => Math.round(v / GRID) * GRID;
  const ox = snap(MARGIN - x1);
  const oy = snap(MARGIN + y2);
  const w = x2 - x1 + 2 * MARGIN;
  const h = y2 - y1 + 2 * MARGIN;
  const paper = PAPERS.find((p) => p[1] >= w && p[2] >= h) ?? PAPERS[PAPERS.length - 1]!;
  return { paper: paper[0], at: (p) => [p[0] + ox, oy - p[1]], right: x2 + ox };
}

function sheetFile(
  d: ElectronicsDesign,
  sheet: Sheet,
  names: Names,
  o: { project: string; root: string; path: string; uuid: string; global: boolean; subs: Node[][] },
): string {
  const page = pageOf(d, sheet);
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const at = (p: P2) => page.at(p).map(n);
  const out: Node[] = ["kicad_sch", ["version", SCH_VERSION], ["generator", "bettercad"], ["uuid", o.uuid], ["paper", s(page.paper)]];

  // The symbols this sheet draws, as KiCad keeps a copy of each in the file.
  const lib = new Map<string, Node[]>();
  for (const sym of sheet.symbols) {
    const part = parts.get(sym.part);
    const def = part && d.defs[part.def];
    if (!part || !def) continue;
    const name = symbolOf(d, part, names);
    if (!lib.has(name)) lib.set(name, kicadSymbol(def, name, `${names.lib}:${name}`, isPower(d, part) ? { power: part.value } : {}));
  }
  out.push(["lib_symbols", ...[...lib.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1])]);

  // We join a wire's end, or a pin, that lands on the middle of another wire. KiCad joins wires only at their ends, so
  // a wire is cut where something joins it, with a dot on the cut.
  const dots = new Map(sheet.junctions.map((j) => [key(j.x, j.y), { at: [j.x, j.y] as P2, id: j.id }]));
  const lands: P2[] = sheet.wires.flatMap((w) => [w.a, w.b]);
  for (const sym of sheet.symbols) {
    const def = d.defs[parts.get(sym.part)?.def ?? ""];
    for (const pin of def?.symbol.pins ?? [])
      if (pin.unit === undefined || def!.symbol.units < 2 || pin.unit === sym.unit) lands.push(placeOnSheet([pin.x, pin.y], sym));
  }
  const same = (a: P2, b: P2) => key(a[0], a[1]) === key(b[0], b[1]);
  for (const p of lands)
    if (!dots.has(key(p[0], p[1])) && sheet.wires.some((w) => !same(p, w.a) && !same(p, w.b) && onSegment(p, w.a, w.b)))
      dots.set(key(p[0], p[1]), { at: p, id: `dot:${sheet.id}:${key(p[0], p[1])}` });
  for (const j of dots.values()) out.push(["junction", ["at", ...at(j.at)], ["diameter", "0"], ["color", "0", "0", "0", "0"], ["uuid", uuidOf(j.id)]]);
  for (const x of sheet.noConnects) out.push(["no_connect", ["at", ...at([x.x, x.y])], ["uuid", uuidOf(x.id)]]);
  for (const w of sheet.wires) {
    const along = (p: P2) => Math.hypot(p[0] - w.a[0], p[1] - w.a[1]);
    const cuts = [...dots.values()]
      .map((j) => j.at)
      .filter((p) => !same(p, w.a) && !same(p, w.b) && onSegment(p, w.a, w.b))
      .sort((p, q) => along(p) - along(q));
    const stops = [w.a, ...cuts, w.b];
    for (let i = 0; i + 1 < stops.length; i += 1)
      out.push(["wire", ["pts", xy(page.at(stops[i]!)), xy(page.at(stops[i + 1]!))], stroke(0), ["uuid", uuidOf(i ? `${w.id}:${i}` : w.id)]]);
  }
  for (const l of sheet.labels) {
    const rot = l.rot ?? 0;
    const just = rot === 180 || rot === 270 ? "right" : "left";
    out.push(
      o.global
        ? ["global_label", s(l.name), ["shape", "passive"], ["at", ...at([l.x, l.y]), n(rot)], font(1.27, ["justify", just]), ["uuid", uuidOf(l.id)]]
        : ["label", s(l.name), ["at", ...at([l.x, l.y]), n(rot)], font(1.27, ["justify", just, "bottom"]), ["uuid", uuidOf(l.id)]],
    );
  }
  for (const note of sheet.notes ?? []) {
    const id: Node[] = ["uuid", uuidOf(note.id)];
    if (note.kind === "line") out.push(["polyline", ["pts", ...note.pts.map((p) => xy(page.at(p)))], stroke(note.width), id]);
    else if (note.kind === "rect")
      out.push(["rectangle", ["start", ...at([note.x1, note.y1])], ["end", ...at([note.x2, note.y2])], stroke(note.width), ["fill", ["type", "none"]], id]);
    else if (note.kind === "circle")
      out.push(["circle", ["center", ...at([note.cx, note.cy])], ["radius", n(note.r)], stroke(note.width), ["fill", ["type", "none"]], id]);
    else if (note.kind === "arc") {
      const [a, m, b] = arcPoints(note.cx, note.cy, note.r, note.a0, note.a1);
      out.push(["arc", ["start", ...at(a)], ["mid", ...at(m)], ["end", ...at(b)], stroke(note.width), ["fill", ["type", "none"]], id]);
    } else out.push(["text", s(note.text), ["at", ...at([note.x, note.y]), n(note.angle ?? 0)], font(note.size, ["justify", "left", "bottom"]), id]);
  }

  for (const sym of sheet.symbols) {
    const part = parts.get(sym.part);
    const def = part && d.defs[part.def];
    if (!part || !def) continue;
    const power = isPower(d, part);
    // We mirror, then turn; KiCad turns, then mirrors, which is the same as turning the other way first.
    const angle = sym.mirror ? (360 - sym.rot) % 360 : sym.rot;
    const fp = power ? undefined : footprintOf(d, part, names);
    const text = (key: string, value: string, p: P2, effects: Node[]): Node[] => [
      "property",
      s(key),
      s(value),
      ["at", ...at(placeOnSheet(p, sym)), "0"],
      effects,
    ];
    const node: Node[] = ["symbol", ["lib_id", s(`${names.lib}:${symbolOf(d, part, names)}`)], ["at", ...at([sym.x, sym.y]), n(angle)]];
    if (sym.mirror) node.push(["mirror", "y"]);
    node.push(
      ["unit", String(sym.unit || 1)],
      ["in_bom", power || part.fitted === false ? "no" : "yes"],
      ["on_board", power ? "no" : "yes"],
      ["dnp", part.fitted === false ? "yes" : "no"],
      ["uuid", uuidOf(sym.id)],
      text("Reference", part.ref, refPlace(def.symbol), power ? hidden() : font(1.27, ["justify", "left"])),
      text("Value", part.value, valuePlace(def.symbol), font(1.27, ["justify", "left"])),
      text("Footprint", fp ?? "", [0, 0], hidden()),
      text("Datasheet", def.datasheet ?? "", [0, 0], hidden()),
    );
    const supplier = { ...def.supplier, ...part.supplier };
    if (supplier.mpn) node.push(text("MPN", supplier.mpn, [0, 0], hidden()));
    if (supplier.manufacturer) node.push(text("Manufacturer", supplier.manufacturer, [0, 0], hidden()));
    if (supplier.lcsc) node.push(text("LCSC", supplier.lcsc, [0, 0], hidden()));
    for (const pin of def.symbol.pins)
      if (pin.unit === undefined || def.symbol.units < 2 || pin.unit === sym.unit)
        node.push(["pin", s(pin.number), ["uuid", uuidOf(`${sym.id}:${pin.number}`)]]);
    node.push(["instances", ["project", s(o.project), ["path", s(o.path), ["reference", s(part.ref)], ["unit", String(sym.unit || 1)]]]]);
    out.push(node);
  }

  // The other sheets hang off the first as boxes down its right side.
  o.subs.forEach((sub, i) => {
    sub.splice(1, 0, ["at", n(page.right + MARGIN), n(MARGIN + i * 8 * GRID)], ["size", n(12 * GRID), n(4 * GRID)]);
    out.push(sub);
  });
  if (o.path === `/${o.root}`) out.push(["sheet_instances", ["path", s("/"), ["page", s("1")]]]);
  return `${writeSexpr(out)}\n`;
}

// ---------------------------------------------------------------- the board

const BOARD_LAYERS: Record<BoardLayer, string> = { "silk-top": "F.SilkS", "silk-bottom": "B.SilkS", "copper-top": "F.Cu", "copper-bottom": "B.Cu" };
const copperLayer = (layer: string): string => (layer === "bottom" ? "B.Cu" : "F.Cu");

const LAYER_TABLE: Node[] = [
  "layers",
  ["0", s("F.Cu"), "signal"],
  ["31", s("B.Cu"), "signal"],
  ["32", s("B.Adhes"), "user", s("B.Adhesive")],
  ["33", s("F.Adhes"), "user", s("F.Adhesive")],
  ["34", s("B.Paste"), "user"],
  ["35", s("F.Paste"), "user"],
  ["36", s("B.SilkS"), "user", s("B.Silkscreen")],
  ["37", s("F.SilkS"), "user", s("F.Silkscreen")],
  ["38", s("B.Mask"), "user"],
  ["39", s("F.Mask"), "user"],
  ["40", s("Dwgs.User"), "user", s("User.Drawings")],
  ["41", s("Cmts.User"), "user", s("User.Comments")],
  ["44", s("Edge.Cuts"), "user"],
  ["45", s("Margin"), "user"],
  ["46", s("B.CrtYd"), "user", s("B.Courtyard")],
  ["47", s("F.CrtYd"), "user", s("F.Courtyard")],
  ["48", s("B.Fab"), "user"],
  ["49", s("F.Fab"), "user"],
];

/** The middle of the arc a bulge bends an edge into. */
function bulgeMid(a: Corner, b: Corner): P2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const sag = ((a.bulge ?? 0) * len) / 2;
  // An anticlockwise arc bulges to the right of the way from its start to its end.
  return [(a.x + b.x) / 2 + (dy / len) * sag, (a.y + b.y) / 2 - (dx / len) * sag];
}

function boardFile(d: ElectronicsDesign, board: Board, names: Names, nl: Netlist, o: { paths: Map<Id, string> }, notes: string[]): string {
  const pads = boardPads(d, nl);
  // The board sits a little in from the page's corner; y turns over.
  let top = -Infinity;
  let left = Infinity;
  for (const c of board.outline) {
    top = Math.max(top, c.y);
    left = Math.min(left, c.x);
  }
  if (!board.outline.length) [top, left] = [0, 0];
  const ox = 100 - left;
  const oy = 100 + top;
  const at = (p: P2): string[] => [n(p[0] + ox), n(oy - p[1])];

  const netNames = new Set<string>();
  for (const p of pads) if (p.net) netNames.add(p.net);
  for (const t of [...board.tracks, ...board.vias, ...board.pours]) if (t.net) netNames.add(t.net);
  const codes = new Map([...netNames].sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((name, i) => [name, i + 1]));
  const net = (name: string): Node[] => ["net", String(codes.get(name) ?? 0)];

  const out: Node[] = [
    "kicad_pcb",
    ["version", PCB_VERSION],
    ["generator", "bettercad"],
    ["general", ["thickness", n(board.thickness)]],
    ["paper", s("A4")],
    LAYER_TABLE,
    ["setup", ["pad_to_mask_clearance", n(board.rules.maskMargin)]],
    ["net", "0", s("")],
    ...[...codes.entries()].map(([name, code]): Node[] => ["net", String(code), s(name)]),
  ];

  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const placed = [...board.placements].sort((a, b) => byRef(parts.get(a.part)?.ref ?? "", parts.get(b.part)?.ref ?? ""));
  for (const place of placed) {
    const part = parts.get(place.part);
    const pkg = part && packageOf(d, part);
    if (!part || !pkg) continue;
    const fp = pkg.footprint;
    const side = place.side;
    // A part on the bottom is mirrored left to right here, and top to bottom in KiCad: half a turn apart.
    const rot = (((place.rot + (side === "bottom" ? 180 : 0)) % 360) + 360) % 360;
    const node: Node[] = [
      "footprint",
      s(footprintOf(d, part, names) ?? `${names.lib}:${kicadName(fp.name)}`),
      ["layer", s(`${sideLetter(side)}.Cu`)],
      ["tstamp", uuidOf(`fp:${part.id}`)],
      ["at", ...at([place.x, place.y]), ...(rot ? [n(rot)] : [])],
    ];
    const ref = fpText("reference", part.ref, local(place.refAt ?? fp.refAt ?? [0, 0], side), side, "SilkS", rot, place.refHidden);
    node.push(ref, fpText("value", part.value, [0, 0], side, "Fab", rot, true));
    const path = o.paths.get(part.id);
    if (path) node.push(["path", s(path)]);
    const attr: string[] = [mount(fp), ...(part.fitted === false ? ["dnp"] : [])].filter(Boolean);
    if (attr.length) node.push(["attr", ...attr]);
    node.push(...footprintShapes(fp, side));
    for (const pad of pads) {
      if (pad.part !== part.id) continue;
      node.push(padNode(pad.pad, side, pad.angle, pad.net ? { code: codes.get(pad.net) ?? 0, name: pad.net } : undefined));
    }
    out.push(node);
  }

  // Holes of the board's own are footprints with one pad, as KiCad's mounting holes are.
  for (const h of board.holes) {
    const pad: Pad = {
      number: h.pad ? "1" : "",
      kind: h.pad ? "thru" : "npth",
      shape: "circle",
      x: 0,
      y: 0,
      w: h.pad ?? h.drill,
      h: h.pad ?? h.drill,
      drill: h.drill,
    };
    out.push([
      "footprint",
      s(`${names.lib}:Hole_${kicadName(n(h.drill))}mm${h.pad ? "_Pad" : ""}`),
      ["layer", s("F.Cu")],
      ["tstamp", uuidOf(`hole:${h.id}`)],
      ["at", ...at([h.x, h.y])],
      ["attr", "board_only", "exclude_from_pos_files", "exclude_from_bom"],
      fpText("reference", "H", [0, 0], "top", "SilkS", 0, true),
      fpText("value", "Hole", [0, 0], "top", "Fab", 0, true),
      padNode(pad, "top", 0),
    ]);
  }

  for (const [i, loop] of [board.outline, ...(board.cutouts ?? [])].entries()) {
    for (let k = 0; k < loop.length; k += 1) {
      const a = loop[k]!;
      const b = loop[(k + 1) % loop.length]!;
      const id: Node[] = ["tstamp", uuidOf(`edge:${i}:${k}`)];
      const tail: Node[] = [stroke(0.1, "solid"), ["layer", s("Edge.Cuts")], id];
      if (loop.length < 2) continue;
      if (a.bulge) out.push(["gr_arc", ["start", ...at([a.x, a.y])], ["mid", ...at(bulgeMid(a, b))], ["end", ...at([b.x, b.y])], ...tail]);
      else out.push(["gr_line", ["start", ...at([a.x, a.y])], ["end", ...at([b.x, b.y])], ...tail]);
    }
  }

  for (const sh of board.shapes) {
    const layer: Node[] = ["layer", s(BOARD_LAYERS[sh.layer])];
    const id: Node[] = ["tstamp", uuidOf(sh.id)];
    const pen = stroke(sh.kind === "text" ? 0 : (sh.width ?? 0.15), "solid");
    if (sh.kind === "line") {
      if (sh.fill) out.push(["gr_poly", ["pts", ...sh.pts.map((p) => ["xy", ...at(p)])], pen, ["fill", "solid"], layer, id]);
      else
        for (let i = 0; i + 1 < sh.pts.length; i += 1)
          out.push(["gr_line", ["start", ...at(sh.pts[i]!)], ["end", ...at(sh.pts[i + 1]!)], pen, layer, ["tstamp", uuidOf(`${sh.id}:${i}`)]]);
    } else if (sh.kind === "rect")
      out.push(["gr_rect", ["start", ...at([sh.x1, sh.y1])], ["end", ...at([sh.x2, sh.y2])], pen, ["fill", sh.fill ? "solid" : "none"], layer, id]);
    else if (sh.kind === "circle")
      out.push(["gr_circle", ["center", ...at([sh.cx, sh.cy])], ["end", ...at([sh.cx + sh.r, sh.cy])], pen, ["fill", sh.fill ? "solid" : "none"], layer, id]);
    else if (sh.kind === "arc") {
      const [a, m, b] = arcPoints(sh.cx, sh.cy, sh.r, sh.a0, sh.a1);
      out.push(["gr_arc", ["start", ...at(a)], ["mid", ...at(m)], ["end", ...at(b)], pen, layer, id]);
    }
  }
  for (const t of board.texts) {
    const bottom = t.layer.endsWith("bottom");
    out.push([
      "gr_text",
      s(t.text),
      ["at", ...at([t.x, t.y]), ...(t.angle ? [n(t.angle)] : [])],
      ["layer", s(BOARD_LAYERS[t.layer])],
      ["tstamp", uuidOf(t.id)],
      [
        "effects",
        ["font", ["size", n(t.size), n(t.size)], ["thickness", n(Math.max(0.1, t.size * 0.15))]],
        ["justify", "left", "bottom", ...(bottom ? ["mirror"] : [])],
      ],
    ]);
  }

  for (const t of board.tracks)
    for (let i = 0; i + 1 < t.pts.length; i += 1)
      out.push([
        "segment",
        ["start", ...at(t.pts[i]!)],
        ["end", ...at(t.pts[i + 1]!)],
        ["width", n(t.width)],
        ["layer", s(copperLayer(t.layer))],
        net(t.net),
        ["tstamp", uuidOf(`${t.id}:${i}`)],
      ]);
  for (const v of board.vias)
    out.push([
      "via",
      ["at", ...at([v.x, v.y])],
      ["size", n(v.diameter)],
      ["drill", n(v.drill)],
      ["layers", s("F.Cu"), s("B.Cu")],
      net(v.net),
      ["tstamp", uuidOf(v.id)],
    ]);

  for (const p of board.pours) {
    const gap = netRules(board, p.net).clearance;
    out.push([
      "zone",
      net(p.net),
      ["net_name", s(p.net)],
      ["layer", s(copperLayer(p.layer))],
      ["tstamp", uuidOf(p.id)],
      ["hatch", "edge", "0.5"],
      ...(p.priority ? [["priority", String(p.priority)] as Node[]] : []),
      p.thermal === false ? ["connect_pads", "yes", ["clearance", n(gap)]] : ["connect_pads", ["clearance", n(gap)]],
      ["min_thickness", n(Math.max(0.1, board.rules.minTrackWidth))],
      ["filled_areas_thickness", "no"],
      ["fill", ["thermal_gap", n(THERMAL_GAP)], ["thermal_bridge_width", n(SPOKE)]],
      ["polygon", ["pts", ...p.outline.map((q) => ["xy", ...at(q)])]],
    ]);
  }
  if (board.pours.length) notes.push("Pours went across as zone outlines. In KiCad's board editor, choose Edit, Fill all zones to fill them.");
  for (const k of board.keepouts) {
    const rule = (on: boolean | undefined) => (on ? "not_allowed" : "allowed");
    out.push([
      "zone",
      ["net", "0"],
      ["net_name", s("")],
      ["layers", s("F&B.Cu")],
      ["tstamp", uuidOf(k.id)],
      ["hatch", "edge", "0.5"],
      ["connect_pads", ["clearance", "0"]],
      ["min_thickness", "0.25"],
      ["filled_areas_thickness", "no"],
      ["keepout", ["tracks", rule(k.tracks)], ["vias", rule(k.tracks)], ["pads", "allowed"], ["copperpour", rule(k.pours)], ["footprints", rule(k.parts)]],
      ["fill", ["thermal_gap", "0.5"], ["thermal_bridge_width", "0.5"]],
      ["polygon", ["pts", ...k.outline.map((q) => ["xy", ...at(q)])]],
    ]);
  }
  return `${writeSexpr(out)}\n`;
}

// ---------------------------------------------------------------- the project

function projectFile(name: string, sheets: { uuid: string; name: string }[], board: Board | undefined): string {
  const r = board?.rules;
  const klass = (title: string, c: { clearance: number; trackWidth: number; viaDiameter: number; viaDrill: number }) => ({
    bus_width: 12,
    clearance: c.clearance,
    diff_pair_gap: 0.25,
    diff_pair_via_gap: 0.25,
    diff_pair_width: 0.2,
    line_style: 0,
    microvia_diameter: 0.3,
    microvia_drill: 0.1,
    name: title,
    pcb_color: "rgba(0, 0, 0, 0.000)",
    schematic_color: "rgba(0, 0, 0, 0.000)",
    track_width: c.trackWidth,
    via_diameter: c.viaDiameter,
    via_drill: c.viaDrill,
    wire_width: 6,
  });
  const classes = r
    ? [
        klass("Default", r),
        ...board.classes.map((c) => klass(c.name, { ...r, ...c, viaDiameter: c.viaDiameter ?? r.viaDiameter, viaDrill: c.viaDrill ?? r.viaDrill })),
      ]
    : [];
  const pro = {
    board: r
      ? {
          design_settings: {
            rules: {
              min_clearance: r.clearance,
              min_copper_edge_clearance: r.copperToEdge,
              min_hole_to_hole: r.holeToHole,
              min_through_hole_diameter: r.minDrill,
              min_track_width: r.minTrackWidth,
              min_via_annular_width: r.minViaRing ?? r.minRing,
              min_via_diameter: r.minDrill + 2 * (r.minViaRing ?? r.minRing),
              min_text_height: r.minSilkHeight,
              min_text_thickness: r.minSilkWidth,
            },
            track_widths: [0, r.trackWidth],
            via_dimensions: [
              { diameter: 0, drill: 0 },
              { diameter: r.viaDiameter, drill: r.viaDrill },
            ],
          },
        }
      : {},
    meta: { filename: `${name}.kicad_pro`, version: 1 },
    net_settings: {
      classes,
      meta: { version: 3 },
      net_colors: null,
      netclass_assignments: null,
      netclass_patterns: (board?.classes ?? []).flatMap((c) => c.nets.map((pattern) => ({ netclass: c.name, pattern }))),
    },
    schematic: { legacy_lib_dir: "", legacy_lib_list: [] },
    sheets: sheets.map((sh, i) => [sh.uuid, i ? sh.name : ""]),
    text_variables: {},
  };
  return `${JSON.stringify(pro, null, 2)}\n`;
}

/**
 * The whole design as a KiCad project: `<name>.kicad_pro`, the schematic (one file a sheet), the board, a symbol
 * library, a footprint library and the two tables that tell KiCad where the libraries are.
 */
export function kicadProject(d: ElectronicsDesign, title: string): KicadProject {
  const name = kicadName(title) || "board";
  const names = nameThings(d, name);
  const notes: string[] = [];
  const files: KicadFile[] = [];
  const root = uuidOf(`sheet:${d.sheets[0]?.id ?? "root"}`);
  const sheets = d.sheets.map((sh, i) => ({
    sheet: sh,
    uuid: i ? uuidOf(`sheet:${sh.id}`) : root,
    file: i ? `${name}-${i + 1}.kicad_sch` : `${name}.kicad_sch`,
    name: sh.name,
  }));
  const global = sheets.length > 1;

  // Where each part's symbol is, for the board to point back at.
  const paths = new Map<Id, string>();
  sheets.forEach((sh, i) => {
    for (const sym of sh.sheet.symbols) if (!paths.has(sym.part)) paths.set(sym.part, `${i ? `/${sh.uuid}` : ""}/${uuidOf(sym.id)}`);
  });

  sheets.forEach((sh, i) => {
    const subs: Node[][] = i
      ? []
      : sheets
          .slice(1)
          .map((sub, k): Node[] => [
            "sheet",
            ["fields_autoplaced"],
            stroke(0.1524, "solid"),
            ["fill", ["color", "0", "0", "0", "0.0000"]],
            ["uuid", sub.uuid],
            ["property", s("Sheetname"), s(sub.name), ["at", "0", "0", "0"], hidden()],
            ["property", s("Sheetfile"), s(sub.file), ["at", "0", "0", "0"], hidden()],
            ["instances", ["project", s(name), ["path", s(`/${root}`), ["page", s(String(k + 2))]]]],
          ]);
    files.push({
      name: sh.file,
      text: sheetFile(d, sh.sheet, names, { project: name, root, path: i ? `/${root}/${sh.uuid}` : `/${root}`, uuid: sh.uuid, global, subs }),
    });
  });
  if (global) notes.push("Labels went across as global labels, so nets with one name still join between sheets.");

  const nl = netlist(d);
  if (d.board) {
    files.push({ name: `${name}.kicad_pcb`, text: boardFile(d, d.board, names, nl, { paths }, notes) });
    const holes = new Map<string, FootprintDef>();
    for (const h of d.board.holes) {
      const size = h.pad ?? h.drill;
      holes.set(`Hole_${kicadName(n(h.drill))}mm${h.pad ? "_Pad" : ""}`, {
        name: "Hole",
        pads: [{ number: h.pad ? "1" : "", kind: h.pad ? "thru" : "npth", shape: "circle", x: 0, y: 0, w: size, h: size, drill: h.drill }],
        shapes: [],
      });
    }
    for (const [hole, fp] of holes) names.footprints.set(hole, { fp });
  }

  // The library: every symbol and footprint the design uses, with where each came from.
  const symbols: Node[] = ["kicad_symbol_lib", ["version", "20220914"], ["generator", "bettercad"]];
  const seen = new Set<string>();
  const credits: string[] = [];
  for (const part of [...d.parts].sort((a, b) => byRef(a.ref, b.ref))) {
    const def = d.defs[part.def];
    if (!def) continue;
    const sym = symbolOf(d, part, names);
    if (seen.has(sym)) continue;
    seen.add(sym);
    const power = isPower(d, part);
    symbols.push(kicadSymbol(def, sym, sym, power ? { power: part.value } : { footprint: footprintOf(d, part, names) }));
    if (!power)
      credits.push(
        `- ${sym}: ${def.source ? `${def.source.library}, ${def.source.licence}${def.source.url ? `, ${def.source.url}` : ""}` : "drawn in this design"}`,
      );
  }
  files.push({ name: `${name}.kicad_sym`, text: `${writeSexpr(symbols)}\n` });
  for (const [fp, v] of [...names.footprints.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    files.push({ name: `${name}.pretty/${fp}.kicad_mod`, text: kicadFootprint(v.fp, fp, v.credit) });

  const table = (kind: string, uri: string) =>
    `${writeSexpr([kind, ["lib", ["name", s(name)], ["type", s("KiCad")], ["uri", s(uri)], ["options", s("")], ["descr", s("The parts of this design")]]])}\n`;
  files.push({ name: "sym-lib-table", text: table("sym_lib_table", `\${KIPRJMOD}/${name}.kicad_sym`) });
  files.push({ name: "fp-lib-table", text: table("fp_lib_table", `\${KIPRJMOD}/${name}.pretty`) });
  files.push({ name: `${name}.kicad_pro`, text: projectFile(name, sheets, d.board) });
  files.push({
    name: "CREDITS.md",
    text: `# Where the parts came from\n\nThe symbols and footprints in \`${name}.kicad_sym\` and \`${name}.pretty\` were written by BetterCad from this design.\n\n${credits.join("\n")}\n`,
  });
  return { files, notes };
}
