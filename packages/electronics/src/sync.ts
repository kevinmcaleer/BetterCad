import { emptyBox, grow, type Box } from "./geom";
import { emptyBoard, isPower, packageOf, type Board, type ElectronicsDesign, type FootprintDef, type Id, type Placement } from "./model";
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
  for (const c of changes) {
    if (c.kind === "add-part") {
      const part = d.parts.find((p) => p.id === c.part);
      const pkg = part && packageOf(d, part);
      if (!part || !pkg) continue;
      const box = footprintBox(pkg.footprint);
      const w = box.x2 - box.x1 + 2;
      const h = box.y2 - box.y1 + 2;
      if (x + w > left + wrap && x > left) {
        x = left;
        y -= rowH;
        rowH = 0;
      }
      const at: Placement = {
        part: part.id,
        ref: part.ref,
        x: round(x - box.x1 + 1),
        y: round(y - box.y2 - 1),
        rot: 0,
        side: "top",
        footprint: pkg.footprint.name,
      };
      board.placements.push(at);
      x += w;
      rowH = Math.max(rowH, h);
    } else if (c.kind === "remove-part") {
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

/** Pushes the schematic to the board in one go: the list, then the result. */
export function pushToBoard(d: ElectronicsDesign): { design: ElectronicsDesign; changes: Change[] } {
  const nl = netlist(d);
  const changes = boardChanges(d, nl);
  return { design: applyChanges(d, changes, nl), changes };
}
