import { defKey } from "./edit";
import type { ComponentDef, ElectronicsDesign, Id, SymbolPin } from "./model";

/** The pins of a part that can change places (#645), as the component marks them: each list holds two or more. */
export function swapGroups(d: ElectronicsDesign, partId: Id): string[][] {
  const part = d.parts.find((p) => p.id === partId);
  const groups = new Map<string, string[]>();
  for (const pin of (part && d.defs[part.def]?.symbol.pins) ?? []) {
    if (!pin.swap) continue;
    const key = `${pin.unit ?? 0}|${pin.swap}`;
    const list = groups.get(key) ?? [];
    if (!list.includes(pin.number)) list.push(pin.number);
    groups.set(key, list);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Swaps two pins of one part, where its component says they may be (#645). The part gets its own copy of the
 * component with the two pins in each other's places, so the wires on the sheet stay put and now reach the other
 * pin, and the board's pads take each other's nets. The schematic and the board change in one step.
 */
export function swapPins(d: ElectronicsDesign, partId: Id, a: string, b: string): ElectronicsDesign {
  const part = d.parts.find((p) => p.id === partId);
  const def = part && d.defs[part.def];
  if (!part || !def || a === b || !swapGroups(d, partId).some((g) => g.includes(a) && g.includes(b))) return d;
  const where = (n: string) => def.symbol.pins.find((p) => p.number === n)!;
  const [pa, pb] = [where(a), where(b)];
  const seat = (from: SymbolPin, to: SymbolPin): SymbolPin => ({ ...from, x: to.x, y: to.y, length: to.length, dir: to.dir });
  const next: ComponentDef = {
    ...def,
    symbol: { ...def.symbol, pins: def.symbol.pins.map((p) => (p === pa ? seat(pa, pb) : p === pb ? seat(pb, pa) : p)) },
    swapped: true,
  };
  const key = defKey(next);
  return { ...d, defs: { ...d.defs, [key]: next }, parts: d.parts.map((p) => (p.id === partId ? { ...p, def: key } : p)) };
}
