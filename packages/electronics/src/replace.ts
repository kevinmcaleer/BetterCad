import { defKey, nextRef, removeParts } from "./edit";
import { key, placeOnSheet } from "./geom";
import type { ComponentDef, ElectronicsDesign, Id, P2 } from "./model";

/**
 * Swaps a part for another component (#631) and keeps its place and its wiring, and its name and value when it is the same kind of part: wire ends on a pin move
 * to the new part's pin of the same name, or failing that the same number. `lost` lists the old pins that had a wire
 * and found no match, so the person can be told.
 */
export function replacePart(d: ElectronicsDesign, partId: Id, def: ComponentDef, pkg = 0): { design: ElectronicsDesign; lost: string[] } {
  const part = d.parts.find((p) => p.id === partId);
  const old = part && d.defs[part.def];
  if (!part || !old) return { design: d, lost: [] };
  const k = defKey(def);
  const match = (name: string, number: string) =>
    def.symbol.pins.find((p) => name && name !== "~" && p.name === name) ?? def.symbol.pins.find((p) => p.number === number);
  const lost: string[] = [];
  const sheets = d.sheets.map((sheet) => {
    const moved = new Map<string, P2>();
    const ends = new Set(sheet.wires.flatMap((w) => [key(w.a[0], w.a[1]), key(w.b[0], w.b[1])]));
    for (const s of sheet.symbols) {
      if (s.part !== partId) continue;
      for (const pin of old.symbol.pins) {
        const was = placeOnSheet([pin.x, pin.y], s);
        const to = match(pin.name, pin.number);
        const wired = ends.has(key(was[0], was[1]));
        if (to) moved.set(key(was[0], was[1]), placeOnSheet([to.x, to.y], s));
        else if (wired) lost.push(pin.name && pin.name !== pin.number && pin.name !== "~" ? `${pin.number} (${pin.name})` : pin.number);
      }
    }
    if (!moved.size) return sheet;
    const end = (p: P2): P2 => moved.get(key(p[0], p[1])) ?? p;
    return {
      ...sheet,
      symbols: sheet.symbols.map((s) => (s.part === partId ? { ...s, unit: 1 } : s)),
      wires: sheet.wires.map((w) => ({ ...w, a: end(w.a), b: end(w.b) })).filter((w) => key(w.a[0], w.a[1]) !== key(w.b[0], w.b[1])),
    };
  });
  const sameKind = old.prefix === def.prefix;
  const next: ElectronicsDesign = {
    ...d,
    defs: { ...d.defs, [k]: d.defs[k] ?? def },
    // A resistor swapped for a resistor keeps its name and value; anything else takes the new part's own.
    parts: d.parts.map((p) =>
      p.id === partId
        ? {
            ...p,
            def: k,
            pkg: def.packages[pkg] ? pkg : 0,
            value: sameKind ? p.value : (def.value ?? def.name),
            ref: sameKind ? p.ref : nextRef(d, def.prefix),
          }
        : p,
    ),
    sheets,
  };
  // Drops the old component if nothing uses it any more.
  return { design: removeParts(next, []), lost };
}
