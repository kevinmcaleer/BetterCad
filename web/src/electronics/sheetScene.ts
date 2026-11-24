import { GRID, pinDirOnSheet, placeOnSheet, turn, type ElectronicsDesign, type P2, type SchSymbol, type Sheet, type SymbolDef } from "@bettercad/electronics";
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

  const symbol = (def: SymbolDef, at: SchSymbol, ref: string, value: string) => {
    const place = (p: P2) => P(placeOnSheet(p, at));
    for (const sh of def.shapes) {
      if (sh.unit !== undefined && def.units > 1 && sh.unit !== at.unit) continue;
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
        const a0 = (at.mirror ? 180 - sh.a1 : sh.a0) + at.rot;
        const a1 = (at.mirror ? 180 - sh.a0 : sh.a1) + at.rot;
        strokes.push({ layer: "visible", width: pen(sh.width), curve: { kind: "arc", c: place([sh.cx, sh.cy]), r: sh.r * s, from: a0 * RAD, to: a1 * RAD } });
      } else text(sh.text, place([sh.x, sh.y]), sh.size, sh.align === "centre" ? "middle" : sh.align === "right" ? "end" : "start");
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
  return { ...scene, strokes, labels, ...(fills.length ? { fills } : {}) };
}
