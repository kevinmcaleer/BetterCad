import { Tally, joinRuns, loopArea, loopsOf, matchNets, type Edge, type Run } from "../boardIn";
import { defKey } from "../edit";
import { onSegment, placeOnSheet } from "../geom";
import type { ImportFile } from "../kicad/import";
import type { ProjectImport, ProjectOptions } from "../kicad/project";
import {
  DEFAULT_RULES,
  eid,
  emptyBoard,
  emptySheet,
  type Board,
  type CopperLayer,
  type Corner,
  type ElectronicsDesign,
  type FootprintDef,
  type Id,
  type NetClass,
  type P2,
  type Part,
  type Rot,
  type SchSymbol,
  type Sheet,
} from "../model";
import { netlist, pinKey } from "../nets";
import { netPins } from "../sync";
import {
  RESTRING,
  componentOf,
  lengthOf,
  libraryIn,
  pinId,
  plainText,
  ringed,
  rotOf,
  shapeOf,
  vertices,
  type EagleComponent,
  type EagleLibrary,
  type Restring,
} from "./library";
import { kid, kids, numOf, parseXml, type El } from "./xml";
import { bulgeOfTurn } from "../trackArcs";

/**
 * Opening an Eagle project (#665): its schematic and its board, as one design. Eagle 6 and later and Fusion
 * Electronics write the XML this reads. An Eagle schematic says outright which pins each net joins, so the nets are
 * held to that once the design is built: any that came out joined differently are named in `notes`.
 */

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
const norm = (deg: number) => (((Math.round(deg * 1e4) / 1e4) % 360) + 360) % 360;
const base = (file: string) => file.replace(/^.*[\\/]/, "");
const stem = (file: string) => base(file).replace(/\.[^.]+$/, "");
type Notes = ProjectImport["notes"];

/** What kind of Eagle file a text is, if it is one. */
export function eagleKind(text: string): "schematic" | "board" | "library" | "old" | null {
  const start = text.slice(0, 4000);
  if (!/<eagle[\s>]/.test(start) && !/<!DOCTYPE eagle/.test(start)) return /^\s*</.test(start) ? null : start.charCodeAt(0) === 0x10 ? "old" : null;
  if (/<schematic[\s>]/.test(text)) return "schematic";
  if (/<board[\s>]/.test(text)) return "board";
  if (/<library[\s>]/.test(text)) return "library";
  return null;
}

const libKey = (name: string | undefined, urn: string | undefined) => `${name ?? ""}|${urn ?? ""}`;

// ---------------------------------------------------------------- the board

interface BoardRead {
  board: Board;
  /** Each element by its name: where it stands, its package, and the signal on each of its pads. */
  elements: Map<string, { fp: FootprintDef; nets: Map<string, string>; value: string; fitted: boolean }>;
  /** Net classes, by the signals in them. */
  classes: Omit<NetClass, "id">[];
}

function readRestring(rules: Map<string, string>): Restring {
  const one = (share: string, min: string, max: string, or: Restring["pad"]) => ({
    share: rules.has(share) ? Number(rules.get(share)) || or.share : or.share,
    min: lengthOf(rules.get(min), or.min),
    max: lengthOf(rules.get(max), or.max),
  });
  return { pad: one("rvPadTop", "rlMinPadTop", "rlMaxPadTop", RESTRING.pad), via: one("rvViaOuter", "rlMinViaOuter", "rlMaxViaOuter", RESTRING.via) };
}

function readBoard(root: El, refs: Set<string>, notes: Notes): BoardRead {
  const dropped = new Tally();
  const board = emptyBoard();
  board.outline = [];
  const brd = kid(kid(root, "drawing"), "board")!;
  const dru = new Map(kids(kid(brd, "designrules"), "param").map((p) => [p.attrs.name ?? "", p.attrs.value ?? ""]));
  const restring = readRestring(dru);
  const plain = kid(brd, "plain")?.kids ?? [];
  const pOf = (el: El, x = "x", y = "y"): P2 => [numOf(el, x), numOf(el, y)];

  // The edge first: it says where the board's corner is.
  const edges: Edge[] = [];
  const rings: Corner[][] = [];
  for (const item of plain) {
    if (item.attrs.layer !== "20") continue;
    if (item.tag === "wire") {
      const curve = numOf(item, "curve");
      edges.push({ a: pOf(item, "x1", "y1"), b: pOf(item, "x2", "y2"), bulge: curve ? Math.tan((curve * Math.PI) / 720) : 0 });
    } else if (item.tag === "circle") {
      const [c, r] = [pOf(item), numOf(item, "radius")];
      rings.push([
        { x: c[0] - r, y: c[1], bulge: 1 },
        { x: c[0] + r, y: c[1], bulge: 1 },
      ]);
    } else if (item.tag === "rectangle") {
      const [a, c] = [pOf(item, "x1", "y1"), pOf(item, "x2", "y2")];
      const pts: P2[] = [a, [c[0], a[1]], c, [a[0], c[1]]];
      pts.forEach((p, i) => edges.push({ a: p, b: pts[(i + 1) % 4]!, bulge: 0 }));
    } else if (item.tag === "polygon") {
      const pts = vertices(item);
      pts.forEach((p, i) => edges.push({ a: p, b: pts[(i + 1) % pts.length]!, bulge: 0 }));
    } else if (item.tag !== "text" && item.tag !== "dimension") dropped.add("shapes on the board's edge that could not be read");
  }
  const made = loopsOf(edges);
  if (made.open)
    notes.push({ name: "Board", why: `${made.open} ${made.open === 1 ? "line" : "lines"} of the edge did not close into an outline and were left out` });
  const all = [...made.loops, ...rings].sort((p, q) => loopArea(q) - loopArea(p));

  const elements = kids(kid(brd, "elements"), "element");
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  const see = (p: P2) => {
    x1 = Math.min(x1, p[0]);
    y1 = Math.min(y1, p[1]);
    x2 = Math.max(x2, p[0]);
    y2 = Math.max(y2, p[1]);
  };
  if (all[0]) for (const c of all[0]) see([c.x, c.y]);
  else for (const e of elements) see(pOf(e));
  if (x1 === Infinity) [x1, y1, x2, y2] = [0, 0, 50, 40];
  if (all[0]?.length === 2) [y1, y2] = [y1 - (x2 - x1) / 2, y2 + (x2 - x1) / 2];
  const at = (p: P2): P2 => [r4(p[0] - x1), r4(p[1] - y1)];
  const move = (loop: Corner[]): Corner[] => loop.map((c) => ({ ...c, x: r4(c.x - x1), y: r4(c.y - y1) }));
  if (all[0]) {
    board.outline = move(all[0]);
    if (all.length > 1) board.cutouts = all.slice(1).map(move);
  } else {
    notes.push({ name: "Board", why: "It has no closed outline on the Dimension layer, so a rectangle round the parts stands in for one" });
    board.outline = [
      { x: -5, y: -5 },
      { x: r4(x2 - x1 + 5), y: -5 },
      { x: r4(x2 - x1 + 5), y: r4(y2 - y1 + 5) },
      { x: -5, y: r4(y2 - y1 + 5) },
    ];
  }

  // Signals: which pad is on which, then the copper.
  const padNets = new Map<string, Map<string, string>>();
  const runs = new Map<string, Run>();
  const classNets = new Map<string, string[]>();
  let inner = 0;
  // Inner layers (#648): Eagle numbers them 2 to 15. Those with copper on them become Inner 1 up, in order, to the fourth.
  const used = new Set<number>();
  for (const signal of kids(kid(brd, "signals"), "signal"))
    for (const item of signal.kids)
      if (item.tag === "wire" || item.tag === "polygon") {
        const l = Number(item.attrs.layer);
        if (l > 1 && l < 16) used.add(l);
      }
  const inside = [...used].sort((a, b) => a - b).slice(0, 4);
  if (inside.length) board.copperLayers = (2 + inside.length + (inside.length % 2)) as 4 | 6;
  const layerOf = (n: string | number | undefined): CopperLayer | null => {
    const l = Number(n);
    return l === 1 ? "top" : l === 16 ? "bottom" : inside.includes(l) ? `in${inside.indexOf(l) + 1}` : null;
  };
  for (const signal of kids(kid(brd, "signals"), "signal")) {
    const net = signal.attrs.name ?? "";
    const cls = signal.attrs.class ?? "0";
    if (!classNets.has(cls)) classNets.set(cls, []);
    classNets.get(cls)!.push(net);
    for (const item of signal.kids) {
      if (item.tag === "contactref") {
        const el = item.attrs.element ?? "";
        if (!padNets.has(el)) padNets.set(el, new Map());
        padNets.get(el)!.set(item.attrs.pad ?? "", net);
      } else if (item.tag === "wire") {
        const side = layerOf(item.attrs.layer);
        // Layer 19 holds the lines for what is still to route.
        if (item.attrs.layer === "19") continue;
        if (!side) {
          inner += 1;
          continue;
        }
        const width = numOf(item, "width");
        const key = `${net}|${side}|${width}`;
        if (!runs.has(key)) runs.set(key, { net, layer: side, width, pieces: [] });
        const [a, b] = [at(pOf(item, "x1", "y1")), at(pOf(item, "x2", "y2"))];
        // A curved wire (#755) stays a curve: Eagle's `curve` is how far round it turns, anticlockwise.
        const curve = numOf(item, "curve");
        runs.get(key)!.pieces.push(curve ? [a, b, bulgeOfTurn(curve)] : [a, b]);
      } else if (item.tag === "via") {
        const extent = (item.attrs.extent ?? "1-16").split("-").map(Number);
        const through = Math.min(...extent) === 1 && Math.max(...extent) === 16;
        const ends = [layerOf(Math.min(...extent)), layerOf(Math.max(...extent))];
        if (!through && (!ends[0] || !ends[1] || ends[0] === ends[1])) {
          dropped.add("vias between layers that did not come across");
          continue;
        }
        const drill = numOf(item, "drill");
        const p = at(pOf(item));
        board.vias.push({
          id: eid("v"),
          net,
          x: p[0],
          y: p[1],
          diameter: numOf(item, "diameter") || ringed(drill, restring.via),
          drill,
          ...(through ? {} : { span: [ends[0]!, ends[1]!] as [CopperLayer, CopperLayer] }),
        });
      } else if (item.tag === "polygon") {
        const side = layerOf(item.attrs.layer);
        const outline = vertices(item).map(at);
        if (outline.length < 3) continue;
        if (!side) {
          inner += 1;
          continue;
        }
        if (item.attrs.pour === "cutout") {
          board.keepouts.push({ id: eid("ko"), outline, pours: true });
          continue;
        }
        const rank = numOf(item, "rank", 1);
        board.pours.push({
          id: eid("po"),
          net,
          layer: side,
          outline,
          thermal: item.attrs.thermals !== "no",
          // Eagle's hatching (#747): lines as wide as the polygon's width, its spacing from line to line.
          ...(item.attrs.pour === "hatch"
            ? { hatch: { width: numOf(item, "width") || 0.25, gap: Math.max(0.1, r4((numOf(item, "spacing") || 1.27) - (numOf(item, "width") || 0.25))) } }
            : {}),
          // Eagle fills rank 1 first; here the higher priority fills first.
          ...(rank > 1 ? { priority: 1 - rank } : {}),
        });
      }
    }
  }
  board.tracks.push(...joinRuns(runs.values()));
  if (inner)
    notes.push({
      name: "Board",
      why: `It has copper on more than four inside layers. The first four came across; ${inner} ${inner === 1 ? "track or pour on the others was" : "tracks and pours on the others were"} left out`,
    });

  // The parts, each with its package from the board's own libraries.
  const libs = new Map(kids(kid(brd, "libraries"), "library").map((l) => [libKey(l.attrs.name, l.attrs.urn), libraryIn(l, restring)]));
  const byName = new Map([...libs.values()].map((l) => [l.name, l]));
  const out: BoardRead["elements"] = new Map();
  for (const e of elements) {
    const name = e.attrs.name ?? "";
    const lib = libs.get(libKey(e.attrs.library, e.attrs.library_urn)) ?? byName.get(e.attrs.library ?? "");
    const pkg = lib?.packages.get(e.attrs.package ?? "");
    if (!pkg) {
      notes.push({ name, why: `Its package ${e.attrs.package ?? ""} is not in the board file, so it was left off the board` });
      continue;
    }
    const turn = rotOf(e.attrs.rot);
    const p = at(pOf(e));
    if (pkg.skipped) dropped.add("drawings in packages on layers that are not kept (stop, cream, restrict and document layers)", pkg.skipped);
    if (pkg.edge) dropped.add("edge cuts and milling drawn inside packages");
    if (refs.has(name) && !out.has(name)) {
      out.set(name, { fp: pkg.footprint, nets: padNets.get(name) ?? new Map(), value: e.attrs.value ?? "", fitted: e.attrs.populate !== "no" });
      board.placements.push({
        part: name,
        x: p[0],
        y: p[1],
        // Eagle turns a part, then flips it; here a part on the bottom is flipped, then turned.
        rot: turn.mirror ? norm(-turn.deg) : turn.deg,
        side: turn.mirror ? "bottom" : "top",
        ...(e.attrs.locked === "yes" ? { locked: true } : {}),
        ref: name,
        footprint: pkg.footprint.name,
      });
      continue;
    }
    // A package with no symbol: a hole comes across as a hole; anything else is named.
    const only = pkg.footprint.pads.length === 1 ? pkg.footprint.pads[0]! : undefined;
    if (only && only.drill && only.kind !== "smd" && Math.abs(only.x) < 1e-6 && Math.abs(only.y) < 1e-6)
      board.holes.push({ id: eid("h"), x: p[0], y: p[1], drill: only.drill, ...(only.kind === "thru" && only.w > only.drill ? { pad: only.w } : {}) });
    else if (pkg.footprint.pads.length === 0) dropped.add("packages with no pads (logos and marks)");
    else if (out.has(name)) notes.push({ name, why: "The board has this name twice. The second was left out" });
    else notes.push({ name: name || pkg.footprint.name, why: `${pkg.footprint.name} is on the board but has no symbol in the schematic, so it was left out` });
  }

  // What is drawn straight on the board.
  for (const item of plain) {
    const layer = item.attrs.layer;
    if (layer === "20") continue;
    if (item.tag === "hole") {
      const p = at(pOf(item));
      board.holes.push({ id: eid("h"), x: p[0], y: p[1], drill: numOf(item, "drill") });
      continue;
    }
    if (item.tag === "dimension") {
      dropped.add("dimensions");
      continue;
    }
    const keepout = layer === "39" || layer === "40";
    const restrict = layer === "41" || layer === "42" || layer === "43";
    if ((keepout || restrict) && (item.tag === "polygon" || item.tag === "rectangle")) {
      const outline =
        item.tag === "polygon"
          ? vertices(item).map(at)
          : (() => {
              const [a, c] = [at(pOf(item, "x1", "y1")), at(pOf(item, "x2", "y2"))];
              return [a, [c[0], a[1]], c, [a[0], c[1]]] as P2[];
            })();
      if (outline.length > 2) board.keepouts.push({ id: eid("ko"), outline, ...(keepout ? { parts: true } : { tracks: true }) });
      continue;
    }
    const side =
      layer === "21" || layer === "25"
        ? "silk-top"
        : layer === "22" || layer === "26"
          ? "silk-bottom"
          : layer === "1"
            ? "copper-top"
            : layer === "16"
              ? "copper-bottom"
              : null;
    if (!side) {
      dropped.add("drawings on layers that are not kept (document, stop, cream and user layers)");
      continue;
    }
    if (item.tag === "text") {
      const words = item.text.trim();
      if (!words) continue;
      const turn = rotOf(item.attrs.rot);
      const p = at(pOf(item));
      const angle = side.endsWith("bottom") ? norm(-turn.deg) : turn.deg;
      board.texts.push({ id: eid("tx"), layer: side, x: p[0], y: p[1], text: words, size: numOf(item, "size", 1.27), ...(angle ? { angle } : {}) });
      continue;
    }
    const shape = shapeOf(item, true);
    if (!shape || shape.kind === "text") {
      dropped.add("drawings that could not be read");
      continue;
    }
    const moved =
      shape.kind === "line"
        ? { ...shape, pts: shape.pts.map(at) }
        : shape.kind === "rect"
          ? { ...shape, x1: r4(shape.x1 - x1), y1: r4(shape.y1 - y1), x2: r4(shape.x2 - x1), y2: r4(shape.y2 - y1) }
          : { ...shape, cx: r4(shape.cx - x1), cy: r4(shape.cy - y1) };
    board.shapes.push({ ...moved, id: eid("s"), layer: side });
  }
  for (const [what, n] of dropped.each()) if (n) notes.push({ name: "Board", why: `Left out: ${n} ${what}` });

  // The rules Eagle's check uses, where the file sets them.
  const rules = { ...DEFAULT_RULES };
  const set = (key: keyof typeof DEFAULT_RULES & string, name: string) => {
    const v = lengthOf(dru.get(name), -1);
    if (v > 0) (rules as Record<string, number | string | undefined>)[key] = v;
  };
  set("clearance", "mdWireWire");
  set("minTrackWidth", "msWidth");
  set("minDrill", "msDrill");
  set("copperToEdge", "mdCopperDimension");
  set("holeToHole", "mdDrill");
  set("minRing", "rlMinPadTop");
  set("minViaRing", "rlMinViaOuter");
  rules.trackWidth = Math.max(rules.trackWidth, rules.minTrackWidth);
  const classes: BoardRead["classes"] = [];
  for (const c of kids(kid(brd, "classes"), "class")) {
    const width = numOf(c, "width");
    const clearance = Math.max(0, ...kids(c, "clearance").map((x) => numOf(x, "value")));
    const drill = numOf(c, "drill");
    if (c.attrs.number === "0") {
      if (width > 0) rules.trackWidth = Math.max(width, rules.minTrackWidth);
      continue;
    }
    const nets = classNets.get(c.attrs.number ?? "") ?? [];
    if (!nets.length || (!width && !clearance && !drill)) continue;
    classes.push({
      name: c.attrs.name || `Class ${c.attrs.number}`,
      nets,
      trackWidth: width || rules.trackWidth,
      clearance: clearance || rules.clearance,
      ...(drill ? { viaDrill: drill } : {}),
    });
  }
  board.rules = rules;
  return { board, elements: out, classes };
}

// ---------------------------------------------------------------- the whole project

/**
 * An Eagle project as a design. Give it the `.sch` and, for the board, the `.brd`. A schematic on its own comes in
 * with no board; a board needs its schematic, since that is where a design's nets come from here.
 */
export function importEagleProject(files: ImportFile[], o: ProjectOptions = {}): ProjectImport {
  const notes: Notes = [];
  let sch: El | undefined;
  let schName = "";
  let brd: El | undefined;
  for (const f of files) {
    // Eagle before 6 wrote binary files under the same names.
    const kind = eagleKind(f.text) ?? (/\.(sch|brd)$/i.test(f.name) && !/^\s*[(<E]/.test(f.text) ? "old" : null);
    try {
      if (kind === "schematic" && !sch) [sch, schName] = [parseXml(f.text), f.name];
      else if (kind === "board" && !brd) brd = parseXml(f.text);
      else if (kind === "schematic" || kind === "board")
        notes.push({ name: base(f.name), why: `A second ${kind}. One design holds one schematic and one board, so it was left out` });
      else if (kind === "library") notes.push({ name: base(f.name), why: "A library. Bring it in from Components, Import parts" });
      else if (kind === "old")
        notes.push({ name: base(f.name), why: "It was saved by an Eagle older than 6, which is not XML. Open and save it in a newer Eagle first" });
      else notes.push({ name: base(f.name), why: "Not an Eagle schematic or board, so it was not read" });
    } catch (e) {
      notes.push({ name: base(f.name), why: e instanceof Error ? e.message : "It could not be read" });
    }
  }
  if (!sch) {
    const why = notes.find((n) => /older than 6|not XML/.test(n.why));
    throw new Error(
      why
        ? `${why.name}: ${why.why}.`
        : brd
          ? "A board needs its schematic. Add the project's .sch file too."
          : "There is no Eagle schematic (.sch) among these files.",
    );
  }
  const licence = o.licence?.trim() || "Not stated";
  const schematic = kid(kid(sch, "drawing"), "schematic")!;
  const partEls = kids(kid(schematic, "parts"), "part");
  const board = brd ? readBoard(brd, new Set(partEls.map((p) => p.attrs.name ?? "")), notes) : undefined;
  const dropped = new Tally();

  const libs = new Map<string, EagleLibrary>();
  const byName = new Map<string, EagleLibrary>();
  for (const l of kids(kid(schematic, "libraries"), "library")) {
    const lib = libraryIn(l);
    libs.set(libKey(l.attrs.name, l.attrs.urn), lib);
    if (!byName.has(lib.name)) byName.set(lib.name, lib);
  }

  // The parts. Each takes its footprint from where it stands on the board, or failing a board, from its library.
  const design: ElectronicsDesign = { defs: {}, parts: [], sheets: [] };
  const made = new Map<string, EagleComponent & { key: Id }>();
  const parts = new Map<string, { part: Part; comp: EagleComponent }>();
  const byRef = new Map<string, Part>();
  const lacking: string[] = [];
  let power = 0;
  for (const p of partEls) {
    const name = p.attrs.name ?? "";
    const lib = libs.get(libKey(p.attrs.library, p.attrs.library_urn)) ?? byName.get(p.attrs.library ?? "");
    const on = board?.elements.get(name);
    const cacheKey = [p.attrs.library, p.attrs.library_urn, p.attrs.deviceset, p.attrs.device, p.attrs.technology, on?.fp.name].join("|");
    let comp = made.get(cacheKey);
    if (!comp && lib) {
      const fresh = componentOf(lib, p.attrs.deviceset ?? "", {
        devices: [p.attrs.device ?? ""],
        technology: p.attrs.technology ?? "",
        ...(on ? { footprint: () => on.fp } : {}),
        licence,
        library: lib.name || stem(schName),
      });
      if (fresh) {
        // A part the board holds has the board's package whatever its device says.
        if (on && !fresh.def.packages.length && !fresh.supply) fresh.def.packages = [{ footprint: on.fp }];
        comp = { ...fresh, key: defKey(fresh.def) };
        made.set(cacheKey, comp);
      }
    }
    if (!comp) {
      notes.push({ name, why: `Its device ${p.attrs.deviceset ?? ""} is not in the schematic's libraries, so the part was left out` });
      continue;
    }
    if (!comp.def.symbol.pins.length) {
      dropped.add("frames and other symbols with no pins");
      continue;
    }
    design.defs[comp.key] ??= comp.def;
    const attrs = new Map(kids(p, "attribute").map((a) => [(a.attrs.name ?? "").toUpperCase(), a.attrs.value ?? ""]));
    const supplier = {
      ...(attrs.get("MF") || attrs.get("MANUFACTURER") ? { manufacturer: attrs.get("MF") || attrs.get("MANUFACTURER")! } : {}),
      ...(attrs.get("MPN") ? { mpn: attrs.get("MPN")! } : {}),
      ...(/^C\d+$/.test(attrs.get("LCSC") ?? "") ? { lcsc: attrs.get("LCSC")! } : {}),
    };
    if (comp.supply) power += 1;
    const part: Part = {
      id: eid("pt"),
      def: comp.key,
      ref: comp.supply ? `#PWR${power}` : name,
      // Eagle shows a part with no value of its own as its device's name, unless the value is the person's to give.
      value: p.attrs.value ?? (on?.value || undefined) ?? (comp.userValue ? "" : comp.shown),
      pkg: 0,
      ...(Object.keys(supplier).length ? { supplier } : {}),
      ...(on && !on.fitted ? { fitted: false } : {}),
    };
    design.parts.push(part);
    parts.set(name, { part, comp });
    if (!comp.supply) {
      byRef.set(name, part);
      if (!comp.def.packages.length) lacking.push(name);
    }
  }
  // Assembly variants (#758): each part says where it differs, as populate="no" or a value of its own.
  const variantDefs = kids(kid(schematic, "variantdefs"), "variantdef");
  if (variantDefs.length) {
    design.variants = variantDefs.map((v) => ({ id: eid("var"), name: v.attrs.name || "Variant" }));
    for (const p of partEls) {
      const part = parts.get(p.attrs.name ?? "")?.part;
      if (!part) continue;
      for (const pv of kids(p, "variant")) {
        const v = design.variants.find((x) => x.name === (pv.attrs.name || "Variant"));
        if (!v) continue;
        const fitted = pv.attrs.populate !== "no";
        if (fitted !== (part.fitted !== false)) v.fitted = { ...v.fitted, [part.id]: fitted };
        if (pv.attrs.value !== undefined && pv.attrs.value !== part.value) v.values = { ...v.values, [part.id]: pv.attrs.value };
      }
    }
  }
  if (lacking.length)
    notes.push({
      name: lacking.length > 6 ? `${lacking.slice(0, 6).join(", ")} and ${lacking.length - 6} more` : lacking.join(", "),
      why: brd ? "Not on the board, so it came in with no footprint" : "It has no package, so it came in with no footprint",
    });

  // The sheets: symbols, then each net's wires, dots and names.
  const sheetEls = kids(kid(schematic, "sheets"), "sheet");
  const placed = new Map<string, { sheet: Sheet; symbol: SchSymbol }>();
  const segments = new Map<string, { sheet: Sheet; el: El }[]>();
  if (kids(kid(schematic, "modules"), "module").length)
    notes.push({ name: "Schematic", why: "It has modules (design blocks). What is inside them was left out; only the top sheets came across" });
  sheetEls.forEach((el, i) => {
    const sheet: Sheet = { ...emptySheet(plainText(kid(el, "description")?.text) || `Sheet ${i + 1}`), id: eid("sh") };
    design.sheets.push(sheet);
    for (const inst of kids(kid(el, "instances"), "instance")) {
      const found = parts.get(inst.attrs.part ?? "");
      if (!found) continue;
      const unit = found.comp.gates.indexOf(inst.attrs.gate ?? "") + 1;
      if (!unit) continue;
      const turn = rotOf(inst.attrs.rot);
      const symbol: SchSymbol = {
        id: eid("sy"),
        part: found.part.id,
        unit,
        x: r4(numOf(inst, "x")),
        y: r4(numOf(inst, "y")),
        // Eagle turns a symbol, then mirrors it; here a symbol is mirrored, then turned.
        rot: ((Math.round((turn.mirror ? norm(-turn.deg) : turn.deg) / 90) * 90) % 360) as Rot,
        ...(turn.mirror ? { mirror: true } : {}),
      };
      sheet.symbols.push(symbol);
      placed.set(pinId(inst.attrs.part ?? "", inst.attrs.gate ?? ""), { sheet, symbol });
    }
    for (const item of kid(el, "plain")?.kids ?? []) {
      const shape = item.attrs.layer === "94" || item.attrs.layer === "97" || item.attrs.layer === "98" ? shapeOf(item, "solid") : null;
      if (shape) (sheet.notes ??= []).push({ ...shape, id: eid("n") });
      else dropped.add("drawings on a sheet that could not be kept");
    }
    // Buses (#756): drawn, by name. Eagle has no entries; its wires simply end on the bus.
    for (const bus of kids(kid(el, "busses"), "bus")) {
      const pieces = kids(bus, "segment").flatMap((seg) =>
        kids(seg, "wire").map((w): [P2, P2] => [
          [r4(numOf(w, "x1")), r4(numOf(w, "y1"))],
          [r4(numOf(w, "x2")), r4(numOf(w, "y2"))],
        ]),
      );
      for (const run of joinRuns([{ net: "", layer: "top", width: 0, pieces }]))
        (sheet.buses ??= []).push({ id: eid("bus"), name: bus.attrs.name ?? "BUS", pts: run.pts });
    }
    if (kids(kid(el, "moduleinsts"), "moduleinst").length) dropped.add("module blocks on a sheet");
    for (const net of kids(kid(el, "nets"), "net")) {
      const name = net.attrs.name ?? "";
      if (!segments.has(name)) segments.set(name, []);
      for (const seg of kids(net, "segment")) segments.get(name)!.push({ sheet, el: seg });
    }
  });
  if (!design.sheets.length) design.sheets.push({ ...emptySheet("Sheet 1"), id: eid("sh") });

  /** Where a pin a net names sits, and which pin of ours it is. */
  const pinAt = (ref: El): { at: P2; part: Part; number: string; supply: boolean } | null => {
    const found = parts.get(ref.attrs.part ?? "");
    const where = placed.get(pinId(ref.attrs.part ?? "", ref.attrs.gate ?? ""));
    const number = found?.comp.numbers.get(pinId(ref.attrs.gate ?? "", ref.attrs.pin ?? ""));
    const pin = found?.comp.def.symbol.pins.find((x) => x.number === number);
    if (!found || !where || !number || !pin) return null;
    return { at: placeOnSheet([pin.x, pin.y], where.symbol), part: found.part, number, supply: found.comp.supply };
  };

  const theirs: { name: string; pins: string[] }[] = [];
  let lost = 0;
  for (const [name, segs] of segments) {
    const pins: string[] = [];
    for (const { sheet, el } of segs) {
      const wires = kids(el, "wire")
        .map((w): [P2, P2] => [
          [r4(numOf(w, "x1")), r4(numOf(w, "y1"))],
          [r4(numOf(w, "x2")), r4(numOf(w, "y2"))],
        ])
        .filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
      for (const [a, b] of wires) sheet.wires.push({ id: eid("w"), a, b });
      for (const j of kids(el, "junction")) sheet.junctions.push({ id: eid("j"), x: r4(numOf(j, "x")), y: r4(numOf(j, "y")) });
      let supplied = false;
      const ends: P2[] = [];
      for (const ref of kids(el, "pinref")) {
        const pin = pinAt(ref);
        if (!pin) {
          lost += 1;
          continue;
        }
        ends.push(pin.at);
        if (pin.supply) {
          // A supply symbol names the net it is on.
          pin.part.value = name;
          supplied = true;
        } else pins.push(pinKey(pin.part.id, pin.number));
      }
      // A net in more than one piece is one net because its pieces share a name; so is a net somebody named.
      if (supplied || (segs.length === 1 && /^N\$\d+$/.test(name))) continue;
      const labels = kids(el, "label").map((l) => ({ at: [r4(numOf(l, "x")), r4(numOf(l, "y"))] as P2, rot: rotOf(l.attrs.rot).deg }));
      const put = (at: P2, deg = 0) => {
        const rot = (Math.round(deg / 90) * 90) % 360;
        sheet.labels.push({ id: eid("lb"), name, x: at[0], y: at[1], ...(rot ? { rot: rot as Rot } : {}) });
      };
      const drawn = labels.filter((l) => wires.some(([a, b]) => onSegment(l.at, a, b)));
      for (const l of drawn) put(l.at, l.rot);
      // Eagle and Fusion often write a net's name just past the end of a short wire, joined to nothing. Ours has to
      // sit on the wire, so each of those goes to the nearest end of the piece that stops in mid air.
      const same = (a: P2, b: P2) => a[0] === b[0] && a[1] === b[1];
      const all = wires.flatMap(([a, b]) => [a, b]);
      const open = all.filter(
        (e) =>
          all.filter((x) => same(x, e)).length === 1 &&
          !ends.some((x) => same(x, e)) &&
          !wires.some(([a, b]) => !same(a, e) && !same(b, e) && onSegment(e, a, b)),
      );
      let placed = drawn.length;
      for (const l of labels.filter((x) => !drawn.includes(x))) {
        const free = open.filter((e) => !sheet.labels.some((x) => x.name === name && x.x === e[0] && x.y === e[1]));
        const near = free.sort((a, b) => Math.hypot(a[0] - l.at[0], a[1] - l.at[1]) - Math.hypot(b[0] - l.at[0], b[1] - l.at[1]))[0];
        if (!near) continue;
        put(near);
        placed += 1;
      }
      if (placed) continue;
      const where = open[0] ?? wires[0]?.[0] ?? ends[0];
      if (where) put(where);
    }
    if (pins.length) theirs.push({ name, pins });
  }
  if (lost) notes.push({ name: "Schematic", why: `${lost} ${lost === 1 ? "pin of a net is" : "pins of nets are"} on a part that did not come across` });
  for (const [what, n] of dropped.each()) notes.push({ name: "Schematic", why: `Left out: ${n} ${what}` });

  // Eagle says which pins each net joins. Hold what was built to that.
  let nl = netlist(design);
  const wrong: string[] = [];
  const taken = new Map<string, string>();
  for (const net of theirs) {
    const mine = new Set(net.pins.map((p) => nl.of.get(p)));
    const one = mine.size === 1 ? [...mine][0] : undefined;
    const whole = one !== undefined && nl.nets.find((n) => n.name === one)?.pins.length === net.pins.length;
    if (!whole || taken.has(one!)) wrong.push(net.name);
    else taken.set(one!, net.name);
  }
  if (wrong.length)
    notes.push({
      name: "Schematic",
      why: `${wrong.length} ${wrong.length === 1 ? "net is" : "nets are"} joined differently here than in Eagle: ${wrong.slice(0, 8).join(", ")}${wrong.length > 8 ? ` and ${wrong.length - 8} more` : ""}. Check ${wrong.length === 1 ? "it" : "them"} against the original`,
    });

  if (board) {
    const b = board.board;
    b.placements = b.placements.flatMap((p) => {
      const part = byRef.get(p.part);
      return part ? [{ ...p, part: part.id }] : [];
    });
    design.board = b;
    nl = netlist(design);
    const { ours, split } = matchNets(design, nl, byRef, new Map([...board.elements].map(([ref, on]) => [ref, on.nets])));
    if (split)
      notes.push({
        name: "Board",
        why: `${split} ${split === 1 ? "net on the board does" : "nets on the board do"} not match the schematic's. The board may be behind its schematic; run the board check`,
      });
    b.tracks = b.tracks.map((t) => ({ ...t, net: ours(t.net) }));
    b.vias = b.vias.map((v) => ({ ...v, net: ours(v.net) }));
    b.pours = b.pours.map((p) => ({ ...p, net: ours(p.net) }));
    b.classes = board.classes.map((c) => ({ ...c, id: eid("nc"), nets: [...new Set(c.nets.map(ours))] }));
    b.synced = { nets: netPins(nl) };
  }

  return {
    design,
    notes,
    found: {
      sheets: design.sheets.length,
      parts: byRef.size,
      placed: design.board?.placements.length ?? 0,
      tracks: design.board?.tracks.length ?? 0,
      vias: design.board?.vias.length ?? 0,
      pours: design.board?.pours.length ?? 0,
    },
  };
}
