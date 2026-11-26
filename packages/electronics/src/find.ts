/**
 * Find in a design (#734): parts by their reference, value or part numbers, and nets by name. The views go to what is
 * chosen; this only finds it.
 */
import { isPower, type ElectronicsDesign, type Id } from "./model";
import { byRef, netlist, type Netlist } from "./nets";

export type Found = { kind: "part"; id: Id; ref: string; text: string; note: string } | { kind: "net"; name: string; text: string; note: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/**
 * What matches `query`, best first: an exact reference or net name, then ones that start with it, then ones that
 * hold it anywhere. At most `limit` results.
 */
export function findInDesign(d: ElectronicsDesign, query: string, nl: Netlist = netlist(d), limit = 30): Found[] {
  const q = norm(query);
  if (!q) return [];
  const rank = (...fields: (string | undefined)[]): number => {
    let best = 9;
    fields.forEach((f, i) => {
      if (!f) return;
      const n = norm(f);
      // A match on the first field (a reference, a net's name) wins over one on a value or a part number.
      const r = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 9;
      if (r < 9) best = Math.min(best, r * 2 + (i ? 1 : 0));
    });
    return best;
  };
  const out: (Found & { rank: number })[] = [];
  for (const p of d.parts) {
    if (isPower(d, p)) continue;
    const def = d.defs[p.def];
    const supplier = { ...def?.supplier, ...p.supplier };
    const r = rank(p.ref, p.value, supplier.mpn, supplier.lcsc, def?.name);
    if (r === 9) continue;
    out.push({ kind: "part", id: p.id, ref: p.ref, text: p.ref, note: [p.value, def?.name].filter(Boolean).join(" · "), rank: r });
  }
  for (const n of nl.nets) {
    const r = rank(n.name, ...n.names.filter((x) => x !== n.name));
    if (r === 9) continue;
    const pins = n.pins.length;
    out.push({ kind: "net", name: n.name, text: n.name, note: `Net · ${pins} ${pins === 1 ? "pin" : "pins"}`, rank: r });
  }
  return out
    .sort((a, b) => a.rank - b.rank || (a.kind === b.kind ? byRef(a.text, b.text) : a.kind === "part" ? -1 : 1))
    .slice(0, limit)
    .map(({ rank: _, ...f }) => f as Found);
}
