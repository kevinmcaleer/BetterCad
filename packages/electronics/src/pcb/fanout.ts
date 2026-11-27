/**
 * Fan-out (#746): a fine-pitch chip's pads are too close together for the router to find its way out between them,
 * so each pad that still has a connection to make gets a short track straight out from the chip, or out and across at
 * 45°, and a via at its end. Pads next to each other put their vias at different distances, so the vias clear each
 * other. Every piece is measured against the rules the way a track drawn by hand is, and a pad with no room is left.
 */
import { ratsnest, type BoardPad } from "../board";
import { key, q, rad } from "../geom";
import type { ElectronicsDesign, Id, P2 } from "../model";
import { edgeLoops, netRules, type Copper } from "./copper";
import { applyRoutes, blockers, type Route } from "./route";
import { layersOf } from "./stack";
import { boardState } from "./state";

export interface FanOutResult {
  design: ElectronicsDesign;
  /** Pads given a via. */
  fanned: number;
  /** Pads that needed one but had no room. */
  stuck: { part: Id; pad: string }[];
  /** What was laid, as routes the page can lay as one step. */
  routes: Route[];
}

/** The smallest via the board's rules allow: its least hole with the least ring round it, never bigger than the net's. */
const least = (board: NonNullable<ElectronicsDesign["board"]>, rules: ReturnType<typeof netRules>) => {
  const diameter = q(board.rules.minDrill + 2 * board.rules.minRing);
  return diameter < rules.viaDiameter ? { diameter, drill: board.rules.minDrill } : { diameter: rules.viaDiameter, drill: rules.viaDrill };
};

interface Found {
  track: P2[];
  via: P2;
  size: { diameter: number; drill: number };
}

/** How far past the pad's end the via may go, mm, nearest first. */
const STEPS = [0.15, 0.3, 0.45, 0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

/** A piece of copper as the rules see it, for measuring what comes after. */
const piece = (net: string, layers: Copper["layers"], pts: P2[], r: number, kind: Copper["kind"]): Copper => ({
  pts,
  r,
  kind,
  net,
  layers,
  id: "",
  what: kind === "via" ? `a via on ${net}` : `a track on ${net}`,
  at: pts[0]!,
});

/**
 * Fans out the surface pads of `parts` that still have a connection to make: a short track from each and a via at
 * its end. `only` narrows it to some pads, by their place on the board.
 */
export function fanOut(d: ElectronicsDesign, parts: Id[], only?: P2[]): FanOutResult {
  const board = d.board;
  const out: FanOutResult = { design: d, fanned: 0, stuck: [], routes: [] };
  if (!board) return out;
  const state = boardState(d);
  const want = new Set(ratsnest(state.pads, state.joined).flatMap((a) => [key(a.a[0], a.a[1]), key(a.b[0], a.b[1])]));
  const picked = only && new Set(only.map((p) => key(p[0], p[1])));
  const all = layersOf(board);
  const loops = edgeLoops(board);
  // Every hole on the board, for the gap between drills.
  const drilled: { at: P2; r: number }[] = [
    ...state.pads.flatMap((p) => (p.pad.drill && p.pad.kind !== "smd" ? [{ at: p.at, r: Math.max(p.pad.drill, p.pad.slot ?? 0) / 2 }] : [])),
    ...board.vias.map((v) => ({ at: [v.x, v.y] as P2, r: v.drill / 2 })),
    ...board.holes.map((h) => ({ at: [h.x, h.y] as P2, r: h.drill / 2 })),
  ];
  // What has been laid so far, by pad; the copper and holes to measure against follow from it.
  const laid = new Map<BoardPad, Found>();
  const around = () => {
    const copper: Copper[] = [...state.copper];
    const holes = [...drilled];
    for (const [p, f] of laid) {
      const r = netRules(board, p.net);
      for (let k = 0; k + 1 < f.track.length; k += 1) copper.push(piece(p.net, [p.side], [f.track[k]!, f.track[k + 1]!], r.trackWidth / 2, "track"));
      copper.push(piece(p.net, all, [f.via], f.size.diameter / 2, "via"));
      holes.push({ at: f.via, r: f.size.drill / 2 });
    }
    return { copper, holes };
  };
  const tryPad = (p: BoardPad, centre: P2, small: boolean): boolean => {
    const way = fan(p, centre);
    if (!way) return false;
    const { copper, holes } = around();
    const rules = netRules(board, p.net);
    const size = small ? least(board, rules) : { diameter: rules.viaDiameter, drill: rules.viaDrill };
    const found = place(p, way, rules, size, board, copper, loops, holes, all);
    if (found) laid.set(p, { ...found, size });
    return !!found;
  };
  /** One chip's pads, round it in order; then each pad left with no room again, before its neighbours. */
  const fanPart = (todo: BoardPad[], centre: P2, small: boolean): BoardPad[] => {
    const stuck = todo.filter((p) => !tryPad(p, centre, small));
    const left: BoardPad[] = [];
    for (const p of stuck) {
      let done = false;
      const near = todo
        .filter((x) => laid.has(x))
        .sort((a, b) => Math.hypot(a.at[0] - p.at[0], a.at[1] - p.at[1]) - Math.hypot(b.at[0] - p.at[0], b.at[1] - p.at[1]))
        .slice(0, 3);
      // One neighbour at a time, then the two nearest together: a pad between two vias needs both to move.
      const sets = [...near.map((x) => [x]), near.slice(0, 2)].filter((g) => g.length);
      for (const group of sets) {
        const was = group.map((x) => [x, laid.get(x)!] as const);
        for (const x of group) laid.delete(x);
        if (tryPad(p, centre, small) && group.every((x) => tryPad(x, centre, small))) {
          done = true;
          break;
        }
        for (const x of [p, ...group]) laid.delete(x);
        for (const [x, f] of was) laid.set(x, f);
      }
      if (!done) left.push(p);
    }
    return left;
  };
  for (const part of parts) {
    const mine = state.pads.filter((p) => p.part === part);
    if (!mine.length) continue;
    const centre: P2 = [mine.reduce((a, p) => a + p.at[0], 0) / mine.length, mine.reduce((a, p) => a + p.at[1], 0) / mine.length];
    const todo = mine
      .filter(
        (p) =>
          p.pad.kind === "smd" &&
          p.net &&
          want.has(key(p.at[0], p.at[1])) &&
          (!picked || picked.has(key(p.at[0], p.at[1]))) &&
          // A pad a track already leaves from has its way out.
          !board.tracks.some((t) => t.net === p.net && [t.pts[0]!, t.pts[t.pts.length - 1]!].some((e) => key(e[0], e[1]) === key(p.at[0], p.at[1]))),
      )
      .sort((a, b) => Math.atan2(a.at[1] - centre[1], a.at[0] - centre[0]) - Math.atan2(b.at[1] - centre[1], b.at[0] - centre[0]));
    let left = fanPart(todo, centre, false);
    // A pitch too fine for the net's vias: the whole chip again with the smallest via the board's rules allow.
    if (left.length && todo.some((p) => least(board, netRules(board, p.net)).diameter < netRules(board, p.net).viaDiameter - 1e-6)) {
      const before = new Map(todo.flatMap((p) => (laid.has(p) ? [[p, laid.get(p)!] as const] : [])));
      for (const p of todo) laid.delete(p);
      const again = fanPart(todo, centre, true);
      if (again.length <= left.length) left = again;
      else {
        for (const p of todo) laid.delete(p);
        for (const [p, f] of before) laid.set(p, f);
      }
    }
    for (const p of left) out.stuck.push({ part, pad: p.pad.number });
  }
  let design = d;
  for (const [p, f] of laid) {
    const r = netRules(board, p.net);
    const own = f.size.diameter === r.viaDiameter && f.size.drill === r.viaDrill;
    out.routes.push({ net: p.net, tracks: [{ layer: p.side, pts: f.track }], vias: [f.via], ...(own ? {} : { viaSize: f.size }) });
  }
  design = applyRoutes(design, out.routes);
  out.fanned = laid.size;
  out.design = design;
  return out;
}

/** The way out of a pad: along its long side, away from the chip's middle, and how far its copper reaches that way. */
function fan(p: BoardPad, centre: P2): { u: P2; edge: number; centre: P2 } | null {
  const away: P2 = [p.at[0] - centre[0], p.at[1] - centre[1]];
  if (Math.hypot(away[0], away[1]) < 0.1) return null;
  const a = rad(p.angle);
  const along: P2 = p.pad.w >= p.pad.h ? [Math.cos(a), Math.sin(a)] : [-Math.sin(a), Math.cos(a)];
  const across: P2 = [-along[1], along[0]];
  // A pad as long as it is wide goes whichever of its sides faces most outward.
  const pick = Math.abs(p.pad.w - p.pad.h) < 1e-6 && Math.abs(dot(across, away)) > Math.abs(dot(along, away)) ? across : along;
  const u: P2 = dot(pick, away) >= 0 ? pick : [-pick[0], -pick[1]];
  return { u, centre, edge: (pick === along ? Math.max(p.pad.w, p.pad.h) : Math.min(p.pad.w, p.pad.h)) / 2 };
}

const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];

/** The nearest place for a pad's via that keeps every rule: straight out first, then out and across at 45°. */
function place(
  p: BoardPad,
  way: { u: P2; edge: number; centre: P2 },
  rules: ReturnType<typeof netRules>,
  size: { diameter: number; drill: number },
  board: NonNullable<ElectronicsDesign["board"]>,
  copper: Copper[],
  loops: P2[][],
  holes: { at: P2; r: number }[],
  all: Copper["layers"],
): { track: P2[]; via: P2 } | null {
  const { edge } = way;
  const base = edge + size.diameter / 2;
  // Outward first; then in, under the chip, where a dual row or a quad with no centre pad has room. Taking turns
  // between the two is what gives a fine pitch room for its vias.
  for (const step of STEPS)
    for (const u of [way.u, [-way.u[0], -way.u[1]] as P2]) {
      const n: P2 = [-u[1], u[0]];
      // A slant goes first toward the end of the pad's row, so the tracks spread out like a fan.
      const a = Math.sign(n[0] * (p.at[0] - way.centre[0]) + n[1] * (p.at[1] - way.centre[1])) || 1;
      for (const [side, from] of [
        [0, "edge"],
        [a, "edge"],
        [-a, "edge"],
        [a, "middle"],
        [-a, "middle"],
      ] as const) {
        const out = base + step;
        // Straight out; out to just past the pad, then across at 45°; or at 45° from the pad's middle, which keeps a
        // corner pad's track clear of the vias beside it.
        const bend: P2 = [p.at[0] + u[0] * (edge + rules.trackWidth), p.at[1] + u[1] * (edge + rules.trackWidth)];
        const slant = out - edge - rules.trackWidth;
        const via: P2 =
          from === "middle"
            ? [q(p.at[0] + (u[0] + n[0] * side) * out), q(p.at[1] + (u[1] + n[1] * side) * out)]
            : side
              ? [q(bend[0] + (u[0] + n[0] * side) * slant), q(bend[1] + (u[1] + n[1] * side) * slant)]
              : [q(p.at[0] + u[0] * out), q(p.at[1] + u[1] * out)];
        const track: P2[] = side && from === "edge" ? [p.at, [q(bend[0]), q(bend[1])], via] : [p.at, via];
        if (holes.some((h) => Math.hypot(h.at[0] - via[0], h.at[1] - via[1]) - h.r - size.drill / 2 < board.rules.holeToHole - 1e-6)) continue;
        if (blockers(board, copper, loops, { net: p.net, layers: [p.side], pts: track, width: rules.trackWidth }).length) continue;
        if (blockers(board, copper, loops, { net: p.net, layers: all, pts: [via], width: size.diameter }).length) continue;
        return { track, via };
      }
    }
  return null;
}
