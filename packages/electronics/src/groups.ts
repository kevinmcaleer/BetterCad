import { emptyBox, grow, placeOnSheet, type Box } from "./geom";

/** A label's name as the sheet shows it: inside a block, without the block's tag. */
export const shownName = (name: string, tag?: string): string => (tag && name.startsWith(`${tag}.`) ? name.slice(tag.length + 1) : name);
import { eid, type ElectronicsDesign, type Id, type P2, type SchGroup, type SchSymbol, type Sheet, type SymbolDef } from "./model";

/**
 * Groups on a schematic sheet (#766): things gathered in a named outline that move as one block. A group only names
 * its members; moving, copying and deleting them are the sheet's own edits, given every member's id.
 */

const onSheet = (d: ElectronicsDesign, sheet: Id, change: (s: Sheet) => Sheet): ElectronicsDesign => ({
  ...d,
  sheets: d.sheets.map((s) => (s.id === sheet ? change(s) : s)),
});

/** Every id on a sheet that can be in a group. */
export function groupable(sheet: Sheet): Set<Id> {
  return new Set([
    ...sheet.symbols.map((x) => x.id),
    ...sheet.wires.map((x) => x.id),
    ...sheet.labels.map((x) => x.id),
    ...sheet.junctions.map((x) => x.id),
    ...sheet.noConnects.map((x) => x.id),
    ...(sheet.notes ?? []).map((x) => x.id),
  ]);
}

/** The group a thing is in, if any. */
export const groupOf = (sheet: Sheet, id: Id): SchGroup | undefined => sheet.groups?.find((g) => g.members.includes(id));

/** The next free "Group n" name on a sheet. */
export function nextGroupName(sheet: Sheet, base = "Group"): string {
  const used = new Set((sheet.groups ?? []).map((g) => g.name));
  for (let n = 1; ; n += 1) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * Gathers things into a new group. Things already in another group leave it; a group left empty goes.
 * Nothing on the sheet picked: nothing changes.
 */
export function groupOnSheet(d: ElectronicsDesign, sheetId: Id, ids: Id[], name?: string): { design: ElectronicsDesign; id: Id | null } {
  const sheet = d.sheets.find((s) => s.id === sheetId);
  if (!sheet) return { design: d, id: null };
  const here = groupable(sheet);
  const members = [...new Set(ids)].filter((id) => here.has(id));
  if (!members.length) return { design: d, id: null };
  const taken = new Set(members);
  const group: SchGroup = { id: eid("gr"), name: name?.trim() || nextGroupName(sheet), members };
  const others = (sheet.groups ?? []).map((g) => ({ ...g, members: g.members.filter((m) => !taken.has(m)) })).filter((g) => g.members.length);
  return { design: onSheet(d, sheetId, (s) => ({ ...s, groups: [...others, group] })), id: group.id };
}

/** Takes a group away and leaves its things where they are. */
export function ungroupOnSheet(d: ElectronicsDesign, sheetId: Id, groupId: Id): ElectronicsDesign {
  return onSheet(d, sheetId, (s) => tidy({ ...s, groups: (s.groups ?? []).filter((g) => g.id !== groupId) }));
}

export function renameGroup(d: ElectronicsDesign, sheetId: Id, groupId: Id, name: string): ElectronicsDesign {
  const text = name.trim();
  if (!text) return d;
  return onSheet(d, sheetId, (s) => ({ ...s, groups: (s.groups ?? []).map((g) => (g.id === groupId ? { ...g, name: text } : g)) }));
}

/** Adds things to a group, taking them out of any other. */
export function addToGroup(d: ElectronicsDesign, sheetId: Id, groupId: Id, ids: Id[]): ElectronicsDesign {
  return onSheet(d, sheetId, (s) => {
    const here = groupable(s);
    const add = ids.filter((id) => here.has(id));
    const taken = new Set(add);
    return tidy({
      ...s,
      groups: (s.groups ?? []).map((g) =>
        g.id === groupId ? { ...g, members: [...new Set([...g.members, ...add])] } : { ...g, members: g.members.filter((m) => !taken.has(m)) },
      ),
    });
  });
}

/** Takes things out of their groups; a group left empty goes. */
export function leaveGroup(d: ElectronicsDesign, sheetId: Id, ids: Id[]): ElectronicsDesign {
  const out = new Set(ids);
  return onSheet(d, sheetId, (s) => tidy({ ...s, groups: (s.groups ?? []).map((g) => ({ ...g, members: g.members.filter((m) => !out.has(m)) })) }));
}

/** Drops members that are no longer on the sheet, and groups with none left. A sheet with no groups loses the list. */
export function tidy(sheet: Sheet): Sheet {
  if (!sheet.groups) return sheet;
  const here = groupable(sheet);
  const groups = sheet.groups.map((g) => ({ ...g, members: g.members.filter((m) => here.has(m)) })).filter((g) => g.members.length);
  if (!groups.length) {
    const rest = { ...sheet };
    delete rest.groups;
    return rest;
  }
  return groups.length === sheet.groups.length && groups.every((g, i) => g.members.length === sheet.groups![i]!.members.length) ? sheet : { ...sheet, groups };
}

/**
 * A selection grown to whole groups: picking one thing in a group picks the group. `inside` is a group the user has
 * gone into (double-click), whose things are picked one by one.
 */
export function wholeGroups(sheet: Sheet, ids: Id[], inside?: Id | null): Id[] {
  if (!sheet.groups?.length) return ids;
  const out = new Set(ids);
  for (const id of ids) {
    const g = groupOf(sheet, id);
    if (g && g.id !== inside) for (const m of g.members) out.add(m);
  }
  return [...out];
}

/** Groups every member of which is in the set: the ones a selection holds whole. */
export const groupsIn = (sheet: Sheet, ids: Iterable<Id>): SchGroup[] => {
  const set = new Set(ids);
  return (sheet.groups ?? []).filter((g) => g.members.every((m) => set.has(m)));
};

// ---------------------------------------------------------------- outlines

/** The box round a symbol's shapes and pins, in its own space. */
export function symbolBox(def: SymbolDef): Box {
  const b = emptyBox();
  for (const s of def.shapes) {
    if (s.kind === "line") for (const p of s.pts) grow(b, p);
    else if (s.kind === "rect") grow(grow(b, [s.x1, s.y1]), [s.x2, s.y2]);
    else if (s.kind === "circle" || s.kind === "arc") grow(b, [s.cx, s.cy], s.r);
  }
  for (const p of def.pins) grow(b, [p.x, p.y]);
  if (b.x1 === Infinity) grow(b, [0, 0], 1.27);
  return b;
}

/** The shapes and pins of one unit of a symbol drawn in several (a chip with four gates). */
export function unitOf(def: SymbolDef, unit: number): SymbolDef {
  if (!(def.units > 1)) return def;
  return {
    ...def,
    pins: def.pins.filter((p) => p.unit === undefined || p.unit === unit),
    shapes: def.shapes.filter((s) => s.unit === undefined || s.unit === unit),
  };
}

/** A symbol's box on the sheet, after turning and mirroring. */
export function placedBox(def: SymbolDef, at: Pick<SchSymbol, "x" | "y" | "rot" | "mirror">): Box {
  const b = symbolBox(def);
  const out = emptyBox();
  for (const p of [
    [b.x1, b.y1],
    [b.x2, b.y1],
    [b.x2, b.y2],
    [b.x1, b.y2],
  ] as P2[])
    grow(out, placeOnSheet(p, at));
  return out;
}

/** A group's outline on the sheet: round its members with a margin. The name sits on the top edge. */
export interface GroupOutline {
  id: Id;
  name: string;
  box: Box;
}

/** How far a group's outline stands off its members, and the height of its name above the top edge, mm. */
export const GROUP_PAD = 2.54;
export const GROUP_NAME = 1.6;

export function groupBoxes(d: ElectronicsDesign, sheet: Sheet): GroupOutline[] {
  if (!sheet.groups?.length) return [];
  const parts = new Map(d.parts.map((x) => [x.id, x]));
  const syms = new Map(sheet.symbols.map((s) => [s.id, s]));
  const wires = new Map(sheet.wires.map((w) => [w.id, w]));
  const labels = new Map(sheet.labels.map((l) => [l.id, l]));
  const dots = new Map([...sheet.junctions, ...sheet.noConnects].map((j) => [j.id, j]));
  const out: GroupOutline[] = [];
  for (const g of sheet.groups) {
    const b = emptyBox();
    const points = new Set(g.block?.points.map((p) => p.label));
    for (const id of g.members) {
      if (points.has(id)) continue;
      const s = syms.get(id);
      const def = s && d.defs[parts.get(s.part)?.def ?? ""];
      // Room for the reference and value printed beside the body.
      if (s && def) {
        const sb = placedBox(unitOf(def.symbol, s.unit), s);
        grow(grow(b, [sb.x1, sb.y1], 1.5), [sb.x2, sb.y2], 1.5);
      }
      const w = wires.get(id);
      if (w) grow(grow(b, w.a), w.b);
      const l = labels.get(id);
      if (l) {
        const w = Math.max(2, shownName(l.name, g.block?.tag).length * 0.95);
        grow(grow(b, [l.x, l.y]), [l.x + (l.rot === 180 ? -w : w), l.y + 1.8]);
      }
      const j = dots.get(id);
      if (j) grow(b, [j.x, j.y], 0.6);
    }
    if (b.x1 === Infinity) continue;
    const box = { x1: b.x1 - GROUP_PAD, y1: b.y1 - GROUP_PAD, x2: b.x2 + GROUP_PAD, y2: b.y2 + GROUP_PAD };
    // A block keeps the outline it was laid out with (#767), measured from its first point, so its points sit on it.
    const first = g.block?.frame && labels.get(g.block.points[0]?.label ?? "");
    if (first) {
      const f = g.block!.frame!;
      grow(grow(box, [first.x + f.x1, first.y + f.y1]), [first.x + f.x2, first.y + f.y2]);
    }
    out.push({ id: g.id, name: g.name, box });
  }
  return out;
}

/** Folds groups down to boxes, or opens them again (#775). Only a block can fold: its points are what shows. */
export function setFolded(d: ElectronicsDesign, sheetId: Id, groupIds: Id[], folded: boolean): ElectronicsDesign {
  const set = new Set(groupIds);
  return onSheet(d, sheetId, (s) => ({
    ...s,
    groups: s.groups?.map((g) => {
      if (!set.has(g.id) || !g.block) return g;
      const next = { ...g };
      if (folded) next.folded = true;
      else delete next.folded;
      return next;
    }),
  }));
}

/** What folded blocks keep out of sight: every member but the points' labels. */
export function foldedAway(sheet: Sheet): Set<Id> {
  const out = new Set<Id>();
  for (const g of sheet.groups ?? []) {
    if (!g.folded || !g.block) continue;
    const points = new Set(g.block.points.map((p) => p.label));
    for (const m of g.members) if (!points.has(m)) out.add(m);
  }
  return out;
}
