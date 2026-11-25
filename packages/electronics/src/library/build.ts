import { readKicadFootprint } from "../kicad/footprint";
import { readKicadSymbols, type KicadSymbol } from "../kicad/symbol";
import type { CatalogueBody, ComponentDef, Model3D } from "../model";
import { simpleBody } from "./body";
import { BREAKOUTS, breakout } from "./modules";
import { checkPinMap, packOf, type LibraryPack, type PackPart } from "./pack";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** What the starter library is made from (#624): `library/starter.manifest.json`. */
export interface Manifest {
  /** The KiCad library release the parts are read from. */
  kicad: string;
  parts: ManifestPart[];
}

export interface ManifestPart {
  id: string;
  category: string;
  /** "Device:R" from the KiCad symbol libraries, or "module:hc-sr04" for one we draw. */
  symbol: string;
  name?: string;
  value?: string;
  description?: string;
  /** "Resistor_SMD:R_0603_1608Metric"; the first is the package a new part gets. None: the symbol's own. */
  footprints?: string[];
  /** Pin to pads, where a footprint numbers its pads differently, by footprint. */
  pinMap?: Record<string, Record<string, string[]>>;
  keywords?: string[];
  /**
   * A body from the robot parts catalogue (#167), so the board and the mechanical model show the same part: the
   * catalogue part's id, and how it is turned (degrees about X, Y, Z) to lie on the footprint.
   */
  body?: { catalogue: string; rotate?: [number, number, number] };
  /** Makes one part per number: `{n}` and `{nn}` (two digits) are filled in everywhere. */
  repeat?: { from: number; to: number };
}

export interface Sources {
  symbols(library: string): string | undefined;
  footprint(library: string, name: string): string | undefined;
  /**
   * A robot catalogue part turned as asked: its record, and the box round it once turned, as its middle across the
   * board and its lowest and highest points. Left out, parts keep their simple bodies.
   */
  catalogue?(
    id: string,
    rotate: [number, number, number],
  ): { part: CatalogueBody; centre: [number, number]; size: [number, number, number]; bottom: number } | undefined;
}

const fill = (text: string, n: number) => text.replace(/\{nn\}/g, String(n).padStart(2, "0")).replace(/\{n\}/g, String(n));

/** A footprint's name as a short label: "0603", "SOT-23", "Pin header 1x04". */
export function packageLabel(key: string): string {
  const name = key.split(":").pop() ?? key;
  const chip = /_(0201|0402|0603|0805|1206|1210|2010|2512)_\d+Metric/.exec(name);
  if (chip) return chip[1]!;
  const known =
    /^(SOT-\d+(?:-\d)?|SOIC-\d+W?|TSSOP-\d+|SSOP-\d+|MSOP-\d+|DIP-\d+|TO-\d+(?:-\d)?|QFN-\d+|DFN-\d+|LGA-\d+|TSOT-\d+-\d|HTSSOP-\d+|VSSOP-\d+|SOP-\d+)/.exec(
      name,
    );
  if (known) return known[1]!;
  return name
    .replace(/_P[\d.]+mm.*$/, "")
    .replace(/_/g, " ")
    .trim();
}

/** Expands the manifest's `repeat` entries. */
export function expand(parts: ManifestPart[]): ManifestPart[] {
  return parts.flatMap((p) => {
    if (!p.repeat) return [p];
    const out: ManifestPart[] = [];
    for (let n = p.repeat.from; n <= p.repeat.to; n += 1) {
      const one = { ...p };
      delete one.repeat;
      out.push(JSON.parse(fill(JSON.stringify(one), n)) as ManifestPart);
    }
    return out;
  });
}

/**
 * Builds a pack from a manifest and the library files. Nothing is guessed: a symbol or footprint that is not found,
 * or a pin with no pad, is reported and the part is left out, so the pack only holds parts that are whole.
 */
export function buildPack(manifest: Manifest, src: Sources): { pack: LibraryPack; problems: string[] } {
  const problems: string[] = [];
  const libs = new Map<string, Map<string, KicadSymbol> | null>();
  const symbolOf = (key: string): KicadSymbol | undefined => {
    const [lib, name] = key.split(":") as [string, string];
    if (!libs.has(lib)) {
      const text = src.symbols(lib);
      libs.set(lib, text ? new Map(readKicadSymbols(text).map((s) => [s.name, s])) : null);
    }
    return libs.get(lib)?.get(name);
  };
  const made: Parameters<typeof packOf>[3] = [];
  for (const m of expand(manifest.parts)) {
    let def: ComponentDef;
    let from = 0;
    let labels: string[] | undefined;
    if (m.symbol.startsWith("module:")) {
      const b = BREAKOUTS[m.symbol.slice(7)];
      if (!b) {
        problems.push(`${m.id}: no module called ${m.symbol}`);
        continue;
      }
      def = breakout(b);
      from = 1;
    } else {
      const sym = symbolOf(m.symbol);
      if (!sym) {
        problems.push(`${m.id}: symbol ${m.symbol} not found`);
        continue;
      }
      const keys = m.footprints ?? (sym.footprint ? [sym.footprint] : []);
      const packages: ComponentDef["packages"] = [];
      labels = [];
      for (const key of keys) {
        const [lib, name] = key.split(":") as [string, string];
        const text = src.footprint(lib, name);
        if (!text) {
          problems.push(`${m.id}: footprint ${key} not found`);
          continue;
        }
        const fp = readKicadFootprint(text);
        const model = simpleBody(key, fp.footprint);
        const pinMap = m.pinMap?.[key];
        packages.push({ footprint: fp.footprint, ...(pinMap ? { pinMap } : {}), ...(model ? { model } : {}) });
        labels.push(packageLabel(key));
      }
      if (!sym.symbol.power && packages.length === 0) {
        problems.push(`${m.id}: no footprint`);
        continue;
      }
      def = {
        name: m.name ?? sym.name.replace(/_/g, " "),
        ...(m.description || sym.description ? { description: m.description ?? sym.description } : {}),
        prefix: sym.prefix,
        value: m.value ?? sym.value,
        symbol: sym.symbol,
        packages,
        keywords: [...new Set([...(m.keywords ?? []), ...sym.keywords.map((k) => k.toLowerCase())])],
        ...(sym.datasheet ? { datasheet: sym.datasheet } : {}),
      };
    }
    const bad = checkPinMap(def);
    if (bad.length) {
      problems.push(
        ...bad.map((b) => `${m.id}: in ${b.package}, no pad for ${b.missing.length > 6 ? `${b.missing.length} pins` : `pin ${b.missing.join(", ")}`}`),
      );
      const keep = def.packages.map((p) => !bad.some((b) => b.package === p.footprint.name));
      def = { ...def, packages: def.packages.filter((_, i) => keep[i]) };
      if (labels) labels = labels.filter((_, i) => keep[i]);
      if (def.packages.length === 0) continue;
    }
    // A part with two ends that do the same job can have them swapped on the board (#645).
    const ends = def.symbol.pins;
    if (ends.length === 2 && ends.every((p) => p.type === "passive") && /^(R|L|FB|F)$/.test(def.prefix) && !/pot|trim|varist|therm/i.test(def.name))
      def = { ...def, symbol: { ...def.symbol, pins: ends.map((p) => ({ ...p, swap: "ends" })) } };
    else if (ends.length === 2 && ends.every((p) => p.type === "passive") && def.prefix === "C" && !/polar|electro|tant/i.test(`${def.name} ${m.symbol}`))
      def = { ...def, symbol: { ...def.symbol, pins: ends.map((p) => ({ ...p, swap: "ends" })) } };
    if (m.body && src.catalogue) {
      const rotate = m.body.rotate ?? [0, 0, 0];
      const found = src.catalogue(m.body.catalogue, rotate);
      if (!found) problems.push(`${m.id}: no robot catalogue part called ${m.body.catalogue}`);
      else
        def = {
          ...def,
          packages: def.packages.map((p) => {
            // Its box goes where the simple body's was, standing on the board.
            const [x, y] = p.model?.offset ?? [0, 0];
            const model: Model3D = {
              source: { kind: "catalogue", part: found.part, size: found.size },
              offset: [r2(x - found.centre[0]), r2(y - found.centre[1]), r2(-found.bottom)],
              ...(rotate.some(Boolean) ? { rotate } : {}),
            };
            return { ...p, model };
          }),
        };
    }
    const part: Omit<PackPart, "symbol" | "packages"> & { def: ComponentDef; labels?: string[] } = {
      id: m.id,
      name: def.name,
      category: m.category,
      ...(def.description ? { description: def.description } : {}),
      prefix: def.prefix,
      ...(def.value ? { value: def.value } : {}),
      ...(def.keywords?.length ? { keywords: def.keywords } : {}),
      ...(def.datasheet ? { datasheet: def.datasheet } : {}),
      from,
      def,
      ...(labels ? { labels } : {}),
    };
    made.push(part);
  }
  const pack = packOf(
    "BetterCad starter library",
    "CC-BY-SA 4.0, with the KiCad libraries' exception: the boards you make with these parts are yours.",
    [
      {
        name: "KiCad libraries",
        licence: "CC-BY-SA 4.0 with exception",
        url: "https://www.kicad.org/libraries/license/",
        version: manifest.kicad,
        note: "Symbols and footprints by the KiCad librarians and contributors, converted to BetterCad's format. The 3D bodies are simple shapes made by BetterCad, or parts from its robot parts catalogue (MIT).",
      },
      { name: "BetterCad", licence: "CC-BY-SA 4.0", url: "https://bettercad.kevsrobots.com", note: "Modules drawn for BetterCad. Their outlines are guides." },
    ],
    made,
  );
  return { pack, problems };
}
