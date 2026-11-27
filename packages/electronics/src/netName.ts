import { pinDirOnSheet, placeOnSheet } from "./geom";
import { eid, isPower, type Board, type ElectronicsDesign, type Id, type P2 } from "./model";
import { netlist, pinKey } from "./nets";

/**
 * Naming nets from a pin or a net (Kev, 2026-11-27): the names a pin's net goes by are its labels and power symbols on
 * the schematic. A new name changes every one of them, so the whole net takes it, and the board's copper, classes and
 * colours follow in the same step. A net with no name yet gets a label on a short wire out from the pin.
 */

const GRID = 2.54;
const OUT: Record<number, P2> = { 0: [-1, 0], 90: [0, -1], 180: [1, 0], 270: [0, 1] };

/** Gives the net called `from` the name `to`. Joining a name another net already has joins the two nets. */
export function renameNet(d: ElectronicsDesign, from: string, to: string): ElectronicsDesign {
  const name = to.trim();
  if (!name || name === from) return d;
  const nl = netlist(d);
  const net = nl.nets.find((n) => n.name === from);
  if (!net) return d;
  let next: ElectronicsDesign;
  if (net.named) {
    const old = new Set(net.names);
    next = {
      ...d,
      sheets: d.sheets.map((s) => (s.labels.some((l) => old.has(l.name)) ? { ...s, labels: s.labels.map((l) => (old.has(l.name) ? { ...l, name } : l)) } : s)),
      parts: d.parts.map((p) => (isPower(d, p) && old.has(p.value) ? { ...p, value: name } : p)),
    };
  } else {
    const pin = net.pins[0];
    if (!pin) return d;
    next = labelPin(d, pin.part, pin.pin, name);
  }
  return next.board ? { ...next, board: boardRename(next.board, from, name) } : next;
}

/**
 * Names the net a pin is on, from the part's inspector. A pin on a net renames that net; a pin on none gets a label
 * on a short wire, which also takes off a mark that said it was left open.
 */
export function setPinNet(d: ElectronicsDesign, part: Id, pin: string, to: string): ElectronicsDesign {
  const name = to.trim();
  if (!name) return d;
  const now = netlist(d).of.get(pinKey(part, pin));
  return now ? renameNet(d, now, name) : labelPin(d, part, pin, name);
}

/** A short wire out from the pin, away from its part, with the label on its far end. */
function labelPin(d: ElectronicsDesign, partId: Id, number: string, name: string): ElectronicsDesign {
  const part = d.parts.find((p) => p.id === partId);
  const def = part && d.defs[part.def];
  if (!part || !def) return d;
  for (const sheet of d.sheets) {
    for (const sym of sheet.symbols) {
      if (sym.part !== part.id) continue;
      const pin = def.symbol.pins.find((p) => p.number === number && (p.unit === undefined || def.symbol.units < 2 || p.unit === sym.unit));
      if (!pin) continue;
      const at = placeOnSheet([pin.x, pin.y], sym);
      const dir = pinDirOnSheet(pin, sym);
      const out = OUT[dir]!;
      const far: P2 = [round(at[0] + out[0] * 2 * GRID), round(at[1] + out[1] * 2 * GRID)];
      const open = (n: { x: number; y: number }) => Math.abs(n.x - at[0]) < 1e-6 && Math.abs(n.y - at[1]) < 1e-6;
      return {
        ...d,
        sheets: d.sheets.map((s) =>
          s.id === sheet.id
            ? {
                ...s,
                wires: [...s.wires, { id: eid("w"), a: at, b: far }],
                labels: [...s.labels, { id: eid("lb"), name, x: far[0], y: far[1], ...(dir === 0 ? { rot: 180 as const } : {}) }],
                noConnects: s.noConnects.filter((n) => !open(n)),
              }
            : s,
        ),
      };
    }
  }
  return d;
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** The board's copper, classes, colours, test points and last sync take the new name. */
function boardRename(b: Board, from: string, to: string): Board {
  const swap = <T extends { net: string }>(x: T): T => (x.net === from ? { ...x, net: to } : x);
  const inClass = b.classes.some((c) => c.nets.includes(to));
  const looks = b.netLooks && from in b.netLooks ? { ...b.netLooks } : b.netLooks;
  if (looks && from in looks) {
    if (!(to in looks)) looks[to] = looks[from]!;
    delete looks[from];
  }
  const synced = b.synced && from in b.synced.nets ? { nets: { ...b.synced.nets } } : b.synced;
  if (synced && from in synced.nets) {
    synced.nets[to] = [...new Set([...(synced.nets[to] ?? []), ...synced.nets[from]!])].sort();
    delete synced.nets[from];
  }
  return {
    ...b,
    tracks: b.tracks.map(swap),
    vias: b.vias.map(swap),
    pours: b.pours.map(swap),
    classes: b.classes.map((c) =>
      c.nets.includes(from) ? { ...c, nets: inClass ? c.nets.filter((n) => n !== from) : c.nets.map((n) => (n === from ? to : n)) } : c,
    ),
    ...(b.marks ? { marks: b.marks.map((m) => (m.net === from ? { ...m, net: to } : m)) } : {}),
    ...(looks ? { netLooks: looks } : {}),
    ...(synced ? { synced } : {}),
  };
}
