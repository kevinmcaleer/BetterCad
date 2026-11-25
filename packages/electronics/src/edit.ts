import { key, placeOnSheet, q } from "./geom";
import {
  eid,
  isPower,
  type Board,
  type ComponentDef,
  type ElectronicsDesign,
  type Id,
  type NetLabel,
  type P2,
  type Part,
  type Rot,
  type SchSymbol,
  type Sheet,
  type Wire,
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
  const shift = (p: P2): P2 => [q(p[0] + dx), q(p[1] + dy)];
  // A wire that is dragged on its own keeps its neighbours: their ends on its ends come along.
  const ends = new Set(
    (next.sheets.find((s) => s.id === sheetId)?.wires ?? []).filter((w) => set.has(w.id)).flatMap((w) => [key(w.a[0], w.a[1]), key(w.b[0], w.b[1])]),
  );
  const follow = (p: P2): P2 => (ends.has(key(p[0], p[1])) ? shift(p) : p);
  return onSheet(next, sheetId, (s) => ({
    ...s,
    wires: s.wires
      .map((w) => (set.has(w.id) ? { ...w, a: shift(w.a), b: shift(w.b) } : ends.size ? { ...w, a: follow(w.a), b: follow(w.b) } : w))
      .filter((w) => key(w.a[0], w.a[1]) !== key(w.b[0], w.b[1])),
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

/** Flips the picked symbols top to bottom: a flip left to right, then a half turn. */
export function flipOnSheet(d: ElectronicsDesign, sheetId: Id, ids: Id[]): ElectronicsDesign {
  return changeSymbols(mirrorOnSheet(d, sheetId, ids), sheetId, new Set(ids), (s) => ({ ...s, rot: ((s.rot + 180) % 360) as Rot }));
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

// ---------------------------------------------------------------- copy and paste

/** A piece of a sheet that was copied: its parts with their components, and the wires and marks picked with them. */
export interface Clip {
  defs: Record<Id, ComponentDef>;
  parts: Part[];
  symbols: SchSymbol[];
  wires: Wire[];
  labels: NetLabel[];
  junctions: Sheet["junctions"];
  noConnects: Sheet["noConnects"];
}

/** Copies the picked things off a sheet. Nothing picked: nothing copied. */
export function copyFromSheet(d: ElectronicsDesign, sheetId: Id, ids: Id[]): Clip | null {
  const sheet = d.sheets.find((s) => s.id === sheetId);
  const set = new Set(ids);
  const pick = <T extends { id: Id }>(list: T[]): T[] => list.filter((x) => set.has(x.id));
  if (!sheet) return null;
  const symbols = pick(sheet.symbols);
  const used = new Set(symbols.map((s) => s.part));
  const parts = d.parts.filter((p) => used.has(p.id));
  const clip: Clip = {
    defs: Object.fromEntries(parts.map((p) => [p.def, d.defs[p.def]!]).filter(([, def]) => def)),
    parts,
    symbols,
    wires: pick(sheet.wires),
    labels: pick(sheet.labels),
    junctions: pick(sheet.junctions),
    noConnects: pick(sheet.noConnects),
  };
  return symbols.length + clip.wires.length + clip.labels.length + clip.junctions.length + clip.noConnects.length ? clip : null;
}

/** Where a clip's first thing sits, to paste it under the pointer. */
export function clipOrigin(c: Clip): P2 {
  const s = c.symbols[0] ?? c.labels[0] ?? c.junctions[0] ?? c.noConnects[0];
  return s ? [s.x, s.y] : (c.wires[0]?.a ?? [0, 0]);
}

/** Pastes a clip, moved by (dx, dy). Parts get fresh references (R4 becomes R5); the ids of what was added come back. */
export function pasteOnSheet(d: ElectronicsDesign, sheetId: Id, clip: Clip, dx: number, dy: number): { design: ElectronicsDesign; ids: Id[] } {
  if (!d.sheets.some((s) => s.id === sheetId)) return { design: d, ids: [] };
  const at = <T extends { x: number; y: number }>(o: T, prefix: string): T & { id: Id } => ({ ...o, id: eid(prefix), x: q(o.x + dx), y: q(o.y + dy) });
  const move = (p: P2): P2 => [q(p[0] + dx), q(p[1] + dy)];
  const defs = { ...d.defs };
  const parts = [...d.parts];
  const partId = new Map<Id, Id>();
  for (const p of clip.parts) {
    const def = clip.defs[p.def];
    if (!def) continue;
    defs[p.def] ??= def;
    const id = eid("pt");
    partId.set(p.id, id);
    parts.push({ ...p, id, ref: nextRef({ ...d, parts }, def.prefix) });
  }
  const symbols = clip.symbols.filter((s) => partId.has(s.part)).map((s) => ({ ...at(s, "sy"), part: partId.get(s.part)! }));
  const wires = clip.wires.map((w) => ({ id: eid("w"), a: move(w.a), b: move(w.b) }));
  const labels = clip.labels.map((l) => at(l, "lb"));
  const junctions = clip.junctions.map((j) => at(j, "jn"));
  const noConnects = clip.noConnects.map((n) => at(n, "nc"));
  const design = onSheet({ ...d, defs, parts }, sheetId, (s) => ({
    ...s,
    symbols: [...s.symbols, ...symbols],
    wires: [...s.wires, ...wires],
    labels: [...s.labels, ...labels],
    junctions: [...s.junctions, ...junctions],
    noConnects: [...s.noConnects, ...noConnects],
  }));
  return { design, ids: [...symbols, ...wires, ...labels, ...junctions, ...noConnects].map((x) => x.id) };
}

/**
 * Numbers every part again by where it sits: sheet by sheet, top to bottom, then left to right, so R1 is the first
 * resistor you come to. The board's parts are the same parts, so their names follow.
 */
export function renumber(d: ElectronicsDesign): ElectronicsDesign {
  const order = new Map<Id, number>();
  let n = 0;
  for (const sheet of d.sheets) for (const s of [...sheet.symbols].sort((a, b) => b.y - a.y || a.x - b.x)) if (!order.has(s.part)) order.set(s.part, (n += 1));
  const next = new Map<string, number>();
  const ref = new Map<Id, string>();
  for (const p of [...d.parts].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))) {
    const prefix = d.defs[p.def]?.prefix ?? p.ref.replace(/\d+$/, "");
    const k = (next.get(prefix) ?? 0) + 1;
    next.set(prefix, k);
    ref.set(p.id, `${prefix}${k}`);
  }
  if (d.parts.every((p) => ref.get(p.id) === p.ref)) return d;
  return {
    ...d,
    parts: d.parts.map((p) => ({ ...p, ref: ref.get(p.id) ?? p.ref })),
    ...(d.board ? { board: { ...d.board, placements: d.board.placements.map((p) => (ref.has(p.part) ? { ...p, ref: ref.get(p.part)! } : p)) } } : {}),
  };
}

const MULT: Record<string, string> = { p: "p", n: "n", u: "µ", µ: "µ", m: "m", r: "", k: "k", K: "k", M: "M", G: "G" };
const UNIT: Record<string, string> = { R: "Ω", C: "F", L: "H" };

/**
 * Reads engineering shorthand for a resistor, capacitor or coil and writes it with its unit: "4k7" is "4.7 kΩ",
 * "100n" is "100 nF", "2R2" is "2.2 Ω". Anything it does not recognise is left as typed.
 */
export function tidyValue(text: string, prefix: string): string {
  const unit = UNIT[prefix];
  const t = text.trim();
  if (!unit) return t;
  const m = /^(\d+)(?:([.,])(\d+))?\s*([pnuµmrRkKMG]?)(\d*)\s*(?:Ω|ohms?|F|H)?$/.exec(t);
  if (!m || (m[3] && m[5])) return t;
  const [, whole, , frac, letter = "", after] = m;
  const mult = letter === "R" ? "" : (MULT[letter] ?? "");
  // A bare number is ohms on a resistor; on a capacitor or coil it could be anything, so it stays as typed.
  if (!letter && unit !== "Ω") return t;
  const digits = frac ?? after;
  const number = digits ? `${whole}.${digits}` : whole!;
  return `${Number(number)} ${mult}${unit}`;
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
    ...(b.pictures ? { pictures: b.pictures.map((p) => (set.has(p.id) ? at(p) : p)) } : {}),
    pours: b.pours.map((o) => (set.has(o.id) ? { ...o, outline: o.outline.map((p) => [q(p[0] + dx), q(p[1] + dy)] as P2) } : o)),
    keepouts: b.keepouts.map((k) => (set.has(k.id) ? { ...k, outline: k.outline.map((p) => [q(p[0] + dx), q(p[1] + dy)] as P2) } : k)),
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
    ...(b.pictures ? { pictures: b.pictures.filter((p) => !set.has(p.id)) } : {}),
    pours: b.pours.filter((p) => !set.has(p.id)),
  }));
}
