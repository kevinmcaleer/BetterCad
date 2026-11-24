import { eid, type Corner, type ElectronicsDesign, type P2, type Part, type Track } from "./model";
import { pinKey, type Netlist } from "./nets";
import { area } from "./outlineGeom";

/**
 * What the readers of other tools' boards share (#663, #665): counting what was left out, closing the lines of an
 * edge into outlines, and joining straight pieces of track into runs.
 */

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;

/** Counts things of one kind for a note: "3 buses". */
export class Tally {
  private n = new Map<string, number>();
  add(what: string, by = 1) {
    this.n.set(what, (this.n.get(what) ?? 0) + by);
  }
  each(): [string, number][] {
    return [...this.n.entries()];
  }
}

export interface Edge {
  a: P2;
  b: P2;
  /** tan(sweep / 4) from a to b, positive anticlockwise. */
  bulge: number;
}

/** Joins edges end to end into closed loops, anticlockwise. Edges that close nothing are counted in `open`. */
export function loopsOf(edges: Edge[]): { loops: Corner[][]; open: number } {
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

export const loopArea = (loop: Corner[]): number => {
  if (loop.length > 2) return Math.abs(area(loop.map((c): P2 => [c.x, c.y])));
  const d = loop.length === 2 ? Math.hypot(loop[0]!.x - loop[1]!.x, loop[0]!.y - loop[1]!.y) : 0;
  return (Math.PI * d * d) / 4;
};

export interface Run {
  net: string;
  layer: "top" | "bottom";
  width: number;
  pieces: [P2, P2][];
}

/** Tracks from straight pieces: pieces of one net, side and width that run on from each other are joined. */
export function joinRuns(runs: Iterable<Run>): Track[] {
  const tracks: Track[] = [];
  const k = (p: P2) => `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)}`;
  for (const run of runs) {
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
      tracks.push({ id: eid("t"), net: run.net, layer: run.layer, width: run.width, pts });
    }
  }
  return tracks;
}

/**
 * The board's nets carry the other tool's names; ours come from the schematic. A pad that is on both says which is
 * which: each of the board's names goes to the net of ours most of its pads are on. `split` counts the board's nets
 * whose pads sit on more than one of ours.
 */
export function matchNets(
  design: ElectronicsDesign,
  nl: Netlist,
  byRef: Map<string, Part>,
  padNets: Map<string, Map<string, string>>,
): { ours: (name: string) => string; split: number } {
  const votes = new Map<string, Map<string, number>>();
  for (const [ref, nets] of padNets) {
    const part = byRef.get(ref);
    const def = part && design.defs[part.def];
    if (!part || !def) continue;
    for (const pin of def.symbol.pins) {
      const mine = nl.of.get(pinKey(part.id, pin.number));
      for (const pad of def.packages[part.pkg]?.pinMap?.[pin.number] ?? [pin.number]) {
        const theirs = nets.get(pad);
        if (!theirs || !mine) continue;
        if (!votes.has(theirs)) votes.set(theirs, new Map());
        votes.get(theirs)!.set(mine, (votes.get(theirs)!.get(mine) ?? 0) + 1);
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
  return { ours: (name) => rename.get(name) ?? name, split };
}
