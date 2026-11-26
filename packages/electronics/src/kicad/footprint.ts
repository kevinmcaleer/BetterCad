import type { FootprintDef, FootprintLayer, P2, Pad, PadShape, Shape } from "../model";
import { arcFrom3, child, children, head, isList, num, parseSexpr, text, type Node } from "./sexpr";

/** A footprint from a KiCad `.kicad_mod` file, with what else the file says. */
export interface KicadFootprint {
  footprint: FootprintDef;
  description?: string;
  keywords: string[];
  /** Surface mount, through hole, or neither said. */
  mount?: "smd" | "thru";
  /** The 3D model the footprint points at, with KiCad's own offset, scale and turn. */
  models: { path: string; offset: [number, number, number]; scale: [number, number, number]; rotate: [number, number, number] }[];
  /** Front-side shapes on layers we do not keep (paste, mask, user), counted so an import can say what it left out. */
  skipped: number;
}

/** Front layers only: a library footprint is drawn for the top; the board flips it for the bottom. */
const FRONT_LAYERS: Record<string, FootprintLayer> = {
  "F.SilkS": "silk",
  "F.Fab": "fab",
  "F.CrtYd": "courtyard",
  "F.Cu": "copper",
  "F.Silkscreen": "silk",
  "F.Courtyard": "courtyard",
};
const BACK_LAYERS: Record<string, FootprintLayer> = Object.fromEntries(Object.entries(FRONT_LAYERS).map(([k, v]) => [k.replace(/^F\./, "B."), v]));

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
/** KiCad's boards have y running down; ours runs up. */
const xy = (n: Node[] | undefined): P2 => [r4(num(n, 1)), r4(-num(n, 2))];
const widthOf = (n: Node[]): number | undefined => {
  const w = num(child(child(n, "stroke"), "width")) || num(child(n, "width"));
  return w > 0 ? w : undefined;
};
const filled = (n: Node[]): boolean => {
  const f = child(n, "fill");
  const t = text(f);
  return t === "yes" || t === "solid" || text(child(f, "type")) === "solid";
};

/** Joins straight lines that meet end to end on one layer into runs, the way the outline was drawn: far less to keep. */
function joinLines(shapes: FootprintDef["shapes"]): FootprintDef["shapes"] {
  type Run = Extract<FootprintDef["shapes"][number], { kind: "line" }>;
  const same = (a: P2, b: P2) => a[0] === b[0] && a[1] === b[1];
  const out: FootprintDef["shapes"] = [];
  const runs: Run[] = [];
  for (const s of shapes) {
    if (s.kind !== "line" || s.fill) {
      out.push(s);
      continue;
    }
    let piece: Run = { ...s, pts: [...s.pts] };
    // Keep joining: a new line can bridge two runs that were apart until now.
    for (let joined = true; joined;) {
      joined = false;
      for (let i = 0; i < runs.length; i += 1) {
        const r = runs[i]!;
        if (r.layer !== piece.layer || r.width !== piece.width) continue;
        const [r0, r1] = [r.pts[0]!, r.pts[r.pts.length - 1]!];
        const [p0, p1] = [piece.pts[0]!, piece.pts[piece.pts.length - 1]!];
        // A closed run is finished.
        if (r.pts.length > 2 && same(r0, r1)) continue;
        let pts: P2[] | null = null;
        if (same(r1, p0)) pts = [...r.pts, ...piece.pts.slice(1)];
        else if (same(r1, p1)) pts = [...r.pts, ...piece.pts.slice(0, -1).reverse()];
        else if (same(r0, p1)) pts = [...piece.pts, ...r.pts.slice(1)];
        else if (same(r0, p0)) pts = [...piece.pts.slice(1).reverse(), ...r.pts];
        if (!pts) continue;
        piece = { ...r, pts };
        out.splice(out.indexOf(r), 1);
        runs.splice(i, 1);
        joined = true;
        break;
      }
    }
    runs.push(piece);
    out.push(piece);
  }
  return out;
}

function pad(n: Node[], back: boolean): Pad | null {
  const type = text(n, 2);
  const shape = text(n, 3);
  // A pad with no copper is an opening in the paste or the mask, not a pad.
  const copper = (child(n, "layers") ?? [])
    .slice(1)
    .map(String)
    .filter((l) => l.endsWith(".Cu"));
  if ((type === "connect" || type === "smd") && !copper.length) return null;
  const far = (type === "connect" || type === "smd") && copper.every((l) => l.startsWith(back ? "F." : "B."));
  const at = child(n, "at");
  const size = child(n, "size");
  const drill = child(n, "drill");
  const oval = text(drill) === "oval";
  const d = oval ? num(drill, 2) : num(drill, 1);
  const dy = oval ? num(drill, 3, d) : d;
  const layers = child(n, "layers")?.slice(1).map(String) ?? [];
  // A trapezoid keeps its rectangle: close enough for placing and checking, and said in the docs. A custom pad keeps
  // its outline (#744), and copper off the hole its offset.
  const shapes: Record<string, PadShape> = { circle: "circle", rect: "rect", roundrect: "roundrect", oval: "oval", trapezoid: "rect", custom: "rect" };
  const outline = shape === "custom" ? customOutline(n, num(size, 1), num(size, 2, num(size, 1))) : null;
  const offAt = child(drill, "offset");
  const offset: P2 | null = offAt && (num(offAt, 1) || num(offAt, 2)) ? [r4(num(offAt, 1)), r4(-num(offAt, 2))] : null;
  const kind = type === "thru_hole" ? "thru" : type === "np_thru_hole" ? "npth" : "smd";
  const angle = num(at, 3);
  const round = num(child(n, "roundrect_rratio"), 1, 0.25);
  const margin = child(n, "solder_mask_margin");
  const paste = child(n, "solder_paste_margin");
  return {
    number: text(n, 1),
    kind,
    shape: outline ? "polygon" : (shapes[shape] ?? "rect"),
    x: num(at, 1),
    y: r4(-num(at, 2)),
    w: outline ? outline.w : num(size, 1),
    h: outline ? outline.h : num(size, 2, num(size, 1)),
    ...(outline ? { points: outline.points } : {}),
    ...(offset ? { offset } : {}),
    ...(angle ? { angle } : {}),
    ...(shape === "roundrect" ? { round } : {}),
    ...(kind !== "smd" && d ? { drill: Math.min(d, dy) } : {}),
    ...(kind !== "smd" && oval && d !== dy ? { slot: Math.max(d, dy) } : {}),
    ...(margin ? { maskMargin: num(margin) } : {}),
    ...(paste && kind === "smd" && num(paste) ? { pasteMargin: num(paste) } : {}),
    ...(kind === "smd" && !layers.some((l) => l.endsWith(".Paste")) ? { noPaste: true } : {}),
    ...(far ? { back: true } : {}),
  };
}

/**
 * A custom pad's copper as one outline in the pad's own frame, y up: its one polygon, or, when it is made of several
 * pieces (polygons, rectangles, circles and the anchor), the hull round them all. Null when it has nothing we can read.
 */
function customOutline(n: Node[], aw: number, ah: number): { points: P2[]; w: number; h: number } | null {
  const prims = child(n, "primitives") ?? [];
  const pieces: P2[][] = [];
  for (const g of children(prims, "gr_poly")) {
    const pts = children(child(g, "pts"), "xy").map(xy);
    if (pts.length >= 3) pieces.push(pts);
  }
  for (const g of children(prims, "gr_rect")) {
    const [a, b] = [xy(child(g, "start")), xy(child(g, "end"))];
    pieces.push([a, [b[0], a[1]], b, [a[0], b[1]]]);
  }
  for (const g of children(prims, "gr_circle")) {
    const c = xy(child(g, "center"));
    const e = xy(child(g, "end"));
    const r = Math.hypot(e[0] - c[0], e[1] - c[1]) + num(child(g, "width")) / 2;
    pieces.push(Array.from({ length: 16 }, (_, i): P2 => [r4(c[0] + r * Math.cos((i * Math.PI) / 8)), r4(c[1] + r * Math.sin((i * Math.PI) / 8))]));
  }
  if (!pieces.length) return null;
  const anchor: P2[] = [
    [-aw / 2, -ah / 2],
    [aw / 2, -ah / 2],
    [aw / 2, ah / 2],
    [-aw / 2, ah / 2],
  ];
  const inside = (p: P2, poly: P2[]) => {
    let k = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [a, b] = [poly[i]!, poly[j]!];
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) k = true;
    }
    return k;
  };
  // One polygon that takes in the anchor's middle is kept as it is; anything else becomes the hull.
  const points = pieces.length === 1 && inside([0, 0], pieces[0]!) ? pieces[0]! : hull([...pieces.flat(), ...anchor]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { points, w: r4(Math.max(...xs) - Math.min(...xs)), h: r4(Math.max(...ys) - Math.min(...ys)) };
}

/** The convex hull of some points, anticlockwise. */
function hull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: P2[]) => {
    const out: P2[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/**
 * Reads a `.kicad_mod` footprint (#623). Pads, and the silkscreen, fabrication and courtyard drawings of the front
 * side, are kept; y is flipped to run up. Text other than the reference's place is left out: the board draws its own.
 */
export function readKicadFootprint(source: string): KicadFootprint {
  const fp = parseSexpr(source).find((n) => head(n) === "footprint" || head(n) === "module");
  if (!isList(fp)) throw new Error("This is not a KiCad footprint (.kicad_mod).");
  return footprintIn(fp);
}

/**
 * A pad whose paste is drawn as separate openings gets one opening of the same area, so it is still soldered: the
 * stencil's pattern is not kept, the amount of paste is.
 */
function pasted(p: Pad, openings: { x: number; y: number; area: number }[]): Pad {
  const turn = ((p.angle ?? 0) % 180) + ((p.angle ?? 0) < 0 ? 180 : 0);
  if (!p.noPaste || (turn !== 0 && turn !== 90)) return p;
  const [w, h] = turn ? [p.h, p.w] : [p.w, p.h];
  const area = openings.filter((o) => Math.abs(o.x - p.x) <= w / 2 && Math.abs(o.y - p.y) <= h / 2).reduce((a, o) => a + o.area, 0);
  if (!area) return p;
  // (w + 2m)(h + 2m) = area, for the margin m, never bigger than the pad.
  const b = p.w + p.h;
  const m = Math.min(0, (-b + Math.sqrt(b * b - 4 * (p.w * p.h - area))) / 4);
  const next: Pad = { ...p, ...(r4(m) ? { pasteMargin: r4(m) } : {}) };
  delete next.noPaste;
  return next;
}

/**
 * A footprint from its list, in a library or on a board. On a board a footprint flipped to the bottom keeps its
 * drawings on the back layers (`back`); they are read as they are written, and the board's reader turns them over.
 */
export function footprintIn(fp: Node[], back = false): KicadFootprint {
  const LAYERS = back ? BACK_LAYERS : FRONT_LAYERS;
  const pads: Pad[] = [];
  const shapes: FootprintDef["shapes"] = [];
  let skipped = 0;
  let refAt: P2 | undefined;
  // Paste openings drawn as pads of their own, as a thermal pad's are: where each is, and its area.
  const openings: { x: number; y: number; area: number }[] = [];
  for (const item of fp) {
    if (!isList(item)) continue;
    const kind = head(item);
    if (kind === "pad") {
      const p = pad(item, back);
      if (p) pads.push(p);
      else {
        skipped += 1;
        const layers = child(item, "layers")?.slice(1).map(String) ?? [];
        const [at, size] = [child(item, "at"), child(item, "size")];
        if (layers.some((l) => l.endsWith(".Paste"))) openings.push({ x: num(at, 1), y: r4(-num(at, 2)), area: num(size, 1) * num(size, 2, num(size, 1)) });
      }
      continue;
    }
    if ((kind === "property" && text(item) === "Reference") || (kind === "fp_text" && text(item) === "reference")) {
      if (LAYERS[text(child(item, "layer"))] === "silk") refAt = xy(child(item, "at"));
      continue;
    }
    if (!kind.startsWith("fp_") || kind === "fp_text") continue;
    const layer = LAYERS[text(child(item, "layer"))];
    if (!layer) {
      if (text(child(item, "layer")).startsWith(back ? "B." : "F.")) skipped += 1;
      continue;
    }
    const width = widthOf(item);
    const w = width ? { width } : {};
    let s: Shape | null = null;
    if (kind === "fp_line") s = { kind: "line", pts: [xy(child(item, "start")), xy(child(item, "end"))], ...w };
    else if (kind === "fp_rect") {
      const [x1, y1] = xy(child(item, "start"));
      const [x2, y2] = xy(child(item, "end"));
      s = { kind: "rect", x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), fill: filled(item), ...w };
    } else if (kind === "fp_circle") {
      const c = xy(child(item, "center"));
      const e = xy(child(item, "end"));
      s = { kind: "circle", cx: c[0], cy: c[1], r: r4(Math.hypot(e[0] - c[0], e[1] - c[1])), ...(filled(item) ? { fill: true } : {}), ...w };
    } else if (kind === "fp_arc") {
      const mid = child(item, "mid");
      // Before KiCad 6 an arc was a centre (`start`), a point (`end`) and an angle; from 6 it is three points.
      const arc = mid ? arcFrom3(xy(child(item, "start")), xy(mid), xy(child(item, "end"))) : null;
      if (arc) s = { kind: "arc", ...arc, ...w };
    } else if (kind === "fp_poly") {
      const pts = children(child(item, "pts"), "xy").map(xy);
      if (pts.length > 2) s = { kind: "line", pts: [...pts, pts[0]!], fill: filled(item) || !width, ...w };
    }
    if (s) shapes.push({ ...s, layer });
  }
  const attr = child(fp, "attr");
  const mount = attr?.some((x) => x === "smd") ? "smd" : attr?.some((x) => x === "through_hole") ? "thru" : undefined;
  const description = text(child(fp, "descr"));
  const triple = (n: Node[] | undefined, or: number): [number, number, number] => {
    const v = child(n, "xyz");
    return [num(v, 1, or), num(v, 2, or), num(v, 3, or)];
  };
  return {
    footprint: { name: text(fp), pads: pads.map((p) => pasted(p, openings)), shapes: joinLines(shapes), ...(refAt ? { refAt } : {}) },
    ...(description ? { description } : {}),
    keywords: text(child(fp, "tags")).split(/\s+/).filter(Boolean),
    ...(mount ? { mount } : {}),
    models: children(fp, "model").map((m) => ({
      path: text(m),
      offset: triple(child(m, "offset"), 0),
      scale: triple(child(m, "scale"), 1),
      rotate: triple(child(m, "rotate"), 0),
    })),
    skipped,
  };
}
