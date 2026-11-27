/**
 * Notes for whoever makes the board (#749): dimensions, lines and text on a drawing layer of their own. They are on
 * the assembly drawing and in a Gerber notes file, and never in copper or on the silkscreen. Everything that draws a
 * note draws its strokes, so the screen, the files and the drawing agree.
 */
import { penFor, textStrokes } from "../fab/font";
import { q } from "../geom";
import { eid, type Board, type BoardNote, type ElectronicsDesign, type Id, type P2 } from "../model";

/** A dimension's text height, mm, unless it says otherwise; and the pen notes' lines are drawn with. */
export const NOTE_SIZE = 1;
export const NOTE_PEN = 0.1;
/** How far an extension line starts from what it measures, and runs past the dimension line, mm. */
const GAP = 0.5;
const PAST = 1;

const onBoard = (d: ElectronicsDesign, change: (b: Board) => Board): ElectronicsDesign => (d.board ? { ...d, board: change(d.board) } : d);
const push = (d: ElectronicsDesign, n: BoardNote): ElectronicsDesign => onBoard(d, (b) => ({ ...b, notes: [...(b.notes ?? []), n] }));

/** How long a dimension measures, mm, to the hundredth. */
export const measure = (n: { a: P2; b: P2 }): number => Math.round(Math.hypot(n.b[0] - n.a[0], n.b[1] - n.a[1]) * 100) / 100;

/** A dimension's words: the length and its unit. */
export const dimensionText = (n: { a: P2; b: P2 }): string => `${measure(n)} mm`;

/**
 * A dimension as lines and one text: the two extension lines, the dimension line with an arrow at each end, and the
 * length written above its middle, turned to read from the bottom or the right.
 */
export function dimensionParts(n: Extract<BoardNote, { kind: "dimension" }>): {
  lines: P2[][];
  text: { x: number; y: number; text: string; size: number; angle: number };
} {
  const len = Math.hypot(n.b[0] - n.a[0], n.b[1] - n.a[1]) || 1;
  const u: P2 = [(n.b[0] - n.a[0]) / len, (n.b[1] - n.a[1]) / len];
  const left: P2 = [-u[1], u[0]];
  const sign = n.offset < 0 ? -1 : 1;
  const off = (p: P2, k: number): P2 => [q(p[0] + left[0] * k), q(p[1] + left[1] * k)];
  const a2 = off(n.a, n.offset);
  const b2 = off(n.b, n.offset);
  const lines: P2[][] = [];
  // Extension lines, when the dimension line stands off what it measures.
  if (Math.abs(n.offset) > GAP) for (const p of [n.a, n.b]) lines.push([off(p, sign * GAP), off(p, n.offset + sign * PAST)]);
  lines.push([a2, b2]);
  const size = n.size ?? NOTE_SIZE;
  const arrow = Math.min(size, len / 3);
  const wing = arrow * 0.35;
  for (const [tip, dir] of [
    [a2, u],
    [b2, [-u[0], -u[1]] as P2],
  ] as const)
    lines.push(
      [[q(tip[0] + dir[0] * arrow + left[0] * wing), q(tip[1] + dir[1] * arrow + left[1] * wing)], tip],
      [tip, [q(tip[0] + dir[0] * arrow - left[0] * wing), q(tip[1] + dir[1] * arrow - left[1] * wing)]],
    );
  // Text reads left to right or bottom to top, never upside down.
  let angle = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  if (angle > 90.001 || angle <= -89.999) angle = angle > 0 ? angle - 180 : angle + 180;
  const t = (angle * Math.PI) / 180;
  const up: P2 = [-Math.sin(t), Math.cos(t)];
  const mid: P2 = [(a2[0] + b2[0]) / 2 + up[0] * size * 0.4, (a2[1] + b2[1]) / 2 + up[1] * size * 0.4];
  return { lines, text: { x: q(mid[0]), y: q(mid[1]), text: dimensionText(n), size, angle: Math.round(angle * 1000) / 1000 } };
}

/** A note as the strokes a pen draws, mm, and the pen's width. Text is anchored by its centre along its baseline for a dimension, its left end otherwise. */
export function noteStrokes(n: BoardNote): { lines: P2[][]; pen: number } {
  if (n.kind === "line") return { lines: [n.pts], pen: n.width ?? NOTE_PEN };
  if (n.kind === "text") {
    const cap = n.size * 0.72;
    return { lines: textStrokes(n.text, cap, [n.x, n.y], { angle: n.angle ?? 0 }), pen: penFor(cap) };
  }
  const { lines, text } = dimensionParts(n);
  const cap = text.size * 0.72;
  return { lines: [...lines, ...textStrokes(text.text, cap, [text.x, text.y], { angle: text.angle, align: "centre" })], pen: Math.max(NOTE_PEN, penFor(cap)) };
}

/** Adds a dimension from `a` to `b`, its line `offset` mm to the left of the way from `a` to `b`. */
export function addDimension(d: ElectronicsDesign, a: P2, b: P2, offset: number): { design: ElectronicsDesign; id: Id } {
  const id = eid("dim");
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return { design: d, id };
  return { design: push(d, { id, kind: "dimension", a, b, offset: q(offset) }), id };
}

/** Adds a line through `pts`. */
export function addNoteLine(d: ElectronicsDesign, pts: P2[], width?: number): { design: ElectronicsDesign; id: Id } {
  const id = eid("nl");
  if (pts.length < 2) return { design: d, id };
  return { design: push(d, { id, kind: "line", pts, ...(width ? { width } : {}) }), id };
}

/** Adds words to the notes. */
export function addNoteText(d: ElectronicsDesign, x: number, y: number, text: string, size = 1.5): { design: ElectronicsDesign; id: Id } {
  const id = eid("nt");
  const t = text.trim();
  if (!t) return { design: d, id };
  return { design: push(d, { id, kind: "text", x, y, text: t, size }), id };
}

/** Changes a note. Its kind stays. */
export function setNote(d: ElectronicsDesign, id: Id, change: Partial<Omit<BoardNote, "id" | "kind">>): ElectronicsDesign {
  return onBoard(d, (b) => ({ ...b, notes: (b.notes ?? []).map((n) => (n.id === id ? ({ ...n, ...change } as BoardNote) : n)) }));
}

/** The offset that puts a dimension's line through `p`. */
export function offsetThrough(a: P2, b: P2, p: P2): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return q(((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len);
}
