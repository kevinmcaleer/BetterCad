/**
 * Length matching (#745): nets that must arrive together, such as a bus or the two halves of a pair, are tuned with
 * wiggles to the longest of them, within a tolerance. The group is kept on the board, so the board check can say when
 * later routing pulls them apart. Loaded only when you match.
 */
import { boardPads, type BoardPad } from "../board";
import { eid, type Board, type ElectronicsDesign, type LengthGroup, type P2 } from "../model";
import { trackLength } from "./route";
import { netLength, pairOf, tuneLength } from "./shove";

/** How far apart a matched group may be, when none is given, mm. */
export const MATCH_TOLERANCE = 0.1;

export interface MatchResult {
  net: string;
  /** Its length after matching, mm. */
  length: number;
  /** Why it could not be matched, when it could not. */
  why?: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Its tracks, the one with the longest straight piece first: the likeliest to hold the wiggles. */
function tracksOf(d: ElectronicsDesign, net: string) {
  const longest = (pts: P2[]) => Math.max(0, ...pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1])));
  return (d.board?.tracks ?? [])
    .filter((t) => t.net === net && t.pts.length > 1)
    .sort((a, b) => longest(b.pts) - longest(a.pts) || trackLength(b.pts) - trackLength(a.pts));
}

/**
 * Makes a net about `target` long, `slack` either way. The wiggles go in one piece of track if they fit; when none can
 * hold them all, they are shared out over several pieces and tracks, a half or a quarter of what is left at a time.
 */
function tuneNet(d: ElectronicsDesign, net: string, target: number, slack: number, pads: BoardPad[]): { design: ElectronicsDesign; why: string } {
  let design = d;
  let why = tracksOf(d, net).length ? "" : "It has no tracks to tune.";
  for (let round = 0; round < 24; round += 1) {
    const left = target - netLength(design, net);
    if (left <= slack) break;
    let moved = false;
    for (const share of [1, 0.5, 0.25]) {
      for (const t of tracksOf(design, net)) {
        const out = tuneLength(design, t.id, netLength(design, net) + left * share, undefined, pads);
        if ("design" in out) {
          design = out.design;
          moved = true;
          break;
        }
        why ||= out.why;
      }
      if (moved) break;
    }
    if (!moved) break;
  }
  return { design, why };
}

/**
 * Tunes every net named to the longest of them, and keeps them as a group that the board check watches. A net that is
 * short by no more than the tolerance is left alone. Each net that will not take its wiggles says why.
 */
export function matchLengths(
  d: ElectronicsDesign,
  nets: string[],
  tolerance = MATCH_TOLERANCE,
  pads: BoardPad[] = boardPads(d),
): { design: ElectronicsDesign; target: number; results: MatchResult[] } {
  const names = [...new Set(nets.filter(Boolean))];
  const target = Math.max(0, ...names.map((n) => netLength(d, n)));
  let design = d;
  const results: MatchResult[] = [];
  for (const net of names) {
    const now = netLength(design, net);
    if (target - now <= tolerance + 1e-6) {
      results.push({ net, length: round(now) });
      continue;
    }
    const tuned = tuneNet(design, net, target - tolerance / 2, tolerance / 2, pads);
    design = tuned.design;
    const done = target - netLength(design, net) <= tolerance + 1e-6;
    const why = done ? "" : tuned.why || "There is not enough room beside its tracks for the wiggles.";
    results.push({ net, length: round(netLength(design, net)), ...(done ? {} : { why }) });
  }
  if (names.length > 1 && design.board) {
    const board = design.board;
    // A net is in one group at a time: matching again takes it out of the old one.
    const rest = (board.matched ?? []).map((g) => ({ ...g, nets: g.nets.filter((n) => !names.includes(n)) })).filter((g) => g.nets.length > 1);
    const group: LengthGroup = { id: eid("lg"), nets: names, tolerance };
    design = { ...design, board: { ...board, matched: [...rest, group] } };
  }
  return { design, target: round(target), results };
}

/** The group a net is matched in, if any. */
export const groupOf = (d: ElectronicsDesign, net: string): LengthGroup | undefined => d.board?.matched?.find((g) => g.nets.includes(net));

/** Takes a net's group apart, so the board check stops watching it. */
export function unmatch(d: ElectronicsDesign, net: string): ElectronicsDesign {
  const board = d.board;
  if (!board?.matched?.some((g) => g.nets.includes(net))) return d;
  const matched = board.matched.filter((g) => !g.nets.includes(net));
  const next: Board = { ...board, matched };
  if (!matched.length) delete next.matched;
  return { ...d, board: next };
}

/** A net's pair (D+ with D-) and how much longer one is than the other: the skew, mm. Null when it has no pair. */
export function pairSkew(d: ElectronicsDesign, net: string, nets: string[]): { mate: string; mine: number; theirs: number; skew: number } | null {
  const mate = pairOf(net, nets);
  if (!mate) return null;
  const [mine, theirs] = [round(netLength(d, net)), round(netLength(d, mate))];
  return { mate, mine, theirs, skew: round(Math.abs(mine - theirs)) };
}
