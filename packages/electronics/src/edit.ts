import { eid, isPower, type ComponentDef, type ElectronicsDesign, type Id, type Part, type Rot, type SchSymbol } from "./model";

/**
 * Edits to a design. Each returns a new design and leaves the old one alone, so the history store can keep both.
 */

/** The next free reference for a prefix: R1, R2… Gaps are filled, so deleting R2 gives the next resistor R2. */
export function nextRef(d: ElectronicsDesign, prefix: string): string {
  const used = new Set(d.parts.map((p) => p.ref));
  for (let n = 1; ; n += 1) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** A stable key for a component, so placing the same one twice keeps one copy in the design. */
export function defKey(def: ComponentDef): string {
  const text = JSON.stringify(def);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${
    def.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "part"
  }-${(h >>> 0).toString(36)}`;
}

export interface Placed {
  design: ElectronicsDesign;
  part: Part;
  symbol: SchSymbol;
}

/** Places a new part on a sheet. The component is copied into the design the first time it is used. */
export function placePart(
  d: ElectronicsDesign,
  sheet: Id,
  def: ComponentDef,
  at: { x: number; y: number; rot?: Rot; mirror?: boolean },
  opts: { value?: string } = {},
): Placed {
  const k = defKey(def);
  const part: Part = { id: eid("pt"), def: k, ref: nextRef(d, def.prefix), value: opts.value ?? def.value ?? def.name, pkg: 0 };
  const symbol: SchSymbol = { id: eid("sy"), part: part.id, unit: 1, x: at.x, y: at.y, rot: at.rot ?? 0, ...(at.mirror ? { mirror: true } : {}) };
  const design: ElectronicsDesign = {
    ...d,
    defs: d.defs[k] ? d.defs : { ...d.defs, [k]: def },
    parts: [...d.parts, part],
    sheets: d.sheets.map((s) => (s.id === sheet ? { ...s, symbols: [...s.symbols, symbol] } : s)),
  };
  return { design, part, symbol };
}

/** Removes parts, with their symbols. The board keeps its footprints until the next push lists them. */
export function removeParts(d: ElectronicsDesign, ids: Id[]): ElectronicsDesign {
  const gone = new Set(ids);
  const parts = d.parts.filter((p) => !gone.has(p.id));
  const used = new Set(parts.map((p) => p.def));
  return {
    ...d,
    parts,
    defs: Object.fromEntries(Object.entries(d.defs).filter(([k]) => used.has(k))),
    sheets: d.sheets.map((s) => ({ ...s, symbols: s.symbols.filter((y) => !gone.has(y.part)) })),
  };
}

export function addWire(d: ElectronicsDesign, sheet: Id, a: [number, number], b: [number, number]): ElectronicsDesign {
  if (a[0] === b[0] && a[1] === b[1]) return d;
  return { ...d, sheets: d.sheets.map((s) => (s.id === sheet ? { ...s, wires: [...s.wires, { id: eid("w"), a, b }] } : s)) };
}

export function addLabel(d: ElectronicsDesign, sheet: Id, name: string, x: number, y: number): ElectronicsDesign {
  return { ...d, sheets: d.sheets.map((s) => (s.id === sheet ? { ...s, labels: [...s.labels, { id: eid("lb"), name, x, y }] } : s)) };
}

/** Real parts, power symbols left out. */
export const realParts = (d: ElectronicsDesign): Part[] => d.parts.filter((p) => !isPower(d, p));
