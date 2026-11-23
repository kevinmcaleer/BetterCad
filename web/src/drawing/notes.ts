import { toWorld } from "@bettercad/sketch";
import type { DrawingNote, DrawingRef, DrawingSheet, FrameSymbol } from "@bettercad/kernel/drawing";
import { viewAxes, type ModelView, type V2, type ViewCurve, type ViewFrame } from "@bettercad/kernel/view";
import { resolveHole, screw, type Feature } from "../state/document";
import { sizeText, textWidth } from "./dimensions";
import { offered, resolve, targets, type Target } from "./marks";

/**
 * Notes on a drawing (#573): text, leaders, hole notes read from the model's Hole steps, and the surface finish,
 * datum and feature control frame symbols. Each is worked out as lines and text in paper millimetres, y up, so the
 * sheet and every export draw the same thing. No DOM here.
 */
export type NoteKind = DrawingNote["kind"];
export const NOTE_KINDS: { id: NoteKind; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "leader", label: "Leader" },
  { id: "hole", label: "Hole note" },
  { id: "finish", label: "Surface finish" },
  { id: "datum", label: "Datum" },
  { id: "frame", label: "Feature control frame" },
];
export const noteKindName = (k: NoteKind) => NOTE_KINDS.find((x) => x.id === k)!.label;

export const FRAME_SYMBOLS: { id: FrameSymbol; label: string }[] = [
  { id: "position", label: "Position" },
  { id: "flatness", label: "Flatness" },
  { id: "perpendicular", label: "Perpendicularity" },
  { id: "parallel", label: "Parallelism" },
  { id: "circular", label: "Circularity" },
  { id: "straight", label: "Straightness" },
  { id: "concentric", label: "Concentricity" },
];

/** Letter height, the height of a symbol's box, and the clear paper between lines and text, mm. */
export const NOTE_TEXT = 3.5;
const CELL = 7;
const PAD = 1.2;
const LINE = NOTE_TEXT * 1.5;
const ARROW = 3;

/** What a note tool can point at: a hole note at holes, a datum or finish at edges and round faces, a leader at anything. */
export function notePicks(kind: NoteKind, t: Target): boolean {
  if (kind === "text") return false;
  if (kind === "hole") return t.kind !== "edge" && t.hole && t.whole;
  return true;
}

/** Coarse thread pitches, mm, for writing a tapped hole as "M3 × 0.5". */
const PITCH: Record<string, number> = { M2: 0.4, "M2.5": 0.45, M3: 0.5, M4: 0.7, M5: 0.8, M6: 1, M8: 1.25, M10: 1.5, M12: 1.75 };

const d2 = (v: number) => sizeText(v, 2);

/**
 * What a hole note says of a hole seen end on at `c`, `r` (the view's millimetres): its Hole step's own words when a
 * step made it ("4× Ø3.4 through", "M3 × 0.5", its counterbore or countersink), else its size and how many like it
 * the view shows.
 */
export function holeNote(
  features: readonly Feature[] | undefined,
  frame: ViewFrame,
  body: string,
  at: { c: V2; r: number } | undefined,
  all: Target[],
): string[] {
  const like = (r: number) => offered(all).filter((t) => t.kind === "round" && t.hole && t.whole && Math.abs(t.r - r) < 1e-6).length;
  if (!at) return [];
  const { x, y } = viewAxes(frame);
  const flat = (w: readonly number[]): V2 => [w[0]! * x[0] + w[1]! * x[1] + w[2]! * x[2], w[0]! * y[0] + w[1]! * y[1] + w[2]! * y[2]];
  for (const f of features ?? []) {
    if (f.type !== "hole" || f.part !== body) continue;
    if (!f.points.some((q) => Math.hypot(...(flat(toWorld(f.frame, q)).map((v, i) => v - at.c[i]!) as V2)) < 1e-3)) continue;
    const made = resolveHole(f);
    if ("error" in made) continue;
    const n = f.points.length;
    const lines: string[] = [];
    const size = screw(f.size);
    if (f.fit === "tap" && size) lines.push(`${n > 1 ? `${n}× ` : ""}${size.label}${PITCH[size.id] ? ` × ${d2(PITCH[size.id]!)}` : ""}`);
    const deep = f.depth === null ? "through" : `${d2(f.depth)} deep`;
    lines.push(`${n > 1 && !lines.length ? `${n}× ` : ""}Ø${d2(made.diameter)} ${deep}`);
    if (made.head?.kind === "counterbore") lines.push(`Ø${d2(made.head.diameter)} counterbore, ${d2(made.head.depth)} deep`);
    else if (made.head?.kind === "countersink") lines.push(`Ø${d2(made.head.diameter)} countersink${made.head.angle ? `, ${d2(made.head.angle)}°` : ""}`);
    return lines;
  }
  const n = like(at.r);
  return [`${n > 1 ? `${n}× ` : ""}Ø${d2(at.r * 2)}`];
}

/** What a note's symbol draws, and the text beside it. All in paper millimetres, y up. */
export interface NoteArt {
  /** Thin lines: the leader and its shoulder, a symbol's box and strokes. */
  lines: [V2, V2][];
  curves: ViewCurve[];
  /** Filled: the leader's arrowhead, a datum's triangle. */
  fills: V2[][];
  texts: { at: V2; text: string; anchor: "start" | "middle" }[];
  /** What it reads, for naming it. */
  says: string;
  /** Its text's box, to point at and drag by. */
  box: { min: V2; max: V2 };
}

export interface NoteContext {
  /** The picture and scale of the view the note points into, and which way that view looks. Left out for loose text. */
  view?: ModelView;
  scale?: number;
  frame?: ViewFrame;
  all?: Target[];
  /** The model's steps, for hole notes. */
  features?: readonly Feature[];
}

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2, k = 1): V2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const unit = (a: V2): V2 => (len(a) < 1e-9 ? [1, 0] : [a[0] / len(a), a[1] / len(a)]);

/** The point of a target a leader ends on, coming from `from`, and the target seen end on if it is a hole. Paper mm. */
function leaderEnd(t: Target, P: (p: V2) => V2, scale: number, from: V2): V2 {
  if (t.kind === "round") {
    const c = P(t.c);
    return add(c, unit(sub(from, c)), t.r * scale);
  }
  const [a, b] = [P(t.a), P(t.b)];
  const d = sub(b, a);
  const k = Math.max(0.1, Math.min(0.9, ((from[0] - a[0]) * d[0] + (from[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1)));
  return add(a, d, k);
}

/** A feature control frame's characteristic as strokes in a cell `CELL` square whose bottom left is `o`. */
function symbolArt(symbol: FrameSymbol, o: V2): { lines: [V2, V2][]; curves: ViewCurve[] } {
  const p = (u: number, v: number): V2 => [o[0] + u * CELL, o[1] + v * CELL];
  const c = p(0.5, 0.5);
  switch (symbol) {
    case "position":
      return {
        lines: [
          [p(0.5, 0.12), p(0.5, 0.88)],
          [p(0.12, 0.5), p(0.88, 0.5)],
        ],
        curves: [{ kind: "circle", c, r: CELL * 0.25 }],
      };
    case "flatness":
      return {
        lines: [
          [p(0.15, 0.3), p(0.65, 0.3)],
          [p(0.65, 0.3), p(0.85, 0.7)],
          [p(0.85, 0.7), p(0.35, 0.7)],
          [p(0.35, 0.7), p(0.15, 0.3)],
        ],
        curves: [],
      };
    case "perpendicular":
      return {
        lines: [
          [p(0.15, 0.25), p(0.85, 0.25)],
          [p(0.5, 0.25), p(0.5, 0.8)],
        ],
        curves: [],
      };
    case "parallel":
      return {
        lines: [
          [p(0.25, 0.2), p(0.5, 0.8)],
          [p(0.5, 0.2), p(0.75, 0.8)],
        ],
        curves: [],
      };
    case "circular":
      return { lines: [], curves: [{ kind: "circle", c, r: CELL * 0.3 }] };
    case "straight":
      return { lines: [[p(0.15, 0.5), p(0.85, 0.5)]], curves: [] };
    case "concentric":
      return {
        lines: [],
        curves: [
          { kind: "circle", c, r: CELL * 0.32 },
          { kind: "circle", c, r: CELL * 0.16 },
        ],
      };
  }
}

/**
 * What a note draws, or nothing when what it pointed at has gone from the model. For a note with a leader the
 * millimetres are from the middle of its view; for loose text, from the sheet's bottom left corner.
 */
export function noteArt(note: Pick<DrawingNote, "kind" | "text" | "symbol" | "on" | "at">, ctx: NoteContext = {}): NoteArt | undefined {
  const art: NoteArt = { lines: [], curves: [], fills: [], texts: [], says: "", box: { min: note.at, max: note.at } };
  const T = note.at;
  let target: Target | undefined;
  let P = (p: V2): V2 => p;
  if (note.on) {
    const { view, scale } = ctx;
    if (!view || !scale) return undefined;
    const all = ctx.all ?? targets(view);
    target = resolve(all, note.on);
    if (!target) return undefined;
    const mid: V2 = [(view.box.min[0] + view.box.max[0]) / 2, (view.box.min[1] + view.box.max[1]) / 2];
    P = (p) => [(p[0] - mid[0]) * scale, (p[1] - mid[1]) * scale];
  }
  const scale = ctx.scale ?? 1;

  // What it says, and how wide and tall that is.
  let lines: string[];
  if (note.kind === "hole") {
    const round = target && target.kind === "round" ? { c: target.c, r: target.r } : undefined;
    lines = ctx.frame && target ? holeNote(ctx.features, ctx.frame, target.source.body, round, ctx.all ?? (ctx.view ? targets(ctx.view) : [])) : [];
    if (!lines.length && target && target.kind !== "edge") lines = [`Ø${d2(target.r * 2)}`];
  } else lines = note.kind === "frame" ? [] : note.text.split("\n");
  const cells =
    note.kind === "frame"
      ? note.text
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  let w: number;
  let h: number;
  if (note.kind === "frame") {
    const widths = cells.map((c) => Math.max(CELL, textWidth(c, NOTE_TEXT) + PAD * 2));
    w = CELL + widths.reduce((a, b) => a + b, 0);
    h = CELL;
    const sym = symbolArt(note.symbol ?? "position", T);
    art.lines.push(...sym.lines);
    art.curves.push(...sym.curves);
    let x = T[0] + CELL;
    const box = (x0: number, x1: number) =>
      art.lines.push(
        [
          [x0, T[1]],
          [x1, T[1]],
        ],
        [
          [x1, T[1]],
          [x1, T[1] + CELL],
        ],
        [
          [x1, T[1] + CELL],
          [x0, T[1] + CELL],
        ],
        [
          [x0, T[1] + CELL],
          [x0, T[1]],
        ],
      );
    box(T[0], x);
    cells.forEach((c, i) => {
      box(x, x + widths[i]!);
      art.texts.push({ at: [x + widths[i]! / 2, T[1] + CELL / 2], text: c, anchor: "middle" });
      x += widths[i]!;
    });
    art.says = `${FRAME_SYMBOLS.find((s) => s.id === (note.symbol ?? "position"))!.label} ${cells.join(", ")}`;
  } else if (note.kind === "datum") {
    w = h = CELL;
    art.lines.push(
      [T, [T[0] + CELL, T[1]]],
      [
        [T[0] + CELL, T[1]],
        [T[0] + CELL, T[1] + CELL],
      ],
      [
        [T[0] + CELL, T[1] + CELL],
        [T[0], T[1] + CELL],
      ],
      [[T[0], T[1] + CELL], T],
    );
    art.texts.push({ at: [T[0] + CELL / 2, T[1] + CELL / 2], text: note.text, anchor: "middle" });
    art.says = `Datum ${note.text}`;
  } else {
    // A finish mark stands left of its text: a tick, its long arm twice its short one.
    const lead = note.kind === "finish" ? 6 : 0;
    w = lead + Math.max(0, ...lines.map((l) => textWidth(l, NOTE_TEXT)));
    h = Math.max(1, lines.length) * LINE;
    lines.forEach((l, i) => art.texts.push({ at: [T[0] + lead, T[1] + h - LINE * (i + 0.5)], text: l, anchor: "start" }));
    if (note.kind === "finish") {
      const v: V2 = [T[0] + 1.7, T[1]];
      art.lines.push(
        [[T[0], T[1] + 3], v],
        [v, [T[0] + 5.2, T[1] + 6]],
        [
          [T[0] + 5.2, T[1] + 6],
          [T[0] + 5.2 + Math.max(4, w - lead), T[1] + 6],
        ],
      );
      art.texts.forEach((t) => (t.at = [t.at[0], T[1] + 6 + LINE * 0.55]));
      h = 6 + LINE;
    }
    art.says = note.kind === "finish" ? `Surface finish ${lines.join(" ")}` : lines.join(" ");
  }
  art.box = { min: [T[0] - 0.5, T[1] - 0.5], max: [T[0] + w + 0.5, T[1] + h + 0.5] };

  if (target) {
    // The leader leaves the side of the text nearer what it points at, level for a short shoulder, then goes to it.
    const rough = leaderEnd(target, P, scale, [T[0] + w / 2, T[1] + h / 2]);
    const left = rough[0] < T[0] + w / 2;
    const y = note.kind === "finish" ? T[1] : note.kind === "frame" || note.kind === "datum" ? T[1] + CELL / 2 : T[1] + h - LINE / 2;
    const start: V2 = [left ? T[0] - PAD : T[0] + w + PAD, y];
    const elbow: V2 = note.kind === "finish" ? [T[0] + 1.7, T[1]] : [start[0] + (left ? -3 : 3), y];
    const end = leaderEnd(target, P, scale, elbow);
    if (note.kind !== "finish") art.lines.push([start, elbow]);
    if (len(sub(end, elbow)) > 1e-6) {
      art.lines.push([elbow, end]);
      const d = unit(sub(end, elbow));
      const n: V2 = [-d[1], d[0]];
      // A datum sits on its edge with a filled triangle; anything else points with an arrowhead.
      const back = add(end, d, -(note.kind === "datum" ? 2.2 : ARROW));
      const half = note.kind === "datum" ? 1.6 : 0.5;
      art.fills.push([end, add(back, n, half), add(back, n, -half)]);
    }
  }
  return art;
}

/** "Note, 4× Ø3.4 through": what a note is called. */
export const noteName = (note: Pick<DrawingNote, "kind">, art: NoteArt) => `${note.kind === "hole" ? "Hole note" : "Note"}, ${art.says}`;

/** Datum letters skip I, O and Q; the next one a sheet has not used. */
export function nextDatum(sheet: DrawingSheet): string {
  const used = new Set((sheet.notes ?? []).filter((n) => n.kind === "datum").map((n) => n.text));
  return [..."ABCDEFGHJKLMNPRSTUVWXYZ"].find((l) => !used.has(l)) ?? "A";
}

/** Where a note pointing at something starts out: up and to the right of it, clear of the view's lines. Paper mm from the view's middle. */
export function noteSpot(t: Target, view: ModelView, scale: number): V2 {
  const mid: V2 = [(view.box.min[0] + view.box.max[0]) / 2, (view.box.min[1] + view.box.max[1]) / 2];
  const p = t.kind === "round" ? t.c : ([(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2] as V2);
  const at: V2 = [(p[0] - mid[0]) * scale, (p[1] - mid[1]) * scale];
  const r = t.kind === "edge" ? 0 : t.r * scale;
  return [Math.round(at[0] + r + 12), Math.round(at[1] + r + 10)];
}

/** What a note being written or changed says, as its card holds it. */
export interface NoteDraft {
  text: string;
  symbol: FrameSymbol;
  /** A frame's datums, after its tolerance. */
  datums: string;
}

/** What a note tool starts with: a common roughness, the next datum letter, a tenth of a millimetre. */
export const firstDraft = (kind: NoteKind, sheet: DrawingSheet): NoteDraft => ({
  text: kind === "finish" ? "Ra 3.2" : kind === "datum" ? nextDatum(sheet) : kind === "frame" ? "0.1" : "",
  symbol: "position",
  datums: "",
});

/** A note on the sheet as its card shows it. A frame keeps its tolerance and datums as cells split by "|". */
export function draftOfNote(note: Pick<DrawingNote, "kind" | "text" | "symbol">): NoteDraft {
  if (note.kind !== "frame") return { text: note.text, symbol: "position", datums: "" };
  const [text = "", ...datums] = note.text.split("|");
  return { text, symbol: note.symbol ?? "position", datums: datums.join(" ") };
}

/** What a note of a kind keeps of its card, or nothing when there is nothing to say yet. A hole note reads the model instead. */
export function noteWords(kind: NoteKind, draft: NoteDraft): { text: string; symbol?: FrameSymbol } | undefined {
  if (kind === "hole") return { text: "" };
  const text = draft.text.trim();
  if (!text) return undefined;
  if (kind === "datum") return { text: text.toUpperCase() };
  if (kind !== "frame") return { text };
  const datums = draft.datums
    .split(/[\s,|]+/)
    .filter(Boolean)
    .map((d) => d.toUpperCase());
  return { text: [text.replace(/\|/g, " "), ...datums].join("|"), symbol: draft.symbol };
}

/** The view a note points into. */
export const noteView = (n: Pick<DrawingNote, "on">) => n.on?.view;
export type { DrawingRef };
