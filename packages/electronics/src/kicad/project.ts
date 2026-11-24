import { defKey } from "../edit";
import { onSegment } from "../geom";
import { textWidth } from "../fab/font";
import {
  DEFAULT_RULES,
  eid,
  emptyBoard,
  type Board,
  type BoardLayer,
  type ComponentDef,
  type Corner,
  type ElectronicsDesign,
  type FootprintDef,
  type Id,
  type NetClass,
  type P2,
  type Part,
  type Placement,
  type Rot,
  type Rules,
  type SchSymbol,
  type Shape,
  type Sheet,
} from "../model";
import { netlist, pinKey } from "../nets";
import { area } from "../outlineGeom";
import { netPins } from "../sync";
import { footprintIn } from "./footprint";
import { unstack, type ImportFile } from "./import";
import { arcFrom3, child, children, flag, head, isList, num, parseSexpr, text, type Node } from "./sexpr";
import { symbolsIn, type KicadSymbol } from "./symbol";

/**
 * Opening a KiCad project (#663): its schematic, sheet by sheet, and its board, as one design. KiCad 6 and later
 * write the files this reads. What does not come across is listed in `notes`, never left out in silence.
 */
export interface ProjectImport {
  design: ElectronicsDesign;
  /** What was left out or changed on the way in, and why. */
  notes: { name: string; why: string }[];
  found: { sheets: number; parts: number; placed: number; tracks: number; vias: number; pours: number };
}

export interface ProjectOptions {
  /** The licence the files are shared under, kept on every part. */
  licence?: string;
  /** A footprint by KiCad name, for a part the board does not hold (the starter library's). */
  known?: (name: string) => FootprintDef | undefined;
}

const G = 2.54;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
const snap = (v: number) => Math.round(v / G) * G;
const base = (file: string) => file.replace(/^.*[\\/]/, "");
const stem = (file: string) => base(file).replace(/\.[^.]+$/, "");
const norm = (deg: number) => (((Math.round(deg * 1e4) / 1e4) % 360) + 360) % 360;

/** Counts things of one kind for a note: "3 buses". */
class Tally {
  private n = new Map<string, number>();
  add(what: string, by = 1) {
    this.n.set(what, (this.n.get(what) ?? 0) + by);
  }
  each(): [string, number][] {
    return [...this.n.entries()];
  }
}

// ---------------------------------------------------------------- the schematic

interface PlacedUnit {
  sheet: Id;
  symbol: SchSymbol;
  lib: KicadSymbol;
  ref: string;
  value: string;
  footprint: string;
  fitted: boolean;
}

interface SchRead {
  sheets: Sheet[];
  units: PlacedUnit[];
  /** Labels to add at the hidden supply pins of old symbols, once their places are known. */
  version: number;
}

function readSchematic(files: Map<string, Node[]>, rootFile: string, notes: ProjectImport["notes"]): SchRead {
  const out: SchRead = { sheets: [], units: [], version: 0 };
  const dropped = new Tally();
  const root = files.get(rootFile)!;
  out.version = num(child(root, "version"));
  // KiCad 6 kept every part's reference in the first file, by the path to its symbol.
  const oldRefs = new Map(children(child(root, "symbol_instances"), "path").map((p) => [text(p), text(child(p, "reference"))]));
  const libs = new Map<string, Map<string, KicadSymbol>>();
  const libOf = (file: string) => {
    if (!libs.has(file)) libs.set(file, new Map(symbolsIn(child(files.get(file), "lib_symbols") ?? []).map((sym) => [sym.name, sym])));
    return libs.get(file)!;
  };

  /** The wires of a bus, by name and in order: "D[0..7]" is D0 to D7. Null for a plain name. */
  const members = (name: string): string[] | null => {
    const m = /^(.*)\[(\d+)\.\.(\d+)\]$/.exec(name);
    if (!m) return null;
    const [from, to] = [Number(m[2]), Number(m[3])];
    if (Math.abs(to - from) > 512) return null;
    const step = to >= from ? 1 : -1;
    return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => `${m[1]}${from + i * step}`);
  };

  /** `alias` gives names inside this sheet that are really a net of the sheet above: the wires of a bus on a sheet pin. */
  const walk = (file: string, path: string, name: string, prefix: string, depth: number, alias: Map<string, string>) => {
    const tree = files.get(file);
    if (!tree || depth > 12) {
      if (!tree) notes.push({ name: base(file), why: "A sheet of the schematic is in this file, which was not among the ones opened" });
      return;
    }
    const lib = libOf(file);
    // Where things are, to bring the sheet near our origin with y running up.
    let x1 = Infinity;
    let y2 = -Infinity;
    for (const item of tree) {
      if (!isList(item)) continue;
      const at = child(item, "at");
      const pts = children(child(item, "pts"), "xy");
      for (const p of at ? [at, ...pts] : pts) {
        x1 = Math.min(x1, num(p, 1));
        y2 = Math.max(y2, num(p, 2));
      }
    }
    const ox = x1 === Infinity ? 0 : snap(x1);
    const oy = x1 === Infinity ? 0 : snap(y2);
    const at = (n: Node[] | undefined): P2 => [r4(num(n, 1) - ox), r4(oy - num(n, 2))];
    const sheet: Sheet = { id: eid("sh"), name: name || "Sheet 1", symbols: [], wires: [], junctions: [], labels: [], noConnects: [], notes: [] };
    out.sheets.push(sheet);
    const label = (text0: string, p: P2, rot = 0) =>
      sheet.labels.push({ id: eid("lb"), name: text0, x: p[0], y: p[1], ...(rot ? { rot: (norm(rot) - (norm(rot) % 90)) as Rot } : {}) });
    /** A name used on this sheet, as the whole design knows it. */
    const scoped = (local: string) => alias.get(local) ?? `${prefix}${local}`;

    // Buses: which pieces join, and what each run is called, so a bus on a sheet's pin can be followed inside.
    const buses = children(tree, "bus").flatMap((b) => {
      const pts = children(child(b, "pts"), "xy").map(at);
      return pts.slice(1).map((q, i): [P2, P2] => [pts[i]!, q]);
    });
    const group = buses.map((_, i) => i);
    const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i]!)));
    buses.forEach((a, i) =>
      buses.forEach((b, k) => {
        if (k > i && (onSegment(a[0], b[0], b[1]) || onSegment(a[1], b[0], b[1]) || onSegment(b[0], a[0], a[1]) || onSegment(b[1], a[0], a[1])))
          group[find(k)] = find(i);
      }),
    );
    const busAt = (p: P2): number => {
      const i = buses.findIndex((b) => onSegment(p, b[0], b[1]));
      return i < 0 ? -1 : find(i);
    };
    /** The design's names for the wires of each run of bus: from a label on it, else from the first sheet pin on it. */
    const busNames = new Map<number, string[]>();
    for (const item of tree) {
      if (!isList(item) || !["label", "global_label", "hierarchical_label"].includes(head(item))) continue;
      const list = members(text(item));
      const g = list ? busAt(at(child(item, "at"))) : -1;
      if (list && g >= 0 && !busNames.has(g))
        busNames.set(
          g,
          list.map((m) => (head(item) === "global_label" ? m : scoped(m))),
        );
    }

    for (const item of tree) {
      if (!isList(item)) continue;
      const kind = head(item);
      if (kind === "wire") {
        const pts = children(child(item, "pts"), "xy").map(at);
        for (let i = 0; i + 1 < pts.length; i += 1) sheet.wires.push({ id: eid("w"), a: pts[i]!, b: pts[i + 1]! });
      } else if (kind === "junction") {
        const p = at(child(item, "at"));
        sheet.junctions.push({ id: eid("j"), x: p[0], y: p[1] });
      } else if (kind === "no_connect") {
        const p = at(child(item, "at"));
        sheet.noConnects.push({ id: eid("nc"), x: p[0], y: p[1] });
      } else if (kind === "label" || kind === "hierarchical_label") {
        // A bus's own label names its wires; it is not a net.
        if (!members(text(item))) label(scoped(text(item)), at(child(item, "at")), num(child(item, "at"), 3));
      } else if (kind === "global_label") {
        if (!members(text(item))) label(text(item), at(child(item, "at")), num(child(item, "at"), 3));
      } else if (kind === "sheet") {
        const prop = (key: string, old: string) =>
          text(
            children(item, "property").find((p) => text(p) === key || text(p) === old),
            2,
          );
        const childName = prop("Sheetname", "Sheet name") || "Sheet";
        const childFile = prop("Sheetfile", "Sheet file");
        const childPrefix = `${prefix}${childName}/`;
        // A pin on the sheet's box is the net of that name inside the sheet.
        const inside = new Map<string, string>();
        for (const pin of children(item, "pin")) {
          const list = members(text(pin));
          if (!list) {
            if (/\{.*\}/.test(text(pin))) dropped.add("group buses between sheets");
            else label(`${childPrefix}${text(pin)}`, at(child(pin, "at")));
            continue;
          }
          // A bus on the pin: each of its wires inside the sheet is the wire in the same place on the bus out here.
          const g = busAt(at(child(pin, "at")));
          if (g < 0) continue;
          if (!busNames.has(g))
            busNames.set(
              g,
              list.map((m) => `${childPrefix}${m}`),
            );
          const outside = busNames.get(g)!;
          list.forEach((m, i) => {
            if (outside[i] !== undefined && outside[i] !== `${childPrefix}${m}`) inside.set(m, outside[i]!);
          });
        }
        const dir = file.includes("/") ? file.replace(/[^/]*$/, "") : "";
        const target = [...files.keys()].find((f) => f === `${dir}${childFile}`) ?? [...files.keys()].find((f) => base(f) === base(childFile));
        if (!target) notes.push({ name: childFile, why: `The sheet ${childName} is in this file, which was not among the ones opened` });
        else walk(target, `${path}/${text(child(item, "uuid"))}`, childName, childPrefix, depth + 1, inside);
      } else if (kind === "symbol") {
        const id = text(child(item, "lib_name")) || text(child(item, "lib_id"));
        const sym = lib.get(id);
        if (!sym) {
          notes.push({ name: id, why: "The schematic draws this symbol but does not hold it, so the part was left out" });
          continue;
        }
        const prop = (key: string) =>
          text(
            children(item, "property").find((p) => text(p) === key),
            2,
          );
        const uuid = text(child(item, "uuid"));
        const paths = children(child(item, "instances"), "project").flatMap((p) => children(p, "path"));
        const mine = paths.find((p) => text(p) === path) ?? (paths.length === 1 ? paths[0] : undefined);
        const ref = text(child(mine, "reference")) || oldRefs.get(`${path}/${uuid}`) || prop("Reference");
        const unit = num(child(mine, "unit"), 1, 0) || num(child(item, "unit"), 1, 1);
        if (num(child(item, "convert"), 1, 1) > 1) dropped.add("symbols drawn in their alternate style, which came in drawn the usual way");
        const where = child(item, "at");
        const angle = norm(num(where, 3));
        const mirror = child(item, "mirror");
        const mx = !!mirror?.some((m) => m === "x");
        const my = !!mirror?.some((m) => m === "y");
        // KiCad turns, then mirrors. We mirror left to right, then turn: the same picture, by another road.
        const flipped = mx !== my;
        const rot = norm(mx && my ? angle + 180 : my ? 360 - angle : mx ? 180 - angle : angle);
        const p = at(where);
        // A reference that starts with "#" is not a real part: KiCad leaves it off the board and the parts list.
        const power = !!sym.symbol.power || ref.startsWith("#");
        // A power symbol that does not name a net (KiCad's PWR_FLAG) only speaks to KiCad's own rules check.
        if (power && !sym.symbol.pins.some((pin) => pin.type === "power_in")) {
          dropped.add("power flags, which only KiCad's rules check uses");
          continue;
        }
        const symbol: SchSymbol = { id: eid("sy"), part: "", unit, x: p[0], y: p[1], rot: (rot - (rot % 90)) as Rot, ...(flipped ? { mirror: true } : {}) };
        const value = power && out.version < 20230620 ? sym.symbol.pins.find((pin) => pin.type === "power_in")?.name || prop("Value") : prop("Value");
        out.units.push({
          sheet: sheet.id,
          symbol,
          lib: sym,
          ref: power ? "" : ref,
          value: value || sym.value,
          footprint: prop("Footprint"),
          fitted: !flag(item, "dnp") && text(child(item, "in_bom")) !== "no",
        });
        sheet.symbols.push(symbol);
      } else if (kind === "polyline") {
        const pts = children(child(item, "pts"), "xy").map(at);
        if (pts.length > 1) sheet.notes!.push({ id: eid("n"), kind: "line", pts });
      } else if (kind === "text") {
        const size = num(child(child(child(item, "effects"), "font"), "size"), 1, 1.27);
        const p = at(child(item, "at"));
        sheet.notes!.push({ id: eid("n"), kind: "text", x: p[0], y: p[1], text: text(item), size, align: "left" });
      } else if (kind === "bus" || kind === "bus_entry") dropped.add("buses and their entries, which are not drawn (the wires they carry still join by name)");
      else if (kind === "image") dropped.add("pictures");
      else if (kind === "text_box" || kind === "rectangle" || kind === "circle" || kind === "arc") dropped.add("boxes and shapes drawn on the sheet");
      else if (kind === "netclass_flag" || kind === "directive_label") dropped.add("net class flags");
    }
    if (!sheet.notes!.length) delete sheet.notes;
  };
  walk(rootFile, `/${text(child(root, "uuid"))}`, "", "", 0, new Map());
  for (const [what, n] of dropped.each()) notes.push({ name: "Schematic", why: `Left out: ${n} ${what}` });
  return out;
}

// ---------------------------------------------------------------- the board

/** A footprint as the board holds it, turned back to how a library draws it: for the top, not turned. */
function boardFootprint(node: Node[]): {
  fp: FootprintDef;
  place: Omit<Placement, "part">;
  ref: string;
  value: string;
  nets: Map<string, string>;
  skipped: number;
} {
  const bottom = text(child(node, "layer")).startsWith("B.");
  const read = footprintIn(node, bottom);
  const where = child(node, "at");
  const turn = norm(num(where, 3));
  const rot = norm(bottom ? turn - 180 : turn);
  const fp = read.footprint;
  const nets = new Map<string, string>();
  for (const p of children(node, "pad")) {
    const net = text(child(p, "net"), 2);
    if (net && text(p, 1)) nets.set(text(p, 1), net);
  }
  const pads = fp.pads.map((p) => {
    // On a board a pad's turn is the whole of it, the part's included.
    const mine = norm(bottom ? rot - (p.angle ?? 0) : (p.angle ?? 0) - turn);
    const rest = { ...p };
    delete rest.angle;
    // Half a turn leaves a pad as it was.
    return { ...rest, y: bottom ? r4(-p.y) : p.y, ...(mine % 180 ? { angle: mine } : {}) };
  });
  const over = (s: FootprintDef["shapes"][number]): FootprintDef["shapes"][number] => {
    if (!bottom) return s;
    if (s.kind === "line") return { ...s, pts: s.pts.map((q): P2 => [q[0], r4(-q[1])]) };
    if (s.kind === "rect") return { ...s, y1: r4(-s.y2), y2: r4(-s.y1) };
    if (s.kind === "circle") return { ...s, cy: r4(-s.cy) };
    if (s.kind === "arc") return { ...s, cy: r4(-s.cy), a0: norm(-s.a1), a1: norm(-s.a1) + (s.a1 - s.a0) };
    return { ...s, y: r4(-s.y) };
  };
  const textOf = (kind: string, key: string) =>
    text(
      children(node, "fp_text").find((t) => text(t) === kind),
      2,
    ) ||
    text(
      children(node, "property").find((t) => text(t) === key),
      2,
    );
  const name = text(node).split(":").pop() || "Footprint";
  return {
    fp: { name, pads, shapes: fp.shapes.map(over), ...(fp.refAt ? { refAt: [fp.refAt[0], bottom ? r4(-fp.refAt[1]) : fp.refAt[1]] as P2 } : {}) },
    place: { x: num(where, 1), y: num(where, 2), rot, side: bottom ? "bottom" : "top", ...(flag(node, "locked") ? { locked: true } : {}) },
    ref: textOf("reference", "Reference"),
    value: textOf("value", "Value"),
    nets,
    skipped: read.skipped,
  };
}

interface Edge {
  a: P2;
  b: P2;
  /** tan(sweep / 4) from a to b, positive anticlockwise. */
  bulge: number;
}

/** Joins edges end to end into closed loops, anticlockwise. Edges that close nothing are counted in `open`. */
function loopsOf(edges: Edge[]): { loops: Corner[][]; open: number } {
  const near = (p: P2, q: P2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.02;
  const left = [...edges];
  const loops: Corner[][] = [];
  let open = 0;
  while (left.length) {
    const run = [left.shift()!];
    for (let grew = true; grew && !near(run[0]!.a, run[run.length - 1]!.b);) {
      grew = false;
      const end = run[run.length - 1]!.b;
      const i = left.findIndex((e) => near(e.a, end) || near(e.b, end));
      if (i < 0) break;
      const e = left.splice(i, 1)[0]!;
      run.push(near(e.a, end) ? e : { a: e.b, b: e.a, bulge: -e.bulge });
      grew = true;
    }
    if (run.length > 1 && near(run[0]!.a, run[run.length - 1]!.b))
      loops.push(run.map((e) => ({ x: e.a[0], y: e.a[1], ...(e.bulge ? { bulge: r4(e.bulge) } : {}) })));
    else if (run.length === 1 && near(run[0]!.a, run[0]!.b) && run[0]!.bulge) loops.push([{ x: run[0]!.a[0], y: run[0]!.a[1], bulge: run[0]!.bulge }]);
    else open += run.length;
  }
  return {
    loops: loops.map((loop) => {
      const flat = loop.map((c): P2 => [c.x, c.y]);
      const turnsLeft = loop.length > 2 ? area(flat) > 0 : (loop[0]!.bulge ?? 0) > 0;
      if (turnsLeft) return loop;
      // The other way round: each edge's bend goes with the corner it now starts from.
      const n = loop.length;
      return loop.map((_, i) => {
        const c = loop[(n - i) % n]!;
        const before = loop[(n - i - 1) % n]!;
        return { x: c.x, y: c.y, ...(before.bulge ? { bulge: -before.bulge } : {}) };
      });
    }),
    open,
  };
}

const loopArea = (loop: Corner[]): number => {
  if (loop.length > 2) return Math.abs(area(loop.map((c): P2 => [c.x, c.y])));
  const d = loop.length === 2 ? Math.hypot(loop[0]!.x - loop[1]!.x, loop[0]!.y - loop[1]!.y) : 0;
  return (Math.PI * d * d) / 4;
};

/** The bend of an arc given by three points, from the first to the last. */
function bulgeOf(a: P2, m: P2, b: P2): number {
  const arc = arcFrom3(a, m, b);
  if (!arc) return 0;
  const sweep = ((arc.a1 - arc.a0) * Math.PI) / 180;
  const ccw = (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]) > 0;
  return (ccw ? 1 : -1) * Math.tan(sweep / 4);
}

const SIDE_LAYERS: Record<string, BoardLayer> = {
  "F.SilkS": "silk-top",
  "B.SilkS": "silk-bottom",
  "F.Silkscreen": "silk-top",
  "B.Silkscreen": "silk-bottom",
  "F.Cu": "copper-top",
  "B.Cu": "copper-bottom",
};
const copperOf = (layer: string): "top" | "bottom" | null => (layer === "F.Cu" ? "top" : layer === "B.Cu" ? "bottom" : null);

interface BoardRead {
  board: Board;
  /** Each footprint that stands for a part, by its reference. */
  parts: Map<string, { fp: FootprintDef; nets: Map<string, string>; value: string }>;
  /** KiCad's name for each net that copper is on, to be turned into ours. */
  found: { tracks: number; vias: number; pours: number };
}

function readBoard(tree: Node[], refs: Set<string>, notes: ProjectImport["notes"]): BoardRead {
  const dropped = new Tally();
  const board = emptyBoard();
  board.outline = [];
  const version = num(child(tree, "version"));
  if (version && version < 20211014)
    notes.push({ name: "Board", why: "It was saved by a KiCad older than 6. Open and save it in a newer KiCad first, or arcs and some pads may be wrong" });
  const thickness = num(child(child(tree, "general"), "thickness"));
  if (thickness > 0) board.thickness = thickness;
  const inner = (child(tree, "layers") ?? []).filter((l) => isList(l) && /^In\d+\.Cu$/.test(text(l, 1))).length;
  if (inner)
    notes.push({ name: "Board", why: `It has ${inner + 2} copper layers. Only the top and bottom came across; what is on the ${inner} inside is left out` });
  const netName = new Map(children(tree, "net").map((n) => [text(n, 1), text(n, 2)]));
  const netOf = (item: Node[]) => netName.get(text(child(item, "net"))) ?? "";

  // The edge first: it says where the board's corner is.
  const raw: { kind: string; item: Node[]; shift?: (p: P2) => P2 }[] = [];
  for (const item of tree) if (isList(item) && head(item).startsWith("gr_")) raw.push({ kind: head(item), item });
  const edges: Edge[] = [];
  const rings: Corner[][] = [];
  const flat = (n: Node[] | undefined): P2 => [num(n, 1), -num(n, 2)];
  for (const { kind, item } of raw) {
    if (text(child(item, "layer")) !== "Edge.Cuts") continue;
    if (kind === "gr_line") edges.push({ a: flat(child(item, "start")), b: flat(child(item, "end")), bulge: 0 });
    else if (kind === "gr_arc" && child(item, "mid")) {
      const [a, m, b] = [flat(child(item, "start")), flat(child(item, "mid")), flat(child(item, "end"))];
      edges.push({ a, b, bulge: bulgeOf(a, m, b) });
    } else if (kind === "gr_rect") {
      const [a, c] = [flat(child(item, "start")), flat(child(item, "end"))];
      const pts: P2[] = [a, [c[0], a[1]], c, [a[0], c[1]]];
      pts.forEach((p, i) => edges.push({ a: p, b: pts[(i + 1) % 4]!, bulge: 0 }));
    } else if (kind === "gr_poly") {
      const pts = children(child(item, "pts"), "xy").map(flat);
      pts.forEach((p, i) => edges.push({ a: p, b: pts[(i + 1) % pts.length]!, bulge: 0 }));
    } else if (kind === "gr_circle") {
      const c = flat(child(item, "center"));
      const e = flat(child(item, "end"));
      const r = Math.hypot(e[0] - c[0], e[1] - c[1]);
      rings.push([
        { x: c[0] - r, y: c[1], bulge: 1 },
        { x: c[0] + r, y: c[1], bulge: 1 },
      ]);
    } else dropped.add("shapes on the board's edge that could not be read");
  }
  const made = loopsOf(edges);
  if (made.open)
    notes.push({ name: "Board", why: `${made.open} ${made.open === 1 ? "line" : "lines"} of the edge did not close into an outline and were left out` });
  const all = [...made.loops, ...rings].sort((p, q) => loopArea(q) - loopArea(p));

  // Everything is measured from the outline's bottom left corner, or failing an outline, from the parts.
  const fps = children(tree, "footprint").concat(children(tree, "module"));
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const see = (p: P2) => {
    x1 = Math.min(x1, p[0]);
    y1 = Math.min(y1, p[1]);
    x2 = Math.max(x2, p[0]);
    y2 = Math.max(y2, p[1]);
  };
  if (all[0]) for (const c of all[0]) see([c.x, c.y]);
  else for (const f of fps) see(flat(child(f, "at")));
  if (x1 === Infinity) [x1, y1, x2, y2] = [0, 0, 50, 40];
  if (all[0]?.length === 2) [y1, y2] = [y1 - (x2 - x1) / 2, y2 + (x2 - x1) / 2];
  const at = (p: P2): P2 => [r4(p[0] - x1), r4(p[1] - y1)];
  const pt = (n: Node[] | undefined): P2 => at(flat(n));
  const move = (loop: Corner[]): Corner[] => loop.map((c) => ({ ...c, x: r4(c.x - x1), y: r4(c.y - y1) }));
  if (all[0]) {
    board.outline = move(all[0]);
    if (all.length > 1) board.cutouts = all.slice(1).map(move);
  } else {
    notes.push({ name: "Board", why: "It has no closed outline on Edge.Cuts, so a rectangle round the parts stands in for one" });
    board.outline = [
      { x: -5, y: -5 },
      { x: r4(x2 - x1 + 5), y: -5 },
      { x: r4(x2 - x1 + 5), y: r4(y2 - y1 + 5) },
      { x: -5, y: r4(y2 - y1 + 5) },
    ];
  }

  const parts: BoardRead["parts"] = new Map();
  const pending: Board["placements"] = [];
  for (const node of fps) {
    const f = boardFootprint(node);
    const p = pt(child(node, "at"));
    if (f.skipped) dropped.add("drawings in footprints on layers that are not kept (paste, mask and user layers)", f.skipped);
    const off = children(node, "pad").filter((x) => child(child(x, "drill"), "offset")).length;
    if (off) dropped.add("pads whose copper sits off the middle of the hole: the hole is where it should be, and the copper is centred on it", off);
    if (
      children(node, "fp_line")
        .concat(children(node, "fp_arc"), children(node, "fp_circle"))
        .some((g) => text(child(g, "layer")) === "Edge.Cuts")
    )
      dropped.add("edge cuts drawn inside footprints");
    if (f.ref && refs.has(f.ref) && !parts.has(f.ref)) {
      parts.set(f.ref, { fp: f.fp, nets: f.nets, value: f.value });
      pending.push({ part: f.ref, ...f.place, x: p[0], y: p[1], ref: f.ref, footprint: f.fp.name });
      continue;
    }
    // A footprint with no symbol: a hole comes across as a hole; anything else is named.
    const only = f.fp.pads.length === 1 ? f.fp.pads[0]! : undefined;
    if (only && only.drill && !only.slot && only.kind !== "smd" && Math.abs(only.x) < 1e-6 && Math.abs(only.y) < 1e-6)
      board.holes.push({ id: eid("h"), x: p[0], y: p[1], drill: only.drill, ...(only.kind === "thru" && only.w > only.drill ? { pad: only.w } : {}) });
    else if (parts.has(f.ref)) notes.push({ name: f.ref, why: "The board has this reference twice. The second was left out" });
    else notes.push({ name: f.ref || f.fp.name, why: `${f.fp.name} is on the board but has no symbol in the schematic, so it was left out` });
  }
  board.placements = pending;

  // Tracks: KiCad keeps each straight piece on its own; pieces that run on from each other are joined.
  const runs = new Map<string, { net: string; layer: "top" | "bottom"; width: number; pieces: [P2, P2][] }>();
  const piece = (net: string, layer: string, width: number, a: P2, b: P2) => {
    const side = copperOf(layer);
    if (!side) return dropped.add("tracks on inside layers");
    const key = `${net}|${side}|${width}`;
    if (!runs.has(key)) runs.set(key, { net, layer: side, width, pieces: [] });
    runs.get(key)!.pieces.push([a, b]);
  };
  for (const s of children(tree, "segment")) piece(netOf(s), text(child(s, "layer")), num(child(s, "width")), pt(child(s, "start")), pt(child(s, "end")));
  let arcs = 0;
  for (const s of children(tree, "arc")) {
    const [a, m, b] = [pt(child(s, "start")), pt(child(s, "mid")), pt(child(s, "end"))];
    const arc = arcFrom3(a, m, b);
    arcs += 1;
    if (!arc) {
      piece(netOf(s), text(child(s, "layer")), num(child(s, "width")), a, b);
      continue;
    }
    // A curved track goes in as short straight pieces, from its start to its end.
    const ccw = (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]) > 0;
    const sweep = arc.a1 - arc.a0;
    // Close enough that the chords stay within half a micron of the curve, which is the grace the board check gives.
    const n = Math.max(2, Math.ceil(sweep / ((360 / Math.PI) * Math.acos(Math.max(0, 1 - 0.0005 / Math.max(arc.r, 0.01))))));
    let last = a;
    for (let i = 1; i <= n; i += 1) {
      const t = ((ccw ? arc.a0 + (sweep * i) / n : arc.a1 - (sweep * i) / n) * Math.PI) / 180;
      const next: P2 = i === n ? b : [r4(arc.cx + arc.r * Math.cos(t)), r4(arc.cy + arc.r * Math.sin(t))];
      piece(netOf(s), text(child(s, "layer")), num(child(s, "width")), last, next);
      last = next;
    }
  }
  if (arcs) notes.push({ name: "Board", why: `${arcs} curved ${arcs === 1 ? "track" : "tracks"} came in as short straight pieces` });
  const k = (p: P2) => `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)}`;
  for (const run of runs.values()) {
    const ends = new Map<string, number>();
    for (const [a, b] of run.pieces) for (const p of [a, b]) ends.set(k(p), (ends.get(k(p)) ?? 0) + 1);
    const left = [...run.pieces];
    while (left.length) {
      const pts: P2[] = [...left.shift()!];
      for (const front of [false, true]) {
        for (;;) {
          const tip = front ? pts[0]! : pts[pts.length - 1]!;
          // Only where exactly two pieces meet: a branch stays a join of tracks.
          if (ends.get(k(tip)) !== 2) break;
          const i = left.findIndex(([a, b]) => k(a) === k(tip) || k(b) === k(tip));
          if (i < 0) break;
          const [a, b] = left.splice(i, 1)[0]!;
          const next = k(a) === k(tip) ? b : a;
          if (front) pts.unshift(next);
          else pts.push(next);
        }
      }
      board.tracks.push({ id: eid("t"), net: run.net, layer: run.layer, width: run.width, pts });
    }
  }
  for (const v of children(tree, "via")) {
    const layers = (child(v, "layers") ?? []).slice(1).map(String);
    if (v.some((x) => x === "blind" || x === "micro") || !(layers.includes("F.Cu") && layers.includes("B.Cu"))) {
      dropped.add("vias that do not go right through the board");
      continue;
    }
    const p = pt(child(v, "at"));
    board.vias.push({ id: eid("v"), net: netOf(v), x: p[0], y: p[1], diameter: num(child(v, "size")), drill: num(child(v, "drill")) });
  }

  for (const z of children(tree, "zone")) {
    const polys = children(z, "polygon");
    const outline = children(child(polys[0], "pts"), "xy").map(pt);
    if (outline.length < 3) continue;
    if (polys.length > 1) dropped.add("holes drawn inside zones");
    const layers = [text(child(z, "layer")), ...(child(z, "layers") ?? []).slice(1).map(String)].filter(Boolean);
    const keep = child(z, "keepout");
    if (keep) {
      const no = (key: string) => text(child(keep, key)) === "not_allowed";
      board.keepouts.push({
        id: eid("ko"),
        outline,
        ...(no("tracks") || no("vias") ? { tracks: true } : {}),
        ...(no("copperpour") ? { pours: true } : {}),
        ...(no("footprints") ? { parts: true } : {}),
      });
      continue;
    }
    const pads = child(z, "connect_pads");
    const sides = new Set(layers.flatMap((l) => (l === "F&B.Cu" || l === "*.Cu" ? ["top", "bottom"] : copperOf(l) ? [copperOf(l)!] : [])));
    if (!sides.size) dropped.add("zones on inside layers");
    for (const side of sides) {
      const priority = num(child(z, "priority"));
      board.pours.push({
        id: eid("po"),
        net: text(child(z, "net_name")) || netOf(z),
        layer: side as "top" | "bottom",
        outline,
        thermal: !pads?.some((x) => x === "yes" || x === "no"),
        ...(priority ? { priority } : {}),
      });
    }
  }

  for (const { kind, item } of raw) {
    const name = text(child(item, "layer"));
    if (name === "Edge.Cuts") continue;
    const layer = SIDE_LAYERS[name];
    if (!layer) {
      dropped.add("drawings on layers that are not kept (fabrication, comments and user layers)");
      continue;
    }
    const w = num(child(child(item, "stroke"), "width")) || num(child(item, "width"));
    const width = w > 0 ? { width: w } : {};
    const fill = text(child(item, "fill")) === "solid" || text(child(item, "fill")) === "yes" ? { fill: true as const } : {};
    let shape: Shape | null = null;
    if (kind === "gr_text") {
      const size = num(child(child(child(item, "effects"), "font"), "size"), 1, 1);
      const just = child(child(item, "effects"), "justify") ?? [];
      const bottom = layer.endsWith("bottom");
      const where = child(item, "at");
      const angle = norm(num(where, 3));
      const p = pt(where);
      // KiCad anchors text by its middle unless it says otherwise; ours starts at its left end, on its baseline.
      const wide = textWidth(text(item), size);
      const along = just.some((j) => j === "left") ? 0 : just.some((j) => j === "right") ? -wide : -wide / 2;
      const up = just.some((j) => j === "bottom") ? 0 : just.some((j) => j === "top") ? -size : -size / 2;
      const c = Math.cos((angle * Math.PI) / 180);
      const s0 = Math.sin((angle * Math.PI) / 180);
      const dx = (bottom ? -1 : 1) * along;
      board.texts.push({
        id: eid("tx"),
        layer,
        x: r4(p[0] + dx * c - up * s0),
        y: r4(p[1] + dx * s0 + up * c),
        text: text(item),
        size,
        ...(angle ? { angle } : {}),
      });
      continue;
    }
    if (kind === "gr_line") shape = { kind: "line", pts: [pt(child(item, "start")), pt(child(item, "end"))], ...width };
    else if (kind === "gr_rect") {
      const [a, c] = [pt(child(item, "start")), pt(child(item, "end"))];
      shape = { kind: "rect", x1: Math.min(a[0], c[0]), y1: Math.min(a[1], c[1]), x2: Math.max(a[0], c[0]), y2: Math.max(a[1], c[1]), ...width, ...fill };
    } else if (kind === "gr_circle") {
      const [c, e] = [pt(child(item, "center")), pt(child(item, "end"))];
      shape = { kind: "circle", cx: c[0], cy: c[1], r: r4(Math.hypot(e[0] - c[0], e[1] - c[1])), ...width, ...fill };
    } else if (kind === "gr_arc" && child(item, "mid")) {
      const arc = arcFrom3(pt(child(item, "start")), pt(child(item, "mid")), pt(child(item, "end")));
      if (arc) shape = { kind: "arc", ...arc, ...width };
    } else if (kind === "gr_poly") {
      const pts = children(child(item, "pts"), "xy").map(pt);
      if (pts.length > 2) shape = { kind: "line", pts: [...pts, pts[0]!], ...width, fill: true };
    }
    if (shape) board.shapes.push({ ...shape, id: eid("s"), layer });
    else dropped.add("drawings that could not be read");
  }
  for (const what of ["dimension", "image", "group", "target"]) {
    const n = children(tree, what).length;
    if (n && what !== "group") dropped.add(what === "dimension" ? "dimensions" : what === "image" ? "pictures" : "alignment targets", n);
  }
  for (const [what, n] of dropped.each()) notes.push({ name: "Board", why: `Left out: ${n} ${what}` });
  return { board, parts, found: { tracks: board.tracks.length, vias: board.vias.length, pours: board.pours.length } };
}

/** The numbers a KiCad project file sets, where it sets them. */
function readRules(pro: unknown): { rules: Rules; classes: Omit<NetClass, "id">[] } {
  const rules: Rules = { ...DEFAULT_RULES };
  const classes: Omit<NetClass, "id">[] = [];
  const o = (pro ?? {}) as {
    board?: { design_settings?: { rules?: Record<string, number> } };
    net_settings?: { classes?: Record<string, unknown>[]; netclass_patterns?: { netclass: string; pattern: string }[] };
  };
  const min = o.board?.design_settings?.rules ?? {};
  const set = (key: keyof Rules, v: unknown) => {
    if (typeof v === "number" && v > 0) (rules as unknown as Record<string, number>)[key] = v;
  };
  set("minTrackWidth", min.min_track_width);
  set("minDrill", min.min_through_hole_diameter);
  set("minRing", min.min_via_annular_width);
  set("holeToHole", min.min_hole_to_hole);
  // None at all is a choice a project can make: an edge connector's fingers run to the edge.
  if (typeof min.min_copper_edge_clearance === "number" && min.min_copper_edge_clearance >= 0) rules.copperToEdge = min.min_copper_edge_clearance;
  for (const c of o.net_settings?.classes ?? []) {
    const name = String(c.name ?? "");
    const n = (key: string) => (typeof c[key] === "number" && (c[key] as number) > 0 ? (c[key] as number) : undefined);
    if (name === "Default") {
      set("clearance", n("clearance"));
      set("trackWidth", n("track_width"));
      set("viaDiameter", n("via_diameter"));
      set("viaDrill", n("via_drill"));
    } else if (name)
      classes.push({
        name,
        nets: (o.net_settings?.netclass_patterns ?? []).filter((p) => p.netclass === name && !/[*?[\]]/.test(p.pattern)).map((p) => p.pattern),
        trackWidth: n("track_width") ?? rules.trackWidth,
        clearance: n("clearance") ?? rules.clearance,
        ...(n("via_diameter") ? { viaDiameter: n("via_diameter")! } : {}),
        ...(n("via_drill") ? { viaDrill: n("via_drill")! } : {}),
      });
  }
  rules.minTrackWidth = Math.min(rules.minTrackWidth, rules.trackWidth);
  return { rules, classes };
}

// ---------------------------------------------------------------- the whole project

/**
 * A KiCad project as a design. Give it the project's files: every `.kicad_sch`, the `.kicad_pcb` and, for the board's
 * rules, the `.kicad_pro`. A schematic on its own comes in with no board; a board needs its schematic, since that is
 * where a design's nets come from here.
 */
export function importKicadProject(files: ImportFile[], o: ProjectOptions = {}): ProjectImport {
  const notes: ProjectImport["notes"] = [];
  const trees = new Map<string, Node[]>();
  let pcb: Node[] | undefined;
  let pcbName = "";
  let pro: unknown;
  for (const f of files) {
    try {
      if (/\.kicad_pro$/i.test(f.name)) pro = JSON.parse(f.text);
      else if (/\.kicad_(sch|pcb)$/i.test(f.name) || /^\s*\(kicad_(sch|pcb)\b/.test(f.text)) {
        const tree = parseSexpr(f.text)[0];
        if (isList(tree) && head(tree) === "kicad_sch") trees.set(f.name, tree);
        else if (isList(tree) && head(tree) === "kicad_pcb" && !pcb) [pcb, pcbName] = [tree, f.name];
        else
          notes.push({
            name: base(f.name),
            why:
              pcb && isList(tree) && head(tree) === "kicad_pcb"
                ? "A second board. One design holds one board, so it was left out"
                : "Not a KiCad schematic or board",
          });
      } else if (!/(sym|fp)-lib-table$|\.kicad_(prl|sym|mod|dru|wks)$/i.test(f.name))
        notes.push({ name: base(f.name), why: "Not a KiCad schematic or board, so it was not read" });
    } catch (e) {
      notes.push({ name: base(f.name), why: e instanceof Error ? e.message : "It could not be read" });
    }
  }
  if (!trees.size)
    throw new Error(
      pcb ? "A board needs its schematic. Add the project's .kicad_sch files too." : "There is no KiCad schematic (.kicad_sch) among these files.",
    );

  // The first sheet is the one no other sheet points at; with a choice, the one named like the board or project.
  const pointed = new Set<string>();
  for (const tree of trees.values())
    for (const sh of children(tree, "sheet")) {
      const file = text(
        children(sh, "property").find((p) => text(p) === "Sheetfile" || text(p) === "Sheet file"),
        2,
      );
      for (const name of trees.keys()) if (base(name) === base(file)) pointed.add(name);
    }
  const tops = [...trees.keys()].filter((name) => !pointed.has(name));
  const want = stem(pcbName || files.find((f) => /\.kicad_pro$/i.test(f.name))?.name || "");
  const rootFile = tops.find((name) => stem(name) === want) ?? tops[0] ?? [...trees.keys()][0]!;
  for (const other of tops)
    if (other !== rootFile) notes.push({ name: base(other), why: "A schematic that is not part of the first one's sheets, so it was left out" });

  const sch = readSchematic(trees, rootFile, notes);
  const licence = o.licence?.trim() || "Not stated";
  const design: ElectronicsDesign = { defs: {}, parts: [], sheets: sch.sheets };

  // The board's footprints, by reference: a part takes its footprint from where it stands on the board.
  const refs = new Set(sch.units.map((u) => u.ref).filter(Boolean));
  const brd = pcb ? readBoard(pcb, refs, notes) : undefined;

  // Units with one reference are one part. A power symbol is a part of its own each time.
  const byRef = new Map<string, Part>();
  let power = 0;
  const lacking: string[] = [];
  for (const u of sch.units) {
    const isPower = !!u.lib.symbol.power || u.ref === "";
    let part = isPower ? undefined : byRef.get(u.ref);
    if (!part) {
      const flat = unstack(u.lib.symbol);
      const onBoard = brd?.parts.get(u.ref);
      const named = u.footprint.split(":").pop() ?? "";
      const fp = isPower ? undefined : (onBoard?.fp ?? (named ? o.known?.(named) : undefined));
      const [library, plain] = u.lib.name.includes(":") ? (u.lib.name.split(/:(.*)/) as [string, string]) : ["", u.lib.name];
      const def: ComponentDef = {
        name: plain.replace(/_/g, " "),
        ...(u.lib.description ? { description: u.lib.description } : {}),
        prefix: isPower ? "#PWR" : u.ref.replace(/[0-9?]+$/, "") || u.lib.prefix || "U",
        value: isPower ? u.value : u.lib.value || plain,
        symbol: { ...flat.symbol, name: plain, ...(isPower ? { power: true } : {}) },
        packages: fp ? [{ footprint: fp, ...(Object.keys(flat.pinMap).length ? { pinMap: flat.pinMap } : {}) }] : [],
        ...(u.lib.keywords.length ? { keywords: u.lib.keywords.map((w) => w.toLowerCase()) } : {}),
        ...(u.lib.datasheet && /^https?:/.test(u.lib.datasheet) ? { datasheet: u.lib.datasheet } : {}),
        ...(isPower ? {} : { source: { library: library || stem(rootFile), licence } }),
      };
      const key = defKey(def);
      design.defs[key] ??= def;
      power += isPower ? 1 : 0;
      part = { id: eid("pt"), def: key, ref: isPower ? `#PWR${power}` : u.ref, value: u.value, pkg: 0, ...(u.fitted || isPower ? {} : { fitted: false }) };
      design.parts.push(part);
      if (!isPower) {
        byRef.set(u.ref, part);
        if (!fp) lacking.push(u.ref);
      }
    }
    u.symbol.part = part.id;
  }
  if (lacking.length)
    notes.push({
      name: lacking.length > 6 ? `${lacking.slice(0, 6).join(", ")} and ${lacking.length - 6} more` : lacking.join(", "),
      why: pcb ? "Not on the board, so it came in with no footprint" : "There is no board among the files, so parts came in with no footprint",
    });

  // Old symbols carry supply pins that are not drawn: each joins the net with the pin's name.
  if (sch.version < 20250114) {
    let hiddenPins = 0;
    for (const u of sch.units) {
      if (u.lib.symbol.power || u.ref === "") continue;
      const sheet = design.sheets.find((s) => s.id === u.sheet)!;
      const def = design.defs[design.parts.find((p) => p.id === u.symbol.part)!.def]!;
      for (const pin of def.symbol.pins) {
        if (!pin.hidden || pin.type !== "power_in" || !pin.name) continue;
        if (pin.unit !== undefined && def.symbol.units > 1 && pin.unit !== u.symbol.unit) continue;
        const m: P2 = u.symbol.mirror ? [-pin.x, pin.y] : [pin.x, pin.y];
        const t = u.symbol.rot === 90 ? [-m[1], m[0]] : u.symbol.rot === 180 ? [-m[0], -m[1]] : u.symbol.rot === 270 ? [m[1], -m[0]] : m;
        sheet.labels.push({ id: eid("lb"), name: pin.name, x: r4(t[0]! + u.symbol.x), y: r4(t[1]! + u.symbol.y) });
        hiddenPins += 1;
      }
    }
    if (hiddenPins)
      notes.push({ name: "Schematic", why: `${hiddenPins} hidden supply pins were given a label with the pin's name, which is the net KiCad joins them to` });
  }

  if (brd) {
    const { rules, classes } = readRules(pro);
    const board = brd.board;
    board.rules = rules;
    board.placements = board.placements.flatMap((p) => {
      const part = byRef.get(p.part);
      return part ? [{ ...p, part: part.id }] : [];
    });
    design.board = board;
    // The board's nets carry KiCad's names; ours come from the schematic. A pad on both says which is which.
    const nl = netlist(design);
    const votes = new Map<string, Map<string, number>>();
    for (const [ref, on] of brd.parts) {
      const part = byRef.get(ref);
      const def = part && design.defs[part.def];
      if (!part || !def) continue;
      for (const pin of def.symbol.pins) {
        const ours = nl.of.get(pinKey(part.id, pin.number));
        for (const pad of def.packages[0]?.pinMap?.[pin.number] ?? [pin.number]) {
          const theirs = on.nets.get(pad);
          if (!theirs || !ours) continue;
          if (!votes.has(theirs)) votes.set(theirs, new Map());
          votes.get(theirs)!.set(ours, (votes.get(theirs)!.get(ours) ?? 0) + 1);
        }
      }
    }
    const rename = new Map<string, string>();
    let split = 0;
    for (const [theirs, tally] of votes) {
      const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      rename.set(theirs, ranked[0]![0]);
      if (ranked.length > 1) split += 1;
    }
    if (split)
      notes.push({
        name: "Board",
        why: `${split} ${split === 1 ? "net on the board does" : "nets on the board do"} not match the schematic's. The board may be behind its schematic; run the board check`,
      });
    const ours = (name: string) => rename.get(name) ?? name;
    board.tracks = board.tracks.map((t) => ({ ...t, net: ours(t.net) }));
    board.vias = board.vias.map((v) => ({ ...v, net: ours(v.net) }));
    board.pours = board.pours.map((p) => ({ ...p, net: ours(p.net) }));
    board.classes = classes.map((c) => ({ ...c, id: eid("nc"), nets: [...new Set(c.nets.map(ours))] }));
    board.synced = { nets: netPins(nl) };
  }

  return {
    design,
    notes,
    found: {
      sheets: design.sheets.length,
      parts: byRef.size,
      placed: design.board?.placements.length ?? 0,
      tracks: brd?.found.tracks ?? 0,
      vias: brd?.found.vias ?? 0,
      pours: brd?.found.pours ?? 0,
    },
  };
}
