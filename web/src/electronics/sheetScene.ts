import {
  GRID,
  boardPads,
  outlinePoints,
  packageOf,
  pinDirOnSheet,
  placeOnBoard,
  placeOnSheet,
  turn,
  type ElectronicsDesign,
  type P2,
  type SchSymbol,
  type Shape,
  type Sheet,
  type Side,
  type SymbolDef,
} from "@bettercad/electronics";
import { newSheet, type SheetSize, type TitleBlock } from "@bettercad/kernel/drawing";
import { sheetScene, type Fill, type Label, type Scene, type Stroke } from "../drawing/export/scene";
import { sheetLayout } from "../drawing/layout";
import { teePoints } from "./drawSchematic";
import { sheetBox } from "./SchematicCanvas";

const DIRS: Record<number, P2> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
/** The scales a schematic prints at: twice full size while a small one fits, full size, then the usual steps down. */
const SCALES = [2, 1, 0.5, 0.25, 0.2, 0.1, 0.05];
const RAD = Math.PI / 180;

export interface SchematicPage {
  size: SheetSize;
  title: TitleBlock;
  /** This sheet's number and how many the design has, for the title block. */
  index?: number;
  count?: number;
}

/**
 * A schematic sheet on paper (#635): the drawing workspace's frame and title block, with the diagram drawn inside
 * as the screen draws it. Lines and text only, black on white, so the PDF and SVG writers of drawings take it as is.
 */
export function schematicScene(d: ElectronicsDesign, sheet: Sheet, page: SchematicPage): Scene {
  const paper = newSheet(sheet.name, { size: page.size, landscape: true, block: { type: "Schematic", ...page.title } });
  const blank = sheetLayout(paper);
  // The diagram goes above the title block, a little clear of the frame.
  const room = { x: blank.frame.x + 6, w: blank.frame.w - 12, y: blank.frame.y + 6, h: blank.frame.h - blank.block.h - 12 };
  const box = sheetBox(d, sheet);
  const fit = Math.min(room.w / Math.max(box.x2 - box.x1, 1), room.h / Math.max(box.y2 - box.y1, 1));
  const s = SCALES.find((x) => x <= fit) ?? SCALES[SCALES.length - 1]!;
  paper.scale = s;
  const layout = sheetLayout(paper, { index: page.index, count: page.count });
  const scene = sheetScene(paper, layout, () => undefined);
  const ox = room.x + room.w / 2 - ((box.x1 + box.x2) / 2) * s;
  const oy = layout.page.h - (room.y + room.h / 2) - ((box.y1 + box.y2) / 2) * s;
  const P = (p: P2): P2 => [ox + p[0] * s, oy + p[1] * s];

  const strokes: Stroke[] = scene.strokes;
  const labels: Label[] = scene.labels;
  const fills: Fill[] = scene.fills ?? [];
  const pen = (w = 0.15) => Math.max(0.18, w * s);
  const line = (pts: P2[], width: number) =>
    strokes.push({ layer: "visible", width, curve: pts.length === 2 ? { kind: "line", a: pts[0]!, b: pts[1]! } : { kind: "poly", pts } });
  const disc = (c: P2, r: number) =>
    fills.push({
      layer: "visible",
      pts: Array.from({ length: 16 }, (_, i): P2 => [c[0] + r * Math.cos((i * Math.PI) / 8), c[1] + r * Math.sin((i * Math.PI) / 8)]),
    });
  const text = (t: string, at: P2, size: number, anchor: Label["anchor"], baseline: Label["baseline"] = "central", quarter = false) =>
    t && labels.push({ layer: "visible", at, size: size * s, anchor, baseline, text: t, ...(quarter ? { turn: Math.PI / 2 } : {}) });

  /** A shape drawn as it is placed: a symbol's own, or a note on the sheet (#733). */
  const shapeOut = (sh: Shape, place: (p: P2) => P2, rot: number, mirror: boolean) => {
    if (sh.kind === "line") {
      const pts = sh.pts.map(place);
      if (sh.fill === "solid") fills.push({ layer: "visible", pts });
      line(sh.fill ? [...pts, pts[0]!] : pts, pen(sh.width));
    } else if (sh.kind === "rect") {
      const pts = ([[sh.x1, sh.y1], [sh.x2, sh.y1], [sh.x2, sh.y2], [sh.x1, sh.y2], [sh.x1, sh.y1]] as P2[]).map(place); // prettier-ignore
      if (sh.fill === "solid") fills.push({ layer: "visible", pts });
      line(pts, pen(sh.width ?? 0.25));
    } else if (sh.kind === "circle") {
      if (sh.fill === "solid") disc(place([sh.cx, sh.cy]), sh.r * s);
      strokes.push({ layer: "visible", width: pen(sh.width), curve: { kind: "circle", c: place([sh.cx, sh.cy]), r: sh.r * s } });
    } else if (sh.kind === "arc") {
      // Mirroring swaps the ends and the way round; turning adds to both.
      const a0 = (mirror ? 180 - sh.a1 : sh.a0) + rot;
      const a1 = (mirror ? 180 - sh.a0 : sh.a1) + rot;
      strokes.push({ layer: "visible", width: pen(sh.width), curve: { kind: "arc", c: place([sh.cx, sh.cy]), r: sh.r * s, from: a0 * RAD, to: a1 * RAD } });
    } else text(sh.text, place([sh.x, sh.y]), sh.size, sh.align === "centre" ? "middle" : sh.align === "right" ? "end" : "start");
  };

  const symbol = (def: SymbolDef, at: SchSymbol, ref: string, value: string) => {
    const place = (p: P2) => P(placeOnSheet(p, at));
    for (const sh of def.shapes) {
      if (sh.unit !== undefined && def.units > 1 && sh.unit !== at.unit) continue;
      shapeOut(sh, place, at.rot, !!at.mirror);
    }
    for (const pin of def.pins) {
      if ((pin.unit !== undefined && def.units > 1 && pin.unit !== at.unit) || pin.hidden) continue;
      const a = placeOnSheet([pin.x, pin.y], at);
      const dir = DIRS[pinDirOnSheet(pin, at)]!;
      const b: P2 = [a[0] + dir[0] * pin.length, a[1] + dir[1] * pin.length];
      if (pin.length > 0) line([P(a), P(b)], pen());
      if (def.power) continue;
      // As on screen: the name inside the body past the pin, the number over the pin's line, both upright.
      const up = dir[0] === 0;
      const along = up ? dir[1] : dir[0];
      if (pin.name && pin.name !== pin.number && pin.name !== "~")
        text(pin.name, P(up ? [b[0], b[1] + along * 0.4] : [b[0] + along * 0.4, b[1]]), 1.1, along > 0 ? "start" : "end", "central", up);
      if (pin.length > 0) text(pin.number, P(up ? [b[0] - 0.25, (a[1] + b[1]) / 2] : [(a[0] + b[0]) / 2, b[1] + 0.25]), 0.95, "middle", "alphabetic", up);
    }
    const beside = (t: string, where: P2) => {
      const off = turn(where, at.rot);
      text(t, place(where), 1.27, def.power ? "middle" : (at.mirror ? -off[0] : off[0]) < -0.01 ? "end" : "start");
    };
    if (!def.power) beside(ref, def.refAt ?? [GRID, GRID]);
    beside(value, def.valueAt ?? [GRID, -GRID]);
  };

  for (const w of sheet.wires) line([P(w.a), P(w.b)], pen(0.2));
  for (const p of teePoints(sheet)) disc(P(p), 0.45 * s);
  for (const j of sheet.junctions) disc(P([j.x, j.y]), 0.45 * s);
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  for (const y of sheet.symbols) {
    const part = parts.get(y.part);
    const def = part && d.defs[part.def];
    if (part && def) symbol(def.symbol, y, part.ref, part.value);
  }
  for (const l of sheet.labels) {
    text(l.name, P([l.x + 0.3, l.y + 0.3]), 1.27, "start", "alphabetic");
    disc(P([l.x, l.y]), 0.25 * s);
  }
  for (const n of sheet.noConnects) {
    line([P([n.x - 0.6, n.y - 0.6]), P([n.x + 0.6, n.y + 0.6])], pen());
    line([P([n.x - 0.6, n.y + 0.6]), P([n.x + 0.6, n.y - 0.6])], pen());
  }
  for (const note of sheet.notes ?? []) shapeOut(note, P, 0, false);
  return { ...scene, strokes, labels, ...(fills.length ? { fills } : {}) };
}

/** The scales an assembly drawing prints at: as large as fits, in the usual steps. */
const BOARD_SCALES = [10, 5, 4, 2, 1.5, 1, 0.5, 0.25];

export interface AssemblyPage {
  size: SheetSize;
  title: TitleBlock;
  index?: number;
  count?: number;
}

/** The sides of a board that have parts on them, top first. */
export const sidesWithParts = (d: ElectronicsDesign): Side[] => (["top", "bottom"] as Side[]).filter((s) => d.board?.placements.some((p) => p.side === s));

/**
 * An assembly drawing (#662): one side of the board on the drawing workspace's sheet, with its frame and title block.
 * The board's edge and holes, each part's outline and pads, a dot at pin 1 and the part's reference. The bottom is
 * drawn as you see it when you turn the board over. Lines and text only, so the drawing PDF and SVG writers take it.
 */
export function assemblyScene(d: ElectronicsDesign, side: Side, page: AssemblyPage): Scene {
  const board = d.board!;
  const flip = side === "bottom";
  const look = (p: P2): P2 => (flip ? [-p[0], p[1]] : p);
  const edge = outlinePoints(board.outline).map(look);
  const xs = edge.map((p) => p[0]);
  const ys = edge.map((p) => p[1]);
  const box = { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };

  const paper = newSheet(side === "top" ? "Top side" : "Bottom side", {
    size: page.size,
    landscape: true,
    block: { type: side === "top" ? "Assembly drawing, top side" : "Assembly drawing, bottom side, seen from below", ...page.title },
  });
  const blank = sheetLayout(paper);
  const room = { x: blank.frame.x + 10, w: blank.frame.w - 20, y: blank.frame.y + 12, h: blank.frame.h - blank.block.h - 22 };
  const fit = Math.min(room.w / Math.max(box.x2 - box.x1, 1), room.h / Math.max(box.y2 - box.y1, 1));
  const s = BOARD_SCALES.find((x) => x <= fit) ?? BOARD_SCALES[BOARD_SCALES.length - 1]!;
  paper.scale = s;
  const layout = sheetLayout(paper, { index: page.index, count: page.count });
  const scene = sheetScene(paper, layout, () => undefined);
  const ox = room.x + room.w / 2 - ((box.x1 + box.x2) / 2) * s;
  const oy = layout.page.h - (room.y + room.h / 2) - ((box.y1 + box.y2) / 2) * s;
  const P = (p: P2): P2 => {
    const q = look(p);
    return [ox + q[0] * s, oy + q[1] * s];
  };

  const strokes: Stroke[] = scene.strokes;
  const labels: Label[] = scene.labels;
  const fills = scene.fills ?? [];
  const line = (pts: P2[], width: number, layer: Stroke["layer"] = "visible") =>
    pts.length > 1 && strokes.push({ layer, width, curve: pts.length === 2 ? { kind: "line", a: pts[0]!, b: pts[1]! } : { kind: "poly", pts } });
  const ring = (c: P2, r: number, width: number) => strokes.push({ layer: "visible", width, curve: { kind: "circle", c, r } });

  // The board.
  for (const loop of [board.outline, ...(board.cutouts ?? [])]) {
    const pts = outlinePoints(loop).map(P);
    line([...pts, pts[0]!], 0.5);
  }
  for (const h of board.holes) ring(P([h.x, h.y]), (h.pad ?? h.drill) * 0.5 * s, 0.25);

  // The parts on this side: outline, pads, pin 1 and reference.
  const pads = boardPads(d);
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  for (const at of board.placements) {
    if (at.side !== side) continue;
    const part = parts.get(at.part);
    const pkg = part && packageOf(d, part);
    if (!part || !pkg) continue;
    const place = (p: P2) => P(placeOnBoard(p, at));
    const fab = pkg.footprint.shapes.filter((x) => x.layer === "fab");
    const outline = fab.length ? fab : pkg.footprint.shapes.filter((x) => x.layer === "courtyard");
    for (const sh of outline) {
      if (sh.kind === "line") line(sh.pts.map(place), 0.25);
      else if (sh.kind === "rect") {
        const c = ([[sh.x1, sh.y1], [sh.x2, sh.y1], [sh.x2, sh.y2], [sh.x1, sh.y2], [sh.x1, sh.y1]] as P2[]).map(place); // prettier-ignore
        line(c, 0.25);
      } else if (sh.kind === "circle") ring(place([sh.cx, sh.cy]), sh.r * s, 0.25);
    }
    const mine = pads.filter((p) => p.part === at.part);
    for (const p of mine) {
      if (p.pad.kind === "smd" && p.side !== side) continue;
      const a = (p.angle * Math.PI) / 180;
      const [c, n] = [Math.cos(a), Math.sin(a)];
      const corner = (x: number, y: number): P2 => P([p.at[0] + x * c - y * n, p.at[1] + x * n + y * c]);
      const [w, h] = [p.pad.w / 2, p.pad.h / 2];
      if (p.pad.shape === "circle") ring(P(p.at), Math.max(w, h) * s, 0.13);
      else line([corner(-w, -h), corner(w, -h), corner(w, h), corner(-w, h), corner(-w, -h)], 0.13);
    }
    const one = mine.find((p) => p.pad.number === "1" || p.pad.number === "A1");
    if (one && mine.length > 2) {
      const c = P(one.at);
      const r = Math.max(0.5, 0.3 * s);
      fills.push({
        layer: "visible",
        pts: Array.from({ length: 12 }, (_, i): P2 => [c[0] + r * Math.cos((i * Math.PI) / 6), c[1] + r * Math.sin((i * Math.PI) / 6)]),
      });
    }
    if (!/^#/.test(part.ref))
      labels.push({ layer: "visible", at: P([at.x, at.y]), size: Math.min(3.5, Math.max(1.8, 1 * s)), anchor: "middle", baseline: "central", text: part.ref });
  }
  return { ...scene, strokes, labels, ...(fills.length ? { fills } : {}) };
}
