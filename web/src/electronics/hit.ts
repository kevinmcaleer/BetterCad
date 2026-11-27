import {
  boxesTouch,
  distToSegment,
  emptyBox,
  grow,
  placeOnSheet,
  type Box,
  type ElectronicsDesign,
  type P2,
  type Shape,
  type Sheet,
  type SymbolDef,
} from "@bettercad/electronics";
import { GROUP_NAME, type GroupOutline } from "@bettercad/electronics/groups";

/** What the pointer is over on a sheet. `id` is the thing's own id; for a symbol, `part` is its part. */
export interface SchHit {
  kind: "symbol" | "wire" | "label" | "junction" | "noConnect" | "note";
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

/** The box round a note on a sheet (#733). Text is measured roughly: 0.6 of its size a character. */
export function noteBox(n: Shape): Box {
  const b = emptyBox();
  if (n.kind === "line") for (const p of n.pts) grow(b, p);
  else if (n.kind === "rect") grow(grow(b, [n.x1, n.y1]), [n.x2, n.y2]);
  else if (n.kind === "circle" || n.kind === "arc") grow(b, [n.cx, n.cy], n.r);
  else {
    const rows = n.text.split("\n");
    const w = Math.max(...rows.map((r) => r.length)) * n.size * 0.6;
    const x1 = n.align === "centre" ? n.x - w / 2 : n.align === "right" ? n.x - w : n.x;
    grow(grow(b, [x1, n.y - n.size / 2 - (rows.length - 1) * n.size * 1.4]), [x1 + w, n.y + n.size / 2]);
  }
  return b;
}

/** Whether a point is on a note: on a line or a box's or circle's edge, or anywhere in a text. */
function onNote(n: Shape, p: P2, tol: number): boolean {
  if (n.kind === "line") return n.pts.some((a, i) => i > 0 && distToSegment(p, n.pts[i - 1]!, a) <= tol);
  if (n.kind === "rect") {
    const c: P2[] = [
      [n.x1, n.y1],
      [n.x2, n.y1],
      [n.x2, n.y2],
      [n.x1, n.y2],
    ];
    return c.some((a, i) => distToSegment(p, a, c[(i + 1) % 4]!) <= tol);
  }
  if (n.kind === "circle" || n.kind === "arc") return Math.abs(Math.hypot(p[0] - n.cx, p[1] - n.cy) - n.r) <= tol;
  return inBox(p, noteBox(n), tol * 0.5);
}

export const inBox = (p: P2, b: Box, pad = 0) => p[0] >= b.x1 - pad && p[0] <= b.x2 + pad && p[1] >= b.y1 - pad && p[1] <= b.y2 + pad;

/** Everything under a point, nearest kind first: marks and labels, then wires, then symbols. `tol` is in mm. */
export function hitSheet(d: ElectronicsDesign, sheet: Sheet, p: P2, tol: number): SchHit[] {
  const out: SchHit[] = [];
  for (const n of sheet.noConnects) if (Math.hypot(n.x - p[0], n.y - p[1]) <= tol + 0.6) out.push({ kind: "noConnect", id: n.id });
  for (const j of sheet.junctions) if (Math.hypot(j.x - p[0], j.y - p[1]) <= tol + 0.5) out.push({ kind: "junction", id: j.id });
  for (const l of sheet.labels)
    if (inBox(p, { x1: l.x - 0.5, y1: l.y - 0.3, x2: l.x + Math.max(2, l.name.length * 0.95), y2: l.y + 1.8 }, tol * 0.5))
      out.push({ kind: "label", id: l.id });
  for (const w of sheet.wires) if (distToSegment(p, w.a, w.b) <= tol) out.push({ kind: "wire", id: w.id });
  for (const n of sheet.notes ?? []) if (onNote(n, p, tol)) out.push({ kind: "note", id: n.id });
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
  for (const n of sheet.notes ?? []) {
    const nb = noteBox(n);
    if (inBox([nb.x1, nb.y1], box) && inBox([nb.x2, nb.y2], box)) out.push(n.id);
  }
  return out;
}

export { groupBoxes as groupOutlines, type GroupOutline } from "@bettercad/electronics/groups";

/** The group whose outline or name is under a point: the edge within `tol`, or the name above the top edge. */
export function hitGroupOutline(outlines: GroupOutline[], p: P2, tol: number): GroupOutline | undefined {
  for (const o of [...outlines].reverse()) {
    const { x1, y1, x2, y2 } = o.box;
    const name = { x1, y1: y2, x2: x1 + Math.max(4, o.name.length * 1.05 + 1), y2: y2 + GROUP_NAME + 0.6 };
    if (inBox(p, name, tol * 0.5)) return o;
    const near = (a: number, b: number) => Math.abs(a - b) <= tol;
    const along = inBox(p, o.box, tol);
    if (along && (near(p[0], x1) || near(p[0], x2) || near(p[1], y1) || near(p[1], y2))) return o;
  }
  return undefined;
}
