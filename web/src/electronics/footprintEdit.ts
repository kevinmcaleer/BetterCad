import type { FootprintDef, FootprintLayer, P2, Pad, PadKind, PadShape, Shape } from "@bettercad/electronics";
import { copperMiddle, octagon, outlineBox, padOutline } from "@bettercad/electronics/padShape";
import { movedShape, shapeBox, shapeDist } from "./symbolEdit";

/**
 * Edits to a footprint being changed pad by pad (#627): each is a function from a footprint to a new footprint, so
 * the editor's undo is a list of footprints. A thing on the footprint is named by what it is and where it sits in
 * its list: "p0" is the first pad, "s3" the fourth outline shape.
 */
export type LandId = string;
type FpShape = FootprintDef["shapes"][number];

/** What a click or a drag snaps to. Exact sizes are typed. */
export const LAND_GRID = 0.25;

export const PAD_KINDS: { id: PadKind; label: string }[] = [
  { id: "smd", label: "Surface mount" },
  { id: "thru", label: "Through hole" },
  { id: "npth", label: "Bare hole, no copper" },
];
export const PAD_SHAPES: { id: PadShape; label: string }[] = [
  { id: "rect", label: "Rectangle" },
  { id: "roundrect", label: "Rounded rectangle" },
  { id: "oval", label: "Oval" },
  { id: "circle", label: "Round" },
  { id: "polygon", label: "Custom outline" },
];
/** The outline layers a shape can be drawn on. Copper shapes come only from imported footprints. */
export const OUTLINE_LAYERS: { id: Exclude<FootprintLayer, "copper">; label: string }[] = [
  { id: "silk", label: "Silkscreen" },
  { id: "courtyard", label: "Courtyard" },
  { id: "fab", label: "Fabrication" },
];

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const index = (id: LandId) => Number(id.slice(1));
export const isPad = (id: LandId) => id[0] === "p";
export const padsOf = (fp: FootprintDef, ids: Iterable<LandId>): Pad[] => [...ids].filter(isPad).flatMap((id) => fp.pads[index(id)] ?? []);

/** The next free pad number: one more than the largest whole number in use. */
export function nextPadNumber(fp: FootprintDef): string {
  const used = fp.pads.map((p) => Number(p.number)).filter((n) => Number.isInteger(n) && n > 0);
  return String(Math.max(0, ...used) + 1);
}

/** A new pad where you clicked, shaped like the last one made so a row of pads comes out alike. */
export function addPad(fp: FootprintDef, at: P2, like?: Pad): { fp: FootprintDef; id: LandId } {
  const from = like ?? fp.pads.filter((p) => p.kind !== "npth").at(-1);
  const pad: Pad = from
    ? { ...from, number: nextPadNumber(fp), x: at[0], y: at[1] }
    : { number: nextPadNumber(fp), kind: "smd", shape: "roundrect", round: 0.25, x: at[0], y: at[1], w: 1, h: 0.6 };
  return { fp: { ...fp, pads: [...fp.pads, pad] }, id: `p${fp.pads.length}` };
}

export function addOutline(fp: FootprintDef, shape: Shape, layer: FootprintLayer): { fp: FootprintDef; id: LandId } {
  const width = layer === "courtyard" ? 0.05 : layer === "fab" ? 0.1 : 0.12;
  const s = { ...shape, layer, ...(shape.kind === "text" ? {} : { width }) } as FpShape;
  return { fp: { ...fp, shapes: [...fp.shapes, s] }, id: `s${fp.shapes.length}` };
}

export function moveItems(fp: FootprintDef, ids: Iterable<LandId>, dx: number, dy: number): FootprintDef {
  const set = new Set(ids);
  if (!set.size || (!dx && !dy)) return fp;
  return {
    ...fp,
    pads: fp.pads.map((p, i) => (set.has(`p${i}`) ? { ...p, x: r4(p.x + dx), y: r4(p.y + dy) } : p)),
    shapes: fp.shapes.map((s, i) => (set.has(`s${i}`) ? movedShape(s, dx, dy) : s)),
  };
}

export function deleteItems(fp: FootprintDef, ids: Iterable<LandId>): FootprintDef {
  const set = new Set(ids);
  return { ...fp, pads: fp.pads.filter((_, i) => !set.has(`p${i}`)), shapes: fp.shapes.filter((_, i) => !set.has(`s${i}`)) };
}

/** Sets fields on every pad named. A field given as `undefined` is taken off, which hands it back to the board's rule. */
export function setPads(fp: FootprintDef, ids: Iterable<LandId>, patch: Partial<Record<keyof Pad, unknown>>): FootprintDef {
  const set = new Set(ids);
  return {
    ...fp,
    pads: fp.pads.map((p, i) => {
      if (!set.has(`p${i}`)) return p;
      const next = { ...p, ...patch } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
      return next as unknown as Pad;
    }),
  };
}

/** Changes what kind of pad it is, and puts right what no longer fits: a hole to drill, or paste on a pad with a hole. */
export function setPadKind(fp: FootprintDef, ids: Iterable<LandId>, kind: PadKind): FootprintDef {
  const set = new Set(ids);
  return {
    ...fp,
    pads: fp.pads.map((p, i) => {
      if (!set.has(`p${i}`) || p.kind === kind) return p;
      const next: Pad = { ...p, kind };
      if (kind === "smd") {
        delete next.drill;
        delete next.slot;
      } else {
        delete next.noPaste;
        delete next.pasteMargin;
        delete next.back;
        const least = Math.min(p.w, p.h);
        next.drill = p.drill ?? (kind === "npth" ? r4(least) : r4(Math.max(0.3, least * 0.6)));
        if (kind === "npth") next.number = "";
      }
      if (kind !== "npth" && !next.number) next.number = nextPadNumber(fp);
      return next;
    }),
  };
}

export function setOutline(fp: FootprintDef, id: LandId, patch: Record<string, unknown>): FootprintDef {
  const i = index(id);
  return { ...fp, shapes: fp.shapes.map((s, k) => (k === i ? ({ ...s, ...patch } as FpShape) : s)) };
}

/**
 * A pad drawn corner by corner (#744): a surface pad shaped like the outline, placed at the middle of its box, shaped
 * like the last pad made for everything else. Null with fewer than three corners.
 */
export function addOutlinePad(fp: FootprintDef, corners: P2[], like?: Pad): { fp: FootprintDef; id: LandId } | null {
  const clean = corners.filter((p, i) => i === 0 || p[0] !== corners[i - 1]![0] || p[1] !== corners[i - 1]![1]);
  if (clean.length > 2 && clean[0]![0] === clean.at(-1)![0] && clean[0]![1] === clean.at(-1)![1]) clean.pop();
  if (clean.length < 3) return null;
  const { w, h, mid } = outlineBox(clean);
  if (!w || !h) return null;
  const from = like ?? fp.pads.filter((p) => p.kind === "smd").at(-1);
  const pad: Pad = {
    number: nextPadNumber(fp),
    kind: "smd",
    shape: "polygon",
    x: mid[0],
    y: mid[1],
    w,
    h,
    points: clean.map((p): P2 => [r4(p[0] - mid[0]), r4(p[1] - mid[1])]),
    ...(from?.back ? { back: true } : {}),
  };
  return { fp: { ...fp, pads: [...fp.pads, pad] }, id: `p${fp.pads.length}` };
}

/** Sets the pads' shape. A custom outline starts as the pad's own rectangle; leaving one drops its corners. */
export function setPadShape(fp: FootprintDef, ids: Iterable<LandId>, shape: PadShape): FootprintDef {
  const set = new Set(ids);
  return {
    ...fp,
    pads: fp.pads.map((p, i) => {
      if (!set.has(`p${i}`) || p.shape === shape) return p;
      const next: Pad = { ...p, shape };
      delete next.round;
      delete next.points;
      if (shape === "roundrect") next.round = 0.25;
      if (shape === "polygon") {
        const [x, y] = [r4(p.w / 2), r4(p.h / 2)];
        next.points = [
          [-x, -y],
          [x, -y],
          [x, y],
          [-x, y],
        ];
      }
      return next;
    }),
  };
}

/** Gives a pad a custom outline, its size following the outline's box. Null when there are fewer than three corners. */
export function setPadCorners(fp: FootprintDef, id: LandId, corners: P2[]): FootprintDef | null {
  const pad = fp.pads[index(id)];
  if (!pad || corners.length < 3) return null;
  const { w, h } = outlineBox(corners);
  if (!w || !h) return null;
  return setPads(fp, [id], { shape: "polygon", points: corners.map((c): P2 => [r4(c[0]), r4(c[1])]), w, h, round: undefined });
}

/** Turns the pads into octagons the size of their box, as Eagle draws them. */
export const makeOctagon = (fp: FootprintDef, ids: Iterable<LandId>): FootprintDef =>
  [...ids].filter(isPad).reduce((f, id) => {
    const p = f.pads[index(id)];
    return (p && setPadCorners(f, id, octagon(p.w, p.h))) || f;
  }, fp);

/** Corners as typed: "x y" pairs, split by commas or semicolons. Null when one is not two numbers. */
export function parseCorners(text: string): P2[] | null {
  const parts = text
    .split(/[;,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const pts = parts.map((t) => t.split(/\s+/).map(Number));
  return pts.every((p) => p.length === 2 && p.every(Number.isFinite)) ? pts.map((p) => [p[0]!, p[1]!] as P2) : null;
}
export const cornersText = (pts: P2[]): string => pts.map((p) => `${p[0]} ${p[1]}`).join(", ");

/** A pad's box on the footprint, turned pads as their turned box (whole quarter turns) or their widest reach. */
export function padBox(p: Pad): { x1: number; y1: number; x2: number; y2: number } {
  const outline = padOutline(p);
  if (outline) {
    const xs = outline.map((q) => q[0]);
    const ys = outline.map((q) => q[1]);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  const [cx, cy] = copperMiddle(p);
  const a = (((p.angle ?? 0) % 180) + 180) % 180;
  const reach = p.shape === "circle" ? Math.max(p.w, p.h) : Math.hypot(p.w, p.h);
  const [w, h] = p.shape === "circle" ? [reach, reach] : a < 1 || a > 179 ? [p.w, p.h] : Math.abs(a - 90) < 1 ? [p.h, p.w] : [reach, reach];
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
}

/** What is under a point, pads before outlines, nearest first. `tol` is in mm. */
export function hitFootprint(fp: FootprintDef, p: P2, tol: number): LandId[] {
  const found: { id: LandId; d: number }[] = [];
  fp.pads.forEach((pad, i) => {
    const b = padBox(pad);
    const d = Math.hypot(Math.max(b.x1 - p[0], 0, p[0] - b.x2), Math.max(b.y1 - p[1], 0, p[1] - b.y2));
    // Inside a pad wins over any outline; the nearer centre wins among pads.
    if (d <= tol) found.push({ id: `p${i}`, d: d - tol - 1 / (1 + Math.hypot(p[0] - pad.x, p[1] - pad.y)) });
  });
  fp.shapes.forEach((s, i) => {
    const d = shapeDist(s, p);
    if (d <= tol) found.push({ id: `s${i}`, d });
  });
  return found.sort((a, b) => a.d - b.d).map((f) => f.id);
}

export function itemBox(fp: FootprintDef, id: LandId): { x1: number; y1: number; x2: number; y2: number } | null {
  if (isPad(id)) {
    const p = fp.pads[index(id)];
    return p ? padBox(p) : null;
  }
  const s = fp.shapes[index(id)];
  return s ? shapeBox(s) : null;
}

/** A box round everything, for Fit. */
export function landBox(fp: FootprintDef): { x1: number; y1: number; x2: number; y2: number } {
  const boxes = [...fp.pads.map(padBox), ...fp.shapes.map(shapeBox)];
  if (!boxes.length) return { x1: -3, y1: -3, x2: 3, y2: 3 };
  return {
    x1: Math.min(...boxes.map((b) => b.x1)),
    y1: Math.min(...boxes.map((b) => b.y1)),
    x2: Math.max(...boxes.map((b) => b.x2)),
    y2: Math.max(...boxes.map((b) => b.y2)),
  };
}

/** The one value a field has across the pads picked, or null when they differ. */
export function shared<K extends keyof Pad>(pads: Pad[], key: K, or: NonNullable<Pad[K]>): NonNullable<Pad[K]> | null {
  const first = pads[0]?.[key] ?? or;
  return pads.every((p) => (p[key] ?? or) === first) ? first : null;
}

/**
 * A courtyard drawn round everything: the pads and the fabrication outline, 0.25 mm clear. It takes the place of any
 * courtyard there is, so it can be pressed again after pads move.
 */
export function wrapCourtyard(fp: FootprintDef, margin = 0.25): FootprintDef {
  const rest = fp.shapes.filter((s) => s.layer !== "courtyard");
  const boxes = [...fp.pads.map(padBox), ...rest.filter((s) => s.layer === "fab").map(shapeBox)];
  if (!boxes.length) return fp;
  const up = (n: number) => Math.ceil((n - 1e-9) * 20) / 20;
  const court: FpShape = {
    kind: "rect",
    layer: "courtyard",
    x1: -up(-Math.min(...boxes.map((b) => b.x1)) + margin),
    y1: -up(-Math.min(...boxes.map((b) => b.y1)) + margin),
    x2: up(Math.max(...boxes.map((b) => b.x2)) + margin),
    y2: up(Math.max(...boxes.map((b) => b.y2)) + margin),
    width: 0.05,
  };
  return { ...fp, shapes: [...rest, court] };
}
