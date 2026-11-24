import { arcOf, boardPads, outlinePoints, pointInPolygon, type BoardPad } from "../board";
import { distToSegment, placeOnBoard, rad, segmentDistance } from "../geom";
import { packageOf, type Board, type Corner, type ElectronicsDesign, type P2, type Pad, type Shape, type Side } from "../model";
import { netlist, type Netlist } from "../nets";
import { copperOf, type Copper, type Solid } from "../pcb/copper";
import { pourFill, pourShape, type Knock, type PourShape } from "../pcb/pour";
import { penFor, textStrokes } from "./font";

/**
 * Gerber files for a board (#655): one RS-274X file per layer with X2 attributes, in millimetres, as every board
 * house reads them. Pure text out of the design; nothing here touches the DOM.
 *
 * Every file is drawn looking down on the top of the board, bottom layers included, which is what the format asks
 * for. Pads are flashed with apertures (a macro for a rounded or turned pad), tracks are drawn with a round pen, and
 * a pour is painted the way the screen paints it: its area dark, then the copper it keeps clear of taken back out.
 */
export type GerberLayer = "copper-top" | "copper-bottom" | "mask-top" | "mask-bottom" | "paste-top" | "paste-bottom" | "silk-top" | "silk-bottom" | "edge";

export interface GerberFile {
  layer: GerberLayer;
  /** The X2 file function, as written in the file: "Copper,L1,Top". */
  fn: string;
  text: string;
}

export const GERBER_LAYERS: { id: GerberLayer; label: string; fn: string }[] = [
  { id: "copper-top", label: "Top copper", fn: "Copper,L1,Top" },
  { id: "copper-bottom", label: "Bottom copper", fn: "Copper,L2,Bot" },
  { id: "mask-top", label: "Top solder mask", fn: "Soldermask,Top" },
  { id: "mask-bottom", label: "Bottom solder mask", fn: "Soldermask,Bot" },
  { id: "paste-top", label: "Top paste", fn: "Paste,Top" },
  { id: "paste-bottom", label: "Bottom paste", fn: "Paste,Bot" },
  { id: "silk-top", label: "Top silkscreen", fn: "Legend,Top" },
  { id: "silk-bottom", label: "Bottom silkscreen", fn: "Legend,Bot" },
  { id: "edge", label: "Board outline", fn: "Profile,NP" },
];

/** The pen the outline is drawn with, mm. Board houses cut along its middle. */
export const EDGE_PEN = 0.1;
/** Capital height of a part's name on the silkscreen, mm. */
export const REF_SIZE = 1;

/** A coordinate in the file's units: whole numbers of a millionth of a millimetre (format 4.6). */
const co = (n: number): string => String(Math.round(n * 1e6) + 0);
/** A size inside an aperture definition. */
const sz = (n: number): string => String(Math.round(n * 1e6) / 1e6);
/** Attribute values cannot hold the format's own marks. */
const field = (s: string): string => s.replace(/[%*,\\\r\n]/g, "_") || "N/C";

/** Writes one file: collects apertures as they are first used, and keeps the pen's state so nothing is said twice. */
class Writer {
  private defs: string[] = [];
  private body: string[] = [];
  private codes = new Map<string, number>();
  private macros = 0;
  private current = 0;
  private dark = true;
  private attrs = new Map<string, string>();

  constructor(private fn: string) {}

  /** The D code of an aperture, defined on first use. `fn` is its .AperFunction, if it has one. */
  private aperture(shape: string, fn?: string, macro?: (name: string) => string): number {
    const key = `${fn ?? ""}|${shape}`;
    let code = this.codes.get(key);
    if (code) return code;
    code = 10 + this.codes.size;
    this.codes.set(key, code);
    let def = shape;
    if (macro) {
      this.macros += 1;
      const name = `M${this.macros}`;
      this.defs.push(`%AM${name}*\n${macro(name)}%`);
      def = name;
    }
    if (fn) this.defs.push(`%TA.AperFunction,${fn}*%`);
    this.defs.push(`%ADD${code}${def}*%`);
    if (fn) this.defs.push("%TD*%");
    return code;
  }

  circle(d: number, fn?: string): number {
    return this.aperture(`C,${sz(d)}`, fn);
  }

  /** The aperture for a pad's copper, grown all round by `grow` (a mask opening), turned by `angle` degrees. */
  pad(pad: Pick<Pad, "shape" | "w" | "h" | "round">, angle: number, grow: number, fn?: string): number {
    const w = pad.w + 2 * grow;
    const h = pad.h + 2 * grow;
    if (pad.shape === "circle") return this.circle(Math.max(w, h), fn);
    const a = (((Math.round(angle * 1000) / 1000) % 180) + 180) % 180;
    const square = a === 0 || a === 90;
    const [bw, bh] = a === 90 ? [h, w] : [w, h];
    if (pad.shape === "rect") {
      if (square) return this.aperture(`R,${sz(bw)}X${sz(bh)}`, fn);
      return this.aperture(`rect ${sz(w)} ${sz(h)} ${a}`, fn, () => `21,1,${sz(w)},${sz(h)},0,0,${sz(a)}*\n`);
    }
    if (pad.shape === "oval") {
      if (square) return this.aperture(`O,${sz(bw)}X${sz(bh)}`, fn);
      const r = Math.min(w, h) / 2;
      const half = Math.max(w, h) / 2 - r;
      const dir = rad(w >= h ? a : a + 90);
      const [x, y] = [half * Math.cos(dir), half * Math.sin(dir)];
      return this.aperture(
        `oval ${sz(w)} ${sz(h)} ${a}`,
        fn,
        () => `20,1,${sz(2 * r)},${sz(-x)},${sz(-y)},${sz(x)},${sz(y)},0*\n1,1,${sz(2 * r)},${sz(-x)},${sz(-y)}*\n1,1,${sz(2 * r)},${sz(x)},${sz(y)}*\n`,
      );
    }
    // A rounded rectangle: two bars and a disc on each corner.
    const r = Math.min(Math.min(pad.w, pad.h) * (pad.round ?? 0.25) + grow, Math.min(w, h) / 2);
    const [cx, cy] = [w / 2 - r, h / 2 - r];
    const [c, s] = [Math.cos(rad(a)), Math.sin(rad(a))];
    return this.aperture(`round ${sz(w)} ${sz(h)} ${sz(r)} ${a}`, fn, () => {
      let m = `21,1,${sz(w)},${sz(h - 2 * r)},0,0,${sz(a)}*\n21,1,${sz(w - 2 * r)},${sz(h)},0,0,${sz(a)}*\n`;
      for (const [x, y] of [
        [cx, cy],
        [-cx, cy],
        [-cx, -cy],
        [cx, -cy],
      ] as P2[])
        m += `1,1,${sz(2 * r)},${sz(x * c - y * s)},${sz(x * s + y * c)}*\n`;
      return m;
    });
  }

  private use(code: number) {
    if (code !== this.current) this.body.push(`D${code}*`);
    this.current = code;
  }

  /** Dark adds, clear takes away. */
  polarity(dark: boolean) {
    if (dark !== this.dark) this.body.push(dark ? "%LPD*%" : "%LPC*%");
    this.dark = dark;
  }

  /** Sets an object attribute (".N" a net, ".P" a pad, ".C" a part) for what is drawn next, or clears it. */
  attr(name: string, value?: string) {
    if (this.attrs.get(name) === value) return;
    if (value === undefined) {
      this.attrs.delete(name);
      this.body.push(`%TD${name}*%`);
    } else {
      this.attrs.set(name, value);
      this.body.push(`%TO${name},${value}*%`);
    }
  }

  comment(text: string) {
    this.body.push(`G04 ${text.replace(/[%*]/g, " ")}*`);
  }

  flash(code: number, at: P2) {
    this.use(code);
    this.body.push(`X${co(at[0])}Y${co(at[1])}D03*`);
  }

  /** A run of straight lines with the pen `code`. One point makes a dot. */
  line(code: number, pts: P2[], close = false) {
    if (!pts.length) return;
    if (pts.length === 1) return this.flash(code, pts[0]!);
    this.use(code);
    this.body.push(`X${co(pts[0]![0])}Y${co(pts[0]![1])}D02*`);
    for (const p of close ? [...pts.slice(1), pts[0]!] : pts.slice(1)) this.body.push(`X${co(p[0])}Y${co(p[1])}D01*`);
  }

  /** An arc about `c` from `a` to `b`, anticlockwise unless `clockwise`. Equal ends make a full circle. */
  private arcTo(c: P2, a: P2, b: P2, clockwise: boolean) {
    this.body.push(`${clockwise ? "G02" : "G03"}*`, `X${co(b[0])}Y${co(b[1])}I${co(c[0] - a[0])}J${co(c[1] - a[1])}D01*`, "G01*");
  }

  arc(code: number, c: P2, a: P2, b: P2, clockwise = false) {
    this.use(code);
    this.body.push(`X${co(a[0])}Y${co(a[1])}D02*`);
    this.arcTo(c, a, b, clockwise);
  }

  /** A closed outline drawn with a pen, its arcs kept as arcs. */
  outline(code: number, corners: Corner[]) {
    if (corners.length < 2) return;
    this.use(code);
    this.body.push(`X${co(corners[0]!.x)}Y${co(corners[0]!.y)}D02*`);
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % corners.length]!;
      const arc = arcOf(a, b);
      if (arc) this.arcTo([arc.cx, arc.cy], [a.x, a.y], [b.x, b.y], (a.bulge ?? 0) < 0);
      else this.body.push(`X${co(b.x)}Y${co(b.y)}D01*`);
    });
  }

  /** A filled area. */
  region(pts: P2[]) {
    if (pts.length < 3) return;
    this.body.push("G36*", `X${co(pts[0]![0])}Y${co(pts[0]![1])}D02*`);
    for (const p of [...pts.slice(1), pts[0]!]) this.body.push(`X${co(p[0])}Y${co(p[1])}D01*`);
    this.body.push("G37*");
  }

  text(): string {
    return [
      "%TF.GenerationSoftware,BetterCad,BetterCad,1*%",
      "%TF.SameCoordinates,Original*%",
      `%TF.FileFunction,${this.fn}*%`,
      "%TF.FilePolarity,Positive*%",
      "%FSLAX46Y46*%",
      "%MOMM*%",
      "%LPD*%",
      "G01*",
      "G75*",
      ...this.defs,
      ...this.body,
      "M02*",
      "",
    ].join("\n");
  }
}

const onSide = (layer: string, side: Side) => layer.endsWith(side);

/** Everything a solid keeps clear, taken away: a disc, a fat line, or an outline grown by `by`. */
function clear(w: Writer, s: Solid, by: number) {
  const d = 2 * (s.r + by);
  if (s.pts.length < 3) {
    if (d > 0) w.line(w.circle(d), s.pts);
    return;
  }
  w.region(s.pts);
  if (d > 0) w.line(w.circle(d), s.pts, true);
}

/** How close a solid's core comes to an area: 0 when it is inside or crosses it. */
function reachOf(area: P2[], s: Solid): number {
  if (s.pts.some((p) => pointInPolygon(p, area))) return 0;
  if (s.pts.length > 2 && pointInPolygon(area[0]!, s.pts)) return 0;
  let best = Infinity;
  const n = s.pts.length === 1 ? 1 : s.pts.length === 2 ? 1 : s.pts.length;
  for (let i = 0; i < n; i += 1) {
    const a = s.pts[i]!;
    const b = s.pts[(i + 1) % s.pts.length]!;
    for (let k = 0; k < area.length; k += 1) {
      const c = area[k]!;
      const e = area[(k + 1) % area.length]!;
      best = Math.min(best, s.pts.length === 1 ? distToSegment(a, c, e) : segmentDistance(a, b, c, e));
    }
  }
  return best;
}

const near = (area: P2[], k: Knock): boolean => reachOf(area, k) <= k.r + k.reach + 1e-6;

/** The part of a spoke, from the pad outwards, that stays inside the pour's own area, less the pen's round end. */
function spokeInside(area: P2[], a: P2, b: P2, width: number): P2[] | null {
  if (!pointInPolygon(a, area)) return null;
  let t = 1;
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  for (let i = 0; i < area.length; i += 1) {
    const c = area[i]!;
    const e = area[(i + 1) % area.length]!;
    const [ex, ey] = [e[0] - c[0], e[1] - c[1]];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const u = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
    const v = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
    if (u > 0 && u < t && v >= 0 && v <= 1) t = u;
  }
  const len = Math.hypot(dx, dy);
  if (t < 1) t -= width / 2 / len;
  return t > 0 ? [a, [a[0] + dx * t, a[1] + dy * t]] : null;
}

/**
 * Takes away everything outside the board: one area from far outside in to the board's edge, joined to it by a
 * straight cut from the edge's highest point, which is how the format draws an area with a hole in it.
 */
function clearOutside(w: Writer, edge: P2[], all: P2[]) {
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [x1, y1, x2, y2] = [Math.min(...xs) - 5, Math.min(...ys) - 5, Math.max(...xs) + 5, Math.max(...ys) + 5];
  let top = 0;
  edge.forEach((p, i) => {
    if (p[1] > edge[top]![1]) top = i;
  });
  const turned = [...edge.slice(top), ...edge.slice(0, top)];
  const px = turned[0]![0];
  // The outer box runs anticlockwise, so the edge must run clockwise for the board to be left as a hole.
  let twice = 0;
  turned.forEach((p, i) => {
    const n = turned[(i + 1) % turned.length]!;
    twice += p[0] * n[1] - n[0] * p[1];
  });
  const inner = twice > 0 ? [turned[0]!, ...turned.slice(1).reverse()] : turned;
  w.region([[px, y2], [x1, y2], [x1, y1], [x2, y1], [x2, y2], [px, y2], ...inner, inner[0]!]);
}

const sameLoop = (a: P2[], b: P2[]): boolean =>
  a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i]![0]) < 1e-6 && Math.abs(p[1] - b[i]![1]) < 1e-6);

/** One pour, painted in the screen's order: the area, its pads' rings out, the spokes back, then what it keeps clear of. */
function paintPour(w: Writer, shape: PourShape, islands: [number, number, number, number][]) {
  const area = shape.outline;
  if (area.length < 3) return;
  w.comment(`Pour on ${shape.pour.net || "no net"}`);
  w.polarity(true);
  w.attr(".N", field(shape.pour.net));
  w.region(area);
  w.attr(".N");
  w.polarity(false);
  const edge = shape.board[0];
  if (edge && !sameLoop(edge, area)) clearOutside(w, edge, [...edge, ...area]);
  for (const hole of shape.board.slice(1)) w.region(hole);
  for (const ring of shape.rings) if (near(area, ring)) clear(w, ring, ring.reach);
  w.polarity(true);
  for (const s of shape.spokes) {
    const run = spokeInside(area, s.a, s.b, s.width);
    if (run) w.line(w.circle(s.width, "Conductor"), run);
  }
  w.polarity(false);
  for (const k of shape.knocks) if (near(area, k)) clear(w, k, k.reach);
  // Pieces of the fill that reach nothing are left out, as they are on screen.
  for (const [x, y, wide, tall] of islands)
    w.region([
      [x, y],
      [x + wide, y],
      [x + wide, y + tall],
      [x, y + tall],
    ]);
  w.polarity(true);
}

/** Pours in the order they are painted: the one that fills first goes on last, so nothing painted later cuts it. */
const paintOrder = (board: Board, side: Side) =>
  board.pours
    .map((p, i) => ({ p, i }))
    .filter((x) => (x.p.layer === "bottom" ? "bottom" : "top") === side)
    .sort((a, b) => (a.p.priority ?? 0) - (b.p.priority ?? 0) || b.i - a.i)
    .map((x) => x.p);

/**
 * Pours this writer cannot paint truly: two on one side, on different nets, close enough that painting the second
 * would cut copper out of the first round the first's own pads and tracks. Says which, so the order pack can stop.
 */
export function pourClashes(
  d: ElectronicsDesign,
  pads: BoardPad[] = boardPads(d),
  copper: Copper[] = copperOf(d, pads),
): { side: Side; a: string; b: string }[] {
  const board = d.board;
  const out: { side: Side; a: string; b: string }[] = [];
  if (!board) return out;
  for (const side of ["top", "bottom"] as Side[]) {
    const order = paintOrder(board, side);
    order.forEach((later, i) => {
      const shape = pourShape(d, later, pads, copper);
      for (const earlier of order.slice(0, i)) {
        if (earlier.net === later.net) continue;
        const hit = copper.some(
          (c) =>
            c.net === earlier.net &&
            c.layers.includes(side) &&
            shape.knocks.some((k) => k.pts === c.pts && near(later.outline, k) && reachOf(earlier.outline, k) < k.r + k.reach),
        );
        if (hit) out.push({ side, a: earlier.net || "no net", b: later.net || "no net" });
      }
    });
  }
  return out;
}

/** A footprint's or the board's line work, placed and drawn with a round pen. */
function drawShape(w: Writer, s: Shape, place: (p: P2) => P2, turnBy: number, mirror: boolean, least: number, fn?: string) {
  const pen = (width?: number) => w.circle(Math.max(least, width ?? 0.12), fn);
  if (s.kind === "line") {
    const pts = s.pts.map(place);
    if (s.fill) w.region(pts);
    w.line(pen(s.width), pts, !!s.fill);
  } else if (s.kind === "rect") {
    const pts = (
      [
        [s.x1, s.y1],
        [s.x2, s.y1],
        [s.x2, s.y2],
        [s.x1, s.y2],
      ] as P2[]
    ).map(place);
    if (s.fill) w.region(pts);
    w.line(pen(s.width), pts, true);
  } else if (s.kind === "circle") {
    const c = place([s.cx, s.cy]);
    if (s.fill) w.flash(w.circle(2 * s.r + Math.max(least, s.width ?? 0.12), fn), c);
    else w.arc(pen(s.width), c, [c[0] + s.r, c[1]], [c[0] + s.r, c[1]]);
  } else if (s.kind === "arc") {
    const end = (deg: number): P2 => place([s.cx + s.r * Math.cos(rad(deg)), s.cy + s.r * Math.sin(rad(deg))]);
    w.arc(pen(s.width), place([s.cx, s.cy]), end(s.a0), end(s.a1), mirror);
  } else {
    // Text reads the right way round on its own side: from below for the bottom, so mirrored in the file.
    const cap = s.size * 0.72;
    const at = place([s.x, s.y]);
    const strokes = textStrokes(s.text, cap, at, { angle: turnBy + (mirror ? -1 : 1) * (s.angle ?? 0), align: s.align ?? "left", middle: true, mirror });
    const code = w.circle(penFor(cap, least), fn);
    for (const line of strokes) w.line(code, line);
  }
}

/** The pad shape of a mask opening over a bare hole or a round land. */
const round = (d: number): Pick<Pad, "shape" | "w" | "h"> => ({ shape: "circle", w: d, h: d });

function copperFile(d: ElectronicsDesign, board: Board, side: Side, pads: BoardPad[], copper: Copper[], fn: string): string {
  const w = new Writer(fn);
  for (const pour of paintOrder(board, side)) paintPour(w, pourShape(d, pour, pads, copper), pourFill(d, pour, pads, copper).islands);
  for (const t of board.tracks) {
    if (t.layer !== side) continue;
    w.attr(".N", field(t.net));
    w.line(w.circle(t.width, "Conductor"), t.pts);
  }
  for (const s of board.shapes) if (s.layer === `copper-${side}`) drawShape(w, s, (p) => p, 0, side === "bottom", 0, "NonConductor");
  for (const t of board.texts) {
    if (t.layer !== `copper-${side}`) continue;
    const cap = t.size * 0.72;
    const code = w.circle(penFor(cap), "NonConductor");
    w.attr(".N");
    for (const line of textStrokes(t.text, cap, [t.x, t.y], { angle: t.angle ?? 0, mirror: side === "bottom" })) w.line(code, line);
  }
  for (const p of pads) {
    if (p.pad.kind === "npth" || (p.pad.kind === "smd" && p.side !== side)) continue;
    w.attr(".P", `${field(p.ref)},${field(p.pad.number)}`);
    w.attr(".N", field(p.net));
    w.flash(w.pad(p.pad, p.angle, 0, p.pad.kind === "smd" ? "SMDPad,CuDef" : "ComponentPad"), p.at);
  }
  w.attr(".P");
  for (const v of board.vias) {
    w.attr(".N", field(v.net));
    w.flash(w.circle(v.diameter, "ViaPad"), [v.x, v.y]);
  }
  w.attr(".N");
  for (const h of board.holes) if (h.pad) w.flash(w.circle(h.pad, "ComponentPad"), [h.x, h.y]);
  return w.text();
}

/** The openings in the solder mask on a side: over pads and holes, each a little bigger than the copper. Vias stay covered. */
function openings(w: Writer, board: Board, side: Side, pads: BoardPad[]) {
  const margin = board.rules.maskMargin;
  for (const p of pads) {
    if (p.pad.kind === "smd" && p.side !== side) continue;
    const grow = p.pad.maskMargin ?? margin;
    if (p.pad.kind === "npth") w.flash(w.pad(round(p.pad.drill ?? Math.max(p.pad.w, p.pad.h)), 0, grow), p.at);
    else w.flash(w.pad(p.pad, p.angle, grow), p.at);
  }
  for (const h of board.holes) w.flash(w.pad(round(h.pad ?? h.drill), 0, margin), [h.x, h.y]);
}

function maskFile(board: Board, side: Side, pads: BoardPad[], fn: string): string {
  const w = new Writer(fn);
  openings(w, board, side, pads);
  return w.text();
}

function pasteFile(side: Side, pads: BoardPad[], fn: string): string {
  const w = new Writer(fn);
  for (const p of pads) {
    if (p.pad.kind !== "smd" || p.side !== side || p.pad.noPaste) continue;
    // A pad's own paste gap (#627), never so far in that nothing is left to print.
    const grow = Math.max(p.pad.pasteMargin ?? 0, -(Math.min(p.pad.w, p.pad.h) / 2 - 0.05));
    w.flash(w.pad(p.pad, p.angle, grow), p.at);
  }
  return w.text();
}

function silkFile(d: ElectronicsDesign, board: Board, side: Side, pads: BoardPad[], fn: string): string {
  const w = new Writer(fn);
  const least = board.rules.minSilkWidth;
  const mirror = side === "bottom";
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  for (const at of board.placements) {
    const part = parts.get(at.part);
    const pkg = part && packageOf(d, part);
    if (!part || !pkg || at.side !== side) continue;
    const place = (p: P2) => placeOnBoard(p, at);
    w.attr(".C", field(part.ref));
    for (const s of pkg.footprint.shapes) if (s.layer === "silk") drawShape(w, s, place, at.rot, mirror, least);
    if (!at.refHidden) {
      const size = Math.max(REF_SIZE, board.rules.minSilkHeight);
      const code = w.circle(penFor(size, least));
      for (const line of textStrokes(part.ref, size, place(at.refAt ?? pkg.footprint.refAt ?? [0, 0]), { align: "centre", middle: true, mirror }))
        w.line(code, line);
    }
  }
  w.attr(".C");
  for (const s of board.shapes) if (onSide(s.layer, side) && s.layer.startsWith("silk")) drawShape(w, s, (p) => p, 0, mirror, least);
  for (const t of board.texts) {
    if (t.layer !== `silk-${side}`) continue;
    const cap = Math.max(t.size * 0.72, 0);
    const code = w.circle(penFor(cap, least));
    for (const line of textStrokes(t.text, cap, [t.x, t.y], { angle: t.angle ?? 0, mirror })) w.line(code, line);
  }
  // Ink never lands on a pad: the mask's openings are taken back out of the silkscreen.
  w.comment("Silkscreen kept off the pads");
  w.polarity(false);
  openings(w, board, side, pads);
  w.polarity(true);
  return w.text();
}

function edgeFile(board: Board, fn: string): string {
  const w = new Writer(fn);
  const pen = w.circle(EDGE_PEN, "Profile");
  for (const loop of [board.outline, ...(board.cutouts ?? [])]) w.outline(pen, loop);
  return w.text();
}

/** Every Gerber file of the board. No board: none. */
export function gerberFiles(d: ElectronicsDesign, nl: Netlist = netlist(d)): GerberFile[] {
  const board = d.board;
  if (!board) return [];
  const pads = boardPads(d, nl);
  const copper = copperOf(d, pads);
  return GERBER_LAYERS.map(({ id, fn }): GerberFile => {
    const side: Side = id.endsWith("bottom") ? "bottom" : "top";
    const text = id.startsWith("copper")
      ? copperFile(d, board, side, pads, copper, fn)
      : id.startsWith("mask")
        ? maskFile(board, side, pads, fn)
        : id.startsWith("paste")
          ? pasteFile(side, pads, fn)
          : id.startsWith("silk")
            ? silkFile(d, board, side, pads, fn)
            : edgeFile(board, fn);
    return { layer: id, fn, text };
  });
}

/** The board's edge as straight runs, for anything that needs to know what is on the board. */
export const edgePoints = (board: Pick<Board, "outline">): P2[] => outlinePoints(board.outline, 0.02);
