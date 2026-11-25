import { copyFromSheet, pasteOnSheet, removeParts } from "./edit";
import { eid, emptySheet, type ElectronicsDesign, type Id, type Sheet } from "./model";

/**
 * A schematic's sheets (#636): add, name, reorder, delete and copy them. Nets join across sheets by name, as they do
 * on one sheet, so a sheet is only a page: a bigger design is drawn a part at a time.
 */

/** A name no sheet has yet: "Sheet 3", or `base` with a number after it. */
function freeName(d: ElectronicsDesign, base: string): string {
  const names = new Set(d.sheets.map((s) => s.name));
  if (!names.has(base)) return base;
  const stem = base.replace(/ \d+$/, "");
  for (let n = 2; ; n += 1) if (!names.has(`${stem} ${n}`)) return `${stem} ${n}`;
}

/** Adds an empty sheet after `after` (or at the end), and says which it is. */
export function addSheet(d: ElectronicsDesign, after?: Id, id: Id = eid("sh")): { design: ElectronicsDesign; id: Id } {
  const at = d.sheets.findIndex((s) => s.id === after);
  const sheet: Sheet = { ...emptySheet(), id, name: freeName(d, `Sheet ${d.sheets.length + 1}`) };
  const sheets = [...d.sheets];
  sheets.splice(at < 0 ? sheets.length : at + 1, 0, sheet);
  return { design: { ...d, sheets }, id };
}

/** Names a sheet. An empty name changes nothing. */
export function renameSheet(d: ElectronicsDesign, id: Id, name: string): ElectronicsDesign {
  const tidy = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!tidy || !d.sheets.some((s) => s.id === id && s.name !== tidy)) return d;
  return { ...d, sheets: d.sheets.map((s) => (s.id === id ? { ...s, name: tidy } : s)) };
}

/** Moves a sheet to place `to` in the strip, counted from 0. */
export function moveSheet(d: ElectronicsDesign, id: Id, to: number): ElectronicsDesign {
  const from = d.sheets.findIndex((s) => s.id === id);
  const at = Math.max(0, Math.min(d.sheets.length - 1, to));
  if (from < 0 || from === at) return d;
  const sheets = [...d.sheets];
  sheets.splice(at, 0, ...sheets.splice(from, 1));
  return { ...d, sheets };
}

/** Deletes a sheet and the parts drawn on it. A schematic keeps at least one sheet. */
export function removeSheet(d: ElectronicsDesign, id: Id): ElectronicsDesign {
  const sheet = d.sheets.find((s) => s.id === id);
  if (!sheet || d.sheets.length < 2) return d;
  const elsewhere = new Set(d.sheets.filter((s) => s.id !== id).flatMap((s) => s.symbols.map((y) => y.part)));
  const gone = sheet.symbols.map((y) => y.part).filter((p) => !elsewhere.has(p));
  const left = removeParts(d, gone);
  return { ...left, sheets: left.sheets.filter((s) => s.id !== id) };
}

/** Net names that reach beyond one sheet: a label on another sheet, or a power symbol anywhere. */
function sharedNames(d: ElectronicsDesign, sheetId: Id): Set<string> {
  const out = new Set<string>();
  for (const s of d.sheets) if (s.id !== sheetId) for (const l of s.labels) out.add(l.name);
  for (const p of d.parts) if (d.defs[p.def]?.symbol.power && p.value) out.add(p.value);
  return out;
}

export interface SheetCopy {
  design: ElectronicsDesign;
  id: Id;
  /** The names that were only on the copied sheet, and what they are called on the copy. */
  renamed: [string, string][];
}

/**
 * Copies a sheet as a block to use again (#636): a motor driver channel drawn once and placed four times. Each copy's
 * parts get their own references. A name used only on that sheet is a net inside the block, so the copy gets its own
 * ("OUT" becomes "OUT_2"); a name other sheets use, or a power rail, stays joined.
 */
export function duplicateSheet(d: ElectronicsDesign, sheetId: Id, id: Id = eid("sh")): SheetCopy | null {
  const from = d.sheets.find((s) => s.id === sheetId);
  if (!from) return null;
  const all = [...from.symbols, ...from.wires, ...from.labels, ...from.junctions, ...from.noConnects].map((x) => x.id);
  const clip = copyFromSheet(d, sheetId, all);
  const added = addSheet(d, sheetId, id);
  const name = freeName(d, from.name);
  let design: ElectronicsDesign = {
    ...added.design,
    sheets: added.design.sheets.map((s) =>
      s.id === id ? { ...s, name, ...(from.notes ? { notes: from.notes.map((n) => ({ ...n, id: eid("nt") })) } : {}) } : s,
    ),
  };
  if (clip) design = pasteOnSheet(design, id, clip, 0, 0).design;

  const shared = sharedNames(d, sheetId);
  const taken = new Set(d.sheets.flatMap((s) => s.labels.map((l) => l.name)));
  const own = [...new Set(from.labels.map((l) => l.name))].filter((n) => !shared.has(n));
  // One number for the whole copy, so its names read as a set.
  let n = 2;
  while (own.some((o) => taken.has(`${o}_${n}`))) n += 1;
  const renamed = own.map((o): [string, string] => [o, `${o}_${n}`]);
  const to = new Map(renamed);
  design = {
    ...design,
    sheets: design.sheets.map((s) => (s.id === id ? { ...s, labels: s.labels.map((l) => (to.has(l.name) ? { ...l, name: to.get(l.name)! } : l)) } : s)),
  };
  return { design, id, renamed };
}
