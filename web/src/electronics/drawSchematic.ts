import {
  GRID,
  key,
  onSegment,
  pinDirOnSheet,
  placeOnSheet,
  turn,
  type ElectronicsDesign,
  type P2,
  type SchSymbol,
  type Shape,
  type Sheet,
  type SymbolDef,
} from "@bettercad/electronics";
import type { Colours } from "./colours";
import { gridStep, toScreen, toWorld, type View2D } from "./view2d";

export interface SchematicLook {
  /** Ids of selected symbols, wires, labels, junctions and marks. */
  selected: Set<string>;
  hover?: string | null;
  /** Things drawn faintly on top: a part being placed, a wire being drawn. */
  ghost?: { symbols?: { def: SymbolDef; at: Pick<SchSymbol, "x" | "y" | "rot" | "mirror">; ref?: string; value?: string }[]; wires?: [P2, P2][] };
  /** Open wire ends and floating pins to ring, from the netlist. */
  marks?: P2[];
  /** A rubber-band box, in world millimetres. */
  box?: [P2, P2] | null;
  grid?: boolean;
}

const DIRS: Record<number, P2> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };

function shape(
  ctx: CanvasRenderingContext2D,
  v: View2D,
  s: Shape,
  place: (p: P2) => P2,
  rot: number,
  mirror: boolean,
  c: Colours,
  stroke: string,
  fill: string,
) {
  const px = (w?: number) => Math.max(1.2, (w ?? 0.15) * v.scale);
  ctx.strokeStyle = stroke;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (s.kind === "line") {
    ctx.beginPath();
    s.pts.forEach((p, i) => {
      const q = toScreen(v, place(p));
      if (i) ctx.lineTo(q[0], q[1]);
      else ctx.moveTo(q[0], q[1]);
    });
    if (s.fill) {
      ctx.closePath();
      ctx.fillStyle = s.fill === "solid" ? stroke : fill;
      ctx.fill();
    }
    ctx.lineWidth = px(s.width);
    ctx.stroke();
  } else if (s.kind === "rect") {
    const pts = (
      [
        [s.x1, s.y1],
        [s.x2, s.y1],
        [s.x2, s.y2],
        [s.x1, s.y2],
      ] as P2[]
    ).map((p) => toScreen(v, place(p)));
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath();
    ctx.fillStyle = s.fill === "solid" ? stroke : fill;
    if (s.fill !== false) ctx.fill();
    ctx.lineWidth = px(s.width ?? 0.25);
    ctx.stroke();
  } else if (s.kind === "circle") {
    const q = toScreen(v, place([s.cx, s.cy]));
    ctx.beginPath();
    ctx.arc(q[0], q[1], s.r * v.scale, 0, Math.PI * 2);
    if (s.fill) {
      ctx.fillStyle = s.fill === "solid" ? stroke : fill;
      ctx.fill();
    }
    ctx.lineWidth = px(s.width);
    ctx.stroke();
  } else if (s.kind === "arc") {
    const q = toScreen(v, place([s.cx, s.cy]));
    // Mirroring swaps the ends and the way round; turning adds to both. The screen's y runs down, so angles negate.
    const a0 = mirror ? 180 - s.a1 : s.a0;
    const a1 = mirror ? 180 - s.a0 : s.a1;
    ctx.beginPath();
    ctx.arc(q[0], q[1], s.r * v.scale, (-(a0 + rot) * Math.PI) / 180, (-(a1 + rot) * Math.PI) / 180, true);
    ctx.lineWidth = px(s.width);
    ctx.stroke();
  } else {
    const q = toScreen(v, place([s.x, s.y]));
    ctx.fillStyle = c.ink;
    ctx.font = `${Math.max(1, s.size * v.scale)}px ${c.font}`;
    ctx.textAlign = s.align === "centre" ? "center" : (s.align ?? "left");
    ctx.textBaseline = "middle";
    ctx.fillText(s.text, q[0], q[1]);
  }
}

/** Draws one symbol: its shapes, pins, and its reference and value. */
export function drawSymbol(
  ctx: CanvasRenderingContext2D,
  v: View2D,
  def: SymbolDef,
  at: Pick<SchSymbol, "x" | "y" | "rot" | "mirror"> & { unit?: number },
  c: Colours,
  text: { ref?: string; value?: string },
  on = false,
  alpha = 1,
) {
  const place = (p: P2) => placeOnSheet(p, at);
  const stroke = on ? c.accent : c["ec-symbol"];
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const s of def.shapes) {
    if (s.unit !== undefined && def.units > 1 && s.unit !== (at.unit ?? 1)) continue;
    shape(ctx, v, s, place, at.rot, !!at.mirror, c, def.power ? (on ? c.accent : c["ec-wire"]) : stroke, c["ec-symbol-fill"]);
  }
  const small = Math.max(0, 1.1 * v.scale);
  for (const pin of def.pins) {
    if (pin.unit !== undefined && def.units > 1 && pin.unit !== (at.unit ?? 1)) continue;
    if (pin.hidden) continue;
    const a = place([pin.x, pin.y]);
    const dir = DIRS[pinDirOnSheet(pin, at)]!;
    const b: P2 = [a[0] + dir[0] * pin.length, a[1] + dir[1] * pin.length];
    const sa = toScreen(v, a);
    const sb = toScreen(v, b);
    if (pin.length > 0) {
      ctx.strokeStyle = def.power ? c["ec-wire"] : stroke;
      ctx.lineWidth = Math.max(1.2, 0.15 * v.scale);
      ctx.beginPath();
      ctx.moveTo(sa[0], sa[1]);
      ctx.lineTo(sb[0], sb[1]);
      ctx.stroke();
    }
    if (def.power || small < 6) continue;
    // The name sits inside the body past the pin; the number sits over the pin's line. Both stay upright.
    const vertical = dir[0] === 0;
    ctx.font = `${small}px ${c.mono}`;
    const named = pin.name && pin.name !== pin.number && pin.name !== "~";
    ctx.save();
    if (vertical) {
      ctx.translate(sb[0], sb[1]);
      ctx.rotate(-Math.PI / 2);
      ctx.translate(-sb[0], -sb[1]);
    }
    // After the quarter turn, "along the pin" is the canvas's x in both cases.
    const along = vertical ? dir[1] : dir[0];
    if (named) {
      ctx.fillStyle = c.ink;
      ctx.textBaseline = "middle";
      ctx.textAlign = along > 0 ? "left" : "right";
      ctx.fillText(pin.name, sb[0] + along * small * 0.35, sb[1]);
    }
    if (pin.length > 0) {
      ctx.fillStyle = stroke;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "center";
      const mid = vertical ? sb[0] - (along * pin.length * v.scale) / 2 : (sa[0] + sb[0]) / 2;
      ctx.font = `${small * 0.85}px ${c.mono}`;
      ctx.fillText(pin.number, mid, sb[1] - 1);
    }
    ctx.restore();
  }
  const label = (t: string | undefined, where: P2 | undefined, colour: string, weight: string) => {
    if (!t || !where) return;
    // Text keeps its place beside the part when the part turns, but never turns upside down itself.
    const q = toScreen(v, place(where));
    ctx.fillStyle = colour;
    ctx.font = `${weight} ${Math.max(1, 1.27 * v.scale)}px ${c.mono}`;
    const off = turn(where, at.rot);
    ctx.textAlign = def.power ? "center" : (at.mirror ? -off[0] : off[0]) < -0.01 ? "right" : "left";
    ctx.textBaseline = "middle";
    ctx.fillText(t, q[0], q[1]);
  };
  if (v.scale * 1.27 >= 5) {
    if (!def.power) label(text.ref, def.refAt ?? [GRID, GRID], on ? c.accent : c["ec-symbol"], "600");
    label(text.value, def.valueAt ?? [GRID, -GRID], def.power ? c["ec-wire"] : c.ink, "400");
  }
  ctx.restore();
}

/** Where wires meet in a T, which gets a dot without the person adding one. */
export function teePoints(sheet: Sheet): P2[] {
  const seen = new Set<string>();
  const out: P2[] = [];
  for (const w of sheet.wires)
    for (const end of [w.a, w.b]) {
      const k = key(end[0], end[1]);
      if (seen.has(k)) continue;
      const touching = sheet.wires.filter((o) => o !== w && onSegment(end, o.a, o.b));
      const mid = touching.some((o) => key(o.a[0], o.a[1]) !== k && key(o.b[0], o.b[1]) !== k);
      if (mid || touching.length >= 2) {
        seen.add(k);
        out.push(end);
      }
    }
  return out;
}

export function drawSchematic(
  ctx: CanvasRenderingContext2D,
  v: View2D,
  size: { w: number; h: number },
  d: ElectronicsDesign,
  sheet: Sheet,
  c: Colours,
  look: SchematicLook,
) {
  ctx.fillStyle = c.viewport;
  ctx.fillRect(0, 0, size.w, size.h);
  if (look.grid !== false) {
    const step = gridStep(v, GRID);
    const a = toWorld(v, [0, size.h]);
    const b = toWorld(v, [size.w, 0]);
    ctx.fillStyle = c.line;
    const r = step === GRID ? 1 : 1.3;
    for (let x = Math.ceil(a[0] / step) * step; x <= b[0]; x += step)
      for (let y = Math.ceil(a[1] / step) * step; y <= b[1]; y += step) {
        const s = toScreen(v, [x, y]);
        ctx.fillRect(s[0] - r / 2, s[1] - r / 2, r, r);
      }
  }
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const wire = Math.max(1.5, 0.2 * v.scale);
  ctx.lineCap = "round";
  for (const w of sheet.wires) {
    const a = toScreen(v, w.a);
    const b = toScreen(v, w.b);
    const on = look.selected.has(w.id) || look.hover === w.id;
    ctx.strokeStyle = on ? c.accent : c["ec-wire"];
    ctx.lineWidth = on ? wire + 1.5 : wire;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  const dot = (p: P2, colour: string) => {
    const s = toScreen(v, p);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(s[0], s[1], Math.max(2.5, 0.45 * v.scale), 0, Math.PI * 2);
    ctx.fill();
  };
  for (const p of teePoints(sheet)) dot(p, c["ec-wire"]);
  for (const j of sheet.junctions) dot([j.x, j.y], look.selected.has(j.id) ? c.accent : c["ec-wire"]);
  for (const s of sheet.symbols) {
    const part = parts.get(s.part);
    const def = part && d.defs[part.def];
    if (!part || !def) continue;
    drawSymbol(ctx, v, def.symbol, s, c, { ref: part.ref, value: part.value }, look.selected.has(s.id) || look.hover === s.id);
  }
  for (const l of sheet.labels) {
    const s = toScreen(v, [l.x, l.y]);
    const on = look.selected.has(l.id) || look.hover === l.id;
    ctx.fillStyle = on ? c.accent : c["ec-wire"];
    ctx.font = `600 ${Math.max(1, 1.27 * v.scale)}px ${c.mono}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(l.name, s[0] + 2, s[1] - 2);
    ctx.fillRect(s[0] - 1.5, s[1] - 1.5, 3, 3);
  }
  for (const n of sheet.noConnects) {
    const s = toScreen(v, [n.x, n.y]);
    const r = Math.max(3, 0.6 * v.scale);
    ctx.strokeStyle = look.selected.has(n.id) ? c.accent : c.snap;
    ctx.lineWidth = Math.max(1.5, 0.15 * v.scale);
    ctx.beginPath();
    ctx.moveTo(s[0] - r, s[1] - r);
    ctx.lineTo(s[0] + r, s[1] + r);
    ctx.moveTo(s[0] - r, s[1] + r);
    ctx.lineTo(s[0] + r, s[1] - r);
    ctx.stroke();
  }
  for (const m of look.marks ?? []) {
    const s = toScreen(v, m);
    ctx.strokeStyle = c["ec-mark"];
    ctx.lineWidth = 1.5;
    ctx.strokeRect(s[0] - 4, s[1] - 4, 8, 8);
  }
  for (const g of look.ghost?.symbols ?? []) drawSymbol(ctx, v, g.def, g.at, c, { ref: g.ref, value: g.value }, true, 0.7);
  for (const [a, b] of look.ghost?.wires ?? []) {
    const sa = toScreen(v, a);
    const sb = toScreen(v, b);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = wire;
    ctx.beginPath();
    ctx.moveTo(sa[0], sa[1]);
    ctx.lineTo(sb[0], sb[1]);
    ctx.stroke();
  }
  if (look.box) rubber(ctx, v, look.box, c);
}

export function rubber(ctx: CanvasRenderingContext2D, v: View2D, box: [P2, P2], c: Colours) {
  const a = toScreen(v, box[0]);
  const b = toScreen(v, box[1]);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  ctx.restore();
}
