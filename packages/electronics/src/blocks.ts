/**
 * Circuit blocks (#767): a ready-made circuit that drops onto a sheet as a group, with named connection points on its
 * outline. Inside, every connected pin carries a short stub and a net label; the labels' names start with the block's
 * own tag ("MD1.VM"), so two copies of a block keep their nets apart and only their points meet the outside. A point
 * is a label on the outline with the same name as its inside net. Points marked global (ground) are named plainly and
 * join the design's net of that name.
 */
import { pasteOnSheet, type Clip } from "./edit";
import { emptyBox, grow, pinDirOnSheet, placeOnSheet, q, type Box } from "./geom";
import { GROUP_PAD, placedBox, unitOf } from "./groups";
import { GRID } from "./basics";
import {
  eid,
  type BlockPoint,
  type ComponentDef,
  type ElectronicsDesign,
  type Id,
  type NetLabel,
  type P2,
  type PlacedBlock,
  type PointKind,
  type Sheet,
} from "./model";

/** Which edge of the outline a point sits on: inputs left, outputs right, power top, ground bottom. */
export type Edge = "left" | "right" | "top" | "bottom";

/** A block as it is written in the library: its parts, how they are joined, and its points. */
export interface BlockSpec {
  id: string;
  version: number;
  name: string;
  /** The shelf in the Blocks tab. */
  shelf: "Power" | "Motors" | "Connectors" | "Sensors and signals" | "Your blocks";
  /** What it does, in one line a beginner understands. */
  summary: string;
  /** What it needs to work: "6 to 10 V for the motors, 3.3 V logic". */
  needs?: string;
  keywords?: string[];
  /** The start of the block's tag: "MD" gives MD1, MD2. */
  tag: string;
  /** The datasheet or reference design it follows. */
  source: { title: string; url: string };
  parts: { ref: string; part: string; value?: string; pkg?: number; note: string }[];
  /** Nets by name: pins as "U1.VM" (pin name) or "U1.12" (pin number). A pin name used twice picks every such pin. */
  nets: Record<string, string[]>;
  /** Pins left open on purpose. */
  open?: string[];
  points: { name: string; net: string; kind: PointKind; edge?: Edge; volts?: string; note?: string; required?: boolean; global?: boolean }[];
  /**
   * Where the parts go on the board, from the datasheet's layout guide: millimetres and degrees by reference, the
   * first part at the middle. Parts it leaves out are set beside them (#774).
   */
  layout?: Record<string, [x: number, y: number, rot?: number]>;
}

/** A block laid out and ready to place: a clip at the origin and its points. Inside names start with `@.`. */
export interface BuiltBlock {
  spec: BlockSpec;
  clip: Clip;
  /** The points, by the label each one is in the clip. */
  points: (Omit<BlockPoint, "label"> & { label: Id })[];
  /** What each part is for, by its id in the clip. */
  notes: Record<Id, string>;
  /** The board layout, by id in the clip. */
  layout?: Record<Id, { x: number; y: number; rot: number }>;
  /** The outline in the clip's space. */
  box: Box;
}

const TAG = "@";
const edgeOf = (k: PointKind): Edge =>
  k === "ground" ? "bottom" : k === "power-in" ? "top" : k === "power-out" || k === "signal-out" || k === "load" ? "right" : "left";
const DIR: Record<number, P2> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
const snapOut = (v: number, dir: -1 | 1) => (dir < 0 ? Math.floor(v / GRID) : Math.ceil(v / GRID)) * GRID;

/** A spec's pin reference, "U1.VM", as the pins it names. */
function pinsOf(ref: string, parts: Map<string, ComponentDef>): string[] {
  const dot = ref.indexOf(".");
  const def = parts.get(ref.slice(0, dot));
  const want = ref.slice(dot + 1);
  if (!def) throw new Error(`Block pin ${ref}: no part ${ref.slice(0, dot)}`);
  const byNumber = def.symbol.pins.filter((p) => p.number === want);
  const pins = byNumber.length ? byNumber : def.symbol.pins.filter((p) => p.name === want);
  if (!pins.length) throw new Error(`Block pin ${ref}: ${def.name} has no pin ${want}`);
  return pins.map((p) => p.number);
}

/**
 * Lays a block out: its parts in rows, a stub and a label on every joined pin, and its points round the outline.
 * `lookup` gives a part of the library by id.
 */
export function buildBlock(spec: BlockSpec, lookup: (id: string) => ComponentDef | undefined): BuiltBlock {
  const defs = new Map<string, ComponentDef>();
  for (const p of spec.parts) {
    const def = lookup(p.part);
    if (!def) throw new Error(`Block ${spec.id}: no part ${p.part} in the library`);
    defs.set(p.ref, def);
  }
  const global = new Set(spec.points.filter((p) => p.global).map((p) => p.net));
  const nameOf = (net: string) => (global.has(net) ? net : `${TAG}.${net}`);
  // Which net each pin is on.
  const netOf = new Map<string, string>();
  for (const [net, pins] of Object.entries(spec.nets))
    for (const r of pins) for (const n of pinsOf(r, defs)) netOf.set(`${r.slice(0, r.indexOf("."))}.${n}`, net);

  const clip: Clip = { defs: {}, parts: [], symbols: [], wires: [], labels: [], junctions: [], noConnects: [] };
  const notes: Record<Id, string> = {};
  let layout: Record<Id, { x: number; y: number; rot: number }> | undefined;
  const inner = emptyBox();
  let x = 0;
  let y = 0;
  let rowH = 0;
  const ROW = 90;
  for (const p of spec.parts) {
    const def = defs.get(p.ref)!;
    const key = `${p.part}-${spec.id}`;
    clip.defs[key] = def;
    const id = eid("pt");
    clip.parts.push({ id, def: key, ref: p.ref, value: p.value ?? def.value ?? def.name, pkg: def.packages[p.pkg ?? 0] ? (p.pkg ?? 0) : 0 });
    notes[id] = p.note;
    const spot = spec.layout?.[p.ref];
    if (spot) (layout ??= {})[id] = { x: spot[0], y: spot[1], rot: spot[2] ?? 0 };
    // A part drawn in several units (a chip with four gates) has each unit placed, side by side.
    const units = Math.max(1, def.symbol.units || 1);
    for (let unit = 1; unit <= units; unit += 1) {
      const pinsHere = def.symbol.pins.filter((pin) => !(pin.unit !== undefined && units > 1 && pin.unit !== unit));
      const own = placedBox(unitOf(def.symbol, unit), { x: 0, y: 0, rot: 0 });
      const w = own.x2 - own.x1 + 8 * GRID;
      const h = own.y2 - own.y1 + 5 * GRID;
      if (x > 0 && x + w > ROW) {
        x = 0;
        y -= rowH;
        rowH = 0;
      }
      // Symbol origins on the grid, its box's top left at the row's corner.
      const at = { x: q(Math.round((x - own.x1 + 4 * GRID) / GRID) * GRID), y: q(Math.round((y - own.y2 - 2 * GRID) / GRID) * GRID), rot: 0 as const };
      clip.symbols.push({ id: eid("sy"), part: id, unit, ...at });
      grow(grow(inner, [at.x + own.x1, at.y + own.y1], 1.5), [at.x + own.x2, at.y + own.y2], 1.5);
      x += w;
      rowH = Math.max(rowH, h);
      for (const pin of pinsHere) {
        if (pin.hidden) continue;
        const net = netOf.get(`${p.ref}.${pin.number}`);
        const end = placeOnSheet([pin.x, pin.y], at);
        if (!net) {
          if (spec.open?.some((r) => r.startsWith(`${p.ref}.`) && pinsOf(r, defs).includes(pin.number)))
            clip.noConnects.push({ id: eid("nc"), x: end[0], y: end[1] });
          continue;
        }
        // A stub out from the pin, and the label on its end: text reads away from the part.
        const dir = DIR[pinDirOnSheet(pin, at)]!;
        const out: P2 = [q(end[0] - dir[0] * GRID), q(end[1] - dir[1] * GRID)];
        clip.wires.push({ id: eid("w"), a: end, b: out });
        const label: NetLabel = { id: eid("lb"), x: out[0], y: out[1], name: nameOf(net), ...(dir[0] > 0 ? { rot: 180 as const } : {}) };
        clip.labels.push(label);
        grow(inner, out, 1);
        grow(inner, [out[0] + (dir[0] > 0 ? -1 : 1) * (net.length + 2) * 0.95, out[1] + 1.8]);
      }
    }
  }
  // Points round the outline, spaced two grid steps apart, in the order given.
  const box: Box = {
    x1: snapOut(inner.x1 - GROUP_PAD, -1),
    y1: snapOut(inner.y1 - GROUP_PAD, -1),
    x2: snapOut(inner.x2 + GROUP_PAD, 1),
    y2: snapOut(inner.y2 + GROUP_PAD, 1),
  };
  const byEdge: Record<Edge, BlockSpec["points"]> = { left: [], right: [], top: [], bottom: [] };
  for (const p of spec.points) byEdge[p.edge ?? edgeOf(p.kind)].push(p);
  // Grow the box when an edge holds more points than fit.
  const need = (n: number) => (n + 1) * 2 * GRID;
  box.y1 = Math.min(box.y1, box.y2 - need(Math.max(byEdge.left.length, byEdge.right.length)));
  box.x2 = Math.max(box.x2, box.x1 + need(Math.max(byEdge.top.length, byEdge.bottom.length)));
  const points: BuiltBlock["points"] = [];
  for (const edge of Object.keys(byEdge) as Edge[])
    byEdge[edge].forEach((p, i) => {
      const step = 2 * GRID * (i + 1);
      const at: P2 =
        edge === "left"
          ? [box.x1, box.y2 - step]
          : edge === "right"
            ? [box.x2, box.y2 - step]
            : edge === "top"
              ? [box.x1 + step, box.y2]
              : [box.x1 + step, box.y1];
      const label: NetLabel = { id: eid("lb"), x: q(at[0]), y: q(at[1]), name: nameOf(p.net) };
      clip.labels.push(label);
      points.push({
        label: label.id,
        name: p.name,
        kind: p.kind,
        ...(p.volts ? { volts: p.volts } : {}),
        ...(p.note ? { note: p.note } : {}),
        ...(p.required ? { required: true } : {}),
      });
    });
  return { spec, clip, points, notes, box, ...(layout ? { layout } : {}) };
}

/** The next free tag for a block: MD1, MD2… across every sheet. */
export function nextTag(d: ElectronicsDesign, prefix: string): string {
  const used = new Set(d.sheets.flatMap((s) => (s.groups ?? []).flatMap((g) => (g.block ? [g.block.tag] : []))));
  for (let n = 1; ; n += 1) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** Drops a built block on a sheet, its top left near `at`. The ids of what was added and the new group come back. */
export function placeBlock(d: ElectronicsDesign, sheetId: Id, built: BuiltBlock, at: P2): { design: ElectronicsDesign; group: Id | null; ids: Id[] } {
  if (!d.sheets.some((s) => s.id === sheetId)) return { design: d, group: null, ids: [] };
  const tag = nextTag(d, built.spec.tag);
  const rename = (n: string) => (n.startsWith(`${TAG}.`) ? `${tag}.${n.slice(TAG.length + 1)}` : n);
  const clip: Clip = { ...built.clip, labels: built.clip.labels.map((l) => ({ ...l, name: rename(l.name) })) };
  const pasted = pasteOnSheet(d, sheetId, clip, q(at[0]), q(at[1]));
  // Map the clip's ids to the pasted ones by their order: the paste keeps it.
  const order = [
    ...clip.symbols.filter((s) => clip.parts.some((p) => p.id === s.part)),
    ...clip.wires,
    ...clip.labels,
    ...clip.junctions,
    ...clip.noConnects,
  ].map((x) => x.id);
  const newId = new Map(order.map((id, i) => [id, pasted.ids[i]!]));
  const sheet = pasted.design.sheets.find((s) => s.id === sheetId)!;
  const partOf = new Map(sheet.symbols.map((s) => [s.id, s.part]));
  const clipSym = new Map(clip.symbols.map((s) => [s.part, s.id]));
  const partFor = (clipPart: Id) => {
    const sym = newId.get(clipSym.get(clipPart) ?? "");
    return sym && partOf.get(sym);
  };
  const notes: Record<Id, string> = {};
  for (const [clipPart, note] of Object.entries(built.notes)) {
    const part = partFor(clipPart);
    if (part) notes[part] = note;
  }
  let layout: PlacedBlock["layout"];
  for (const [clipPart, spot] of Object.entries(built.layout ?? {})) {
    const part = partFor(clipPart);
    if (part) (layout ??= {})[part] = spot;
  }
  const first = clip.labels.find((l) => l.id === built.points[0]?.label);
  const frame = first && { x1: built.box.x1 - first.x, y1: built.box.y1 - first.y, x2: built.box.x2 - first.x, y2: built.box.y2 - first.y };
  const group = {
    id: eid("gr"),
    name: built.spec.name,
    members: pasted.ids,
    block: {
      def: built.spec.id,
      version: built.spec.version,
      tag,
      points: built.points.map((p) => ({ ...p, label: newId.get(p.label)! })),
      notes,
      ...(frame ? { frame } : {}),
      ...(layout ? { layout } : {}),
    },
  };
  const design: ElectronicsDesign = {
    ...pasted.design,
    sheets: pasted.design.sheets.map((s): Sheet => (s.id === sheetId ? { ...s, groups: [...(s.groups ?? []), group] } : s)),
  };
  return { design, group: group.id, ids: pasted.ids };
}

export { shownName } from "./groups";
