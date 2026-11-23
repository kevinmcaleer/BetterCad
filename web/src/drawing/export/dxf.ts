import { DxfWriter, dxfFile, type DxfLayer } from "@bettercad/sketch/dxfWriter";
import type { V2 } from "@bettercad/kernel/view";
import { roundAt, roundOf, type Layer, type Scene } from "./scene";

/**
 * A scene as a DXF drawing (#569), with the sketch export's writer. Lines, circles and round arcs stay exact;
 * ellipses and traced curves go as fine polylines, since this plain DXF has no ellipse. Text goes as text.
 * Layers are there for the marks and dimensions to come, so a template made now keeps working.
 */
const NAME: Record<Layer, string> = { visible: "VISIBLE", hidden: "HIDDEN", centre: "CENTRE", dimension: "DIMENSIONS", border: "BORDER", title: "TITLE" };
const LAYERS: DxfLayer[] = [
  { name: "VISIBLE", colour: 7 },
  { name: "HIDDEN", colour: 8, ltype: "HIDDEN" },
  { name: "CENTRE", colour: 1, ltype: "CENTER" },
  { name: "DIMENSIONS", colour: 5 },
  { name: "BORDER", colour: 7 },
  { name: "TITLE", colour: 7 },
];
const LTYPES = [
  { name: "HIDDEN", description: "Hidden __ __ __ __", pattern: [2, -1] },
  { name: "CENTER", description: "Centre ____ _ ____ _", pattern: [8, -1.5, 1.5, -1.5] },
];
/** How far a traced ellipse may stray from the true one, mm. */
const TOL = 0.01;
const DEG = 180 / Math.PI;
/** Capitals stand about this much of the font size, which is the height DXF text is given by. */
const CAP = 0.72;

export function sceneDxf(scene: Scene): string {
  const w = new DxfWriter();
  const start = (type: string, layer: string) => {
    w.pair(0, type);
    w.pair(8, layer);
  };
  const point = (code: number, q: V2) => {
    w.pair(code, q[0]);
    w.pair(code + 10, q[1]);
    w.pair(code + 20, 0);
  };
  const polyline = (layer: string, pts: V2[], closed: boolean) => {
    start("POLYLINE", layer);
    w.pair(66, 1);
    point(10, [0, 0]);
    w.pair(70, closed ? 1 : 0);
    for (const q of pts) {
      start("VERTEX", layer);
      point(10, q);
    }
    start("SEQEND", layer);
  };

  for (const s of scene.strokes) {
    const layer = NAME[s.layer];
    const c = s.curve;
    if (c.kind === "line") {
      start("LINE", layer);
      point(10, c.a);
      point(11, c.b);
    } else if (c.kind === "poly") {
      if (c.pts.length < 2) continue;
      const first = c.pts[0]!;
      const last = c.pts[c.pts.length - 1]!;
      const closed = c.pts.length > 2 && first[0] === last[0] && first[1] === last[1];
      polyline(layer, closed ? c.pts.slice(0, -1) : c.pts, closed);
    } else if (c.kind === "circle") {
      start("CIRCLE", layer);
      point(10, c.c);
      w.pair(40, c.r);
    } else if (c.kind === "arc") {
      start("ARC", layer);
      point(10, c.c);
      w.pair(40, c.r);
      w.pair(50, c.from * DEG);
      w.pair(51, c.to * DEG);
    } else {
      const r = roundOf(c);
      const whole = r.sweep >= Math.PI * 2 - 1e-9;
      const big = Math.max(r.rx, r.ry, TOL);
      const n = Math.max(8, Math.ceil(r.sweep / (2 * Math.acos(Math.max(0, 1 - TOL / big)))));
      const pts: V2[] = [];
      for (let i = 0; i < (whole ? n : n + 1); i++) pts.push(roundAt(r, r.from + (r.sweep * i) / n).p);
      polyline(layer, pts, whole);
    }
  }
  for (const l of scene.labels) {
    start("TEXT", NAME[l.layer]);
    point(10, l.at);
    w.pair(40, l.size * CAP);
    w.pair(1, l.text);
    if (l.turn) w.pair(50, l.turn * DEG);
    // 72: left or centre. 73: on the baseline or about the middle. The second point is the one they are measured from.
    w.pair(72, l.anchor === "middle" ? 1 : 0);
    w.pair(73, l.baseline === "central" ? 2 : 0);
    point(11, l.at);
  }
  // Arrowheads: a filled triangle is a SOLID with its last corner given twice.
  for (const f of scene.fills ?? []) {
    if (f.pts.length < 3) continue;
    start("SOLID", NAME[f.layer]);
    point(10, f.pts[0]!);
    point(11, f.pts[1]!);
    point(12, f.pts[2]!);
    point(13, f.pts[3] ?? f.pts[2]!);
  }
  return dxfFile(w, { min: [0, 0], max: [scene.w, scene.h] }, LAYERS, LTYPES);
}
