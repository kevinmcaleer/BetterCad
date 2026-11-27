import { GRID } from "./basics";
import { distToSegment, key, q } from "./geom";
import { eid, type ElectronicsDesign, type Id, type P2, type Sheet } from "./model";

/**
 * Buses on the schematic (#756). A bus is a thick line with a name such as D[0..7]; wires leave it by a short slanted
 * entry, each with a net label. A bus joins nothing by itself, so the nets are the ones its labels alone would give,
 * the same as in KiCad and Eagle.
 */

/** The nets a bus name stands for: "D[0..7]" is D0 to D7, "A[3..0]" counts down, "{SDA SCL}" lists them. Null: a plain name. */
export function busMembers(name: string): string[] | null {
  const range = /^(.*?)\[(\d+)\.\.(\d+)\](.*)$/.exec(name.trim());
  if (range) {
    const [, pre, a, b, post] = range;
    const [from, to] = [Number(a), Number(b)];
    if (Math.abs(to - from) > 1023) return null;
    const step = from <= to ? 1 : -1;
    const out: string[] = [];
    for (let i = from; i !== to + step; i += step) out.push(`${pre}${i}${post}`);
    return out;
  }
  const group = /^(.*?)\{([^}]*)\}$/.exec(name.trim());
  if (group) {
    const names = group[2]!.split(/[\s,]+/).filter(Boolean);
    return names.length ? names.map((n) => (group[1] ? `${group[1]}.${n}` : n)) : null;
  }
  return null;
}

const onSheet = (d: ElectronicsDesign, sheet: Id, change: (s: Sheet) => Sheet): ElectronicsDesign => ({
  ...d,
  sheets: d.sheets.map((s) => (s.id === sheet ? change(s) : s)),
});

/** Draws a bus through the points given. Its id comes back with the design. */
export function addBus(d: ElectronicsDesign, sheet: Id, pts: P2[], name: string): { design: ElectronicsDesign; id: Id } {
  const id = eid("bus");
  const run = pts.filter((p, i) => !i || key(p[0], p[1]) !== key(pts[i - 1]![0], pts[i - 1]![1]));
  if (run.length < 2) return { design: d, id: "" };
  return { design: onSheet(d, sheet, (s) => ({ ...s, buses: [...(s.buses ?? []), { id, name: name.trim(), pts: run }] })), id };
}

/** Carries a bus on to another point. */
export function extendBus(d: ElectronicsDesign, sheet: Id, id: Id, to: P2): ElectronicsDesign {
  return onSheet(d, sheet, (s) => ({
    ...s,
    buses: (s.buses ?? []).map((b) => {
      const last = b.pts[b.pts.length - 1]!;
      return b.id === id && key(last[0], last[1]) !== key(to[0], to[1]) ? { ...b, pts: [...b.pts, to] } : b;
    }),
  }));
}

export function renameBus(d: ElectronicsDesign, sheet: Id, id: Id, name: string): ElectronicsDesign {
  const text = name.trim();
  if (!text) return d;
  return onSheet(d, sheet, (s) => ({ ...s, buses: (s.buses ?? []).map((b) => (b.id === id ? { ...b, name: text } : b)) }));
}

/** The bus under a point, and the piece of it, within `tol`. */
export function busAt(sheet: Sheet, p: P2, tol: number): { id: Id; piece: number } | null {
  for (const b of sheet.buses ?? [])
    for (let i = 0; i + 1 < b.pts.length; i += 1) if (distToSegment(p, b.pts[i]!, b.pts[i + 1]!) <= tol) return { id: b.id, piece: i };
  return null;
}

/** Where an entry ends, away from its bus. */
export const entryEnd = (e: { x: number; y: number; dx: number; dy: number }): P2 => [q(e.x + e.dx * GRID), q(e.y + e.dy * GRID)];

/** The members of a bus that no entry on the sheet has taken yet, in order. */
export function freeMembers(sheet: Sheet, id: Id): string[] {
  const bus = sheet.buses?.find((b) => b.id === id);
  const all = (bus && busMembers(bus.name)) ?? [];
  const taken = new Set(sheet.labels.map((l) => l.name));
  return all.filter((n) => !taken.has(n));
}

/**
 * Takes a wire off a bus (#756): a slanted entry from the point on the bus nearest `at`, a short wire on from it,
 * and a label naming the net at the wire's end. The entry leans to the side `at` is on. Returns the design as it
 * was when `at` is not near the bus.
 */
export function addBusEntry(d: ElectronicsDesign, sheet: Id, bus: Id, at: P2, net: string): ElectronicsDesign {
  const s = d.sheets.find((x) => x.id === sheet);
  const b = s?.buses?.find((x) => x.id === bus);
  const name = net.trim();
  if (!s || !b || !name) return d;
  // The nearest grid point on the bus.
  let best: { p: P2; along: P2; dist: number } | null = null;
  for (let i = 0; i + 1 < b.pts.length; i += 1) {
    const [p1, p2] = [b.pts[i]!, b.pts[i + 1]!];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (len < 1e-9) continue;
    const u: P2 = [(p2[0] - p1[0]) / len, (p2[1] - p1[1]) / len];
    const t = Math.max(0, Math.min(len, Math.round(((at[0] - p1[0]) * u[0] + (at[1] - p1[1]) * u[1]) / GRID) * GRID));
    const p: P2 = [q(p1[0] + u[0] * t), q(p1[1] + u[1] * t)];
    const dist = Math.hypot(at[0] - p[0], at[1] - p[1]);
    if (!best || dist < best.dist) best = { p, along: u, dist };
  }
  if (!best) return d;
  // A bus running up and down sends its wires off sideways; one running across sends them up or down.
  const across = Math.abs(best.along[1]) > Math.abs(best.along[0]);
  const side = (v: number): 1 | -1 => (v < 0 ? -1 : 1);
  const dx = across ? side(at[0] - best.p[0]) : 1;
  const dy = across ? 1 : side(at[1] - best.p[1]);
  const entry = { id: eid("be"), x: best.p[0], y: best.p[1], dx, dy };
  const end = entryEnd(entry);
  const tip: P2 = across ? [q(end[0] + dx * 2 * GRID), end[1]] : [end[0], q(end[1] + dy * 2 * GRID)];
  return onSheet(d, sheet, (x) => ({
    ...x,
    busEntries: [...(x.busEntries ?? []), entry],
    wires: [...x.wires, { id: eid("w"), a: end, b: tip }],
    labels: [...x.labels, { id: eid("lb"), name, x: tip[0], y: tip[1] }],
  }));
}
