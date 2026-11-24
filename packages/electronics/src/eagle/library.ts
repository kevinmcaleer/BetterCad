import type { ComponentDef, Fill, FootprintDef, FootprintLayer, P2, Pad, PinType, Shape, SymbolDef, SymbolPin } from "../model";
import { kid, kids, numOf, type El } from "./xml";

/**
 * Eagle's libraries (#665): packages as footprints, symbols, and device sets as components. A schematic and a board
 * each carry the libraries they use in the same form, so the project reader uses this too. Eagle 6 and later write
 * these files as XML, in millimetres, y up, angles anticlockwise, which is how a design is kept here.
 */

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
const norm = (deg: number) => (((Math.round(deg * 1e4) / 1e4) % 360) + 360) % 360;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Eagle's turn: "R90", "MR180" (mirrored), "SR270" (text kept the way it reads). */
export function rotOf(s: string | undefined): { deg: number; mirror: boolean } {
  const m = /^(S?)(M?)(S?)R(-?[\d.]+)$/.exec(s ?? "");
  return { deg: m ? norm(Number(m[4])) : 0, mirror: !!m?.[2] };
}

/** A length that may carry a unit, as the design rules do: "8mil", "0.2mm". Millimetres come back. */
export function lengthOf(s: string | undefined, or = 0): number {
  const m = /^(-?[\d.]+)\s*(mm|mil|mic|inch|in)?$/.exec((s ?? "").trim());
  if (!m) return or;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return or;
  return r4(m[2] === "mil" ? v * 0.0254 : m[2] === "mic" ? v / 1000 : m[2] === "inch" || m[2] === "in" ? v * 25.4 : v);
}

/** How wide the copper ring round a hole is when a pad or via does not say: a share of the drill, within limits. */
export interface Restring {
  pad: { share: number; min: number; max: number };
  via: { share: number; min: number; max: number };
}
/** Eagle's own defaults: a quarter of the drill, 10 to 20 mil for pads and 8 to 20 mil for vias. */
export const RESTRING: Restring = { pad: { share: 0.25, min: 0.254, max: 0.508 }, via: { share: 0.25, min: 0.2032, max: 0.508 } };
export const ringed = (drill: number, r: Restring["pad"]): number => r4(drill + 2 * Math.min(r.max, Math.max(r.min, drill * r.share)));

/** The arc a curved line makes: from `a` to `b`, sweeping `curve` degrees, anticlockwise when positive. */
export function arcOf(a: P2, b: P2, curve: number): { cx: number; cy: number; r: number; a0: number; a1: number } | null {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d < 1e-9 || Math.abs(curve) < 1e-6 || Math.abs(curve) >= 360) return null;
  const h = d / 2 / Math.tan(rad(curve) / 2);
  const cx = (a[0] + b[0]) / 2 - ((b[1] - a[1]) / d) * h;
  const cy = (a[1] + b[1]) / 2 + ((b[0] - a[0]) / d) * h;
  const from = curve > 0 ? a : b;
  const a0 = norm((Math.atan2(from[1] - cy, from[0] - cx) * 180) / Math.PI);
  return { cx: r4(cx), cy: r4(cy), r: r4(d / 2 / Math.abs(Math.sin(rad(curve) / 2))), a0: r4(a0), a1: r4(a0 + Math.abs(curve)) };
}

/** A curved line as short straight pieces that stay within `within` of the curve: the points after `a`, ending at `b`. */
export function chordsOf(a: P2, b: P2, curve: number, within = 0.0005): P2[] {
  const arc = arcOf(a, b, curve);
  if (!arc) return [b];
  const step = (360 / Math.PI) * Math.acos(Math.max(0, 1 - within / Math.max(arc.r, 0.01)));
  const n = Math.max(2, Math.ceil(Math.abs(curve) / step));
  const start = Math.atan2(a[1] - arc.cy, a[0] - arc.cx);
  const out: P2[] = [];
  for (let i = 1; i < n; i += 1) {
    const t = start + (rad(curve) * i) / n;
    out.push([r4(arc.cx + arc.r * Math.cos(t)), r4(arc.cy + arc.r * Math.sin(t))]);
  }
  out.push(b);
  return out;
}

/** The corners of a polygon, with its curved edges as short straight pieces. */
export function vertices(el: El, within = 0.01): P2[] {
  const v = kids(el, "vertex");
  const out: P2[] = [];
  v.forEach((p, i) => {
    const a: P2 = [numOf(p, "x"), numOf(p, "y")];
    const next = v[(i + 1) % v.length]!;
    const b: P2 = [numOf(next, "x"), numOf(next, "y")];
    out.push(a);
    const curve = numOf(p, "curve");
    if (curve) out.push(...chordsOf(a, b, curve, within).slice(0, -1));
  });
  return out;
}

/** A drawn thing as a shape of ours. Text that stands for the name or value is not a shape and gives null. */
export function shapeOf(el: El, solid: Fill): Shape | null {
  const width = numOf(el, "width") > 0 ? { width: numOf(el, "width") } : {};
  if (el.tag === "wire") {
    const a: P2 = [numOf(el, "x1"), numOf(el, "y1")];
    const b: P2 = [numOf(el, "x2"), numOf(el, "y2")];
    const arc = arcOf(a, b, numOf(el, "curve"));
    return arc ? { kind: "arc", ...arc, ...width } : { kind: "line", pts: [a, b], ...width };
  }
  if (el.tag === "circle") {
    const r = numOf(el, "radius");
    return { kind: "circle", cx: numOf(el, "x"), cy: numOf(el, "y"), r, ...(numOf(el, "width") > 0 ? width : { fill: solid }) };
  }
  if (el.tag === "rectangle") {
    const [x1, y1, x2, y2] = [numOf(el, "x1"), numOf(el, "y1"), numOf(el, "x2"), numOf(el, "y2")];
    const turn = rotOf(el.attrs.rot).deg;
    if (turn % 180 === 0) return { kind: "rect", x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), fill: solid };
    // Turned about its middle.
    const [cx, cy] = [(x1 + x2) / 2, (y1 + y2) / 2];
    const c = Math.cos(rad(turn));
    const s = Math.sin(rad(turn));
    const pts = (
      [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
      ] as P2[]
    ).map((p): P2 => [r4(cx + (p[0] - cx) * c - (p[1] - cy) * s), r4(cy + (p[0] - cx) * s + (p[1] - cy) * c)]);
    return { kind: "line", pts: [...pts, pts[0]!], fill: solid };
  }
  if (el.tag === "polygon") {
    const pts = vertices(el);
    return pts.length > 2 ? { kind: "line", pts: [...pts, pts[0]!], ...width, fill: solid } : null;
  }
  if (el.tag === "text") {
    const words = el.text.trim();
    if (!words || words.startsWith(">")) return null;
    const turn = rotOf(el.attrs.rot).deg;
    const align = el.attrs.align ?? "bottom-left";
    return {
      kind: "text",
      x: numOf(el, "x"),
      y: numOf(el, "y"),
      text: words,
      size: numOf(el, "size", 1.27),
      ...(turn ? { angle: turn } : {}),
      ...(align.includes("right") ? { align: "right" as const } : align.includes("center") ? { align: "centre" as const } : {}),
    };
  }
  return null;
}

// ---------------------------------------------------------------- packages

export interface EaglePackage {
  footprint: FootprintDef;
  description?: string;
  /** Drawings on layers that are not kept. */
  skipped: number;
  /** Pads whose copper sits off the middle of the hole. */
  offset: number;
  /** It draws on the board's edge or milling layer. */
  edge: boolean;
}

/** Eagle's layers of a package that have a place here. Everything is drawn for the top; the bottom's are the far side. */
const PACKAGE_LAYERS: Record<string, FootprintLayer> = { "1": "copper", "21": "silk", "25": "silk", "51": "fab", "39": "courtyard" };

/** A line of plain text from Eagle's descriptions, which are a little HTML. */
export const plainText = (html: string | undefined): string =>
  (html ?? "")
    .replace(/<br\s*\/?>|<\/p>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) ?? "";

/** A package as a footprint. */
export function packageIn(el: El, restring: Restring = RESTRING): EaglePackage {
  const fp: FootprintDef = { name: el.attrs.name ?? "Package", pads: [], shapes: [] };
  const out: EaglePackage = { footprint: fp, skipped: 0, offset: 0, edge: false };
  const about = plainText(kid(el, "description")?.text);
  if (about) out.description = about;
  for (const item of el.kids) {
    const turn = rotOf(item.attrs.rot).deg;
    const angle = turn % 180 ? { angle: turn } : {};
    if (item.tag === "smd") {
      const w = numOf(item, "dx");
      const h = numOf(item, "dy");
      const round = Math.min(100, Math.max(0, numOf(item, "roundness")));
      const pad: Pad = {
        number: item.attrs.name ?? "",
        kind: "smd",
        shape: round >= 100 ? (Math.abs(w - h) < 1e-6 ? "circle" : "oval") : round > 0 ? "roundrect" : "rect",
        x: numOf(item, "x"),
        y: numOf(item, "y"),
        w,
        h,
        // A turn of a right angle swaps the sides; anything else stays a turn.
        ...(turn % 180 ? { angle: turn } : {}),
        ...(round > 0 && round < 100 ? { round: r4(round / 200) } : {}),
        ...(item.attrs.cream === "no" ? { noPaste: true } : {}),
        ...(item.attrs.layer === "16" ? { back: true } : {}),
      };
      fp.pads.push(pad);
    } else if (item.tag === "pad") {
      const drill = numOf(item, "drill");
      const d = numOf(item, "diameter") || ringed(drill, restring.pad);
      const shape = item.attrs.shape ?? "round";
      const long = shape === "long" || shape === "offset";
      if (shape === "offset") out.offset += 1;
      fp.pads.push({
        number: item.attrs.name ?? "",
        kind: "thru",
        shape: shape === "square" ? "rect" : long ? "oval" : "circle",
        x: numOf(item, "x"),
        y: numOf(item, "y"),
        w: long ? r4(d * 2) : d,
        h: d,
        drill,
        ...(long || shape === "square" ? angle : {}),
      });
    } else if (item.tag === "hole") {
      const drill = numOf(item, "drill");
      fp.pads.push({ number: "", kind: "npth", shape: "circle", x: numOf(item, "x"), y: numOf(item, "y"), w: drill, h: drill, drill });
    } else if (item.tag === "description") {
      // Read above.
    } else if (item.attrs.layer !== undefined) {
      const layer = PACKAGE_LAYERS[item.attrs.layer];
      if (item.attrs.layer === "20" || item.attrs.layer === "46") out.edge = true;
      if (item.tag === "text" && item.text.trim().toUpperCase() === ">NAME") {
        fp.refAt = [numOf(item, "x"), numOf(item, "y")];
        continue;
      }
      if (item.tag === "text" && item.text.trim().startsWith(">")) continue;
      // Names and values have layers of their own, which hold only those two texts.
      if (!layer || item.attrs.layer === "25") {
        if (item.attrs.layer !== "27" && item.attrs.layer !== "25") out.skipped += 1;
        continue;
      }
      const shape = shapeOf(item, true);
      if (shape) fp.shapes.push({ ...shape, layer });
      else out.skipped += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------- symbols

export interface EagleSymbol {
  shapes: Shape[];
  pins: (Omit<SymbolPin, "number"> & { supply: boolean })[];
  refAt?: P2;
  valueAt?: P2;
  skipped: number;
}

const PIN_TYPES: Record<string, PinType> = {
  nc: "no_connect",
  in: "input",
  out: "output",
  io: "bidirectional",
  oc: "open_collector",
  pwr: "power_in",
  pas: "passive",
  hiz: "tristate",
  sup: "power_in",
};
const PIN_LENGTHS: Record<string, number> = { point: 0, short: 2.54, middle: 5.08, long: 7.62 };

/** A symbol: its drawing and its pins, by name. Which pad each pin joins is the device's business. */
export function symbolIn(el: El): EagleSymbol {
  const out: EagleSymbol = { shapes: [], pins: [], skipped: 0 };
  for (const item of el.kids) {
    if (item.tag === "pin") {
      const turn = rotOf(item.attrs.rot).deg;
      out.pins.push({
        name: item.attrs.name ?? "",
        type: PIN_TYPES[item.attrs.direction ?? "io"] ?? "unspecified",
        x: numOf(item, "x"),
        y: numOf(item, "y"),
        length: PIN_LENGTHS[item.attrs.length ?? "long"] ?? 7.62,
        dir: ((Math.round(turn / 90) * 90) % 360) as SymbolPin["dir"],
        supply: item.attrs.direction === "sup",
      });
    } else if (item.tag === "text" && item.text.trim().startsWith(">")) {
      const what = item.text.trim().toUpperCase();
      if (what === ">NAME") out.refAt = [numOf(item, "x"), numOf(item, "y")];
      else if (what === ">VALUE") out.valueAt = [numOf(item, "x"), numOf(item, "y")];
    } else if (item.tag !== "description") {
      const shape = shapeOf(item, "solid");
      if (shape) out.shapes.push(shape);
      else out.skipped += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------- libraries and device sets

export interface EagleLibrary {
  name: string;
  packages: Map<string, EaglePackage>;
  symbols: Map<string, EagleSymbol>;
  sets: Map<string, El>;
}

/** A library as it stands in a `.lbr`, a schematic or a board. A board's has only packages. */
export function libraryIn(el: El, restring: Restring = RESTRING, name = el.attrs.name ?? ""): EagleLibrary {
  return {
    name,
    packages: new Map(kids(kid(el, "packages"), "package").map((p) => [p.attrs.name ?? "", packageIn(p, restring)])),
    symbols: new Map(kids(kid(el, "symbols"), "symbol").map((s) => [s.attrs.name ?? "", symbolIn(s)])),
    sets: new Map(kids(kid(el, "devicesets"), "deviceset").map((d) => [d.attrs.name ?? "", d])),
  };
}

/** The name Eagle shows for a device: the set's name, with `*` for the technology and `?` for the variant. */
export function deviceName(set: string, device: string, technology: string): string {
  let name = set.includes("*") ? set.replace("*", technology) : set + technology;
  name = name.includes("?") ? name.replace("?", device) : name + device;
  return name;
}

export interface EagleComponent {
  def: ComponentDef;
  /** The gates in order: a gate's place here, plus one, is its unit. */
  gates: string[];
  /** A pin's number in the component, by gate and pin name (see `pinId`). */
  numbers: Map<string, string>;
  /** A supply symbol: no package, and every pin a supply pin. */
  supply: boolean;
  /** The device's name as Eagle writes it, which a part with no value of its own shows as its value. */
  shown: string;
  /** The value is the person's to give ("10k"), so a part with none has none. */
  userValue: boolean;
  /** Devices that named a package the library does not hold. */
  missing: string[];
}

export const pinId = (gate: string, pin: string): string => `${gate}\u0000${pin}`;

/**
 * A device set as a component. `devices` picks which of its devices become packages, in order; the first that has a
 * package gives the pins their numbers, and the others get a pin map. With none picked, every device is taken.
 * `footprint` can give a package from somewhere else (the board), by its name.
 */
export function componentOf(
  lib: EagleLibrary,
  setName: string,
  o: { devices?: string[]; technology?: string; footprint?: (name: string) => FootprintDef | undefined; licence: string; library?: string },
): EagleComponent | null {
  const set = lib.sets.get(setName);
  if (!set) return null;
  const gates = kids(kid(set, "gates"), "gate");
  const all = kids(kid(set, "devices"), "device");
  const picked = o.devices ? o.devices.flatMap((n) => all.filter((d) => (d.attrs.name ?? "") === n)) : all;
  const missing: string[] = [];
  const packaged = picked.flatMap((d) => {
    const name = d.attrs.package;
    if (!name) return [];
    const fp = o.footprint?.(name) ?? lib.packages.get(name)?.footprint;
    if (!fp) missing.push(name);
    return fp ? [{ device: d, fp }] : [];
  });
  const lead = packaged[0]?.device ?? picked[0];
  const padsOf = (device: El | undefined) =>
    new Map(
      kids(kid(device, "connects"), "connect").map((c) => [pinId(c.attrs.gate ?? "", c.attrs.pin ?? ""), (c.attrs.pad ?? "").split(/\s+/).filter(Boolean)]),
    );
  const leadPads = padsOf(lead);

  const symbol: SymbolDef = { name: setName, units: Math.max(1, gates.length), shapes: [], pins: [] };
  const numbers = new Map<string, string>();
  const used = new Set<string>([...leadPads.values()].flat());
  const many = gates.length > 1;
  let supplyPins = 0;
  gates.forEach((gate, i) => {
    const sym = lib.symbols.get(gate.attrs.symbol ?? "");
    if (!sym) return;
    const unit = many ? { unit: i + 1 } : {};
    for (const s of sym.shapes) symbol.shapes.push({ ...s, ...unit });
    if (i === 0) {
      if (sym.refAt) symbol.refAt = sym.refAt;
      if (sym.valueAt) symbol.valueAt = sym.valueAt;
    }
    for (const pin of sym.pins) {
      const id = pinId(gate.attrs.name ?? "", pin.name);
      let number = leadPads.get(id)?.[0];
      if (!number) {
        // No pad: the pin goes by its name, with its gate's when that is taken.
        const plain = pin.name.replace(/@.*$/, "") || "1";
        number =
          [pin.name, `${gate.attrs.name}.${pin.name}`, `${gate.attrs.name}.${pin.name}.${i}`].find((n) => n && !used.has(n)) ?? `${plain}.${numbers.size}`;
      }
      used.add(number);
      numbers.set(id, number);
      if (pin.supply) supplyPins += 1;
      // Eagle tells pins with one name apart with "@1", "@2", which it never shows.
      symbol.pins.push({
        name: pin.name.replace(/@.*$/, ""),
        number,
        type: pin.type,
        x: pin.x,
        y: pin.y,
        length: pin.length,
        dir: pin.dir,
        ...unit,
      });
    }
  });
  const supply = packaged.length === 0 && !picked.some((d) => d.attrs.package) && symbol.pins.length > 0 && supplyPins === symbol.pins.length;
  if (supply) symbol.power = true;

  const tech = o.technology ?? kid(kid(lead, "technologies"), "technology")?.attrs.name ?? "";
  const attrs = new Map(
    kids(kid(lead, "technologies"), "technology")
      .filter((t) => (t.attrs.name ?? "") === tech)
      .flatMap((t) => kids(t, "attribute"))
      .map((a) => [(a.attrs.name ?? "").toUpperCase(), a.attrs.value ?? ""]),
  );
  const supplier = {
    ...(attrs.get("MF") || attrs.get("MANUFACTURER") ? { manufacturer: attrs.get("MF") || attrs.get("MANUFACTURER")! } : {}),
    ...(attrs.get("MPN") || attrs.get("MFR_PN") ? { mpn: attrs.get("MPN") || attrs.get("MFR_PN")! } : {}),
    ...(/^C\d+$/.test(attrs.get("LCSC") ?? "") ? { lcsc: attrs.get("LCSC")! } : {}),
  };
  const shown = deviceName(setName, o.devices?.length === 1 ? (lead?.attrs.name ?? "") : "", o.devices?.length === 1 ? tech : "")
    .replace(/[*?]/g, "")
    .replace(/[-_.]+$/, "");
  const about = plainText(kid(set, "description")?.text);
  const def: ComponentDef = {
    name: shown.replace(/_/g, " ").trim() || setName,
    ...(about ? { description: about } : {}),
    prefix: supply ? "#PWR" : set.attrs.prefix || "U",
    value: shown.replace(/_/g, " ").trim() || setName,
    symbol,
    packages: packaged.map(({ device, fp }) => {
      const pads = padsOf(device);
      const pinMap: Record<string, string[]> = {};
      for (const [id, number] of numbers) {
        const to = pads.get(id);
        if (to?.length && (to.length > 1 || to[0] !== number)) pinMap[number] = to;
      }
      return { footprint: fp, ...(Object.keys(pinMap).length ? { pinMap } : {}) };
    }),
    ...(Object.keys(supplier).length ? { supplier } : {}),
    ...(supply ? {} : { source: { library: o.library ?? lib.name, licence: o.licence } }),
  };
  return { def, shown: shown || setName, userValue: set.attrs.uservalue === "yes", gates: gates.map((g) => g.attrs.name ?? ""), numbers, supply, missing };
}
