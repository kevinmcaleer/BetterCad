import { removeParts } from "../edit";
import { key, q } from "../geom";
import { eid, isPower, type Board, type CopperLayer, type Corner, type ElectronicsDesign, type Id, type P2, type Placement } from "../model";
import { clearanceBetween, edgeGap, gap, netRules, type Copper, type Layer, type Solid } from "./copper";
import { layersOf, viaLayers } from "./stack";

/**
 * A path from `a` to `b` with one 45° bend (#640): a straight run along x or y and a diagonal. `diagonalFirst`
 * chooses which comes first. Points that line up come back as one straight piece.
 */
export function corner45(a: P2, b: P2, diagonalFirst = false): P2[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.min(Math.abs(dx), Math.abs(dy));
  if (d < 1e-6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6) return [a, b];
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const mid: P2 = diagonalFirst ? [q(a[0] + sx * d), q(a[1] + sy * d)] : Math.abs(dx) > Math.abs(dy) ? [q(b[0] - sx * d), a[1]] : [a[0], q(b[1] - sy * d)];
  return [a, mid, b];
}

export interface Blocked {
  /** What is in the way: "R1 pad 2", "a track on GND", "the board's edge". */
  what: string;
  /** The space there would be, and the space the rules ask for, mm. */
  gap: number;
  need: number;
  at: P2;
}

/** What a new run of track (or a via: one point) would come too close to. Its own net never blocks it. */
export function blockers(
  board: Pick<Board, "rules" | "classes"> & Partial<Pick<Board, "keepouts">>,
  copper: Copper[],
  loops: P2[][],
  run: { net: string; layers: Layer[]; pts: P2[]; width: number },
): Blocked[] {
  const out: Blocked[] = [];
  const pieces: Solid[] =
    run.pts.length === 1 ? [{ pts: run.pts, r: run.width / 2 }] : run.pts.slice(1).map((b, i) => ({ pts: [run.pts[i]!, b], r: run.width / 2 }));
  for (const piece of pieces) {
    for (const c of copper) {
      if ((c.net && c.net === run.net) || !c.layers.some((l) => run.layers.includes(l))) continue;
      const need = clearanceBetween(board, run.net, c.net);
      const g = gap(piece, c);
      if (g < need - 1e-6) out.push({ what: c.what, gap: g, need, at: c.at });
    }
    for (const k of board.keepouts ?? [])
      if (k.tracks && gap(piece, { pts: k.outline, r: 0 }) === 0) out.push({ what: "a keep-out", gap: 0, need: 0, at: k.outline[0]! });
    const e = edgeGap(piece, loops);
    if (e < board.rules.copperToEdge - 1e-6) out.push({ what: "the board's edge", gap: Math.max(0, e), need: board.rules.copperToEdge, at: piece.pts[0]! });
  }
  return out;
}

const onBoard = (d: ElectronicsDesign, change: (b: Board) => Board): ElectronicsDesign => {
  const next = d.board && change(d.board);
  return next && next !== d.board ? { ...d, board: next } : d;
};

/** Takes out points that repeat and points in the middle of a straight run. */
export function tidyRun(pts: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of pts) {
    if (out.length && key(out[out.length - 1]![0], out[out.length - 1]![1]) === key(p[0], p[1])) continue;
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (
      a &&
      b &&
      Math.abs((b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0])) < 1e-9 &&
      (b[0] - a[0]) * (p[0] - b[0]) + (b[1] - a[1]) * (p[1] - b[1]) > 0
    )
      out.pop();
    out.push(p);
  }
  return out;
}

/**
 * Lays a track. With no width given it takes its net's from the rules. A run that starts where a track of the same
 * net, layer and width ends carries that track on, so a route laid click by click stays one track.
 */
export function addTrack(d: ElectronicsDesign, net: string, layer: CopperLayer, pts: P2[], width?: number): ElectronicsDesign {
  const run = tidyRun(pts);
  if (run.length < 2) return d;
  return onBoard(d, (b) => {
    const w = width ?? netRules(b, net).trackWidth;
    const same = (p: P2, o: P2) => key(p[0], p[1]) === key(o[0], o[1]);
    const on = b.tracks.find((t) => t.net === net && t.layer === layer && Math.abs(t.width - w) < 1e-9 && same(t.pts[t.pts.length - 1]!, run[0]!));
    if (on) return { ...b, tracks: b.tracks.map((t) => (t === on ? { ...t, pts: tidyRun([...t.pts, ...run]) } : t)) };
    return { ...b, tracks: [...b.tracks, { id: eid("tr"), net, layer, width: w, pts: run }] };
  });
}

/**
 * Drops a via, sized by its net's rules. One already there on the same net is left as it is. `span` makes it join
 * only those layers and the ones between (#648); a span of the whole board is a via right through.
 */
export function addVia(d: ElectronicsDesign, net: string, x: number, y: number, span?: [CopperLayer, CopperLayer]): ElectronicsDesign {
  return onBoard(d, (b) => {
    if (b.vias.some((v) => v.net === net && key(v.x, v.y) === key(x, y))) return b;
    const r = netRules(b, net);
    const part = span && viaLayers(b, { span }).length < layersOf(b).length;
    return { ...b, vias: [...b.vias, { id: eid("vi"), net, x, y, diameter: r.viaDiameter, drill: r.viaDrill, ...(part ? { span } : {}) }] };
  });
}

/** Changes a via's size or hole. */
export function setVia(d: ElectronicsDesign, id: Id, change: { diameter?: number; drill?: number }): ElectronicsDesign {
  return onBoard(d, (b) => ({ ...b, vias: b.vias.map((v) => (v.id === id ? { ...v, ...change } : v)) }));
}

/** What the autorouter (#647) lays for one connection: a run of track on each side it uses, and the vias between. */
export interface Route {
  net: string;
  tracks: { layer: Layer; pts: P2[] }[];
  vias: P2[];
}

/** Lays routes the autorouter found. */
export function applyRoutes(d: ElectronicsDesign, routes: Route[]): ElectronicsDesign {
  for (const r of routes) {
    for (const t of r.tracks) d = addTrack(d, r.net, t.layer, t.pts);
    for (const v of r.vias) d = addVia(d, r.net, v[0], v[1]);
  }
  return d;
}

/** How long a track is, mm. */
export const trackLength = (pts: P2[]): number => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);

/** Deletes every track and via of a net. */
export function ripUpNet(d: ElectronicsDesign, net: string): ElectronicsDesign {
  return onBoard(d, (b) => ({ ...b, tracks: b.tracks.filter((t) => t.net !== net), vias: b.vias.filter((v) => v.net !== net) }));
}

/** Takes every track and via off the board, so it can be routed again. Parts, pours and keep-outs stay. */
export function clearRoutes(d: ElectronicsDesign): ElectronicsDesign {
  return onBoard(d, (b) => (b.tracks.length || b.vias.length ? { ...b, tracks: [], vias: [] } : b));
}

/** Changes the width of the picked tracks. */
export function setTrackWidth(d: ElectronicsDesign, ids: Id[], width: number): ElectronicsDesign {
  const set = new Set(ids);
  return width > 0 ? onBoard(d, (b) => ({ ...b, tracks: b.tracks.map((t) => (set.has(t.id) ? { ...t, width } : t)) })) : d;
}

// ---------------------------------------------------------------- the board itself

/** A rectangle with its bottom left corner at the origin, corners rounded by `radius`. */
export function roundedOutline(w: number, h: number, radius = 0): Corner[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r < 1e-6)
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  // A quarter turn's bulge: tan(90° / 4).
  const bulge = Math.SQRT2 - 1;
  return [
    { x: r, y: 0 },
    { x: q(w - r), y: 0, bulge },
    { x: w, y: r },
    { x: w, y: q(h - r), bulge },
    { x: q(w - r), y: h },
    { x: r, y: h, bulge },
    { x: 0, y: q(h - r) },
    { x: 0, y: r, bulge },
  ];
}

/** The corner radius of an outline made by `roundedOutline`; 0 for anything else. */
export function outlineRadius(outline: Corner[]): number {
  return outline.length === 8 && outline[1]?.bulge ? q(outline[0]!.x - Math.min(...outline.map((c) => c.x))) : 0;
}

/** Changes the board's make-up: its outline, thickness, colours. */
export function setBoard(
  d: ElectronicsDesign,
  change: Partial<Pick<Board, "outline" | "cutouts" | "thickness" | "mask" | "silk" | "rules" | "classes">>,
): ElectronicsDesign {
  return onBoard(d, (b) => ({ ...b, ...change }));
}

/** Sets where a part sits, how it is turned, its side, or whether it is locked. */
export function setPlacement(
  d: ElectronicsDesign,
  part: Id,
  change: Partial<Pick<Placement, "x" | "y" | "rot" | "side" | "locked" | "refHidden">>,
): ElectronicsDesign {
  const tidy = { ...change, ...(change.rot !== undefined ? { rot: ((change.rot % 360) + 360) % 360 } : {}) };
  return onBoard(d, (b) => ({
    ...b,
    placements: b.placements.map((p) => {
      if (p.part !== part) return p;
      const next = { ...p, ...tidy };
      if (!next.locked) delete next.locked;
      return next;
    }),
  }));
}

/** Locks the picked parts where they are, or frees them when every one is locked already. */
export function toggleLock(d: ElectronicsDesign, parts: Id[]): ElectronicsDesign {
  const set = new Set(parts);
  const all = d.board?.placements.filter((p) => set.has(p.part)).every((p) => p.locked) ?? false;
  return onBoard(d, (b) => ({
    ...b,
    placements: b.placements.map((p) => {
      if (!set.has(p.part)) return p;
      const next: Placement = { ...p, locked: true };
      if (all) delete next.locked;
      return next;
    }),
  }));
}

export type Align = "left" | "right" | "top" | "bottom" | "across" | "down";

/**
 * Lines the picked parts up by their origins: to the leftmost, rightmost, top or bottom one, or spread evenly across
 * or down between the two furthest apart. Locked parts stay put.
 */
export function alignParts(d: ElectronicsDesign, parts: Id[], how: Align): ElectronicsDesign {
  const set = new Set(parts);
  const picked = d.board?.placements.filter((p) => set.has(p.part)) ?? [];
  if (picked.length < 2) return d;
  const xs = picked.map((p) => p.x);
  const ys = picked.map((p) => p.y);
  const to = new Map<Id, P2>();
  if (how === "across" || how === "down") {
    const axis = how === "across" ? 0 : 1;
    const order = [...picked].sort((a, b) => (axis ? b.y - a.y : a.x - b.x));
    const from = axis ? order[0]!.y : order[0]!.x;
    const end = axis ? order[order.length - 1]!.y : order[order.length - 1]!.x;
    order.forEach((p, i) => {
      const v = q(from + ((end - from) * i) / (order.length - 1));
      to.set(p.part, axis ? [p.x, v] : [v, p.y]);
    });
  } else
    for (const p of picked)
      to.set(
        p.part,
        how === "left" ? [Math.min(...xs), p.y] : how === "right" ? [Math.max(...xs), p.y] : how === "top" ? [p.x, Math.max(...ys)] : [p.x, Math.min(...ys)],
      );
  return onBoard(d, (b) => ({
    ...b,
    placements: b.placements.map((p) => (to.has(p.part) && !p.locked ? { ...p, x: to.get(p.part)![0], y: to.get(p.part)![1] } : p)),
  }));
}

/** Screw sizes a mounting hole is offered in, with a normal clearance hole for each, mm. */
export const SCREWS: { name: string; drill: number; pad: number }[] = [
  { name: "M2", drill: 2.2, pad: 4.4 },
  { name: "M2.5", drill: 2.7, pad: 5 },
  { name: "M3", drill: 3.2, pad: 6 },
  { name: "M4", drill: 4.3, pad: 8 },
];

/** Adds a mounting hole. `pad` rings it with copper, making it a plated hole. */
export function addHole(d: ElectronicsDesign, x: number, y: number, drill: number, pad?: number): ElectronicsDesign {
  return onBoard(d, (b) => ({ ...b, holes: [...b.holes, { id: eid("ho"), x, y, drill, ...(pad ? { pad } : {}) }] }));
}

export function setHole(d: ElectronicsDesign, id: Id, change: { drill?: number; pad?: number | null }): ElectronicsDesign {
  return onBoard(d, (b) => ({
    ...b,
    holes: b.holes.map((h) => {
      if (h.id !== id) return h;
      const { pad, ...rest } = { ...h, ...(change.drill ? { drill: change.drill } : {}) };
      const ring = change.pad === undefined ? pad : (change.pad ?? undefined);
      return ring ? { ...rest, pad: ring } : rest;
    }),
  }));
}

/** Adds a line of text to the silkscreen. */
export function addText(
  d: ElectronicsDesign,
  x: number,
  y: number,
  text: string,
  layer: Board["texts"][number]["layer"] = "silk-top",
  size = 1.5,
): ElectronicsDesign {
  const t = text.trim();
  return t ? onBoard(d, (b) => ({ ...b, texts: [...b.texts, { id: eid("tx"), layer, x, y, text: t, size }] })) : d;
}

export function setText(d: ElectronicsDesign, id: Id, change: Partial<Omit<Board["texts"][number], "id">>): ElectronicsDesign {
  return onBoard(d, (b) => ({ ...b, texts: b.texts.map((t) => (t.id === id ? { ...t, ...change } : t)) }));
}

/** Adds an area tracks, parts or both must stay out of. */
export function addKeepout(d: ElectronicsDesign, a: P2, c: P2, what: { tracks?: boolean; parts?: boolean } = { tracks: true }): ElectronicsDesign {
  const [x1, x2] = [Math.min(a[0], c[0]), Math.max(a[0], c[0])];
  const [y1, y2] = [Math.min(a[1], c[1]), Math.max(a[1], c[1])];
  if (x2 - x1 < 0.1 || y2 - y1 < 0.1) return d;
  return onBoard(d, (b) => ({
    ...b,
    keepouts: [
      ...b.keepouts,
      {
        id: eid("ko"),
        outline: [
          [x1, y1],
          [x2, y1],
          [x2, y2],
          [x1, y2],
        ],
        ...what,
      },
    ],
  }));
}

/**
 * Deletes parts from the board and the schematic together (#645), as one change, so one undo brings both back. The
 * tracks that ran to them stay: the board check lists them as loose ends.
 */
export function deleteParts(d: ElectronicsDesign, parts: Id[]): ElectronicsDesign {
  const gone = new Set(parts);
  if (!d.parts.some((p) => gone.has(p.id))) return d;
  return onBoard(removeParts(d, parts), (b) => ({ ...b, placements: b.placements.filter((p) => !gone.has(p.part)) }));
}

/** Rows of parts this far apart or less count as one row when renumbering, mm. */
const ROW = 2.54;

/**
 * Numbers the parts by where they sit on the board (#645): top side first, in rows from the top, left to right, so
 * R1 is the first resistor you come to. The schematic's names change with them. Parts not on the board keep their
 * place after the ones that are.
 */
export function renumberOnBoard(d: ElectronicsDesign): ElectronicsDesign {
  const board = d.board;
  if (!board) return d;
  const top = Math.max(0, ...board.placements.map((p) => p.y));
  const rank = new Map<Id, number>();
  [...board.placements]
    .sort((a, b) => Number(a.side === "bottom") - Number(b.side === "bottom") || Math.round((top - a.y) / ROW) - Math.round((top - b.y) / ROW) || a.x - b.x)
    .forEach((p, i) => rank.set(p.part, i));
  const next = new Map<string, number>();
  const ref = new Map<Id, string>();
  for (const p of [...d.parts].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))) {
    // Power symbols have no number.
    if (isPower(d, p)) continue;
    const prefix = d.defs[p.def]?.prefix ?? p.ref.replace(/\d+$/, "");
    const k = (next.get(prefix) ?? 0) + 1;
    next.set(prefix, k);
    ref.set(p.id, `${prefix}${k}`);
  }
  if (d.parts.every((p) => (ref.get(p.id) ?? p.ref) === p.ref)) return d;
  return {
    ...d,
    parts: d.parts.map((p) => ({ ...p, ref: ref.get(p.id) ?? p.ref })),
    board: { ...board, placements: board.placements.map((p) => (ref.has(p.part) ? { ...p, ref: ref.get(p.part)! } : p)) },
  };
}
