import { boardPads, outlinePoints, pointInPolygon, type BoardPad } from "../board";
import { penFor, textStrokes } from "../fab/font";
import { distToSegment, rad, segmentDistance } from "../geom";
import type { Board, ElectronicsDesign, Id, NetClass, P2, Rules } from "../model";

/**
 * Copper as shapes that can be measured (#640, #644). Every piece is a core (a point, a line or a convex outline)
 * grown by a radius: a via is a point, a track a line, a rounded pad a rectangle with its corners pulled in. The gap
 * between two pieces is then the distance between their cores less both radii.
 */
export interface Solid {
  pts: P2[];
  r: number;
}

export type Layer = "top" | "bottom";

export interface Copper extends Solid {
  /** `text`: a stroke of text written in copper, on no net. */
  kind: "pad" | "track" | "via" | "text";
  net: string;
  layers: Layer[];
  /** The part for a pad, the track or via otherwise. */
  id: Id;
  /** For a track: which piece of it. */
  segment?: number;
  /** In words, for a result: "R1 pad 2", "a track on GND". */
  what: string;
  at: P2;
}

const inside = (p: P2, s: Solid): boolean => s.pts.length > 2 && pointInPolygon(p, s.pts);

/** Distance between two cores; 0 when they touch, cross or one holds the other. */
function coreDistance(a: Solid, b: Solid): number {
  if (inside(b.pts[0]!, a) || inside(a.pts[0]!, b)) return 0;
  let best = Infinity;
  const edges = (s: Solid) => (s.pts.length === 1 ? 1 : s.pts.length === 2 ? 1 : s.pts.length);
  for (let i = 0; i < edges(a); i += 1) {
    const a1 = a.pts[i]!;
    const a2 = a.pts[(i + 1) % a.pts.length]!;
    for (let j = 0; j < edges(b); j += 1) {
      best = Math.min(best, segmentDistance(a1, a2, b.pts[j]!, b.pts[(j + 1) % b.pts.length]!));
      if (best === 0) return 0;
    }
  }
  return best;
}

/** The clear space between two pieces of copper, mm. 0 when they touch or overlap. */
export function gap(a: Solid, b: Solid): number {
  const d = coreDistance(a, b) - a.r - b.r;
  return d < 1e-6 ? 0 : d;
}

/** A pad's copper where it sits on the board. */
export function padSolid(p: BoardPad): Solid {
  const { w, h, shape } = p.pad;
  const c = Math.cos(rad(p.angle));
  const s = Math.sin(rad(p.angle));
  const at = (x: number, y: number): P2 => [p.at[0] + x * c - y * s, p.at[1] + x * s + y * c];
  if (shape === "circle") return { pts: [p.at], r: Math.max(w, h) / 2 };
  if (shape === "oval") {
    const r = Math.min(w, h) / 2;
    const half = Math.max(w, h) / 2 - r;
    return half < 1e-6 ? { pts: [p.at], r } : { pts: w >= h ? [at(-half, 0), at(half, 0)] : [at(0, -half), at(0, half)], r };
  }
  const r = shape === "roundrect" ? Math.min(w, h) * (p.pad.round ?? 0.25) : 0;
  const x = w / 2 - r;
  const y = h / 2 - r;
  return { pts: [at(-x, -y), at(x, -y), at(x, y), at(-x, y)], r };
}

/** The layers a pad has copper on. */
export const padLayers = (p: BoardPad): Layer[] => (p.pad.kind === "thru" ? ["top", "bottom"] : p.pad.kind === "smd" ? [p.side] : []);

/**
 * Every piece of copper on the board. The pads come first, one each in the order of `pads` (a bare hole has no
 * copper but keeps its place, with no layers), then each track's pieces, then the vias and plated holes.
 */
export function copperOf(d: ElectronicsDesign, pads: BoardPad[] = boardPads(d)): Copper[] {
  const board = d.board;
  if (!board) return [];
  const out: Copper[] = pads.map((p) => ({
    ...padSolid(p),
    kind: "pad",
    net: p.net,
    layers: padLayers(p),
    id: p.part,
    what: `${p.ref} pad ${p.pad.number}`,
    at: p.at,
  }));
  for (const t of board.tracks) {
    if (t.layer !== "top" && t.layer !== "bottom") continue;
    for (let i = 0; i + 1 < t.pts.length; i += 1) {
      const a = t.pts[i]!;
      const b = t.pts[i + 1]!;
      out.push({
        pts: [a, b],
        r: t.width / 2,
        kind: "track",
        net: t.net,
        layers: [t.layer],
        id: t.id,
        segment: i,
        what: `a track on ${t.net || "no net"}`,
        at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      });
    }
  }
  for (const v of board.vias)
    out.push({
      pts: [[v.x, v.y]],
      r: v.diameter / 2,
      kind: "via",
      net: v.net,
      layers: ["top", "bottom"],
      id: v.id,
      what: `a via on ${v.net || "no net"}`,
      at: [v.x, v.y],
    });
  for (const h of board.holes)
    if (h.pad) out.push({ pts: [[h.x, h.y]], r: h.pad / 2, kind: "via", net: "", layers: ["top", "bottom"], id: h.id, what: "a plated hole", at: [h.x, h.y] });
  // Text written in copper (#642) is copper like any other: the same strokes the Gerber file draws.
  for (const t of board.texts) {
    if (!t.layer.startsWith("copper")) continue;
    const side = t.layer === "copper-bottom" ? "bottom" : "top";
    const cap = t.size * 0.72;
    for (const line of textStrokes(t.text, cap, [t.x, t.y], { angle: t.angle ?? 0, mirror: side === "bottom" }))
      for (let i = 0; i + 1 < line.length; i += 1)
        out.push({
          pts: [line[i]!, line[i + 1]!],
          r: penFor(cap) / 2,
          kind: "text",
          net: "",
          layers: [side],
          id: t.id,
          what: `the text "${t.text}"`,
          at: [t.x, t.y],
        });
  }
  return out;
}

const shares = (a: Copper, b: Copper): boolean => a.layers.some((l) => b.layers.includes(l));

/**
 * Which copper is joined to which: pieces of one net that touch on a layer they share are one group. The result gives
 * each piece its group, by its place in `copper`. `joined` lists pieces joined some other way, such as by a pour.
 */
export function copperGroups(copper: Copper[], joined: number[][] = []): number[] {
  const parent = copper.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const byNet = new Map<string, number[]>();
  copper.forEach((c, i) => {
    if (!c.net || !c.layers.length) return;
    if (!byNet.has(c.net)) byNet.set(c.net, []);
    byNet.get(c.net)!.push(i);
  });
  for (const list of byNet.values())
    for (let x = 0; x < list.length; x += 1)
      for (let y = x + 1; y < list.length; y += 1) {
        const a = copper[list[x]!]!;
        const b = copper[list[y]!]!;
        if (find(list[x]!) !== find(list[y]!) && shares(a, b) && gap(a, b) === 0) parent[find(list[x]!)] = find(list[y]!);
      }
  // Pieces something else joins, such as a pour: each list is one group.
  for (const list of joined) for (const i of list.slice(1)) parent[find(i)] = find(list[0]!);
  return copper.map((_, i) => find(i));
}

/** The width, clearance and via a net is routed with: its class's, else the board's own. */
export function netRules(
  board: Pick<Board, "rules" | "classes">,
  net: string,
): Pick<NetClass, "trackWidth" | "clearance"> & { viaDiameter: number; viaDrill: number } {
  const k = board.classes.find((c) => c.nets.includes(net));
  const r: Rules = board.rules;
  return {
    trackWidth: k?.trackWidth ?? r.trackWidth,
    clearance: k?.clearance ?? r.clearance,
    viaDiameter: k?.viaDiameter ?? r.viaDiameter,
    viaDrill: k?.viaDrill ?? r.viaDrill,
  };
}

/** The clearance two nets must keep from each other: the larger of the two. */
export const clearanceBetween = (board: Pick<Board, "rules" | "classes">, a: string, b: string): number =>
  Math.max(netRules(board, a).clearance, netRules(board, b).clearance);

/** The board's edge and cut-outs as closed runs of straight pieces. */
export function edgeLoops(board: Pick<Board, "outline" | "cutouts">): P2[][] {
  return [board.outline, ...(board.cutouts ?? [])].filter((o) => o.length > 1).map((o) => outlinePoints(o, 0.02));
}

/** How far a piece of copper is from the board's edge. Negative when it is over the edge or off the board. */
export function edgeGap(s: Solid, loops: P2[][]): number {
  if (!loops.length) return Infinity;
  let best = Infinity;
  for (const loop of loops)
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      for (let k = 0; k < Math.max(1, s.pts.length === 2 ? 1 : s.pts.length); k += 1)
        best = Math.min(best, s.pts.length === 1 ? distToSegment(s.pts[0]!, a, b) : segmentDistance(s.pts[k]!, s.pts[(k + 1) % s.pts.length]!, a, b));
    }
  const p = s.pts[0]!;
  const on = pointInPolygon(p, loops[0]!) && !loops.slice(1).some((hole) => pointInPolygon(p, hole));
  return on ? best - s.r : -(best + s.r);
}
