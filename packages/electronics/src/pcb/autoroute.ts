import { outlinePoints, ratsnest, type BoardPad } from "../board";
import { key, q } from "../geom";
import type { Board, ElectronicsDesign, Id, P2 } from "../model";
import { edgeLoops, netRules, padLayers, padSolid, type Copper, type Layer } from "./copper";
import { applyRoutes, blockers, corner45, tidyRun, type Route } from "./route";

export { applyRoutes, type Route };
import { boardState } from "./state";

/**
 * The autorouter (#647): routes the connections still to make, the short ones first, on a fine grid over both sides
 * of the board. It is our own maze router, made for simple boards and for finishing off. It only ever adds copper:
 * tracks and vias already on the board stay where they are, and every run it lays is measured against the rules
 * the same way a track drawn by hand is.
 */
export interface RouteProgress {
  /** Connections tried so far, of `total`. */
  done: number;
  total: number;
  routed: number;
  failed: number;
  /** The net just tried, and what was laid for it. None: it found no way through. */
  net: string;
  route?: Route;
}

export interface AutorouteOptions {
  /** Only these nets. None: every net. */
  nets?: string[];
  /** Only connections to these parts. */
  parts?: Id[];
  /** The sides it may route on. None: both. */
  layers?: Layer[];
  /** The grid's step, mm. None: 0.125 mm, coarser on a very large board. */
  pitch?: number;
  /** What a via costs, as mm of track. */
  viaCost?: number;
  onProgress?: (p: RouteProgress) => void;
}

export interface AutorouteResult {
  /** The board with the routes laid. */
  design: ElectronicsDesign;
  routes: Route[];
  routed: number;
  /** Connections it found no way to make. */
  failed: { net: string; a: P2; b: P2 }[];
  total: number;
}

const BIG = 1e9;
const LAYERS: Layer[] = ["top", "bottom"];
/** The eight ways on, and the way back for each. */
const DIRS: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** Distance from a point to a core: a point, a line or a convex outline (0 inside it). */
function coreDist(pts: P2[], x: number, y: number): number {
  if (pts.length === 1) return Math.hypot(x - pts[0]![0], y - pts[0]![1]);
  let best = Infinity;
  let inside = pts.length > 2;
  const n = pts.length === 2 ? 1 : pts.length;
  let turn = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)));
    if (inside) {
      const side = Math.sign(dx * (y - a[1]) - dy * (x - a[0]));
      if (side && turn && side !== turn) inside = false;
      if (side) turn = side;
    }
  }
  return inside ? 0 : best;
}

/** The space each net class sees round every cell: how much copper could sit there, centred on it. */
interface Space {
  width: number;
  clearance: number;
  viaR: number;
  viaDrill: number;
  /** The least space, and the net whose copper sets it; then the least space left by every other net. */
  v1: Float32Array;
  v2: Float32Array;
  own: Uint16Array;
  /** How much of the copper list is drawn into it. */
  upto: number;
}

interface Near {
  pts: P2[];
  r: number;
  /** A drilled hole, kept clear by the hole rule; else a pad, which a via must not sit on. */
  hole: boolean;
}

/** A binary heap of nodes by cost. */
class Heap {
  private ids: number[] = [];
  private costs: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, cost: number) {
    const { ids, costs } = this;
    let i = ids.length;
    ids.push(id);
    costs.push(cost);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (costs[up]! <= cost) break;
      ids[i] = ids[up]!;
      costs[i] = costs[up]!;
      i = up;
    }
    ids[i] = id;
    costs[i] = cost;
  }
  pop(): number {
    const { ids, costs } = this;
    const top = ids[0]!;
    const id = ids.pop()!;
    const cost = costs.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        let kid = 2 * i + 1;
        if (kid >= n) break;
        if (kid + 1 < n && costs[kid + 1]! < costs[kid]!) kid += 1;
        if (costs[kid]! >= cost) break;
        ids[i] = ids[kid]!;
        costs[i] = costs[kid]!;
        i = kid;
      }
      ids[i] = id;
      costs[i] = cost;
    }
    return top;
  }
}

/** One board being routed: its grid, the space on it, and the search. */
class Router {
  readonly board: Board;
  readonly pitch: number;
  private x0: number;
  private y0: number;
  private nx: number;
  private ny: number;
  private n: number;
  private loops: P2[][];
  private inside: Uint8Array;
  /** The net of the pour over each cell, a side at a time; 0 for none. */
  private pour: Uint16Array;
  private netIds = new Map<string, number>([["", 0]]);
  private spaces = new Map<string, Space>();
  private near = new Map<number, Near[]>();
  private allowed: boolean[];
  private viaCost: number;
  // The search's own arrays, kept between searches; `mark` says which search a cell's numbers belong to.
  private cost: Float32Array;
  private from: Int32Array;
  private dir: Int8Array;
  private mark: Uint32Array;
  private shut: Uint32Array;
  private run = 0;

  constructor(
    d: ElectronicsDesign,
    readonly pads: BoardPad[],
    readonly copper: Copper[],
    opts: AutorouteOptions,
  ) {
    const board = (this.board = d.board!);
    this.loops = edgeLoops(board);
    let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of this.loops[0] ?? []) {
      x1 = Math.min(x1, p[0]);
      y1 = Math.min(y1, p[1]);
      x2 = Math.max(x2, p[0]);
      y2 = Math.max(y2, p[1]);
    }
    if (!Number.isFinite(x1)) [x1, y1, x2, y2] = [0, 0, 0, 0];
    let pitch = opts.pitch ?? 0.125;
    // A very large board is routed on a coarser grid, so the search stays quick and small.
    if (!opts.pitch) while (((x2 - x1) / pitch) * ((y2 - y1) / pitch) > 1.3e6) pitch *= 2;
    this.pitch = pitch;
    this.x0 = x1;
    this.y0 = y1;
    this.nx = Math.max(1, Math.floor((x2 - x1) / pitch + 1e-9) + 1);
    this.ny = Math.max(1, Math.floor((y2 - y1) / pitch + 1e-9) + 1);
    const n = (this.n = this.nx * this.ny);
    this.allowed = LAYERS.map((l) => !opts.layers || opts.layers.includes(l));
    this.viaCost = opts.viaCost ?? 4;
    this.cost = new Float32Array(2 * n + 1);
    this.from = new Int32Array(2 * n + 1);
    this.dir = new Int8Array(2 * n + 1);
    this.mark = new Uint32Array(2 * n + 1);
    this.shut = new Uint32Array(2 * n + 1);

    this.inside = new Uint8Array(n);
    this.fill(this.loops, (i) => (this.inside[i] = 1));
    this.pour = new Uint16Array(2 * n);
    for (const p of [...board.pours].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))) {
      const l = LAYERS.indexOf(p.layer as Layer);
      if (l >= 0 && p.net) this.fill([p.outline], (i) => (this.pour[l * n + i] = this.netId(p.net)));
    }
    for (const p of pads) {
      this.addNear({ ...padSolid(p), hole: false });
      if (p.pad.drill) this.addNear({ pts: [p.at], r: Math.max(p.pad.drill, p.pad.slot ?? 0) / 2, hole: true });
    }
    for (const v of board.vias) this.addNear({ pts: [[v.x, v.y]], r: v.drill / 2, hole: true });
    for (const h of board.holes) this.addNear({ pts: [[h.x, h.y]], r: h.drill / 2, hole: true });
  }

  private netId(net: string): number {
    let id = this.netIds.get(net);
    if (id === undefined) this.netIds.set(net, (id = this.netIds.size));
    return id;
  }

  private px = (i: number) => q(this.x0 + (i % this.nx) * this.pitch);
  private py = (i: number) => q(this.y0 + Math.floor(i / this.nx) * this.pitch);

  /** Calls `set` for every cell inside closed outlines; an outline inside another is a hole in it. */
  private fill(loops: P2[][], set: (cell: number) => void) {
    for (let j = 0; j < this.ny; j += 1) {
      const y = this.y0 + j * this.pitch + 1e-7;
      const xs: number[] = [];
      for (const loop of loops)
        for (let i = 0; i < loop.length; i += 1) {
          const a = loop[i]!;
          const b = loop[(i + 1) % loop.length]!;
          if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil((xs[k]! - this.x0) / this.pitch - 1e-9));
        const to = Math.min(this.nx - 1, Math.floor((xs[k + 1]! - this.x0) / this.pitch + 1e-9));
        for (let i = from; i <= to; i += 1) set(j * this.nx + i);
      }
    }
  }

  private bucket = (x: number, y: number) => Math.floor(x / 2) * 100003 + Math.floor(y / 2);

  private addNear(item: Near) {
    let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of item.pts) {
      x1 = Math.min(x1, p[0]);
      y1 = Math.min(y1, p[1]);
      x2 = Math.max(x2, p[0]);
      y2 = Math.max(y2, p[1]);
    }
    const by = item.r + 3;
    for (let x = Math.floor((x1 - by) / 2); x <= Math.floor((x2 + by) / 2); x += 1)
      for (let y = Math.floor((y1 - by) / 2); y <= Math.floor((y2 + by) / 2); y += 1) {
        const k = x * 100003 + y;
        if (!this.near.has(k)) this.near.set(k, []);
        this.near.get(k)!.push(item);
      }
  }

  /** Draws one piece into a class's space: every cell near it learns how close it is. */
  private stamp(s: Space, layers: number[], pts: P2[], r: number, need: number, net: number) {
    // Two cells with room for a track have room all the way between them only with a little to spare: copper
    // level with the middle of the step is nearer the track than it is to either end.
    const far = r + need + s.width / 2;
    const spare = Math.sqrt(far * far + this.pitch * this.pitch * 0.5) - far;
    const most = Math.max(s.width / 2, s.viaR);
    const reach = r + need + spare + most;
    let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pts) {
      x1 = Math.min(x1, p[0]);
      y1 = Math.min(y1, p[1]);
      x2 = Math.max(x2, p[0]);
      y2 = Math.max(y2, p[1]);
    }
    const i1 = Math.max(0, Math.ceil((x1 - reach - this.x0) / this.pitch));
    const i2 = Math.min(this.nx - 1, Math.floor((x2 + reach - this.x0) / this.pitch));
    const j1 = Math.max(0, Math.ceil((y1 - reach - this.y0) / this.pitch));
    const j2 = Math.min(this.ny - 1, Math.floor((y2 + reach - this.y0) / this.pitch));
    for (let j = j1; j <= j2; j += 1)
      for (let i = i1; i <= i2; i += 1) {
        const v = coreDist(pts, this.x0 + i * this.pitch, this.y0 + j * this.pitch) - r - need - spare;
        if (v >= most) continue;
        for (const l of layers) {
          const c = l * this.n + j * this.nx + i;
          if (s.own[c] === net) s.v1[c] = Math.min(s.v1[c]!, v);
          else if (v < s.v1[c]!) {
            s.v2[c] = s.v1[c]!;
            s.v1[c] = v;
            s.own[c] = net;
          } else if (v < s.v2[c]!) s.v2[c] = v;
        }
      }
  }

  /** The space a net routes in, brought up to date with the copper laid so far. */
  private space(net: string): Space {
    const r = netRules(this.board, net);
    const id = `${r.trackWidth}|${r.clearance}|${r.viaDiameter}|${r.viaDrill}`;
    let s = this.spaces.get(id);
    if (!s) {
      const size = 2 * this.n;
      s = {
        width: r.trackWidth,
        clearance: r.clearance,
        viaR: r.viaDiameter / 2,
        viaDrill: r.viaDrill,
        v1: new Float32Array(size).fill(BIG),
        v2: new Float32Array(size).fill(BIG),
        own: new Uint16Array(size),
        upto: 0,
      };
      this.spaces.set(id, s);
      for (let c = 0; c < this.n; c += 1) if (!this.inside[c]) s.v1[c] = s.v1[this.n + c] = -BIG;
      for (const loop of this.loops)
        for (let i = 0; i < loop.length; i += 1) this.stamp(s, [0, 1], [loop[i]!, loop[(i + 1) % loop.length]!], 0, this.board.rules.copperToEdge, 0);
      for (const k of this.board.keepouts) if (k.tracks) this.keepOut(s, k.outline);
    }
    for (; s.upto < this.copper.length; s.upto += 1) {
      const c = this.copper[s.upto]!;
      const layers = c.layers.map((l) => LAYERS.indexOf(l)).filter((l) => l >= 0);
      if (layers.length) this.stamp(s, layers, c.pts, c.r, Math.max(s.clearance, netRules(this.board, c.net).clearance), this.netId(c.net));
    }
    return s;
  }

  /** A keep-out may be any shape, so its inside is filled and its edge drawn a line at a time. */
  private keepOut(s: Space, outline: P2[]) {
    this.fill([outline], (c) => {
      for (const l of [0, 1]) {
        s.v1[l * this.n + c] = -BIG;
        s.own[l * this.n + c] = 0;
      }
    });
    for (let i = 0; i < outline.length; i += 1) this.stamp(s, [0, 1], [outline[i]!, outline[(i + 1) % outline.length]!], 0, 0.01, 0);
  }

  /** Whether a via may be drilled at a cell: clear of other holes, and not on top of a pad. */
  private viaClear(s: Space, x: number, y: number): boolean {
    for (const it of this.near.get(this.bucket(x, y)) ?? []) {
      const g = coreDist(it.pts, x, y) - it.r;
      if (g < (it.hole ? s.viaDrill / 2 + this.board.rules.holeToHole : s.viaR) + 1e-3) return false;
    }
    return true;
  }

  /** The cells near a pad a track can reach from its middle, each with the short run that gets there. */
  private ways(s: Space, net: string, netId: number, pad: BoardPad, local: Copper[]): Map<number, { pts: P2[]; cost: number }> {
    const out = new Map<number, { pts: P2[]; cost: number }>();
    const reach = Math.max(3 * this.pitch, 0.4);
    const ci = Math.round((pad.at[0] - this.x0) / this.pitch);
    const cj = Math.round((pad.at[1] - this.y0) / this.pitch);
    const span = Math.ceil(reach / this.pitch);
    for (const layer of padLayers(pad)) {
      const l = LAYERS.indexOf(layer);
      if (!this.allowed[l]) continue;
      for (let j = Math.max(0, cj - span); j <= Math.min(this.ny - 1, cj + span); j += 1)
        for (let i = Math.max(0, ci - span); i <= Math.min(this.nx - 1, ci + span); i += 1) {
          const cell = j * this.nx + i;
          const node = l * this.n + cell;
          if ((s.own[node] === netId ? s.v2[node]! : s.v1[node]!) < s.width / 2) continue;
          const to: P2 = [this.px(cell), this.py(cell)];
          if (Math.hypot(to[0] - pad.at[0], to[1] - pad.at[1]) > reach) continue;
          for (const first of [false, true]) {
            const pts = corner45(pad.at, to, first);
            if (pts.length > 1 && blockers(this.board, local, this.loops, { net, layers: [layer], pts, width: s.width }).length) continue;
            const cost = pts.slice(1).reduce((sum, p, k) => sum + Math.hypot(p[0] - pts[k]![0], p[1] - pts[k]![1]), 0) * 1.2;
            if (!out.has(node) || out.get(node)!.cost > cost) out.set(node, { pts, cost });
            break;
          }
        }
    }
    return out;
  }

  /** The copper near a point, for measuring the short runs at a pad. */
  private around(at: P2, by: number): Copper[] {
    return this.copper.filter(
      (c) => c.pts.some((p) => Math.abs(p[0] - at[0]) < by + c.r && Math.abs(p[1] - at[1]) < by + c.r) || coreDist(c.pts, at[0], at[1]) < by + c.r,
    );
  }

  /** Finds a way from one pad to another and lays it into the copper list. Null: there is none. */
  route(net: string, a: BoardPad, b: BoardPad): Route | null {
    const s = this.space(net);
    const netId = this.netId(net);
    const { n, nx, ny, pitch } = this;
    const starts = this.ways(s, net, netId, a, this.around(a.at, 3));
    const ends = this.ways(s, net, netId, b, this.around(b.at, 3));
    if (!starts.size || !ends.size) return null;
    const run = (this.run += 1);
    const { cost, from, dir, mark, shut } = this;
    const GOAL = 2 * n;
    const heap = new Heap();
    const slack = Math.max(3 * pitch, 0.4) * 1.5;
    const guess = (node: number): number => {
      const cell = node >= n ? node - n : node;
      const dx = Math.abs(this.x0 + (cell % nx) * pitch - b.at[0]);
      const dy = Math.abs(this.y0 + Math.floor(cell / nx) * pitch - b.at[1]);
      return Math.max(0, Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy) - slack);
    };
    const reach = (node: number, c: number, parent: number, way: number) => {
      if (shut[node] === run || (mark[node] === run && cost[node]! <= c)) return;
      mark[node] = run;
      cost[node] = c;
      from[node] = parent;
      dir[node] = way;
      heap.push(node, c + (node === GOAL ? 0 : guess(node)));
    };
    for (const [node, w] of starts) reach(node, w.cost, -1, -1);
    const free = (node: number) => (s.own[node] === netId ? s.v2[node]! : s.v1[node]!);
    let found = false;
    while (heap.size) {
      const node = heap.pop();
      if (shut[node] === run) continue;
      shut[node] = run;
      if (node === GOAL) {
        found = true;
        break;
      }
      const c = cost[node]!;
      const end = ends.get(node);
      if (end) reach(GOAL, c + end.cost, node, -1);
      const l = node >= n ? 1 : 0;
      const cell = node - l * n;
      const i = cell % nx;
      const j = (cell - i) / nx;
      for (let k = 0; k < 8; k += 1) {
        const ii = i + DIRS[k]![0];
        const jj = j + DIRS[k]![1];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const next = l * n + jj * nx + ii;
        if (shut[next] === run || free(next) < s.width / 2) continue;
        const over = this.pour[next]!;
        const step = (k & 1 ? 1.41421356 : 1) * pitch * (over && over !== netId ? 2 : 1);
        reach(next, c + step + (dir[node] === k || dir[node] === -1 ? 0 : 0.3 * pitch), node, k);
      }
      // Through to the other side.
      const other = (1 - l) * n + cell;
      if (this.allowed[1 - l] && shut[other] !== run && free(node) >= s.viaR && free(other) >= s.viaR && this.viaClear(s, this.px(cell), this.py(cell)))
        reach(other, c + this.viaCost, node, -1);
    }
    if (!found) return null;

    // Back along the way it came, a side at a time.
    const nodes: number[] = [];
    for (let at = from[GOAL]!; at >= 0; at = from[at]!) nodes.push(at);
    nodes.reverse();
    const route: Route = { net, tracks: [], vias: [] };
    let pts: P2[] = [...starts.get(nodes[0]!)!.pts];
    nodes.forEach((node, k) => {
      const l = node >= n ? 1 : 0;
      const cell = node - l * n;
      const p: P2 = [this.px(cell), this.py(cell)];
      const before = nodes[k - 1];
      if (before !== undefined && (before >= n ? 1 : 0) !== l) {
        route.tracks.push({ layer: LAYERS[1 - l]!, pts });
        route.vias.push(p);
        pts = [];
      }
      pts.push(p);
    });
    const lastLayer = LAYERS[nodes[nodes.length - 1]! >= n ? 1 : 0]!;
    pts.push(...[...ends.get(nodes[nodes.length - 1]!)!.pts].reverse());
    route.tracks.push({ layer: lastLayer, pts });
    route.tracks = route.tracks.map((t) => ({ layer: t.layer, pts: tidyRun(t.pts) })).filter((t) => t.pts.length > 1);

    // Measured the way a track drawn by hand is, before it is kept.
    const rules = netRules(this.board, net);
    for (const t of route.tracks) if (blockers(this.board, this.copper, this.loops, { net, layers: [t.layer], pts: t.pts, width: s.width }).length) return null;
    for (const v of route.vias)
      if (blockers(this.board, this.copper, this.loops, { net, layers: LAYERS, pts: [v], width: rules.viaDiameter }).length) return null;

    for (const t of route.tracks)
      for (let k = 0; k + 1 < t.pts.length; k += 1)
        this.copper.push({
          pts: [t.pts[k]!, t.pts[k + 1]!],
          r: s.width / 2,
          kind: "track",
          net,
          layers: [t.layer],
          id: "",
          what: `a track on ${net}`,
          at: t.pts[k]!,
        });
    for (const v of route.vias) {
      this.copper.push({ pts: [v], r: rules.viaDiameter / 2, kind: "via", net, layers: LAYERS, id: "", what: `a via on ${net}`, at: v });
      this.addNear({ pts: [v], r: rules.viaDrill / 2, hole: true });
    }
    return route;
  }
}

/** The connections still to make that the options ask for, the short ones first, each with its two pads. */
function wanted(pads: BoardPad[], joined: (p: BoardPad, i: number) => number, opts: AutorouteOptions) {
  const at = new Map<string, BoardPad>();
  for (const p of pads) if (p.net && p.pad.kind !== "npth" && !at.has(`${p.net}|${key(p.at[0], p.at[1])}`)) at.set(`${p.net}|${key(p.at[0], p.at[1])}`, p);
  const nets = opts.nets && new Set(opts.nets);
  const parts = opts.parts && new Set(opts.parts);
  return ratsnest(pads, joined)
    .map((air) => ({ air, a: at.get(`${air.net}|${key(air.a[0], air.a[1])}`), b: at.get(`${air.net}|${key(air.b[0], air.b[1])}`) }))
    .filter((w): w is { air: typeof w.air; a: BoardPad; b: BoardPad } => !!w.a && !!w.b)
    .filter((w) => (!nets || nets.has(w.air.net)) && (!parts || parts.has(w.a.part) || parts.has(w.b.part)))
    .sort((x, y) => Math.hypot(x.air.a[0] - x.air.b[0], x.air.a[1] - x.air.b[1]) - Math.hypot(y.air.a[0] - y.air.b[0], y.air.a[1] - y.air.b[1]));
}

/** Routes the connections still to make. Those it finds no way for are left as they were, and listed. */
export function autoroute(d: ElectronicsDesign, opts: AutorouteOptions = {}): AutorouteResult {
  const out: AutorouteResult = { design: d, routes: [], routed: 0, failed: [], total: 0 };
  if (!d.board || outlinePoints(d.board.outline).length < 3) return out;
  const tried = new Set<string>();
  let done = 0;
  // A track through a pour can cut it in two, leaving a new connection to make: so it looks again, a few times.
  for (let pass = 0; pass < 3; pass += 1) {
    const state = boardState(out.design);
    const todo = wanted(state.pads, state.joined, opts).filter((w) => !tried.has(`${w.air.net}|${key(w.air.a[0], w.air.a[1])}|${key(w.air.b[0], w.air.b[1])}`));
    if (!todo.length) break;
    out.total += todo.length;
    const router = new Router(out.design, state.pads, [...state.copper], opts);
    for (const w of todo) {
      tried.add(`${w.air.net}|${key(w.air.a[0], w.air.a[1])}|${key(w.air.b[0], w.air.b[1])}`);
      const route = router.route(w.air.net, w.a, w.b);
      done += 1;
      if (route) {
        out.routes.push(route);
        out.routed += 1;
        out.design = applyRoutes(out.design, [route]);
      } else out.failed.push({ net: w.air.net, a: w.air.a, b: w.air.b });
      opts.onProgress?.({ done, total: out.total, routed: out.routed, failed: out.failed.length, net: w.air.net, ...(route ? { route } : {}) });
    }
  }
  // A connection that failed and was then made another way round is no longer one to report.
  if (out.failed.length) {
    const state = boardState(out.design);
    const left = new Set(wanted(state.pads, state.joined, {}).map((w) => w.air.net));
    out.failed = out.failed.filter((f) => left.has(f.net));
  }
  return out;
}
