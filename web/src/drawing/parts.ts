import type { DrawingNote, DrawingSheet, DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { materialOf, type ModelDoc } from "../state/document";
import { TEXT, type Box, type SheetLayout } from "./layout";
import { offered, refTo, targets, type Target } from "./marks";

/**
 * The parts list and its balloons (#574). The list is worked out from the model each time it is drawn, so it never
 * goes stale: a row for each top-level component and each body outside one, the same thing counted once. No DOM here.
 */

/** A body as the list needs it: the editor's built parts fit. */
export interface ListedBody {
  id: string;
  name: string;
  /** The component it is in. */
  link?: string;
  hidden?: boolean;
  hole?: boolean;
  /** Shown to design round, never printed. */
  reference?: boolean;
  /** A bought part from the catalogue. */
  catalogue?: { id: string; name: string };
  /** A copy of another body: one turned or placed by a pattern is the same part, a mirrored one is not. */
  copy?: { body: { id: string }; by: object };
}
export interface ListedComponent {
  id: string;
  name: string;
  parts?: string[];
  parent?: string;
}

export interface PartsRow {
  /** Its number in the list, from 1. */
  item: number;
  name: string;
  count: number;
  material: string;
  /** Every body of every copy, for finding a body's number. */
  bodies: string[];
  /** What a view of one of them shows. */
  shows: DrawingView["shows"];
}

export interface PartsOptions {
  /** What printed parts are made of: the model's print material. */
  material: string;
  /** What a component was inserted from, when it is another model: two of the same count as one row. */
  sourceOf?: (component: string) => string | undefined;
}

/** What goes in the Material column for parts that are bought, not printed. */
export const BOUGHT = "Bought";

/** The model's parts list: top-level components and loose bodies in build order, each numbered and counted. */
export function partsRows(bodies: readonly ListedBody[], components: readonly ListedComponent[], o: PartsOptions): PartsRow[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const top = (id: string): ListedComponent | undefined => {
    let c = byId.get(id);
    const seen = new Set<string>();
    while (c?.parent && byId.has(c.parent) && !seen.has(c.id)) {
      seen.add(c.id);
      c = byId.get(c.parent);
    }
    return c;
  };
  const bought = (b: ListedBody) => !!b.reference || !!b.catalogue;
  const groups = new Map<string, { name: string; first: string; bodies: ListedBody[]; shows: DrawingView["shows"] }>();
  const loose = new Map(bodies.map((b) => [b.id, b]));
  for (const b of bodies) {
    if (b.hidden || b.hole) continue;
    const c = b.link ? top(b.link) : undefined;
    let key: string;
    let name: string;
    let shows: DrawingView["shows"];
    if (c) {
      key = o.sourceOf?.(c.id) ?? `c:${c.id}`;
      name = c.name;
      shows = { component: c.id };
    } else if (b.catalogue) {
      key = `cat:${b.catalogue.id}`;
      name = b.catalogue.name;
      shows = { bodies: [b.id] };
    } else {
      // A patterned copy counts with the body it was copied from; a mirrored one is a part of its own.
      let of = b;
      const seen = new Set<string>();
      while (of.copy && !("mirror" in of.copy.by) && !seen.has(of.id)) {
        seen.add(of.id);
        of = loose.get(of.copy.body.id) ?? { ...of, id: of.copy.body.id, copy: undefined };
      }
      key = `b:${of.id}`;
      name = of.id === b.id ? b.name : (loose.get(of.id)?.name ?? b.name);
      shows = { bodies: [b.id] };
    }
    const g = groups.get(key);
    if (g) g.bodies.push(b);
    else groups.set(key, { name, first: c ? c.id : b.id, bodies: [b], shows });
  }
  return [...groups.values()].map((g, i) => {
    // Copies of a component each bring all its bodies: count the components, not the bodies.
    const owners = new Set(g.bodies.map((b) => (b.link ? (top(b.link)?.id ?? b.id) : b.id)));
    return {
      item: i + 1,
      name: g.name,
      count: owners.size,
      material: g.bodies.every(bought) ? BOUGHT : o.material,
      bodies: g.bodies.map((b) => b.id),
      shows: g.shows,
    };
  });
}

/** The parts list of a model as it is built: printed parts are of its print material, and two inserts of one model are one row. */
export function modelParts(
  doc: Pick<ModelDoc, "features" | "print"> | undefined,
  bodies: readonly ListedBody[],
  components: readonly ListedComponent[],
): PartsRow[] {
  return partsRows(bodies, components, {
    material: materialOf(doc?.print?.material).name,
    sourceOf: (id) => {
      const f = doc?.features.find((x) => x.id === id);
      return f?.type === "model" ? `${f.source.kind}:${f.source.kind === "account" ? f.source.id : f.source.name}` : undefined;
    },
  });
}

/** The item number of the row a body is in. */
export const itemOf = (rows: readonly PartsRow[], body: string): number | undefined => rows.find((r) => r.bodies.includes(body))?.item;

/** The list as a table on the page: millimetres from the page's top left, y down, as the title block is laid out. */
export interface PartsTable {
  box: Box;
  /** Thin lines inside, and the thick outline is `box`. */
  lines: { x1: number; y1: number; x2: number; y2: number }[];
  /** Each row's cells, the heading first. `x` is where the text is anchored, `y` its middle. */
  rows: { cells: { x: number; y: number; text: string; anchor: "start" | "middle" }[] }[];
  size: number;
}

export const PARTS_HEAD = ["Item", "Part", "Qty", "Material"] as const;
const ROW = 6;
const COLS = [12, 0, 12, 30];

/** The parts list above the title block, as wide as it is, the heading on top. */
export function partsTable(rows: readonly PartsRow[], l: SheetLayout): PartsTable {
  const w = Math.max(l.block.w, 110);
  const h = ROW * (rows.length + 1);
  const box: Box = { x: l.block.x + l.block.w - w, y: l.block.y - h, w, h };
  const widths = COLS.map((c) => c || w - COLS.reduce((a, b) => a + b, 0));
  const lines: PartsTable["lines"] = [];
  let x = box.x;
  const starts = widths.map((cw) => {
    const at = x;
    x += cw;
    return at;
  });
  for (const s of starts.slice(1)) lines.push({ x1: s, y1: box.y, x2: s, y2: box.y + h });
  for (let i = 1; i <= rows.length; i++) lines.push({ x1: box.x, y1: box.y + ROW * i, x2: box.x + w, y2: box.y + ROW * i });
  const row = (i: number, texts: string[]) => ({
    cells: texts.map((text, c) =>
      c === 1 || c === 3
        ? { x: starts[c]! + 1.5, y: box.y + ROW * (i + 0.5), text, anchor: "start" as const }
        : { x: starts[c]! + widths[c]! / 2, y: box.y + ROW * (i + 0.5), text, anchor: "middle" as const },
    ),
  });
  return {
    box,
    lines,
    rows: [row(0, [...PARTS_HEAD]), ...rows.map((r, i) => row(i + 1, [String(r.item), r.name, String(r.count), r.material]))],
    size: TEXT.value * 0.8,
  };
}

/** How far a balloon's circle is across, mm on paper. */
export const BALLOON = 8;

/**
 * Balloons for every part a view shows that has none there yet, set out round the view: each on a line from the
 * view's middle through its part, clear of the view's lines, and spread so no two touch.
 */
export function autoBalloons(
  view: ModelView,
  viewId: string,
  scale: number,
  rows: readonly PartsRow[],
  existing: readonly DrawingNote[],
  newId: () => string,
): DrawingNote[] {
  const all = offered(targets(view));
  const mid: V2 = [(view.box.min[0] + view.box.max[0]) / 2, (view.box.min[1] + view.box.max[1]) / 2];
  const half: V2 = [((view.box.max[0] - view.box.min[0]) * scale) / 2, ((view.box.max[1] - view.box.min[1]) * scale) / 2];
  const P = (p: V2): V2 => [(p[0] - mid[0]) * scale, (p[1] - mid[1]) * scale];
  const at = (t: Target): V2 => P(t.kind === "round" ? t.c : [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2]);
  const done = new Set(existing.filter((n) => n.kind === "balloon" && n.on?.view === viewId).map((n) => (n.on ? itemOf(rows, n.on.body) : undefined)));
  const picked: { target: Target; turn: number }[] = [];
  for (const row of rows) {
    if (done.has(row.item)) continue;
    const mine = all.filter((t) => row.bodies.includes(t.source.body));
    if (!mine.length) continue;
    // Point at its longest edge, or a round face when it has no straight edge.
    const len = (t: Target) => (t.kind === "round" ? 0 : Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]));
    const target = mine.reduce((best, t) => (len(t) > len(best) ? t : best));
    const centre = mine.map(at).reduce<V2>((a, p) => [a[0] + p[0] / mine.length, a[1] + p[1] / mine.length], [0, 0]);
    const p = at(target);
    const d: V2 = Math.hypot(centre[0], centre[1]) > 1 ? centre : Math.hypot(p[0], p[1]) > 1 ? p : [0, 1];
    picked.push({ target, turn: Math.atan2(d[1], d[0]) });
  }
  // Round the view in order, no two closer than a balloon and a half on the ring they sit on.
  picked.sort((a, b) => a.turn - b.turn);
  const ring = Math.hypot(half[0], half[1]) + BALLOON * 1.5;
  const least = (BALLOON * 1.5) / ring;
  for (let i = 1; i < picked.length; i++) if (picked[i]!.turn - picked[i - 1]!.turn < least) picked[i]!.turn = picked[i - 1]!.turn + least;
  return picked.map(({ target, turn }) => {
    // On the box round the view, pushed out by a balloon and a half.
    const [cx, cy] = [Math.cos(turn), Math.sin(turn)];
    const k = Math.min((half[0] + BALLOON * 1.5) / (Math.abs(cx) || 1e-9), (half[1] + BALLOON * 1.5) / (Math.abs(cy) || 1e-9));
    const c: V2 = [cx * k, cy * k];
    return { id: newId(), kind: "balloon", text: "", on: refTo(viewId, target), at: [Math.round(c[0] - BALLOON / 2), Math.round(c[1] - BALLOON / 2)] };
  });
}

/** A sheet with its parts list shown or taken away. */
export function setPartsList(sheet: DrawingSheet, on: boolean): DrawingSheet {
  const next = { ...sheet };
  if (on) next.partsList = true;
  else delete next.partsList;
  return next;
}
