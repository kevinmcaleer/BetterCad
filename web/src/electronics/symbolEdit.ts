import type { P2, PinType, Shape, SymbolDef, SymbolPin } from "@bettercad/electronics";

/**
 * Edits to a symbol being drawn by hand (#626): each is a function from a symbol to a new symbol, so the editor's
 * undo is a list of symbols. A thing on the symbol is named by what it is and where it sits in its list: "s3" is the
 * fourth shape, "p0" the first pin.
 */
export type ItemId = string;
export type SymShape = SymbolDef["shapes"][number];

/** Pins sit on the schematic's grid, so wires meet them. Line work may use half steps. */
export const PIN_GRID = 2.54;
export const DRAW_GRID = 1.27;

/** Where a pin is on the body, for people: the side its wire comes in from. */
export type PinSide = "left" | "right" | "top" | "bottom";
export const SIDES: { id: PinSide; label: string; dir: SymbolPin["dir"] }[] = [
  { id: "left", label: "Left", dir: 0 },
  { id: "right", label: "Right", dir: 180 },
  { id: "top", label: "Top", dir: 270 },
  { id: "bottom", label: "Bottom", dir: 90 },
];
export const sideOf = (pin: Pick<SymbolPin, "dir">): PinSide => SIDES.find((s) => s.dir === pin.dir)!.id;

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const DIRS: Record<number, P2> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };

/** The end of a pin's line at the body. */
export const pinInner = (p: SymbolPin): P2 => [r4(p.x + DIRS[p.dir]![0] * p.length), r4(p.y + DIRS[p.dir]![1] * p.length)];

/** Whether a shape or pin shows on a unit of a symbol with several. */
export const onUnit = (def: SymbolDef, item: { unit?: number }, unit: number) => def.units <= 1 || item.unit === undefined || item.unit === unit;

const index = (id: ItemId) => Number(id.slice(1));
export const isPin = (id: ItemId) => id[0] === "p";

/** The next free pin number: one more than the largest whole number in use. */
export function nextPinNumber(def: SymbolDef): string {
  const used = def.pins.map((p) => Number(p.number)).filter((n) => Number.isInteger(n) && n > 0);
  return String(Math.max(0, ...used) + 1);
}

export function addShape(def: SymbolDef, shape: Shape, unit: number): { def: SymbolDef; id: ItemId } {
  const s: SymShape = def.units > 1 ? { ...shape, unit } : shape;
  return { def: { ...def, shapes: [...def.shapes, s] }, id: `s${def.shapes.length}` };
}

export function addPin(def: SymbolDef, at: P2, side: PinSide, unit: number, type: PinType = "passive"): { def: SymbolDef; id: ItemId } {
  const number = nextPinNumber(def);
  const pin: SymbolPin = {
    number,
    name: number,
    type,
    x: at[0],
    y: at[1],
    length: PIN_GRID,
    dir: SIDES.find((s) => s.id === side)!.dir,
    ...(def.units > 1 ? { unit } : {}),
  };
  return { def: { ...def, pins: [...def.pins, pin] }, id: `p${def.pins.length}` };
}

function movedShape(s: SymShape, dx: number, dy: number): SymShape {
  if (s.kind === "line") return { ...s, pts: s.pts.map((p) => [r4(p[0] + dx), r4(p[1] + dy)] as P2) };
  if (s.kind === "rect") return { ...s, x1: r4(s.x1 + dx), y1: r4(s.y1 + dy), x2: r4(s.x2 + dx), y2: r4(s.y2 + dy) };
  if (s.kind === "circle" || s.kind === "arc") return { ...s, cx: r4(s.cx + dx), cy: r4(s.cy + dy) };
  return { ...s, x: r4(s.x + dx), y: r4(s.y + dy) };
}

export function moveItems(def: SymbolDef, ids: Iterable<ItemId>, dx: number, dy: number): SymbolDef {
  const set = new Set(ids);
  if (!set.size || (!dx && !dy)) return def;
  return {
    ...def,
    shapes: def.shapes.map((s, i) => (set.has(`s${i}`) ? movedShape(s, dx, dy) : s)),
    pins: def.pins.map((p, i) => (set.has(`p${i}`) ? { ...p, x: r4(p.x + dx), y: r4(p.y + dy) } : p)),
  };
}

export function deleteItems(def: SymbolDef, ids: Iterable<ItemId>): SymbolDef {
  const set = new Set(ids);
  return { ...def, shapes: def.shapes.filter((_, i) => !set.has(`s${i}`)), pins: def.pins.filter((_, i) => !set.has(`p${i}`)) };
}

export function setPin(def: SymbolDef, id: ItemId, patch: Partial<SymbolPin>): SymbolDef {
  const i = index(id);
  return { ...def, pins: def.pins.map((p, k) => (k === i ? { ...p, ...patch } : p)) };
}

/** Moves a pin to another side, keeping the end at the body where it is, so the body does not have to move. */
export function setPinSide(def: SymbolDef, id: ItemId, side: PinSide): SymbolDef {
  const pin = def.pins[index(id)];
  if (!pin) return def;
  const inner = pinInner(pin);
  const dir = SIDES.find((s) => s.id === side)!.dir;
  return setPin(def, id, { dir, x: r4(inner[0] - DIRS[dir]![0] * pin.length), y: r4(inner[1] - DIRS[dir]![1] * pin.length) });
}

export function setShape(def: SymbolDef, id: ItemId, patch: Record<string, unknown>): SymbolDef {
  const i = index(id);
  return { ...def, shapes: def.shapes.map((s, k) => (k === i ? ({ ...s, ...patch } as SymShape) : s)) };
}

/**
 * Changes how many units the symbol has. Going from one to several puts everything there is on unit 1. Going down
 * takes the lost units' drawing and pins away.
 */
export function setUnits(def: SymbolDef, units: number): SymbolDef {
  const n = Math.max(1, Math.min(26, Math.round(units)));
  if (n === def.units) return def;
  if (n === 1) {
    const keep = <T extends { unit?: number }>(list: T[]) =>
      list
        .filter((x) => x.unit === undefined || x.unit === 1)
        .map((x) => {
          const rest = { ...x };
          delete rest.unit;
          return rest;
        });
    return { ...def, units: 1, shapes: keep(def.shapes), pins: keep(def.pins) };
  }
  if (def.units <= 1)
    return { ...def, units: n, shapes: def.shapes.map((s) => ({ ...s, unit: s.unit ?? 1 })), pins: def.pins.map((p) => ({ ...p, unit: p.unit ?? 1 })) };
  return { ...def, units: n, shapes: def.shapes.filter((s) => (s.unit ?? 1) <= n), pins: def.pins.filter((p) => (p.unit ?? 1) <= n) };
}

/** Copies a unit's drawing onto another unit that has none yet, as the gates of a quad part share one outline. */
export function copyUnitDrawing(def: SymbolDef, from: number, to: number): SymbolDef {
  if (def.units <= 1 || from === to) return def;
  return { ...def, shapes: [...def.shapes, ...def.shapes.filter((s) => s.unit === from).map((s) => ({ ...s, unit: to }))] };
}

// ---------------------------------------------------------------- finding things

const segDist = (p: P2, a: P2, b: P2): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** Whether angle `a` (degrees) is on the arc from `a0` anticlockwise to `a1`. */
export function onArc(a: number, a0: number, a1: number): boolean {
  const norm = (x: number) => ((x % 360) + 360) % 360;
  const sweep = norm(a1 - a0) || 360;
  return norm(a - a0) <= sweep;
}

function shapeDist(s: SymShape, p: P2): number {
  if (s.kind === "line") {
    let d = Infinity;
    for (let i = 0; i + 1 < s.pts.length; i++) d = Math.min(d, segDist(p, s.pts[i]!, s.pts[i + 1]!));
    if (s.fill && s.pts.length > 2) d = Math.min(d, segDist(p, s.pts[s.pts.length - 1]!, s.pts[0]!));
    return s.pts.length === 1 ? Math.hypot(p[0] - s.pts[0]![0], p[1] - s.pts[0]![1]) : d;
  }
  if (s.kind === "rect") {
    const c: P2[] = [
      [s.x1, s.y1],
      [s.x2, s.y1],
      [s.x2, s.y2],
      [s.x1, s.y2],
    ];
    return Math.min(...c.map((a, i) => segDist(p, a, c[(i + 1) % 4]!)));
  }
  if (s.kind === "circle") return Math.abs(Math.hypot(p[0] - s.cx, p[1] - s.cy) - s.r);
  if (s.kind === "arc") {
    const a = (Math.atan2(p[1] - s.cy, p[0] - s.cx) * 180) / Math.PI;
    if (onArc(a, s.a0, s.a1)) return Math.abs(Math.hypot(p[0] - s.cx, p[1] - s.cy) - s.r);
    const end = (deg: number): P2 => [s.cx + s.r * Math.cos((deg * Math.PI) / 180), s.cy + s.r * Math.sin((deg * Math.PI) / 180)];
    return Math.min(...[end(s.a0), end(s.a1)].map((e) => Math.hypot(p[0] - e[0], p[1] - e[1])));
  }
  // Text: a box about as wide as its letters.
  const w = Math.max(s.size, s.text.length * s.size * 0.6);
  const x0 = s.align === "centre" ? s.x - w / 2 : s.align === "right" ? s.x - w : s.x;
  const dx = Math.max(x0 - p[0], 0, p[0] - (x0 + w));
  const dy = Math.max(Math.abs(p[1] - s.y) - s.size / 2, 0);
  return Math.hypot(dx, dy);
}

/** What is under a point on one unit, pins before line work, nearest first. `tol` is in mm. */
export function hitSymbol(def: SymbolDef, unit: number, p: P2, tol: number): ItemId[] {
  const found: { id: ItemId; d: number }[] = [];
  def.pins.forEach((pin, i) => {
    if (!onUnit(def, pin, unit)) return;
    const d = segDist(p, [pin.x, pin.y], pinInner(pin));
    if (d <= tol) found.push({ id: `p${i}`, d: d - tol });
  });
  def.shapes.forEach((s, i) => {
    if (!onUnit(def, s, unit)) return;
    const d = shapeDist(s, p);
    if (d <= tol) found.push({ id: `s${i}`, d });
  });
  return found.sort((a, b) => a.d - b.d).map((f) => f.id);
}

/** A corner-to-corner box round an item, for the selection's outline. */
export function itemBox(def: SymbolDef, id: ItemId): { x1: number; y1: number; x2: number; y2: number } | null {
  if (isPin(id)) {
    const p = def.pins[index(id)];
    if (!p) return null;
    const b = pinInner(p);
    return { x1: Math.min(p.x, b[0]), y1: Math.min(p.y, b[1]), x2: Math.max(p.x, b[0]), y2: Math.max(p.y, b[1]) };
  }
  const s = def.shapes[index(id)];
  if (!s) return null;
  if (s.kind === "line") {
    const xs = s.pts.map((q) => q[0]);
    const ys = s.pts.map((q) => q[1]);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  if (s.kind === "rect") return { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) };
  if (s.kind === "circle" || s.kind === "arc") return { x1: s.cx - s.r, y1: s.cy - s.r, x2: s.cx + s.r, y2: s.cy + s.r };
  const w = Math.max(s.size, s.text.length * s.size * 0.6);
  const x0 = s.align === "centre" ? s.x - w / 2 : s.align === "right" ? s.x - w : s.x;
  return { x1: x0, y1: s.y - s.size / 2, x2: x0 + w, y2: s.y + s.size / 2 };
}

/** An arc from three clicks: the centre, where it starts, and a point that says where it ends (anticlockwise). */
export function arcFrom(centre: P2, start: P2, end: P2): Extract<Shape, { kind: "arc" }> | null {
  const r = r4(Math.hypot(start[0] - centre[0], start[1] - centre[1]));
  if (r < 0.1) return null;
  const deg = (p: P2) => r4((Math.atan2(p[1] - centre[1], p[0] - centre[0]) * 180) / Math.PI);
  const a0 = deg(start);
  const a1 = deg(end);
  if (a0 === a1) return null;
  return { kind: "arc", cx: centre[0], cy: centre[1], r, a0, a1 };
}

/** What stops a hand-drawn symbol being used, and what deserves a look, in words. */
export function checkSymbol(def: SymbolDef): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  if (def.pins.length === 0) problems.push("Add at least one pin to the symbol.");
  const blank = def.pins.filter((p) => !p.number.trim()).length;
  if (blank) problems.push(`${blank} ${blank === 1 ? "pin has" : "pins have"} no number.`);
  const seen = new Map<string, number>();
  for (const p of def.pins) if (p.number.trim()) seen.set(p.number, (seen.get(p.number) ?? 0) + 1);
  const twice = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  if (twice.length) problems.push(`Pin ${twice.join(", ")} is on the drawing more than once.`);
  const off = def.pins.filter(
    (p) => Math.abs(p.x / PIN_GRID - Math.round(p.x / PIN_GRID)) > 1e-3 || Math.abs(p.y / PIN_GRID - Math.round(p.y / PIN_GRID)) > 1e-3,
  );
  if (off.length) notes.push(`Pin ${off.map((p) => p.number).join(", ")} is off the 2.54 mm grid, so wires may not meet it.`);
  const spots = new Map<string, string[]>();
  for (const p of def.pins) {
    const k = `${p.unit ?? 0}|${p.x}|${p.y}`;
    spots.set(k, [...(spots.get(k) ?? []), p.number]);
  }
  for (const nums of spots.values()) if (nums.length > 1) notes.push(`Pins ${nums.join(" and ")} end at the same place, so one wire joins them all.`);
  for (let u = 1; u <= def.units && def.units > 1; u++) if (!def.pins.some((p) => p.unit === u)) notes.push(`Unit ${String.fromCharCode(64 + u)} has no pins.`);
  return { problems, notes };
}

/** A unit's name for people: A, B, C. */
export const unitName = (u: number) => String.fromCharCode(64 + u);
