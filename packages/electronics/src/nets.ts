import { key, onSegment, placeOnSheet } from "./geom";
import type { ElectronicsDesign, Id, P2, PinType } from "./model";

/** A pin of a part: the part's id and the pin's number. */
export interface PinRef {
  part: Id;
  pin: string;
}

export interface NetPin extends PinRef {
  ref: string;
  name: string;
  type: PinType;
  sheet: Id;
  at: P2;
}

export interface Net {
  /** A power symbol's name, else a label's, else one made from its first pin: "Net-(R1-2)". */
  name: string;
  /** True when a label or power symbol names it. */
  named: boolean;
  /** Every name found on it. More than one means two names were joined. */
  names: string[];
  /** Pins of real parts, in reference order. Power symbols' own pins are left out. */
  pins: NetPin[];
  /** Power symbols on it, by value ("GND"). */
  power: string[];
  /** How many labels sit on it. */
  labels: number;
  /** Wire ends that stop in mid air. */
  openEnds: { sheet: Id; at: P2 }[];
}

export interface Netlist {
  nets: Net[];
  /** "part:pin" to the name of its net. Pins on no net at all are absent. */
  of: Map<string, string>;
  /** Pins carrying a no-connect mark, as "part:pin". */
  noConnect: Set<string>;
  /** Pins with nothing on them and no mark. */
  floating: NetPin[];
  /** The net at a wire's end, a label or a pin, by sheet and point (`netAt`). */
  at: Map<string, string>;
}

/** The name of the net a point of a sheet is on, if a wire ends, a label sits or a pin joins there. */
export const netAt = (nl: Netlist, sheet: Id, p: P2): string | undefined => nl.at.get(`${sheet}|${key(p[0], p[1])}`);

export const pinKey = (part: Id, pin: string): string => `${part}:${pin}`;

/** Sorts R2 before R10. */
export function byRef(a: string, b: string): number {
  return refOrder.compare(a, b);
}
// One collator for every comparison: making one a call is most of the time a long parts list takes to sort.
const refOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

class Sets {
  private parent = new Map<string, string>();
  find(a: string): string {
    let root = a;
    for (let up = this.parent.get(root); up !== undefined && up !== root; up = this.parent.get(root)) root = up;
    if (!this.parent.has(a)) this.parent.set(a, a);
    // Point everything on the way straight at the root, so the next look is quick.
    for (let at = a; at !== root;) {
      const up = this.parent.get(at)!;
      this.parent.set(at, root);
      at = up;
    }
    return root;
  }
  join(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}

/** Where every pin of every placed symbol sits. */
export function placedPins(d: ElectronicsDesign): (NetPin & { power: boolean; value: string; hidden: boolean })[] {
  const out: (NetPin & { power: boolean; value: string; hidden: boolean })[] = [];
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  for (const sheet of d.sheets) {
    for (const s of sheet.symbols) {
      const part = parts.get(s.part);
      const def = part && d.defs[part.def];
      if (!part || !def) continue;
      for (const pin of def.symbol.pins) {
        if (pin.unit !== undefined && def.symbol.units > 1 && pin.unit !== s.unit) continue;
        out.push({
          part: part.id,
          pin: pin.number,
          ref: part.ref,
          name: pin.name,
          type: pin.type,
          sheet: sheet.id,
          at: placeOnSheet([pin.x, pin.y], s),
          power: !!def.symbol.power,
          value: part.value,
          hidden: !!pin.hidden,
        });
      }
    }
  }
  return out;
}

/**
 * Works out the nets (#616). Wires join at their ends, and an end or a pin that lands on a wire joins it. Wires that
 * only cross do not join without a junction dot. Labels with one name join, on one sheet or across sheets, and so do
 * power symbols with one value.
 */
export function netlist(d: ElectronicsDesign): Netlist {
  // The nets come from the sheets, the parts and their components alone, and a change makes new ones of those. Work on
  // the board changes none of them, so the last answer is kept: a big schematic is not read again for every move.
  if (kept && kept.sheets === d.sheets && kept.parts === d.parts && kept.defs === d.defs) return kept.out;
  const out = findNets(d);
  kept = { sheets: d.sheets, parts: d.parts, defs: d.defs, out };
  return out;
}
let kept: { sheets: unknown; parts: unknown; defs: unknown; out: Netlist } | null = null;

function findNets(d: ElectronicsDesign): Netlist {
  const sets = new Sets();
  const node = (sheet: Id, p: P2) => `${sheet}|${key(p[0], p[1])}`;
  const pins = placedPins(d);
  const names = new Map<string, Set<string>>(); // node -> names on it
  const powerAt = new Map<string, string[]>();
  const labelsAt = new Map<string, number>();
  const wireNodes = new Set<string>();
  const endCount = new Map<string, number>(); // how many things meet at a wire end

  const name = (n: string, text: string) => {
    if (!names.has(n)) names.set(n, new Set());
    names.get(n)!.add(text);
    sets.join(n, `name|${text}`);
  };

  for (const sheet of d.sheets) {
    const points: P2[] = [];
    for (const w of sheet.wires) {
      const a = node(sheet.id, w.a);
      const b = node(sheet.id, w.b);
      sets.join(a, b);
      wireNodes.add(a).add(b);
      endCount.set(a, (endCount.get(a) ?? 0) + 1);
      endCount.set(b, (endCount.get(b) ?? 0) + 1);
      points.push(w.a, w.b);
    }
    for (const j of sheet.junctions) points.push([j.x, j.y]);
    for (const l of sheet.labels) {
      points.push([l.x, l.y]);
      const n = node(sheet.id, [l.x, l.y]);
      name(n, l.name);
      labelsAt.set(n, (labelsAt.get(n) ?? 0) + 1);
      endCount.set(n, (endCount.get(n) ?? 0) + 1);
    }
    for (const p of pins) {
      if (p.sheet !== sheet.id) continue;
      points.push(p.at);
      const n = node(sheet.id, p.at);
      sets.find(n);
      endCount.set(n, (endCount.get(n) ?? 0) + 1);
      if (p.power) {
        name(n, p.value);
        powerAt.set(n, [...(powerAt.get(n) ?? []), p.value]);
      }
    }
    // A point that lands part way along a wire joins it.
    // A box round each wire is looked at first: every point against every wire is slow on a big sheet.
    const reach = 0.01;
    const boxed = sheet.wires.map((w) => ({
      w,
      x1: Math.min(w.a[0], w.b[0]) - reach,
      x2: Math.max(w.a[0], w.b[0]) + reach,
      y1: Math.min(w.a[1], w.b[1]) - reach,
      y2: Math.max(w.a[1], w.b[1]) + reach,
      a: key(w.a[0], w.a[1]),
      b: key(w.b[0], w.b[1]),
    }));
    for (const p of points) {
      const n = node(sheet.id, p);
      const at = key(p[0], p[1]);
      for (const { w, x1, x2, y1, y2, a, b } of boxed) {
        if (p[0] < x1 || p[0] > x2 || p[1] < y1 || p[1] > y2 || at === a || at === b) continue;
        if (onSegment(p, w.a, w.b)) {
          sets.join(n, node(sheet.id, w.a));
          endCount.set(n, (endCount.get(n) ?? 0) + 1);
        }
      }
    }
  }

  interface Group {
    names: Set<string>;
    power: Set<string>;
    pins: NetPin[];
    labels: number;
    openEnds: { sheet: Id; at: P2 }[];
  }
  const groups = new Map<string, Group>();
  const group = (n: string): Group => {
    const r = sets.find(n);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = { names: new Set(), power: new Set(), pins: [], labels: 0, openEnds: [] }));
    return g;
  };
  for (const [n, set] of names) for (const t of set) group(n).names.add(t);
  for (const [n, list] of powerAt) for (const t of list) group(n).power.add(t);
  for (const [n, c] of labelsAt) group(n).labels += c;
  const noConnect = new Set<string>();
  const ncPoints = new Set<string>();
  for (const sheet of d.sheets) for (const x of sheet.noConnects) ncPoints.add(node(sheet.id, [x.x, x.y]));
  const floating: NetPin[] = [];
  for (const p of pins) {
    if (p.power) continue;
    const n = node(p.sheet, p.at);
    const pin: NetPin = { part: p.part, pin: p.pin, ref: p.ref, name: p.name, type: p.type, sheet: p.sheet, at: p.at };
    if (ncPoints.has(n)) noConnect.add(pinKey(p.part, p.pin));
    const alone = (endCount.get(n) ?? 0) <= 1 && !names.has(n) && sets.find(n) === n;
    if (alone) {
      if (!ncPoints.has(n) && p.type !== "no_connect" && !p.hidden) floating.push(pin);
      continue;
    }
    group(n).pins.push(pin);
  }
  for (const sheet of d.sheets)
    for (const w of sheet.wires)
      for (const end of [w.a, w.b]) {
        const n = node(sheet.id, end);
        if ((endCount.get(n) ?? 0) <= 1) group(n).openEnds.push({ sheet: sheet.id, at: end });
      }

  const nets: Net[] = [];
  const nameOf = new Map<Group, string>();
  for (const g of groups.values()) {
    if (g.pins.length === 0 && g.names.size === 0) continue;
    g.pins.sort((a, b) => byRef(a.ref, b.ref) || byRef(a.pin, b.pin));
    const power = [...g.power].sort();
    const all = [...power, ...[...g.names].filter((n) => !g.power.has(n)).sort()];
    const first = g.pins[0];
    nameOf.set(g, all[0] ?? `Net-(${first!.ref}-${first!.pin})`);
    nets.push({
      name: nameOf.get(g)!,
      named: all.length > 0,
      names: all,
      pins: g.pins,
      power,
      labels: g.labels,
      openEnds: g.openEnds,
    });
  }
  nets.sort((a, b) => byRef(a.name, b.name));
  const of = new Map<string, string>();
  for (const net of nets) for (const p of net.pins) of.set(pinKey(p.part, p.pin), net.name);
  floating.sort((a, b) => byRef(a.ref, b.ref) || byRef(a.pin, b.pin));
  const at = new Map<string, string>();
  for (const n of [...wireNodes, ...labelsAt.keys(), ...pins.map((p) => node(p.sheet, p.at))]) {
    const name = nameOf.get(groups.get(sets.find(n))!);
    if (name) at.set(n, name);
  }
  return { nets, of, noConnect, floating, at };
}
