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
  type BoardPad,
  type Box,
  type CopperLayer,
  type ElectronicsDesign,
  type P2,
} from "@bettercad/electronics";
import { inBox } from "./hit";

export interface BoardHit {
  kind: "part" | "track" | "via" | "hole" | "text" | "picture" | "pad" | "area";
  /** A part's id for parts and pads; the thing's own id otherwise. */
  id: string;
  net?: string;
  pad?: BoardPad;
  /** For a track: which piece of it. */
  segment?: number;
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
export function hitBoard(d: ElectronicsDesign, pads: BoardPad[], p: P2, tol: number, layerShown: (l: CopperLayer) => boolean = () => true): BoardHit[] {
  const board = d.board;
  if (!board) return [];
  const out: BoardHit[] = [];
  for (const v of board.vias) if (Math.hypot(v.x - p[0], v.y - p[1]) <= v.diameter / 2 + tol) out.push({ kind: "via", id: v.id, net: v.net });
  for (const h of board.holes) if (Math.hypot(h.x - p[0], h.y - p[1]) <= Math.max(h.pad ?? 0, h.drill) / 2 + tol) out.push({ kind: "hole", id: h.id });
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
      Math.abs(pad.at[0] - p[0]) <= Math.max(pad.pad.w, pad.pad.h) / 2 + tol &&
      Math.abs(pad.at[1] - p[1]) <= Math.max(pad.pad.w, pad.pad.h) / 2 + tol &&
      Math.hypot(pad.at[0] - p[0], pad.at[1] - p[1]) <= Math.max(pad.pad.w, pad.pad.h) / 2 + tol
    )
      out.push({ kind: "pad", id: pad.part, net: pad.net, pad });
  for (const t of board.texts)
    if (inBox(p, { x1: t.x, y1: t.y - t.size * 0.2, x2: t.x + t.text.length * t.size * 0.6, y2: t.y + t.size }, tol)) out.push({ kind: "text", id: t.id });
  for (const pic of board.pictures ?? [])
    if (inBox(p, { x1: pic.x, y1: pic.y, x2: pic.x + pic.w, y2: pic.y + (pic.w / pic.cols) * pic.rows }, tol)) out.push({ kind: "picture", id: pic.id });
  for (const at of [...board.placements].reverse()) {
    const b = placementBox(d, at);
    if (b && inBox(p, b, tol * 0.5)) out.push({ kind: "part", id: at.part });
  }
  // Areas are picked by their edge, so what is inside them can still be reached.
  for (const a of boardAreas(board))
    if (a.outline.some((q, i) => distToSegment(p, q, a.outline[(i + 1) % a.outline.length]!) <= tol)) out.push({ kind: "area", id: a.id, net: a.net });
  return out;
}

/** Ids of the parts, tracks, vias and holes a rubber-band box touches. Parts come back by part id. */
export function boxBoard(d: ElectronicsDesign, a: P2, b: P2): string[] {
  const board = d.board;
  if (!board) return [];
  const box: Box = { x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]) };
  const out: string[] = [];
  for (const at of board.placements) {
    const pb = placementBox(d, at);
    if (pb && boxesTouch(pb, box)) out.push(at.part);
  }
  for (const t of board.tracks) if (t.pts.every((q) => inBox(q, box))) out.push(t.id);
  for (const v of board.vias) if (inBox([v.x, v.y], box)) out.push(v.id);
  for (const h of board.holes) if (inBox([h.x, h.y], box)) out.push(h.id);
  return out;
}
