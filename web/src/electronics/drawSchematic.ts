import {
  GRID,
  boxPins,
  boxRect,
  elsewhere,
  entryEnd,
  key,
  localName,
  onSegment,
  pinDirOnSheet,
  placeOnSheet,
  turn,
  type ElectronicsDesign,
  type P2,
  type SchSymbol,
  type BlockPoint,
  type PointKind,
  type Shape,
  type Sheet,
  type SymbolDef,
} from "@bettercad/electronics";
import type { Colours } from "./colours";
import { shownName } from "@bettercad/electronics/groups";
import type { GroupOutline } from "./hit";
import { gridStep, toScreen, toWorld, type View2D } from "./view2d";

export interface SchematicLook {
  /** Ids of selected symbols, wires, labels, junctions and marks. */
  selected: Set<string>;
  hover?: string | null;
  /** Things drawn faintly on top: a part being placed, a wire being drawn. */
  ghost?: {
    symbols?: { def: SymbolDef; at: Pick<SchSymbol, "x" | "y" | "rot" | "mirror">; ref?: string; value?: string }[];
    wires?: [P2, P2][];
    /** A note being drawn (#733). */
    notes?: Shape[];
  };
  /** Open wire ends and floating pins to ring, from the netlist. */
  marks?: P2[];
  /** Wires of the net under the pointer, lit with it. */
  lit?: Set<string>;
  /** Labels on this sheet with the same name as the picked or hovered one (#788), and where that one is. */
  twins?: Set<string>;
  twinFrom?: P2;
  /** The place a check's result points at, ringed. */
  spot?: P2;
  /** A rubber-band box, in world millimetres. */
  box?: [P2, P2] | null;
  grid?: boolean;
  /** Group outlines (#766), with which are picked and which one is gone into. */
  groups?: { outlines: GroupOutline[]; picked: Set<string>; inside?: string | null; stale?: Set<string>; folded?: Set<string> };
  /** Things inside folded blocks, not drawn (#775). */
  hidden?: Set<string>;
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
  ink: string = c.ink,
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
    ctx.fillStyle = ink;
    ctx.font = `${Math.max(1, s.size * v.scale)}px ${c.font}`;
    ctx.textAlign = s.align === "centre" ? "center" : (s.align ?? "left");
    ctx.textBaseline = "middle";
    s.text.split("\n").forEach((row, i) => ctx.fillText(row, q[0], q[1] + i * s.size * 1.4 * v.scale));
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
  whole: Sheet,
  c: Colours,
  look: SchematicLook,
) {
  // A folded block (#775) shows only its box and points: what is inside is left out of the drawing, not the design.
  const hide = look.hidden;
  const sheet: Sheet = hide?.size
    ? {
        ...whole,
        symbols: whole.symbols.filter((x) => !hide.has(x.id)),
        wires: whole.wires.filter((x) => !hide.has(x.id)),
        labels: whole.labels.filter((x) => !hide.has(x.id)),
        junctions: whole.junctions.filter((x) => !hide.has(x.id)),
        noConnects: whole.noConnects.filter((x) => !hide.has(x.id)),
        ...(whole.notes ? { notes: whole.notes.filter((x) => !hide.has(x.id)) } : {}),
        ...(whole.buses ? { buses: whole.buses.filter((x) => !hide.has(x.id)) } : {}),
        ...(whole.busEntries ? { busEntries: whole.busEntries.filter((x) => !hide.has(x.id)) } : {}),
        ...(whole.boxes ? { boxes: whole.boxes.filter((x) => !hide.has(x.id)) } : {}),
      }
    : whole;
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
  for (const o of look.groups?.outlines ?? [])
    drawGroup(ctx, v, o, c, look.groups!.picked.has(o.id), look.groups!.inside === o.id, look.groups!.stale?.has(o.id), look.groups!.folded?.has(o.id));
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const wire = Math.max(1.5, 0.2 * v.scale);
  ctx.lineCap = "round";
  for (const w of sheet.wires) {
    const a = toScreen(v, w.a);
    const b = toScreen(v, w.b);
    const on = look.selected.has(w.id) || look.hover === w.id || !!look.lit?.has(w.id);
    ctx.strokeStyle = on ? c.accent : c["ec-wire"];
    ctx.lineWidth = on ? wire + 1.5 : wire;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  // Buses (#756): a thick line with its name over the start, and slanted entries where wires leave it.
  for (const e of sheet.busEntries ?? []) {
    const a = toScreen(v, [e.x, e.y]);
    const b = toScreen(v, entryEnd(e));
    const on = look.selected.has(e.id) || look.hover === e.id;
    ctx.strokeStyle = on ? c.accent : c["ec-wire"];
    ctx.lineWidth = on ? wire + 1.5 : wire;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  for (const bus of sheet.buses ?? []) {
    const on = look.selected.has(bus.id) || look.hover === bus.id;
    ctx.strokeStyle = on ? c.accent : c["ec-wire"];
    ctx.lineWidth = (on ? wire + 1.5 : wire) * 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    bus.pts.forEach((p, i) => {
      const s = toScreen(v, p);
      if (i) ctx.lineTo(s[0], s[1]);
      else ctx.moveTo(s[0], s[1]);
    });
    ctx.stroke();
    const at = toScreen(v, bus.pts[0]!);
    ctx.fillStyle = on ? c.accent : c["ec-wire"];
    ctx.font = `600 ${Math.max(1, 1.27 * v.scale)}px ${c.mono}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(bus.name, at[0] + 2, at[1] - 0.6 * v.scale);
  }
  // Sheets placed here as boxes (#757): the box, the sheet's name over it, and a pin for each of its sheet pins.
  for (const box of sheet.boxes ?? []) {
    const child = d.sheets.find((x) => x.id === box.sheet);
    const r = boxRect(d, box);
    const on = look.selected.has(box.id) || look.hover === box.id;
    const [x1, y1] = toScreen(v, [r.x1, r.y2]);
    const [x2, y2] = toScreen(v, [r.x2, r.y1]);
    ctx.strokeStyle = on ? c.accent : c["ec-symbol"];
    ctx.lineWidth = on ? 2.5 : 1.5;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.fillStyle = on ? c.accent : c["ec-symbol"];
    ctx.font = `600 ${Math.max(1, 1.27 * v.scale)}px ${c.font}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(child ? `${child.name}${child.use ? ` · ${child.use.prefix}` : ""}` : "Missing sheet", x1, y1 - 3);
    ctx.font = `${Math.max(1, 1.1 * v.scale)}px ${c.mono}`;
    ctx.textBaseline = "middle";
    for (const pin of boxPins(d, box)) {
      const [px, py] = toScreen(v, pin.at);
      ctx.fillStyle = c["ec-wire"];
      ctx.fillRect(px - 2, py - 2, 4, 4);
      ctx.fillStyle = c.ink;
      ctx.textAlign = pin.side === "left" ? "left" : "right";
      ctx.fillText(pin.name, pin.side === "left" ? px + 0.6 * v.scale : px - 0.6 * v.scale, py);
    }
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
  // A name that carries on to another sheet says which (#636).
  const far = d.sheets.length > 1 ? elsewhere(d, sheet.id) : null;
  // Inside a circuit block, labels show without the block's tag, and its points are drawn as terminals (#767).
  const tagOf = new Map<string, string>();
  const pointOf = new Map<string, { point: BlockPoint; box: GroupOutline["box"] }>();
  for (const g of sheet.groups ?? []) {
    if (!g.block) continue;
    for (const m of g.members) tagOf.set(m, g.block.tag);
    const box = look.groups?.outlines.find((o) => o.id === g.id)?.box;
    if (box) for (const p of g.block.points) pointOf.set(p.label, { point: p, box });
  }
  for (const l of sheet.labels) {
    const s = toScreen(v, [l.x, l.y]);
    const on = look.selected.has(l.id) || look.hover === l.id;
    const point = pointOf.get(l.id);
    if (point) {
      drawPoint(ctx, v, [l.x, l.y], point.point, point.box, c, on || !!look.lit?.has(l.id), point.point.kind !== "ground" && !pointJoined(sheet, [l.x, l.y]));
      continue;
    }
    const twin = !!look.twins?.has(l.id);
    ctx.fillStyle = on || twin ? c.accent : c["ec-wire"];
    ctx.font = `600 ${Math.max(1, 1.27 * v.scale)}px ${c.mono}`;
    ctx.textAlign = l.rot === 180 ? "right" : "left";
    ctx.textBaseline = "bottom";
    const shown = shownName(localName(l.name, sheet), tagOf.get(l.id));
    ctx.fillRect(s[0] - 1.5, s[1] - 1.5, 3, 3);
    if (l.shape) {
      const end = flag(ctx, s, l.rot === 180 ? -1 : 1, ctx.measureText(shown).width, 1.27 * v.scale + 4, l.shape, on || twin ? c.accent : c["ec-wire"]);
      ctx.textBaseline = "middle";
      ctx.fillText(shown, end.text, s[1]);
      ctx.textBaseline = "bottom";
      const to = far?.get(l.name);
      if (to) {
        ctx.fillStyle = c.muted;
        ctx.textAlign = l.rot === 180 ? "right" : "left";
        ctx.font = `${Math.max(1, 1.0 * v.scale)}px ${c.font}`;
        ctx.fillText(`→ ${to[0]!.name}${to.length > 1 ? ` +${to.length - 1}` : ""}`, end.far + (l.rot === 180 ? -4 : 4), s[1] + 0.5 * v.scale);
      }
      continue;
    }
    ctx.fillText(shown, l.rot === 180 ? s[0] - 2 : s[0] + 2, s[1] - 2);
    // A sheet pin (#757) is boxed, as it is a pin on the box the sheet is placed as.
    if (l.port) {
      const w = ctx.measureText(shown).width + 4;
      const h = 1.27 * v.scale + 2;
      ctx.strokeStyle = on ? c.accent : c["ec-wire"];
      ctx.lineWidth = 1;
      ctx.strokeRect(l.rot === 180 ? s[0] - w - 1 : s[0] + 1, s[1] - h - 1, w, h);
    }
    const to = far?.get(l.name);
    if (to) {
      const w = ctx.measureText(l.name).width;
      ctx.fillStyle = c.muted;
      ctx.font = `${Math.max(1, 1.0 * v.scale)}px ${c.font}`;
      ctx.fillText(` → ${to[0]!.name}${to.length > 1 ? ` +${to.length - 1}` : ""}`, s[0] + 2 + w, s[1] - 2);
    }
  }
  // The labels a picked or hovered one is joined to by name (#788): a dashed line to each says they are one net.
  if (look.twins?.size && look.twinFrom) {
    const from = toScreen(v, look.twinFrom);
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    for (const l of sheet.labels) {
      if (!look.twins.has(l.id)) continue;
      const to = toScreen(v, [l.x, l.y]);
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
    }
    ctx.stroke();
    ctx.restore();
  }
  // Notes (#733): text, lines, boxes and circles, in the ink of the sheet.
  for (const n of sheet.notes ?? []) {
    const on = look.selected.has(n.id) || look.hover === n.id;
    const ink = on ? c.accent : c.ink;
    shape(ctx, v, n.kind === "rect" ? { ...n, fill: n.fill ?? false } : n, (p) => p, 0, false, c, ink, c["ec-symbol-fill"], ink);
  }
  for (const g of look.ghost?.notes ?? [])
    shape(ctx, v, g.kind === "rect" ? { ...g, fill: false } : g, (p) => p, 0, false, c, c.accent, c["ec-symbol-fill"], c.accent);
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
  if (look.spot) {
    const s = toScreen(v, look.spot);
    ctx.strokeStyle = c.danger;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s[0], s[1], 12, 0, Math.PI * 2);
    ctx.stroke();
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

/** True when a wire ends on a point or runs through it, so something outside its block is joined to it. */
export function pointJoined(sheet: Sheet, at: P2): boolean {
  const k = key(at[0], at[1]);
  return sheet.wires.some((w) => key(w.a[0], w.a[1]) === k || key(w.b[0], w.b[1]) === k || onSegment(at, w.a, w.b));
}

/** The colour token a connection point is drawn in, by what it is for. */
export function pointColour(kind: PointKind, c: Colours): string {
  if (kind === "power-in" || kind === "power-out") return c.danger;
  if (kind === "ground") return c.ink;
  if (kind === "i2c-sda" || kind === "i2c-scl") return c.accent;
  if (kind === "load") return c.snap;
  return c["ec-wire"];
}

/**
 * A block's connection point (#767): a small terminal on the outline in its kind's colour, with its name just inside.
 * An open ring until something outside joins it is the sheet's open-end mark, drawn with the rest.
 */
export function drawPoint(ctx: CanvasRenderingContext2D, v: View2D, at: P2, p: BlockPoint, box: GroupOutline["box"], c: Colours, on: boolean, open = false) {
  const s = toScreen(v, at);
  const r = Math.max(3, 0.55 * v.scale);
  const colour = pointColour(p.kind, c);
  ctx.save();
  ctx.fillStyle = colour;
  ctx.strokeStyle = on ? c.accent : c.ink;
  ctx.lineWidth = on ? 2 : 1;
  ctx.beginPath();
  ctx.moveTo(s[0] - r, s[1]);
  ctx.lineTo(s[0], s[1] - r);
  ctx.lineTo(s[0] + r, s[1]);
  ctx.lineTo(s[0], s[1] + r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (open) {
    // Not joined to anything outside yet: a ring round it.
    ctx.strokeStyle = c["ec-mark"];
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(s[0], s[1], r + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  // The name sits inside the outline, away from the edge the point is on.
  const left = Math.abs(at[0] - box.x1) < 0.01;
  const right = Math.abs(at[0] - box.x2) < 0.01;
  const top = !left && !right && Math.abs(at[1] - box.y2) < 0.01;
  ctx.fillStyle = on ? c.accent : c.ink;
  ctx.font = `600 ${Math.max(9, 1.15 * v.scale)}px ${c.font}`;
  ctx.textAlign = left ? "left" : right ? "right" : "center";
  ctx.textBaseline = left || right ? "middle" : top ? "top" : "bottom";
  const gap = r + 3;
  const text = p.volts ? `${p.name} · ${p.volts}` : p.name;
  ctx.fillText(text, s[0] + (left ? gap : right ? -gap : 0), s[1] + (left || right ? 0 : top ? gap : -gap));
  ctx.restore();
}

/** A group's outline: a rounded box with its name on the top edge. Dashed while it is gone into. */
export function drawGroup(
  ctx: CanvasRenderingContext2D,
  v: View2D,
  o: GroupOutline,
  c: Colours,
  picked: boolean,
  inside: boolean,
  stale = false,
  folded = false,
) {
  const a = toScreen(v, [o.box.x1, o.box.y2]);
  const b = toScreen(v, [o.box.x2, o.box.y1]);
  const r = Math.min(Math.max(4, 0.8 * v.scale), (b[0] - a[0]) / 4, (b[1] - a[1]) / 4);
  ctx.save();
  ctx.strokeStyle = picked ? c.accent : c.muted;
  ctx.lineWidth = picked ? 2 : 1.25;
  if (inside) ctx.setLineDash([6, 4]);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(a[0], a[1], b[0] - a[0], b[1] - a[1], r);
  else ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  if (folded) {
    ctx.fillStyle = c["ec-symbol-fill"];
    ctx.fill();
    ctx.lineWidth += 0.75;
  }
  ctx.stroke();
  if (folded) {
    ctx.fillStyle = c.muted;
    ctx.font = `${Math.max(10, 1.27 * v.scale)}px ${c.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Double-click to open", (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  ctx.setLineDash([]);
  ctx.fillStyle = picked ? c.accent : c.muted;
  ctx.font = `600 ${Math.max(10, 1.5 * v.scale)}px ${c.font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(o.name, a[0] + r, a[1] - 3);
  // A newer version of the block is out (#773): a small Update tag after the name.
  if (stale) {
    const x = a[0] + r + ctx.measureText(o.name).width + 6;
    const t = "Update";
    const w = ctx.measureText(t).width + 8;
    const h = Math.max(10, 1.5 * v.scale) + 4;
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, a[1] - 3 - h + 2, w, h, h / 2);
    else ctx.rect(x, a[1] - 3 - h + 2, w, h);
    ctx.fill();
    ctx.fillStyle = c["on-accent"];
    ctx.fillText(t, x + 4, a[1] - 3);
  }
  ctx.restore();
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

/**
 * A net label's flag (#788): an outline round the name, pointed at the end the signal flows to. "in" points at the
 * label's own point (into the wire), "out" away from it, "both" at both ends. Says where the name and the far end go.
 */
function flag(
  ctx: CanvasRenderingContext2D,
  s: P2,
  dir: 1 | -1,
  textW: number,
  h: number,
  shape: "in" | "out" | "both",
  ink: string,
): { text: number; far: number } {
  const tip = h / 2;
  const near = shape !== "out";
  const farTip = shape !== "in";
  const x0 = s[0];
  const x1 = x0 + dir * (tip + textW + 6 + tip);
  const top = s[1] - h / 2;
  const bottom = s[1] + h / 2;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (near) {
    ctx.moveTo(x0, s[1]);
    ctx.lineTo(x0 + dir * tip, top);
  } else {
    ctx.moveTo(x0, bottom);
    ctx.lineTo(x0, top);
  }
  if (farTip) {
    ctx.lineTo(x1 - dir * tip, top);
    ctx.lineTo(x1, s[1]);
    ctx.lineTo(x1 - dir * tip, bottom);
  } else {
    ctx.lineTo(x1, top);
    ctx.lineTo(x1, bottom);
  }
  if (near) ctx.lineTo(x0 + dir * tip, bottom);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  return { text: x0 + dir * (tip + 3), far: x1 };
}
