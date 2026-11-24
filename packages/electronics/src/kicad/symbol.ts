import type { Fill, P2, PinType, SymbolDef, SymbolPin } from "../model";
import { arcFrom3, child, children, flag, head, isList, num, parseSexpr, text, type Node } from "./sexpr";

/** One symbol from a KiCad library, with what its properties say about the part. */
export interface KicadSymbol {
  name: string;
  symbol: SymbolDef;
  /** Reference prefix: R, U, J. Power symbols have "#PWR". */
  prefix: string;
  value: string;
  /** "Resistor_SMD:R_0603_1608Metric", when the symbol names one. */
  footprint?: string;
  /** Footprint name patterns that fit ("R_*"). */
  footprintFilters: string[];
  datasheet?: string;
  description?: string;
  keywords: string[];
}

const PIN_TYPES: Record<string, PinType> = {
  input: "input",
  output: "output",
  bidirectional: "bidirectional",
  tri_state: "tristate",
  passive: "passive",
  free: "unspecified",
  unspecified: "unspecified",
  power_in: "power_in",
  power_out: "power_out",
  open_collector: "open_collector",
  open_emitter: "open_emitter",
  no_connect: "no_connect",
};

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
const xy = (n: Node[] | undefined): P2 => [num(n, 1), num(n, 2)];

function fillOf(n: Node[]): Fill {
  const t = text(child(child(n, "fill"), "type"));
  return t === "outline" ? "solid" : t === "background";
}
const widthOf = (n: Node[]): number | undefined => {
  const w = num(child(child(n, "stroke"), "width"));
  return w > 0 ? w : undefined;
};

/** A cubic Bézier as a run of points. */
function bezier(p: P2[], steps = 12): P2[] {
  if (p.length !== 4) return p;
  const out: P2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    out.push([
      r4(w[0]! * p[0]![0] + w[1]! * p[1]![0] + w[2]! * p[2]![0] + w[3]! * p[3]![0]),
      r4(w[0]! * p[0]![1] + w[1]! * p[1]![1] + w[2]! * p[2]![1] + w[3]! * p[3]![1]),
    ]);
  }
  return out;
}

/** The drawing and pins of one `(symbol "R_1_1" …)` block. `unit` 0 is on every unit. */
function graphics(block: Node[], unit: number): { shapes: SymbolDef["shapes"]; pins: SymbolPin[] } {
  const shapes: SymbolDef["shapes"] = [];
  const pins: SymbolPin[] = [];
  const u = unit > 0 ? { unit } : {};
  for (const item of block) {
    if (!isList(item)) continue;
    const kind = head(item);
    const width = widthOf(item);
    const w = width ? { width } : {};
    if (kind === "rectangle") {
      const [x1, y1] = xy(child(item, "start"));
      const [x2, y2] = xy(child(item, "end"));
      shapes.push({ kind: "rect", x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), fill: fillOf(item), ...w, ...u });
    } else if (kind === "polyline" || kind === "bezier") {
      const raw = children(child(item, "pts"), "xy").map(xy);
      const pts = kind === "bezier" ? bezier(raw) : raw;
      const fill = fillOf(item);
      if (pts.length > 1) shapes.push({ kind: "line", pts, ...(fill ? { fill } : {}), ...w, ...u });
    } else if (kind === "circle") {
      const [cx, cy] = xy(child(item, "center"));
      const fill = fillOf(item);
      shapes.push({ kind: "circle", cx, cy, r: num(child(item, "radius")), ...(fill ? { fill } : {}), ...w, ...u });
    } else if (kind === "arc") {
      const arc = arcFrom3(xy(child(item, "start")), xy(child(item, "mid")), xy(child(item, "end")));
      if (arc) shapes.push({ kind: "arc", ...arc, ...w, ...u });
    } else if (kind === "text") {
      const at = child(item, "at");
      const size = num(child(child(child(item, "effects"), "font"), "size"), 1, 1.27);
      shapes.push({ kind: "text", x: num(at, 1), y: num(at, 2), text: text(item), size, align: "centre", ...u });
    } else if (kind === "pin") {
      const at = child(item, "at");
      const angle = (((Math.round(num(at, 3) / 90) * 90) % 360) + 360) % 360;
      const name = text(child(item, "name"));
      pins.push({
        number: text(child(item, "number")),
        name: name === "~" ? "" : name,
        type: PIN_TYPES[text(item, 1)] ?? "unspecified",
        x: num(at, 1),
        y: num(at, 2),
        length: num(child(item, "length")),
        dir: angle as SymbolPin["dir"],
        ...(flag(item, "hide") ? { hidden: true } : {}),
        ...u,
      });
    }
  }
  return { shapes, pins };
}

function property(sym: Node[], name: string): Node[] | undefined {
  return children(sym, "property").find((p) => text(p) === name);
}

/**
 * Reads a `.kicad_sym` library (#623). KiCad draws symbols y up on a 1.27 mm grid, as we do, so the numbers carry
 * over. Only the normal body style is kept (not the De Morgan one), and a symbol that `extends` another is the
 * parent's drawing with its own name and properties.
 */
export function readKicadSymbols(source: string): KicadSymbol[] {
  const lib = parseSexpr(source).find((n) => head(n) === "kicad_symbol_lib");
  if (!isList(lib)) throw new Error("This is not a KiCad symbol library (.kicad_sym).");
  return symbolsIn(lib);
}

/** The symbols a list holds: a library, or the copies a schematic keeps of the symbols it draws (`lib_symbols`). */
export function symbolsIn(lib: Node[]): KicadSymbol[] {
  const blocks = new Map(children(lib, "symbol").map((s) => [text(s), s]));
  const out: KicadSymbol[] = [];
  for (const [name, sym] of blocks) {
    // Follow `extends` to the symbol that holds the drawing.
    let base = sym;
    for (let hops = 0; hops < 8; hops += 1) {
      const parent = blocks.get(text(child(base, "extends")));
      if (!parent) break;
      base = parent;
    }
    const shapes: SymbolDef["shapes"] = [];
    const pins: SymbolPin[] = [];
    let units = 1;
    for (const sub of children(base, "symbol")) {
      const m = /_(\d+)_(\d+)$/.exec(text(sub));
      const unit = m ? Number(m[1]) : 0;
      const style = m ? Number(m[2]) : 1;
      if (style > 1) continue;
      units = Math.max(units, unit);
      const g = graphics(sub, unit);
      shapes.push(...g.shapes);
      pins.push(...g.pins);
    }
    // One unit: nothing needs saying about which unit a line or pin is on.
    if (units === 1) for (const x of [...shapes, ...pins]) delete x.unit;
    const at = (p: Node[] | undefined): P2 | undefined => {
      const a = child(p, "at");
      return a && !flag(child(p, "effects"), "hide") ? [num(a, 1), num(a, 2)] : undefined;
    };
    const ref = property(sym, "Reference") ?? property(base, "Reference");
    const value = property(sym, "Value") ?? property(base, "Value");
    const power = child(base, "power") !== undefined || text(ref).startsWith("#");
    const footprint = text(property(sym, "Footprint"), 2);
    const datasheet = text(property(sym, "Datasheet"), 2);
    const description = text(property(sym, "Description"), 2) || text(property(sym, "ki_description"), 2);
    let refAt = at(ref);
    let valueAt = at(value);
    // KiCad writes these two up the side of an upright part (a resistor). Ours always read left to right, so they
    // would land on top of each other: they go one above the other, to the right of the body.
    if ((refAt && num(child(ref, "at"), 3) === 90) || (valueAt && num(child(value, "at"), 3) === 90)) {
      let right = 0;
      for (const sh of shapes) {
        if (sh.kind === "rect") right = Math.max(right, sh.x1, sh.x2);
        else if (sh.kind === "line") right = Math.max(right, ...sh.pts.map((q) => q[0]));
        else if (sh.kind === "circle" || sh.kind === "arc") right = Math.max(right, sh.cx + sh.r);
      }
      const x = Math.round((right + 1) * 1000) / 1000;
      if (refAt) refAt = [x, 1.27];
      if (valueAt) valueAt = [x, -1.27];
    }
    out.push({
      name,
      symbol: { name, units, shapes, pins, ...(refAt ? { refAt } : {}), ...(valueAt ? { valueAt } : {}), ...(power ? { power: true } : {}) },
      prefix: text(ref, 2) || "U",
      value: text(value, 2) || name,
      ...(footprint ? { footprint } : {}),
      footprintFilters: text(property(sym, "ki_fp_filters"), 2).split(/\s+/).filter(Boolean),
      ...(datasheet && datasheet !== "~" ? { datasheet } : {}),
      ...(description ? { description } : {}),
      keywords: text(property(sym, "ki_keywords"), 2).split(/\s+/).filter(Boolean),
    });
  }
  return out;
}
