import {
  boxesTouch,
  distToSegment,
  emptyBox,
  footprintBox,
  grow,
  packageOf,
  placeOnBoard,
  placeOnSheet,
  type Board,
  type Box,
  type BoardPad,
  type ElectronicsDesign,
  type P2,
  type Sheet,
  type SymbolDef,
} from "@bettercad/electronics";

/** What the pointer is over on a sheet. `id` is the thing's own id; for a symbol, `part` is its part. */
export interface SchHit {
  kind: "symbol" | "wire" | "label" | "junction" | "noConnect";
  id: string;
  part?: string;
}

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

/** A symbol's box on the sheet, after turning and mirroring. */
export function placedBox(def: SymbolDef, at: { x: number; y: number; rot: 0 | 90 | 180 | 270; mirror?: boolean }): Box {
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

const inBox = (p: P2, b: Box, pad = 0) => p[0] >= b.x1 - pad && p[0] <= b.x2 + pad && p[1] >= b.y1 - pad && p[1] <= b.y2 + pad;

/** Everything under a point, nearest kind first: marks and labels, then wires, then symbols. `tol` is in mm. */
export function hitSheet(d: ElectronicsDesign, sheet: Sheet, p: P2, tol: number): SchHit[] {
  const out: SchHit[] = [];
  for (const n of sheet.noConnects) if (Math.hypot(n.x - p[0], n.y - p[1]) <= tol + 0.6) out.push({ kind: "noConnect", id: n.id });
  for (const j of sheet.junctions) if (Math.hypot(j.x - p[0], j.y - p[1]) <= tol + 0.5) out.push({ kind: "junction", id: j.id });
  for (const l of sheet.labels)
    if (inBox(p, { x1: l.x - 0.5, y1: l.y - 0.3, x2: l.x + Math.max(2, l.name.length * 0.95), y2: l.y + 1.8 }, tol * 0.5))
      out.push({ kind: "label", id: l.id });
  for (const w of sheet.wires) if (distToSegment(p, w.a, w.b) <= tol) out.push({ kind: "wire", id: w.id });
  const parts = new Map(d.parts.map((x) => [x.id, x]));
  for (const s of [...sheet.symbols].reverse()) {
    const def = d.defs[parts.get(s.part)?.def ?? ""];
    if (def && inBox(p, placedBox(def.symbol, s), tol * 0.5)) out.push({ kind: "symbol", id: s.id, part: s.part });
  }
  return out;
}

/** Ids of everything a rubber-band box touches on a sheet. */
export function boxSheet(d: ElectronicsDesign, sheet: Sheet, a: P2, b: P2): string[] {
  const box: Box = { x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]) };
  const out: string[] = [];
  const parts = new Map(d.parts.map((x) => [x.id, x]));
  for (const s of sheet.symbols) {
    const def = d.defs[parts.get(s.part)?.def ?? ""];
    if (def && boxesTouch(placedBox(def.symbol, s), box)) out.push(s.id);
  }
  for (const w of sheet.wires) if (inBox(w.a, box) && inBox(w.b, box)) out.push(w.id);
  for (const l of sheet.labels) if (inBox([l.x, l.y], box)) out.push(l.id);
  for (const j of sheet.junctions) if (inBox([j.x, j.y], box)) out.push(j.id);
  for (const n of sheet.noConnects) if (inBox([n.x, n.y], box)) out.push(n.id);
  return out;
}

export interface BoardHit {
  kind: "part" | "track" | "via" | "hole" | "text" | "pad";
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

/** Everything under a point on the board, smallest things first so a track on a part can still be picked. */
export function hitBoard(d: ElectronicsDesign, pads: BoardPad[], p: P2, tol: number, layerShown: (l: "top" | "bottom") => boolean = () => true): BoardHit[] {
  const board = d.board;
  if (!board) return [];
  const out: BoardHit[] = [];
  for (const v of board.vias) if (Math.hypot(v.x - p[0], v.y - p[1]) <= v.diameter / 2 + tol) out.push({ kind: "via", id: v.id, net: v.net });
  for (const h of board.holes) if (Math.hypot(h.x - p[0], h.y - p[1]) <= Math.max(h.pad ?? 0, h.drill) / 2 + tol) out.push({ kind: "hole", id: h.id });
  for (const t of board.tracks) {
    if ((t.layer === "top" || t.layer === "bottom") && !layerShown(t.layer)) continue;
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
  for (const at of [...board.placements].reverse()) {
    const b = placementBox(d, at);
    if (b && inBox(p, b, tol * 0.5)) out.push({ kind: "part", id: at.part });
  }
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
