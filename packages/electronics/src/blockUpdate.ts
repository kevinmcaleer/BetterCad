/**
 * A placed block's Update (#773): a design keeps its own copy of every block it uses, so it never changes under you.
 * When the block moves on to a newer version, the copy says so, says what changed, and Update swaps its inside for
 * the new one while keeping what was joined to its points joined.
 */
import { placeBlock, type BlockSpec, type BuiltBlock } from "./blocks";
import { joinPoint } from "./connect";
import { removeFromSheet } from "./edit";
import { groupBoxes } from "./groups";
import type { ElectronicsDesign, Id, P2, Placement, SchGroup, Sheet } from "./model";
import { netlist } from "./nets";
import { isJoined } from "./points";

const groupOf = (d: ElectronicsDesign, sheetId: Id, groupId: Id): { sheet: Sheet; g: SchGroup } | null => {
  const sheet = d.sheets.find((s) => s.id === sheetId);
  const g = sheet?.groups?.find((x) => x.id === groupId);
  return sheet && g ? { sheet, g } : null;
};

/** A placed block's parts, in the order they were placed: the order of its spec's parts. */
function insideParts(d: ElectronicsDesign, sheet: Sheet, g: SchGroup) {
  const ids = new Set(sheet.symbols.filter((y) => g.members.includes(y.id)).map((y) => y.part));
  return d.parts.filter((p) => ids.has(p.id));
}

/**
 * What a block's inside is, as text that stays the same while it is moved or its parts renamed: each part's kind and
 * value, in order, and which of their pins share a net. Placing a block keeps it, so a change inside shows up.
 */
export function insidePrint(d: ElectronicsDesign, sheetId: Id, groupId: Id): string {
  const found = groupOf(d, sheetId, groupId);
  if (!found) return "";
  const parts = insideParts(d, found.sheet, found.g);
  const index = new Map(parts.map((p, i) => [p.id, i]));
  const nl = netlist(d);
  const nets = nl.nets
    .map((n) =>
      n.pins
        .filter((p) => index.has(p.part))
        .map((p) => `${index.get(p.part)}.${p.pin}`)
        .sort()
        .join(","),
    )
    .filter((s) => s.includes(","))
    .sort();
  return [parts.map((p) => `${p.def}=${p.value ?? ""}`).join(";"), nets.join("|")].join("#");
}

/** Places a block and keeps a print of its inside, so a later change by hand can be told apart from the block's own. */
export function placeBlockKept(d: ElectronicsDesign, sheetId: Id, built: BuiltBlock, at: P2, tag?: string) {
  const placed = placeBlock(d, sheetId, built, at, tag);
  if (!placed.group) return placed;
  const print = insidePrint(placed.design, sheetId, placed.group);
  return {
    ...placed,
    design: {
      ...placed.design,
      sheets: placed.design.sheets.map((s) =>
        s.id === sheetId ? { ...s, groups: s.groups?.map((g) => (g.id === placed.group ? { ...g, block: { ...g.block!, print } } : g)) } : s,
      ),
    },
  };
}

/** True when the inside of a placed block was changed by hand since it was placed. */
export function changedInside(d: ElectronicsDesign, sheetId: Id, groupId: Id): boolean {
  const found = groupOf(d, sheetId, groupId);
  const print = found?.g.block?.print;
  return !!print && print !== insidePrint(d, sheetId, groupId);
}

/** What a newer version changes, in plain words: parts' values, parts added or gone, points added or gone. */
export function whatChanged(d: ElectronicsDesign, sheetId: Id, groupId: Id, spec: BlockSpec): string[] {
  const found = groupOf(d, sheetId, groupId);
  if (!found?.g.block) return [];
  const out: string[] = [];
  if (spec.changes) out.push(spec.changes);
  const parts = insideParts(d, found.sheet, found.g);
  spec.parts.forEach((p, i) => {
    const now = parts[i];
    if (!now) out.push(`Adds ${p.ref}${p.value ? ` (${p.value})` : ""}: ${p.note}`);
    else if ((p.value ?? "") !== (now.value ?? "") && p.value) out.push(`${now.ref} becomes ${p.value}${now.value ? `, from ${now.value}` : ""}`);
  });
  for (const now of parts.slice(spec.parts.length)) out.push(`${now.ref} is no longer in it`);
  const had = new Set(found.g.block.points.map((p) => p.name));
  const has = new Set(spec.points.map((p) => p.name));
  for (const p of spec.points) if (!had.has(p.name)) out.push(`New point ${p.name}`);
  for (const p of had) if (!has.has(p)) out.push(`Point ${p} is gone`);
  return out;
}

/**
 * Swaps a placed block's inside for a newer build, in the same place and with the same tag. Each point that was
 * joined is joined again where the new point is; a point the new version no longer has is listed, and the wire to it
 * is left where it was for you. Parts already on the board keep their place where the new part is the same kind.
 */
export function updateBlock(
  d: ElectronicsDesign,
  sheetId: Id,
  groupId: Id,
  built: BuiltBlock,
): { design: ElectronicsDesign; group: Id | null; gone: string[] } {
  const found = groupOf(d, sheetId, groupId);
  const block = found?.g.block;
  if (!found || !block) return { design: d, group: null, gone: [] };
  const { sheet, g } = found;
  const box = groupBoxes(d, sheet).find((o) => o.id === g.id)?.box;
  const labels = new Map(sheet.labels.map((l) => [l.id, l]));
  const joined = block.points.flatMap((p) => {
    const l = labels.get(p.label);
    return l && p.kind !== "ground" && isJoined(sheet, [l.x, l.y]) ? [{ name: p.name, at: [l.x, l.y] as P2 }] : [];
  });
  const oldParts = insideParts(d, sheet, g);
  const placedBefore = new Map((d.board?.placements ?? []).map((p) => [p.part, p]));

  const cleared = removeFromSheet(d, sheetId, g.members);
  const without: ElectronicsDesign = {
    ...cleared,
    sheets: cleared.sheets.map((s) => (s.id === sheetId ? { ...s, groups: (s.groups ?? []).filter((x) => x.id !== g.id) } : s)),
  };
  const at: P2 = box ? [box.x1 - built.box.x1, box.y2 - built.box.y2] : [0, 0];
  const placed = placeBlockKept(without, sheetId, built, at, block.tag);
  if (!placed.group) return { design: d, group: null, gone: [] };
  let next = placed.design;

  // Keep the group's name if it was renamed.
  next = {
    ...next,
    sheets: next.sheets.map((s) => (s.id === sheetId ? { ...s, groups: s.groups?.map((x) => (x.id === placed.group ? { ...x, name: g.name } : x)) } : s)),
  };

  const now = next.sheets.find((s) => s.id === sheetId)!;
  const ng = now.groups!.find((x) => x.id === placed.group)!;
  const nlabels = new Map(now.labels.map((l) => [l.id, l]));
  const gone: string[] = [];
  for (const j of joined) {
    const p = ng.block!.points.find((x) => x.name === j.name);
    const l = p && nlabels.get(p.label);
    if (!l) {
      gone.push(j.name);
      continue;
    }
    if (l.x !== j.at[0] || l.y !== j.at[1]) next = joinPoint(next, sheetId, j.at, [l.x, l.y]);
  }

  // Board places carry over, part for part, where the kind of part stays the same.
  if (next.board && placedBefore.size) {
    const newParts = insideParts(
      next,
      next.sheets.find((s) => s.id === sheetId)!,
      ng,
    );
    const swap = new Map<Id, { part: Id; ref: string }>();
    newParts.forEach((p, i) => {
      const old = oldParts[i];
      if (old && placedBefore.has(old.id) && old.def === p.def) swap.set(old.id, { part: p.id, ref: p.ref });
    });
    if (swap.size)
      next = {
        ...next,
        board: { ...next.board, placements: next.board.placements.map((at): Placement => (swap.has(at.part) ? { ...at, ...swap.get(at.part)! } : at)) },
      };
  }
  return { design: next, group: placed.group, gone };
}
