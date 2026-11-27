import {
  boxesTouch,
  distToSegment,
  emptyBox,
  footprintBox,
  grow,
  outlinePoints,
  packageOf,
  placeOnBoard,
  type Board,
  type BoardNote,
  type BoardPad,
  type Box,
  type CopperLayer,
  type ElectronicsDesign,
  type P2,
} from "@bettercad/electronics";
import { noteStrokes } from "@bettercad/electronics/pcb/notes";
import { inBox } from "./hit";
import { boardTextStrokes } from "./drawBoard";

/** The box round a board text as it is drawn: its strokes, and half the pen round them (#730). */
export function textBox(t: Board["texts"][number]): Box {
  const { lines, pen } = boardTextStrokes(t);
  const b = emptyBox();
  for (const line of lines) for (const p of line) grow(b, p, pen / 2);
  if (b.x1 === Infinity) grow(b, [t.x, t.y], t.size / 2);
  return b;
}

export interface BoardHit {
  kind: "part" | "track" | "via" | "hole" | "text" | "picture" | "pad" | "area" | "mark" | "note";
  /** A part's id for parts and pads; the thing's own id otherwise. */
  id: string;
  net?: string;
  pad?: BoardPad;
  /** For a track: which piece of it. */
  segment?: number;
}

/** What the selection filter sorts the board's things into (#748), with the names the Layers card shows. */
export const PICK_KINDS = [
  ["parts", "Parts"],
  ["tracks", "Tracks"],
  ["vias", "Vias"],
  ["pours", "Pours"],
  ["text", "Text"],
  ["holes", "Holes"],
] as const;
export type PickKind = (typeof PICK_KINDS)[number][0];

/** Which things a click or a drag box may pick: the kinds left out, and whether locked parts are left out too. */
export interface PickFilter {
  off: PickKind[];
  skipLocked: boolean;
}

/** The filter's kind for a hit: pads go with their parts, pictures and notes with text, marks with holes, keep-outs with pours. */
export const pickKindOf = (kind: BoardHit["kind"]): PickKind =>
  kind === "part" || kind === "pad"
    ? "parts"
    : kind === "track"
      ? "tracks"
      : kind === "via"
        ? "vias"
        : kind === "area"
          ? "pours"
          : kind === "text" || kind === "picture" || kind === "note"
            ? "text"
            : "holes";

/** Whether the filter lets a thing be picked. */
export function pickable(board: Board, f: PickFilter | undefined, kind: BoardHit["kind"], id: string): boolean {
  if (!f) return true;
  if (f.off.includes(pickKindOf(kind))) return false;
  if (f.skipLocked && (kind === "part" || kind === "pad")) return !board.placements.find((p) => p.part === id)?.locked;
  return true;
}

/** Whether a point is on a note (#749): on one of its lines, or within its words' box. */
function onNote(n: BoardNote, p: P2, tol: number): boolean {
  const { lines, pen } = noteStrokes(n);
  if (n.kind === "text") {
    const b = emptyBox();
    for (const l of lines) for (const q of l) grow(b, q, pen / 2);
    return b.x1 !== Infinity && inBox(p, b, tol);
  }
  return lines.some((l) => l.some((q, i) => i > 0 && distToSegment(p, l[i - 1]!, q) <= pen / 2 + tol));
}

/** A placed footprint's box on the board. */
export function placementBox(d: ElectronicsDesign, at: Board["placements"][number]): Box | null {
  const part = d.parts.find((p) => p.id === at.part);
  const pkg = part && packageOf(d, part);
  if (!pkg) return null;
  const b = footprintBox(pkg.footprint);
  const out = emptyBox();
  for (const p of [
    [b.x1, b.y1],
    [b.x2, b.y1],
    [b.x2, b.y2],
    [b.x1, b.y2],
  ] as P2[])
    grow(out, placeOnBoard(p, at));
  return out;
}

/** The areas drawn on the board: pours, keep-outs and cut-outs (named "cut:" and their place in the list). */
export function boardAreas(board: Board): { id: string; kind: "pour" | "keepout" | "cutout"; outline: P2[]; net?: string }[] {
  return [
    ...board.pours.map((x) => ({ id: x.id, kind: "pour" as const, outline: x.outline, net: x.net })),
    ...board.keepouts.map((x) => ({ id: x.id, kind: "keepout" as const, outline: x.outline })),
    ...(board.cutouts ?? []).map((x, i) => ({ id: `cut:${i}`, kind: "cutout" as const, outline: outlinePoints(x) })),
  ];
}

/** Everything under a point on the board, smallest things first so a track on a part can still be picked. */
export function hitBoard(
  d: ElectronicsDesign,
  pads: BoardPad[],
  p: P2,
  tol: number,
  layerShown: (l: CopperLayer) => boolean = () => true,
  filter?: PickFilter,
  notesShown = true,
): BoardHit[] {
  const board = d.board;
  if (!board) return [];
  const out: BoardHit[] = [];
  for (const v of board.vias) if (Math.hypot(v.x - p[0], v.y - p[1]) <= v.diameter / 2 + tol) out.push({ kind: "via", id: v.id, net: v.net });
  for (const h of board.holes) if (Math.hypot(h.x - p[0], h.y - p[1]) <= Math.max(h.pad ?? 0, h.drill) / 2 + tol) out.push({ kind: "hole", id: h.id });
  // A fiducial or test point is picked as itself, before the pad it is.
  for (const m of board.marks ?? []) if (Math.hypot(m.x - p[0], m.y - p[1]) <= m.size / 2 + tol) out.push({ kind: "mark", id: m.id, net: m.net });
  for (const t of board.tracks) {
    if (!layerShown(t.layer)) continue;
    for (let i = 0; i + 1 < t.pts.length; i += 1)
      if (distToSegment(p, t.pts[i]!, t.pts[i + 1]!) <= t.width / 2 + tol) {
        out.push({ kind: "track", id: t.id, net: t.net, segment: i });
        break;
      }
  }
  for (const pad of pads)
    if (
      Math.abs((pad.centre ?? pad.at)[0] - p[0]) <= Math.max(pad.pad.w, pad.pad.h) / 2 + tol &&
      Math.abs((pad.centre ?? pad.at)[1] - p[1]) <= Math.max(pad.pad.w, pad.pad.h) / 2 + tol &&
      Math.hypot((pad.centre ?? pad.at)[0] - p[0], (pad.centre ?? pad.at)[1] - p[1]) <= Math.max(pad.pad.w, pad.pad.h) / 2 + tol
    )
      out.push({ kind: "pad", id: pad.part, net: pad.net, pad });
  for (const t of board.texts) if (inBox(p, textBox(t), tol)) out.push({ kind: "text", id: t.id });
  if (notesShown) for (const n of board.notes ?? []) if (onNote(n, p, tol)) out.push({ kind: "note", id: n.id });
  for (const pic of board.pictures ?? [])
    if (inBox(p, { x1: pic.x, y1: pic.y, x2: pic.x + pic.w, y2: pic.y + (pic.w / pic.cols) * pic.rows }, tol)) out.push({ kind: "picture", id: pic.id });
  for (const at of [...board.placements].reverse()) {
    const b = placementBox(d, at);
    if (b && inBox(p, b, tol * 0.5)) out.push({ kind: "part", id: at.part });
  }
  // Areas are picked by their edge, so what is inside them can still be reached.
  for (const a of boardAreas(board))
    if (a.outline.some((q, i) => distToSegment(p, q, a.outline[(i + 1) % a.outline.length]!) <= tol)) out.push({ kind: "area", id: a.id, net: a.net });
  return filter ? out.filter((h) => pickable(board, filter, h.kind, h.id)) : out;
}

/**
 * Ids of what a rubber-band box takes: parts it touches, and tracks, vias, holes, marks, text, pictures, notes, pours
 * and keep-outs wholly inside it. Parts come back by part id. `filter` leaves out what the selection filter does (#748).
 */
export function boxBoard(d: ElectronicsDesign, a: P2, b: P2, filter?: PickFilter): string[] {
  const board = d.board;
  if (!board) return [];
  const box: Box = { x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]) };
  const within = (o: Box) => o.x1 >= box.x1 && o.y1 >= box.y1 && o.x2 <= box.x2 && o.y2 <= box.y2;
  const out: [BoardHit["kind"], string][] = [];
  for (const at of board.placements) {
    const pb = placementBox(d, at);
    if (pb && boxesTouch(pb, box)) out.push(["part", at.part]);
  }
  for (const t of board.tracks) if (t.pts.every((q) => inBox(q, box))) out.push(["track", t.id]);
  for (const v of board.vias) if (inBox([v.x, v.y], box)) out.push(["via", v.id]);
  for (const h of board.holes) if (inBox([h.x, h.y], box)) out.push(["hole", h.id]);
  for (const m of board.marks ?? []) if (inBox([m.x, m.y], box)) out.push(["mark", m.id]);
  for (const t of board.texts) if (within(textBox(t))) out.push(["text", t.id]);
  for (const pic of board.pictures ?? [])
    if (within({ x1: pic.x, y1: pic.y, x2: pic.x + pic.w, y2: pic.y + (pic.w / pic.cols) * pic.rows })) out.push(["picture", pic.id]);
  for (const n of board.notes ?? []) if (noteStrokes(n).lines.every((l) => l.every((q) => inBox(q, box)))) out.push(["note", n.id]);
  for (const ar of boardAreas(board)) if (ar.kind !== "cutout" && ar.outline.length && ar.outline.every((q) => inBox(q, box))) out.push(["area", ar.id]);
  return out.filter(([kind, id]) => pickable(board, filter, kind, id)).map(([, id]) => id);
}

/**
 * The corners a picked thing shows to drag (#742): a track's bends (its ends stay on their pads), or an area's
 * corners. Nothing for anything else.
 */
export function handlesOf(board: Board, id: string): { kind: "track" | "area"; pts: P2[]; handles: number[] } | null {
  const t = board.tracks.find((x) => x.id === id);
  if (t) return { kind: "track", pts: t.pts, handles: t.pts.map((_, i) => i).slice(1, -1) };
  const a = boardAreas(board).find((x) => x.id === id);
  if (!a) return null;
  const pts = a.kind === "cutout" ? (board.cutouts?.[Number(id.slice(4))] ?? []).map((c): P2 => [c.x, c.y]) : a.outline;
  return { kind: "area", pts, handles: pts.map((_, i) => i) };
}

/** A corner of a picked thing under a point, or for an area a place on its edge to put a new one. */
export function handleAt(board: Board, id: string, p: P2, tol: number): { i: number } | { edge: number; at: P2 } | null {
  const h = handlesOf(board, id);
  if (!h) return null;
  for (const i of h.handles) if (Math.hypot(h.pts[i]![0] - p[0], h.pts[i]![1] - p[1]) <= tol) return { i };
  if (h.kind === "area")
    for (let k = 0; k < h.pts.length; k += 1) if (distToSegment(p, h.pts[k]!, h.pts[(k + 1) % h.pts.length]!) <= tol) return { edge: k, at: p };
  return null;
}
