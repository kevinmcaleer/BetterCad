import type { ComponentDef, FootprintDef, Model3D, SymbolDef } from "../model";

/**
 * A library pack (#621, #624): many components in one file, with the symbols and footprints they share kept once.
 * The starter library is one; a library you import or save is another. A pack is data only, so it can sit on a
 * server, in a file or in the browser's storage, and a design copies out of it what it uses.
 */
export interface LibraryPack {
  /** The pack format. */
  pack: 1;
  name: string;
  /** Where the parts came from and what that asks of anyone who passes the pack on. */
  licence: string;
  /** Shown in Help, About and written into any exported copy. */
  credits: { name: string; licence: string; url: string; version?: string; note?: string }[];
  symbols: Record<string, SymbolDef>;
  footprints: Record<string, FootprintDef>;
  parts: PackPart[];
}

export interface PackPart {
  id: string;
  name: string;
  /** The shelf it sits on in the Components panel: "Passives", "Connectors". */
  category: string;
  description?: string;
  prefix: string;
  value?: string;
  symbol: string;
  packages: { footprint: string; label?: string; pinMap?: Record<string, string[]>; model?: Model3D }[];
  keywords?: string[];
  datasheet?: string;
  supplier?: ComponentDef["supplier"];
  /** Index into `credits`. */
  from: number;
}

/** One part of a pack as a whole component, ready to place. */
export function inflate(pack: LibraryPack, part: PackPart): ComponentDef {
  const credit = pack.credits[part.from];
  return {
    name: part.name,
    ...(part.description ? { description: part.description } : {}),
    prefix: part.prefix,
    ...(part.value ? { value: part.value } : {}),
    symbol: pack.symbols[part.symbol]!,
    packages: part.packages.flatMap((p) => {
      const footprint = pack.footprints[p.footprint];
      return footprint ? [{ footprint, ...(p.pinMap ? { pinMap: p.pinMap } : {}), ...(p.model ? { model: p.model } : {}) }] : [];
    }),
    ...(part.keywords?.length ? { keywords: part.keywords } : {}),
    ...(part.datasheet ? { datasheet: part.datasheet } : {}),
    ...(part.supplier ? { supplier: part.supplier } : {}),
    ...(credit ? { source: { library: credit.name + (credit.version ? ` ${credit.version}` : ""), licence: credit.licence, url: credit.url } } : {}),
  };
}

/** Puts components into a pack, sharing symbols and footprints that are the same. */
export function packOf(
  name: string,
  licence: string,
  credits: LibraryPack["credits"],
  parts: (Omit<PackPart, "symbol" | "packages"> & { def: ComponentDef; labels?: string[] })[],
): LibraryPack {
  const pack: LibraryPack = { pack: 1, name, licence, credits, symbols: {}, footprints: {}, parts: [] };
  const keyOf = <T extends { name: string }>(shelf: Record<string, T>, item: T): string => {
    const text = JSON.stringify(item);
    for (let i = 0; ; i += 1) {
      const key = i ? `${item.name}#${i}` : item.name;
      if (!shelf[key]) shelf[key] = item;
      if (JSON.stringify(shelf[key]) === text) return key;
    }
  };
  for (const { def, labels, ...rest } of parts)
    pack.parts.push({
      ...rest,
      symbol: keyOf(pack.symbols, def.symbol),
      packages: def.packages.map((p, i) => ({
        footprint: keyOf(pack.footprints, p.footprint),
        ...(labels?.[i] ? { label: labels[i] } : {}),
        ...(p.pinMap ? { pinMap: p.pinMap } : {}),
        ...(p.model ? { model: p.model } : {}),
      })),
    });
  return pack;
}

export interface PinMapProblem {
  package: string;
  /** Pins with no pad to land on. */
  missing: string[];
}

/**
 * The pin map check (#622): in every package, each pin that shows on the symbol has a pad. Pads no pin uses are fine
 * (mounting tabs, shields); a pin with nowhere to go is not.
 */
export function checkPinMap(def: ComponentDef): PinMapProblem[] {
  if (def.symbol.power) return [];
  const out: PinMapProblem[] = [];
  for (const p of def.packages) {
    const pads = new Set(p.footprint.pads.map((x) => x.number));
    const missing = [...new Set(def.symbol.pins.filter((pin) => pin.type !== "no_connect").map((pin) => pin.number))].filter((n) => {
      const to = p.pinMap?.[n] ?? [n];
      return !to.some((x) => pads.has(x));
    });
    if (missing.length) out.push({ package: p.footprint.name, missing });
  }
  return out;
}

/** Words a part answers to, lower case: its name, value, description, keywords, packages and part numbers. */
export function searchText(part: PackPart): string {
  return [
    part.name,
    part.value,
    part.description,
    part.category,
    ...(part.keywords ?? []),
    ...part.packages.map((p) => p.label ?? p.footprint),
    part.supplier?.lcsc,
    part.supplier?.mpn,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Parts that match every word typed, best first: a name that starts with the words beats one that only mentions them. */
export function searchPack(pack: LibraryPack, query: string, category?: string): PackPart[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: [number, number, PackPart][] = [];
  pack.parts.forEach((part, i) => {
    if (category && part.category !== category) return;
    const hay = searchText(part);
    if (!words.every((w) => hay.includes(w))) return;
    const name = part.name.toLowerCase();
    const score = words.length === 0 ? 0 : name === words.join(" ") ? 3 : name.startsWith(words[0]!) ? 2 : words.some((w) => name.includes(w)) ? 1 : 0;
    scored.push([score, i, part]);
  });
  return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((s) => s[2]);
}

export const categoriesOf = (pack: LibraryPack): string[] => [...new Set(pack.parts.map((p) => p.category))];
