import { GRID } from "./basics";
import { nextRef } from "./edit";
import { key, q } from "./geom";
import { eid, type ElectronicsDesign, type Id, type P2, type Part, type Sheet, type SheetBox } from "./model";

/**
 * Hierarchy (#757). A sheet can be placed on another as a box, with a pin for each of its sheet pins (labels marked
 * `port`). Each use of a sheet has nets of its own: its labels are stored as `prefix/name`, and a wire on a box's pin
 * joins the net of that name. Placing a sheet a second time makes a copy that follows the first, its master: after
 * every change to the master, each copy is drawn from it again, keeping its own parts and references, so a block used
 * four times is one drawing. Push to PCB lays every use, and `repeatLayout` gives the copies the master's layout.
 */

/** How far apart a box's pins are, and how wide a box is. */
export const PIN_STEP = 2 * GRID;
export const BOX_W = 8 * GRID;

/** A label's name as it shows on its sheet: without its use's prefix. */
export const localName = (name: string, sheet?: Pick<Sheet, "use">): string => {
  const pre = sheet?.use ? `${sheet.use.prefix}/` : "";
  return pre && name.startsWith(pre) ? name.slice(pre.length) : name;
};

/** What a label typed on a sheet is stored as: a use's labels carry its prefix. */
export const storedName = (name: string, sheet?: Pick<Sheet, "use">): string =>
  sheet?.use && !name.startsWith(`${sheet.use.prefix}/`) ? `${sheet.use.prefix}/${name}` : name;

/** A sheet's pins, by the name shown on them, in order. */
export function portsOf(sheet: Sheet): string[] {
  return [...new Set(sheet.labels.filter((l) => l.port).map((l) => localName(l.name, sheet)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * A box's pins: the first half down its left side, the rest down its right, a pin every two grid steps. A box from
 * KiCad keeps its pins where they were; any new ones go below them.
 */
export function boxPins(d: ElectronicsDesign, box: SheetBox): { name: string; at: P2; side: "left" | "right" }[] {
  const child = d.sheets.find((s) => s.id === box.sheet);
  if (!child) return [];
  const ports = portsOf(child);
  const kept = new Map((box.pins ?? []).map((p) => [p.name, p]));
  const width = box.w ?? BOX_W;
  const lowest = Math.min(0, ...(box.pins ?? []).filter((p) => ports.includes(p.name)).map((p) => p.dy));
  const rest = ports.filter((p) => !kept.has(p));
  const left = Math.ceil(rest.length / 2);
  return ports.map((name) => {
    const k = kept.get(name);
    if (k) return { name, side: k.side, at: [q(box.x + k.dx), q(box.y + k.dy)] as P2 };
    const i = rest.indexOf(name);
    const side = i < left ? "left" : "right";
    const row = side === "left" ? i : i - left;
    return { name, side, at: [q(side === "left" ? box.x : box.x + width), q(box.y + lowest - (row + 1) * PIN_STEP)] as P2 };
  });
}

/** The corners of a box: from its top left, down to the row below its last pin. */
export function boxRect(d: ElectronicsDesign, box: SheetBox): { x1: number; y1: number; x2: number; y2: number } {
  const pins = boxPins(d, box);
  const low = Math.min(box.y - (box.h ?? 2 * PIN_STEP), ...pins.map((p) => p.at[1] - PIN_STEP));
  return { x1: box.x, y1: q(low), x2: q(box.x + (box.w ?? BOX_W)), y2: box.y };
}

/** The sheet a box is on, for each box. */
const boxHome = (d: ElectronicsDesign, box: Id): Sheet | undefined => d.sheets.find((s) => s.boxes?.some((b) => b.id === box));

/** Whether `inner` is `outer` or is placed, at any depth, inside it. */
function within(d: ElectronicsDesign, inner: Id, outer: Id): boolean {
  for (let at: Sheet | undefined = d.sheets.find((s) => s.id === inner), n = 0; at && n < 64; n += 1) {
    if (at.id === outer) return true;
    at = at.use ? boxHome(d, at.use.box) : undefined;
  }
  return false;
}

/** A prefix for a new use, from the sheet's name, that no other use has. */
function freePrefix(d: ElectronicsDesign, name: string): string {
  const base = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Block";
  const taken = new Set(d.sheets.flatMap((s) => (s.use ? [s.use.prefix] : [])));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

const prefixed = (name: string, from: string, to: string): string => (name.startsWith(`${from}/`) ? `${to}/${name.slice(from.length + 1)}` : name);

/** The copies that follow a master. */
export const copiesOf = (d: ElectronicsDesign, master: Id): Sheet[] => d.sheets.filter((s) => s.use?.master === master);

/** The master of a use: itself, unless it is a copy. */
export const masterOf = (sheet: Sheet): Id => sheet.use?.master ?? sheet.id;

/**
 * Places `child` on `parent` as a box with its top left at `at`. The first time, `child` becomes a use, its labels
 * taking the use's prefix; after that, each box is a new copy of it that follows it. Null when that would place a
 * sheet inside itself.
 */
export function placeSheetBox(d: ElectronicsDesign, parent: Id, child: Id, at: P2): { design: ElectronicsDesign; box: Id; sheet: Id } | null {
  const from = d.sheets.find((s) => s.id === child);
  if (!from || !d.sheets.some((s) => s.id === parent) || within(d, parent, masterOf(from))) return null;
  const box: SheetBox = { id: eid("bx"), sheet: child, x: q(at[0]), y: q(at[1]) };
  const onParent = (x: ElectronicsDesign, b: SheetBox) => ({
    ...x,
    sheets: x.sheets.map((s) => (s.id === parent ? { ...s, boxes: [...(s.boxes ?? []), b] } : s)),
  });
  if (!from.use) {
    const prefix = freePrefix(d, from.name);
    const used: Sheet = {
      ...from,
      use: { box: box.id, prefix },
      labels: from.labels.map((l) => ({ ...l, name: `${prefix}/${l.name}` })),
    };
    return { design: onParent({ ...d, sheets: d.sheets.map((s) => (s.id === child ? used : s)) }, box), box: box.id, sheet: child };
  }
  // Placed again: a copy of the master, with parts of its own.
  const master = masterOf(from);
  const masterSheet = d.sheets.find((s) => s.id === master)!;
  const id = eid("sh");
  const prefix = freePrefix(d, masterSheet.name);
  const n = copiesOf(d, master).length + 2;
  const stub: Sheet = {
    id,
    name: `${masterSheet.name} (${n})`,
    symbols: [],
    wires: [],
    junctions: [],
    labels: [],
    noConnects: [],
    use: { box: box.id, prefix, master, links: {} },
  };
  const at0 = d.sheets.findIndex((s) => s.id === (copiesOf(d, master).at(-1)?.id ?? master));
  const sheets = [...d.sheets.slice(0, at0 + 1), stub, ...d.sheets.slice(at0 + 1)];
  const placed = onParent({ ...d, sheets }, { ...box, sheet: id });
  return { design: syncCopy(placed, id), box: box.id, sheet: id };
}

/**
 * Draws a copy from its master again (#757). Each of the master's symbols keeps the copy's own symbol and part, so
 * references and the board stay as they were; a new one gets a part of its own, and one taken away goes.
 */
export function syncCopy(d: ElectronicsDesign, copyId: Id): ElectronicsDesign {
  const copy = d.sheets.find((s) => s.id === copyId);
  const master = copy?.use?.master ? d.sheets.find((s) => s.id === copy.use!.master) : undefined;
  if (!copy?.use || !master?.use) return d;
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const oldLinks = copy.use.links ?? {};
  const oldSym = new Map(copy.symbols.map((s) => [s.id, s]));
  const links: Record<Id, Id> = {};
  // The master's parts to the copy's: kept from the last time, else new.
  const partFor = new Map<Id, Id>();
  for (const s of master.symbols) {
    const mine = oldSym.get(oldLinks[s.id] ?? "");
    if (mine && !partFor.has(s.part)) partFor.set(s.part, mine.part);
  }
  let next = d;
  const fresh: Part[] = [];
  for (const s of master.symbols) {
    if (partFor.has(s.part)) continue;
    const p = parts.get(s.part);
    if (!p) continue;
    const prefix = d.defs[p.def]?.prefix ?? p.ref.replace(/\d+$/, "");
    const made: Part = { ...p, id: eid("pt"), ref: nextRef({ ...next, parts: [...next.parts, ...fresh] }, prefix) };
    fresh.push(made);
    partFor.set(s.part, made.id);
  }
  const symbols = master.symbols.map((s) => {
    const id = oldSym.has(oldLinks[s.id] ?? "") ? oldLinks[s.id]! : eid("sy");
    links[s.id] = id;
    return { ...s, id, part: partFor.get(s.part) ?? s.part };
  });
  const from = master.use.prefix;
  const to = copy.use.prefix;
  const mapped = new Map([...partFor].map(([m, c]) => [c, m]));
  const keep = new Set(symbols.map((s) => s.part));
  const gone = new Set(copy.symbols.map((s) => s.part).filter((p) => !keep.has(p)));
  const own = (id: Id) => `${copyId}~${id}`;
  const drawn: Sheet = {
    ...copy,
    symbols,
    wires: master.wires.map((w) => ({ ...w, id: own(w.id) })),
    junctions: master.junctions.map((j) => ({ ...j, id: own(j.id) })),
    noConnects: master.noConnects.map((x) => ({ ...x, id: own(x.id) })),
    labels: master.labels.map((l) => ({ ...l, id: own(l.id), name: prefixed(l.name, from, to) })),
    ...(master.notes ? { notes: master.notes.map((x) => ({ ...x, id: own(x.id) })) } : {}),
    ...(master.buses ? { buses: master.buses.map((x) => ({ ...x, id: own(x.id), name: prefixed(x.name, from, to) })) } : {}),
    ...(master.busEntries ? { busEntries: master.busEntries.map((x) => ({ ...x, id: own(x.id) })) } : {}),
    use: { ...copy.use, links },
  };
  if (!master.notes) delete drawn.notes;
  if (!master.buses) delete drawn.buses;
  if (!master.busEntries) delete drawn.busEntries;
  next = {
    ...next,
    sheets: next.sheets.map((s) => (s.id === copyId ? drawn : s)),
    // A copy's part says what the master's says, but keeps its own reference.
    parts: [
      ...next.parts
        .filter((p) => !gone.has(p.id))
        .map((p) => {
          const m = mapped.get(p.id);
          const src = m && parts.get(m);
          return src && (src.def !== p.def || src.value !== p.value || src.pkg !== p.pkg || src.fitted !== p.fitted || src.supplier !== p.supplier)
            ? { ...src, id: p.id, ref: p.ref }
            : p;
        }),
      ...fresh,
    ],
  };
  return next;
}

/**
 * After an edit, draws every copy whose master the edit changed again (#757). The app runs each edit through this,
 * so the copies follow without anyone asking.
 */
export function keepUsesInStep(before: ElectronicsDesign, after: ElectronicsDesign): ElectronicsDesign {
  const masters = new Set(after.sheets.flatMap((s) => (s.use?.master ? [s.use.master] : [])));
  if (!masters.size) return after;
  const was = new Map(before.sheets.map((s) => [s.id, s]));
  const partsWere = new Map(before.parts.map((p) => [p.id, p]));
  let out = after;
  for (const m of masters) {
    const sheet = after.sheets.find((s) => s.id === m);
    if (!sheet) continue;
    const changed =
      was.get(m) !== sheet || before.defs !== after.defs || sheet.symbols.some((s) => partsWere.get(s.part) !== after.parts.find((p) => p.id === s.part));
    if (!changed) continue;
    for (const c of copiesOf(out, m)) out = syncCopy(out, c.id);
  }
  return out;
}

/**
 * Takes a box off its sheet (#757). A copy's sheet and parts go with it. The master's sheet stays: if copies follow
 * it, the first of them becomes the master in its place and the old master is a plain sheet again.
 */
export function removeBox(d: ElectronicsDesign, boxId: Id): ElectronicsDesign {
  const home = boxHome(d, boxId);
  const box = home?.boxes?.find((b) => b.id === boxId);
  if (!home || !box) return d;
  const child = d.sheets.find((s) => s.id === box.sheet);
  let out: ElectronicsDesign = { ...d, sheets: d.sheets.map((s) => (s === home ? { ...s, boxes: s.boxes!.filter((b) => b.id !== boxId) } : s)) };
  if (!child?.use) return out;
  if (child.use.master) {
    const parts = new Set(child.symbols.map((s) => s.part));
    return { ...out, sheets: out.sheets.filter((s) => s.id !== child.id), parts: out.parts.filter((p) => !parts.has(p.id)) };
  }
  const copies = copiesOf(out, child.id);
  const plain: Sheet = { ...child, labels: child.labels.map((l) => ({ ...l, name: localName(l.name, child) })) };
  delete plain.use;
  out = { ...out, sheets: out.sheets.map((s) => (s.id === child.id ? plain : s)) };
  if (!copies.length) return out;
  // The first copy is the master now; the others follow it, linked symbol by symbol through the old master.
  const [first, ...rest] = copies;
  const firstLinks = first!.use!.links ?? {};
  return {
    ...out,
    sheets: out.sheets.map((s) => {
      if (s.id === first!.id) return { ...s, use: { box: s.use!.box, prefix: s.use!.prefix } };
      if (!rest.some((r) => r.id === s.id)) return s;
      const links: Record<Id, Id> = {};
      for (const [m, mine] of Object.entries(s.use!.links ?? {})) if (firstLinks[m]) links[firstLinks[m]!] = mine;
      return { ...s, use: { ...s.use!, master: first!.id, links } };
    }),
  };
}

/** Makes the picked labels sheet pins, or plain labels again. */
export function setPorts(d: ElectronicsDesign, sheet: Id, ids: Id[], port: boolean): ElectronicsDesign {
  const set = new Set(ids);
  return {
    ...d,
    sheets: d.sheets.map((s) =>
      s.id !== sheet
        ? s
        : {
            ...s,
            labels: s.labels.map((l) => {
              if (!set.has(l.id)) return l;
              const next = { ...l, port: true };
              if (!port) delete (next as { port?: boolean }).port;
              return next;
            }),
          },
    ),
  };
}

/** Moves a box, carrying the wire ends on its pins with it. */
export function moveBox(d: ElectronicsDesign, boxId: Id, dx: number, dy: number): ElectronicsDesign {
  const home = boxHome(d, boxId);
  const box = home?.boxes?.find((b) => b.id === boxId);
  if (!home || !box || (!dx && !dy)) return d;
  const ends = new Set(boxPins(d, box).map((p) => key(p.at[0], p.at[1])));
  const shift = (p: P2): P2 => (ends.has(key(p[0], p[1])) ? [q(p[0] + dx), q(p[1] + dy)] : p);
  return {
    ...d,
    sheets: d.sheets.map((s) =>
      s !== home
        ? s
        : {
            ...s,
            boxes: s.boxes!.map((b) => (b.id === boxId ? { ...b, x: q(b.x + dx), y: q(b.y + dy) } : b)),
            wires: s.wires.map((w) => ({ ...w, a: shift(w.a), b: shift(w.b) })),
          },
    ),
  };
}

/**
 * Repeats one use's layout on the board for the others (#757): each copy's parts sit as the master's do, the whole
 * group moved across by its width and a 5 mm gap per copy, and its tracks and vias are copied onto the copy's nets.
 */
export function repeatLayout(d: ElectronicsDesign, master: Id): ElectronicsDesign {
  const board = d.board;
  const m = d.sheets.find((s) => s.id === master);
  if (!board || !m?.use) return d;
  const at = new Map(board.placements.map((p) => [p.part, p]));
  const mine = [...new Set(m.symbols.map((s) => s.part))].filter((p) => at.has(p));
  if (!mine.length) return d;
  const xs = mine.map((p) => at.get(p)!.x);
  const width = Math.max(...xs) - Math.min(...xs);
  const nets = (name: string) => name.startsWith(`${m.use!.prefix}/`);
  let placements = board.placements;
  const tracks = [...board.tracks];
  const vias = [...board.vias];
  copiesOf(d, master).forEach((c, k) => {
    const dx = q((k + 1) * (width + 5 + 10));
    const partOf = new Map<Id, Id>();
    for (const s of m.symbols) {
      const theirs = c.symbols.find((x) => x.id === c.use!.links?.[s.id]);
      if (theirs) partOf.set(s.part, theirs.part);
    }
    placements = placements.map((p) => {
      const from = [...partOf].find(([, cp]) => cp === p.part)?.[0];
      const src = from && at.get(from);
      return src ? { ...p, x: q(src.x + dx), y: src.y, rot: src.rot, side: src.side } : p;
    });
    const rename = (n: string) => prefixed(n, m.use!.prefix, c.use!.prefix);
    for (const t of board.tracks) if (nets(t.net)) tracks.push({ ...t, id: eid("tr"), net: rename(t.net), pts: t.pts.map((p): P2 => [q(p[0] + dx), p[1]]) });
    for (const v of board.vias) if (nets(v.net)) vias.push({ ...v, id: eid("vi"), net: rename(v.net), x: q(v.x + dx) });
  });
  return { ...d, board: { ...board, placements, tracks, vias } };
}
