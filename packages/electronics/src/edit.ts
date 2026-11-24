import { key, placeOnSheet, q } from "./geom";
import {
  eid,
  isPower,
  type Board,
  type ComponentDef,
  type ElectronicsDesign,
  type Id,
  type P2,
  type Part,
  type Rot,
  type SchSymbol,
  type Sheet,
} from "./model";

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
  opts: { value?: string; pkg?: number } = {},
): Placed {
  const k = defKey(def);
  const part: Part = {
    id: eid("pt"),
    def: k,
    ref: nextRef(d, def.prefix),
    value: opts.value ?? def.value ?? def.name,
    pkg: def.packages[opts.pkg ?? 0] ? (opts.pkg ?? 0) : 0,
  };
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

// ---------------------------------------------------------------- sheets

const onSheet = (d: ElectronicsDesign, sheet: Id, change: (s: Sheet) => Sheet): ElectronicsDesign => ({
  ...d,
  sheets: d.sheets.map((s) => (s.id === sheet ? change(s) : s)),
});

/** Where each pin of the given symbols sits, as "x,y" keys to points. */
function pinPoints(d: ElectronicsDesign, sheet: Sheet, ids: Set<Id>): P2[] {
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const out: P2[] = [];
  for (const s of sheet.symbols) {
    if (!ids.has(s.id)) continue;
    const def = d.defs[parts.get(s.part)?.def ?? ""];
    for (const pin of def?.symbol.pins ?? []) out.push(placeOnSheet([pin.x, pin.y], s));
  }
  return out;
}

/**
 * Changes symbols and carries the wire ends on their pins along, so a part stays wired when it moves or turns.
 * Wires that are selected themselves are left to the caller.
 */
function changeSymbols(d: ElectronicsDesign, sheetId: Id, ids: Set<Id>, change: (s: SchSymbol) => SchSymbol, held: Set<Id> = new Set()): ElectronicsDesign {
  const sheet = d.sheets.find((s) => s.id === sheetId);
  if (!sheet) return d;
  const before = pinPoints(d, sheet, ids);
  const symbols = sheet.symbols.map((s) => (ids.has(s.id) ? change(s) : s));
  const after = pinPoints(d, { ...sheet, symbols }, ids);
  const moved = new Map(before.map((p, i) => [key(p[0], p[1]), after[i]!]));
  const end = (p: P2): P2 => moved.get(key(p[0], p[1])) ?? p;
  const wires = sheet.wires.map((w) => (held.has(w.id) ? w : { ...w, a: end(w.a), b: end(w.b) })).filter((w) => key(w.a[0], w.a[1]) !== key(w.b[0], w.b[1]));
  return onSheet(d, sheetId, (s) => ({ ...s, symbols, wires }));
}

/** Moves the picked things on a sheet. Wires on a moved part's pins stretch to follow it. */
export function moveOnSheet(d: ElectronicsDesign, sheetId: Id, ids: Id[], dx: number, dy: number): ElectronicsDesign {
  if (!dx && !dy) return d;
  const set = new Set(ids);
  const at = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: q(o.x + dx), y: q(o.y + dy) });
  const next = changeSymbols(d, sheetId, set, at, set);
  return onSheet(next, sheetId, (s) => ({
    ...s,
    wires: s.wires.map((w) => (set.has(w.id) ? { ...w, a: [q(w.a[0] + dx), q(w.a[1] + dy)] as P2, b: [q(w.b[0] + dx), q(w.b[1] + dy)] as P2 } : w)),
    labels: s.labels.map((l) => (set.has(l.id) ? at(l) : l)),
    junctions: s.junctions.map((j) => (set.has(j.id) ? at(j) : j)),
    noConnects: s.noConnects.map((n) => (set.has(n.id) ? at(n) : n)),
  }));
}

/** Turns the picked symbols a quarter turn anticlockwise, each about its own origin. */
export function rotateOnSheet(d: ElectronicsDesign, sheetId: Id, ids: Id[]): ElectronicsDesign {
  return changeSymbols(d, sheetId, new Set(ids), (s) => ({ ...s, rot: ((s.rot + 90) % 360) as Rot }));
}

/** Flips the picked symbols left to right. */
export function mirrorOnSheet(d: ElectronicsDesign, sheetId: Id, ids: Id[]): ElectronicsDesign {
  return changeSymbols(d, sheetId, new Set(ids), (s) => {
    const { mirror, ...rest } = s;
    // A turned part flips across the sheet's vertical, which for a quarter turn means turning it round as well.
    const rot = (s.rot === 90 || s.rot === 270 ? (s.rot + 180) % 360 : s.rot) as Rot;
    return mirror ? { ...rest, rot } : { ...rest, rot, mirror: true };
  });
}

/** Deletes the picked things from a sheet. A part goes when its last symbol does. */
export function removeFromSheet(d: ElectronicsDesign, sheetId: Id, ids: Id[]): ElectronicsDesign {
  const set = new Set(ids);
  const next = onSheet(d, sheetId, (s) => ({
    ...s,
    symbols: s.symbols.filter((y) => !set.has(y.id)),
    wires: s.wires.filter((w) => !set.has(w.id)),
    labels: s.labels.filter((l) => !set.has(l.id)),
    junctions: s.junctions.filter((j) => !set.has(j.id)),
    noConnects: s.noConnects.filter((n) => !set.has(n.id)),
  }));
  const used = new Set(next.sheets.flatMap((s) => s.symbols.map((y) => y.part)));
  return removeParts(
    next,
    next.parts.filter((p) => !used.has(p.id)).map((p) => p.id),
  );
}

/** Adds a run of wire through the points given, one piece per pair. */
export function addWires(d: ElectronicsDesign, sheet: Id, pts: P2[]): ElectronicsDesign {
  let next = d;
  for (let i = 0; i + 1 < pts.length; i += 1) next = addWire(next, sheet, pts[i]!, pts[i + 1]!);
  return next;
}

export function addNoConnect(d: ElectronicsDesign, sheet: Id, x: number, y: number): ElectronicsDesign {
  return onSheet(d, sheet, (s) =>
    s.noConnects.some((n) => key(n.x, n.y) === key(x, y)) ? s : { ...s, noConnects: [...s.noConnects, { id: eid("nc"), x, y }] },
  );
}

export function addJunction(d: ElectronicsDesign, sheet: Id, x: number, y: number): ElectronicsDesign {
  return onSheet(d, sheet, (s) => (s.junctions.some((n) => key(n.x, n.y) === key(x, y)) ? s : { ...s, junctions: [...s.junctions, { id: eid("jn"), x, y }] }));
}

export function renameLabel(d: ElectronicsDesign, sheet: Id, id: Id, name: string): ElectronicsDesign {
  const text = name.trim();
  if (!text) return d;
  return onSheet(d, sheet, (s) => ({ ...s, labels: s.labels.map((l) => (l.id === id ? { ...l, name: text } : l)) }));
}

/** Changes a part's value, package, reference, supplier numbers or whether it is fitted. */
export function changePart(d: ElectronicsDesign, id: Id, change: Partial<Pick<Part, "value" | "pkg" | "ref" | "supplier" | "fitted">>): ElectronicsDesign {
  if (change.ref !== undefined) {
    const ref = change.ref.trim();
    if (!ref || d.parts.some((p) => p.id !== id && p.ref === ref)) return d;
    change = { ...change, ref };
  }
  return { ...d, parts: d.parts.map((p) => (p.id === id ? { ...p, ...change } : p)) };
}

// ---------------------------------------------------------------- the board

const onBoard = (d: ElectronicsDesign, change: (b: Board) => Board): ElectronicsDesign => (d.board ? { ...d, board: change(d.board) } : d);

/** Moves parts (by part id), tracks, vias, holes and text on the board. Locked parts stay put. */
export function moveOnBoard(d: ElectronicsDesign, ids: Id[], dx: number, dy: number): ElectronicsDesign {
  if (!dx && !dy) return d;
  const set = new Set(ids);
  const at = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: q(o.x + dx), y: q(o.y + dy) });
  return onBoard(d, (b) => ({
    ...b,
    placements: b.placements.map((p) => (set.has(p.part) && !p.locked ? at(p) : p)),
    tracks: b.tracks.map((t) => (set.has(t.id) ? { ...t, pts: t.pts.map((p) => [q(p[0] + dx), q(p[1] + dy)] as P2) } : t)),
    vias: b.vias.map((v) => (set.has(v.id) ? at(v) : v)),
    holes: b.holes.map((h) => (set.has(h.id) ? at(h) : h)),
    texts: b.texts.map((t) => (set.has(t.id) ? at(t) : t)),
  }));
}

/** Turns parts on the board by `by` degrees, each about its own origin. */
export function rotateOnBoard(d: ElectronicsDesign, ids: Id[], by = 90): ElectronicsDesign {
  const set = new Set(ids);
  return onBoard(d, (b) => ({
    ...b,
    placements: b.placements.map((p) => (set.has(p.part) && !p.locked ? { ...p, rot: (((p.rot + by) % 360) + 360) % 360 } : p)),
  }));
}

/** Moves parts to the other side of the board. */
export function flipOnBoard(d: ElectronicsDesign, ids: Id[]): ElectronicsDesign {
  const set = new Set(ids);
  return onBoard(d, (b) => ({
    ...b,
    placements: b.placements.map((p) => (set.has(p.part) && !p.locked ? { ...p, side: p.side === "top" ? "bottom" : "top" } : p)),
  }));
}

/** Deletes tracks, vias, holes and text. Parts are removed on the schematic, not here. */
export function removeFromBoard(d: ElectronicsDesign, ids: Id[]): ElectronicsDesign {
  const set = new Set(ids);
  return onBoard(d, (b) => ({
    ...b,
    tracks: b.tracks.filter((t) => !set.has(t.id)),
    vias: b.vias.filter((v) => !set.has(v.id)),
    holes: b.holes.filter((h) => !set.has(h.id)),
    texts: b.texts.filter((t) => !set.has(t.id)),
    pours: b.pours.filter((p) => !set.has(p.id)),
  }));
}
