import { emptyBox, grow, type Box } from "./geom";
import { emptyBoard, isPower, packageOf, type Board, type ElectronicsDesign, type FootprintDef, type Id, type Placement, type SchGroup } from "./model";
import { byRef, netlist, pinKey, type Netlist } from "./nets";

/**
 * The change list (#620): what has to happen to the board for it to match the schematic. Nothing here changes the
 * design; `applyChanges` does, as one step, after the person has seen the list.
 */
export type Change =
  | { kind: "make-board" }
  | { kind: "add-part"; part: Id; ref: string }
  | { kind: "remove-part"; part: Id; ref: string }
  | { kind: "change-footprint"; part: Id; ref: string; from: string; to: string }
  /** A net got a new name; its copper follows. */
  | { kind: "rename-net"; from: string; to: string; copper: number }
  /** A net is gone but copper is still on the board for it. The copper stays until it is removed by hand. */
  | { kind: "dead-net"; net: string; copper: number }
  /** A part has no footprint, so it cannot go on the board. */
  | { kind: "no-footprint"; part: Id; ref: string };

/** Changes that stop a push until they are fixed. */
export const blocks = (c: Change): boolean => c.kind === "no-footprint";

/** One line for the card, in plain words. */
export function describeChange(c: Change): string {
  switch (c.kind) {
    case "make-board":
      return "Make a 2-layer board, 1.6 mm thick";
    case "add-part":
      return `Add ${c.ref} beside the board`;
    case "remove-part":
      return `Remove ${c.ref} from the board`;
    case "change-footprint":
      return `${c.ref}: footprint changes from ${c.from} to ${c.to}`;
    case "rename-net":
      return `Net ${c.from} becomes ${c.to}${c.copper ? `, with ${c.copper} ${c.copper === 1 ? "piece" : "pieces"} of copper` : ""}`;
    case "dead-net":
      return `Net ${c.net} is gone but ${c.copper} ${c.copper === 1 ? "piece" : "pieces"} of copper still use it`;
    case "no-footprint":
      return `${c.ref} has no footprint, so it can't go on the board`;
  }
}

/** The pins of each net, as the board last saw them. */
export function netPins(nl: Netlist): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const n of nl.nets) if (n.pins.length) out[n.name] = n.pins.map((p) => pinKey(p.part, p.pin)).sort();
  return out;
}

function copperOn(board: Board, net: string): number {
  return board.tracks.filter((t) => t.net === net).length + board.vias.filter((v) => v.net === net).length + board.pours.filter((p) => p.net === net).length;
}

/** Compares the schematic with the board. An empty list means the board is in step. */
export function boardChanges(d: ElectronicsDesign, nl: Netlist = netlist(d)): Change[] {
  const out: Change[] = [];
  const board = d.board;
  if (!board) out.push({ kind: "make-board" });
  const placed = new Map((board?.placements ?? []).map((p) => [p.part, p]));
  const real = d.parts.filter((p) => !isPower(d, p)).sort((a, b) => byRef(a.ref, b.ref));
  const ids = new Set(real.map((p) => p.id));
  for (const part of real) {
    const pkg = packageOf(d, part);
    if (!pkg) {
      out.push({ kind: "no-footprint", part: part.id, ref: part.ref });
      continue;
    }
    const at = placed.get(part.id);
    if (!at) out.push({ kind: "add-part", part: part.id, ref: part.ref });
    else if (at.footprint !== undefined && at.footprint !== pkg.footprint.name)
      out.push({ kind: "change-footprint", part: part.id, ref: part.ref, from: at.footprint, to: pkg.footprint.name });
  }
  for (const at of board?.placements ?? []) if (!ids.has(at.part)) out.push({ kind: "remove-part", part: at.part, ref: at.ref ?? "a part" });
  if (board) {
    const now = netPins(nl);
    const before = board.synced?.nets ?? {};
    const used = new Set([...board.tracks.map((t) => t.net), ...board.vias.map((v) => v.net), ...board.pours.map((p) => p.net)]);
    const taken = new Set<string>();
    for (const old of [...new Set([...Object.keys(before), ...used])].sort(byRef)) {
      if (old in now || old === "") continue;
      const pins = new Set(before[old] ?? []);
      let best: string | undefined;
      let bestShare = 0;
      for (const [name, list] of Object.entries(now)) {
        if (name in before || taken.has(name) || pins.size === 0) continue;
        const share = list.filter((p) => pins.has(p)).length / Math.max(pins.size, list.length);
        if (share > bestShare) [best, bestShare] = [name, share];
      }
      const copper = copperOn(board, old);
      if (best && bestShare >= 0.5) {
        taken.add(best);
        // With no copper on it there is nothing to carry, so a new name is not news.
        if (copper) out.push({ kind: "rename-net", from: old, to: best, copper });
      } else if (copper) out.push({ kind: "dead-net", net: old, copper });
    }
  }
  return out;
}

/** The space a footprint takes: its courtyard if it has one, else its pads. */
export function footprintBox(f: FootprintDef): Box {
  const b = emptyBox();
  for (const s of f.shapes) {
    if (s.layer !== "courtyard") continue;
    if (s.kind === "rect") grow(grow(b, [s.x1, s.y1]), [s.x2, s.y2]);
    else if (s.kind === "line") for (const p of s.pts) grow(b, p);
    else if (s.kind === "circle") grow(b, [s.cx, s.cy], s.r);
  }
  if (b.x1 === Infinity) for (const p of f.pads) grow(b, [p.x, p.y], Math.max(p.w, p.h) / 2 + 0.25);
  if (b.x1 === Infinity) grow(b, [0, 0], 1);
  return b;
}

export function outlineBox(board: Pick<Board, "outline">): Box {
  const b = emptyBox();
  for (const c of board.outline) grow(b, [c.x, c.y]);
  return b;
}

/**
 * Applies a change list to the board. New parts are set out in rows to the right of the board, in reference order,
 * so nothing lands on top of work already done. Returns a new design; the one passed in is not touched.
 */
export function applyChanges(d: ElectronicsDesign, changes: Change[], nl: Netlist = netlist(d)): ElectronicsDesign {
  if (changes.some(blocks)) return d;
  const board: Board = d.board ? structuredClone(d.board) : emptyBoard();
  const edge = outlineBox(board);
  // Rows start to the right of the board and of anything already parked there.
  let left = edge.x2 + 5;
  for (const p of board.placements) if (p.x > edge.x2) left = Math.max(left, p.x + 5);
  let x = left;
  let y = edge.y2;
  let rowH = 0;
  const wrap = Math.max(60, edge.x2 - edge.x1);
  // New parts of one schematic group land together, as one cluster in the rows (#774).
  const adds = changes.flatMap((c) => (c.kind === "add-part" ? [c.part] : []));
  for (const item of clusters(d, adds)) {
    const w = item.box.x2 - item.box.x1 + 2;
    const h = item.box.y2 - item.box.y1 + 2;
    if (x + w > left + wrap && x > left) {
      x = left;
      y -= rowH;
      rowH = 0;
    }
    for (const at of item.placements) board.placements.push({ ...at, x: round(at.x + x - item.box.x1 + 1), y: round(at.y + y - item.box.y2 - 1) });
    x += w;
    rowH = Math.max(rowH, h);
  }
  for (const c of changes) {
    if (c.kind === "remove-part") {
      board.placements = board.placements.filter((p) => p.part !== c.part);
    } else if (c.kind === "change-footprint") {
      const at = board.placements.find((p) => p.part === c.part);
      if (at) at.footprint = c.to;
    } else if (c.kind === "rename-net") {
      for (const t of board.tracks) if (t.net === c.from) t.net = c.to;
      for (const v of board.vias) if (v.net === c.from) v.net = c.to;
      for (const p of board.pours) if (p.net === c.from) p.net = c.to;
      for (const k of board.classes) k.nets = k.nets.map((n) => (n === c.from ? c.to : n));
    }
  }
  // References and footprint names ride along so the board can name a part after it is gone from the schematic.
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  for (const at of board.placements) {
    const part = parts.get(at.part);
    if (!part) continue;
    at.ref = part.ref;
    at.footprint = packageOf(d, part)?.footprint.name ?? at.footprint;
  }
  board.synced = { nets: netPins(nl) };
  return { ...d, board };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** A footprint's space turned by `rot` degrees (a quarter turn at a time; other angles take the turned square). */
export function turnedBox(b: Box, rot: number): Box {
  const r = ((Math.round(rot / 90) % 4) + 4) % 4;
  if (rot % 90) {
    const m = Math.max(Math.abs(b.x1), Math.abs(b.x2), Math.abs(b.y1), Math.abs(b.y2)) * Math.SQRT2;
    return { x1: -m, y1: -m, x2: m, y2: m };
  }
  if (r === 0) return b;
  if (r === 1) return { x1: -b.y2, y1: b.x1, x2: -b.y1, y2: b.x2 };
  if (r === 2) return { x1: -b.x2, y1: -b.y2, x2: -b.x1, y2: -b.y1 };
  return { x1: b.y1, y1: -b.x2, x2: b.y2, y2: -b.x1 };
}

/** The schematic group each part is in, by part id. */
export function partGroups(d: ElectronicsDesign): Map<Id, SchGroup> {
  const out = new Map<Id, SchGroup>();
  for (const sheet of d.sheets) {
    const partOf = new Map(sheet.symbols.map((y) => [y.id, y.part]));
    for (const g of sheet.groups ?? []) for (const m of g.members) if (partOf.has(m) && !out.has(partOf.get(m)!)) out.set(partOf.get(m)!, g);
  }
  return out;
}

/** Every part of the groups the given parts are in, with the given ones that are in none (#774). */
export function pickGroups(d: ElectronicsDesign, ids: Id[]): Id[] {
  const groups = partGroups(d);
  const want = new Set(ids.flatMap((id) => (groups.has(id) ? [groups.get(id)!.id] : [])));
  return [...new Set([...ids, ...[...groups].filter(([, g]) => want.has(g.id)).map(([part]) => part)])];
}

/**
 * Outlines round groups' footprints on the board (#774): every group whose parts are all picked, and every group
 * still parked off the board, so a fresh push shows which cluster is which. A group needs two parts on the board.
 */
export function boardGroups(d: ElectronicsDesign, selected: ReadonlySet<Id>): { id: Id; name: string; box: Box; picked: boolean }[] {
  const board = d.board;
  if (!board) return [];
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const edge = outlineBox(board);
  const by = new Map<Id, { g: SchGroup; at: Placement[] }>();
  const groups = partGroups(d);
  for (const at of board.placements) {
    const g = groups.get(at.part);
    if (g) by.set(g.id, { g, at: [...(by.get(g.id)?.at ?? []), at] });
  }
  const out: { id: Id; name: string; box: Box; picked: boolean }[] = [];
  for (const { g, at } of by.values()) {
    if (at.length < 2) continue;
    const box = emptyBox();
    for (const p of at) {
      const part = parts.get(p.part);
      const pkg = part && packageOf(d, part);
      const b = turnedBox(pkg ? footprintBox(pkg.footprint) : { x1: -1, y1: -1, x2: 1, y2: 1 }, p.rot);
      grow(grow(box, [p.x + b.x1, p.y + b.y1]), [p.x + b.x2, p.y + b.y2]);
    }
    const picked = at.every((p) => selected.has(p.part));
    const parked = box.x1 > edge.x2 || box.x2 < edge.x1 || box.y1 > edge.y2 || box.y2 < edge.y1;
    if (picked || parked) out.push({ id: g.id, name: g.name, box: { x1: box.x1 - 0.5, y1: box.y1 - 0.5, x2: box.x2 + 0.5, y2: box.y2 + 0.5 }, picked });
  }
  return out;
}

interface Cluster {
  /** The group's name, or none for a part on its own. */
  name?: string;
  /** Placements round the cluster's own origin. */
  placements: Placement[];
  box: Box;
}

/**
 * New parts set out for the board: each group's parts together, a block's on its layout guide where it has one and
 * packed close where not, and every other part on its own (#774). In reference order of each cluster's first part.
 */
export function clusters(d: ElectronicsDesign, ids: Id[]): Cluster[] {
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const groups = partGroups(d);
  const buckets = new Map<string, Id[]>();
  for (const id of ids) {
    const g = groups.get(id);
    const k = g ? `g:${g.id}` : `p:${id}`;
    buckets.set(k, [...(buckets.get(k) ?? []), id]);
  }
  const out: (Cluster & { first: string })[] = [];
  for (const [k, members] of buckets) {
    const g = k.startsWith("g:") ? groups.get(members[0]!) : undefined;
    const items = members.flatMap((id) => {
      const part = parts.get(id);
      const pkg = part && packageOf(d, part);
      return part && pkg ? [{ part, pkg, box: footprintBox(pkg.footprint) }] : [];
    });
    if (!items.length) continue;
    items.sort((a, b) => byRef(a.part.ref, b.part.ref));
    const placements: Placement[] = [];
    const box = emptyBox();
    const put = (it: (typeof items)[number], x: number, y: number, rot: number) => {
      placements.push({ part: it.part.id, ref: it.part.ref, x: round(x), y: round(y), rot, side: "top", footprint: it.pkg.footprint.name });
      const t = turnedBox(it.box, rot);
      grow(grow(box, [x + t.x1, y + t.y1]), [x + t.x2, y + t.y2]);
    };
    const guide = g?.block?.layout;
    const rest = guide ? items.filter((it) => !guide[it.part.id]) : items;
    for (const it of items) {
      const spot = guide?.[it.part.id];
      if (spot) put(it, spot.x, spot.y, spot.rot);
    }
    // The rest in rows about as wide as they are tall, under what the guide placed.
    const area = rest.reduce((a, it) => a + (it.box.x2 - it.box.x1 + 1) * (it.box.y2 - it.box.y1 + 1), 0);
    const widest = Math.max(0, ...rest.map((it) => it.box.x2 - it.box.x1 + 1));
    const rowW = Math.max(widest, Math.sqrt(area) * 1.4);
    let cx = box.x1 === Infinity ? 0 : box.x1;
    let cy = box.y1 === Infinity ? 0 : box.y1 - 1;
    const startX = cx;
    let h = 0;
    for (const it of rest) {
      const w = it.box.x2 - it.box.x1 + 1;
      if (cx + w > startX + rowW && cx > startX) {
        cx = startX;
        cy -= h;
        h = 0;
      }
      put(it, cx - it.box.x1, cy - it.box.y2, 0);
      cx += w;
      h = Math.max(h, it.box.y2 - it.box.y1 + 1);
    }
    // Room above for the group's name.
    if (g) box.y2 += 2;
    out.push({ ...(g ? { name: g.name } : {}), placements, box, first: items[0]!.part.ref });
  }
  return out.sort((a, b) => byRef(a.first, b.first)).map(({ first: _f, ...c }) => c);
}

/** Pushes the schematic to the board in one go: the list, then the result. */
export function pushToBoard(d: ElectronicsDesign): { design: ElectronicsDesign; changes: Change[] } {
  const nl = netlist(d);
  const changes = boardChanges(d, nl);
  return { design: applyChanges(d, changes, nl), changes };
}
