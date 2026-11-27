/**
 * Corners you can drag (#742): a track's bends, and the corners of a pour, a keep-out or a cut-out. A track's ends sit
 * on pads and vias and stay put; its bends move, and the pieces either side bend again at 45° where a straight run
 * would not be at 0°, 45° or 90°. An area's corners move, a click on an edge adds one, and one can be taken away while
 * three are left.
 */
import { q } from "../geom";
import type { Board, Corner, ElectronicsDesign, Id, P2 } from "../model";
import { corner45, tidyRun } from "./route";
import { withPts } from "../trackArcs";

const onBoard = (d: ElectronicsDesign, change: (b: Board) => Board): ElectronicsDesign => {
  const next = d.board && change(d.board);
  return next && next !== d.board ? { ...d, board: next } : d;
};

/** Whether a piece runs along x, along y or at 45°. */
const square = (a: P2, b: P2): boolean => {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  return dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6;
};

/**
 * A track's points with bend `i` (not an end) moved to `to`. A piece that would run at an odd angle gets a 45° bend
 * of its own, kept next to the moved corner so the rest of the track keeps its line.
 */
export function cornerMoved(pts: P2[], i: number, to: P2): P2[] | null {
  if (i <= 0 || i >= pts.length - 1) return null;
  const at: P2 = [q(to[0]), q(to[1])];
  const before = pts[i - 1]!;
  const after = pts[i + 1]!;
  const into = square(before, at) ? [before, at] : corner45(before, at, false);
  const out = square(at, after) ? [at, after] : corner45(at, after, true);
  return tidyRun([...pts.slice(0, i - 1), ...into, ...out.slice(1), ...pts.slice(i + 2)]);
}

/** Moves bend `i` of a track to `to`. */
export function moveTrackCorner(d: ElectronicsDesign, id: Id, i: number, to: P2): ElectronicsDesign {
  return onBoard(d, (b) => {
    const t = b.tracks.find((x) => x.id === id);
    const pts = t && cornerMoved(t.pts, i, to);
    return t && pts ? { ...b, tracks: b.tracks.map((x) => (x === t ? withPts(t, pts) : x)) } : b;
  });
}

/** An area's corners, by the id `boardAreas` gives it: a pour's or a keep-out's own, or "cut:N" for a cut-out. */
export function areaCorners(board: Board, id: string): P2[] | null {
  const cut = /^cut:(\d+)$/.exec(id);
  if (cut) return board.cutouts?.[Number(cut[1])]?.map((c): P2 => [c.x, c.y]) ?? null;
  return board.pours.find((p) => p.id === id)?.outline ?? board.keepouts.find((k) => k.id === id)?.outline ?? null;
}

function setCorners(
  d: ElectronicsDesign,
  id: string,
  change: (pts: P2[], bulges: (number | undefined)[]) => [P2[], (number | undefined)[]] | null,
): ElectronicsDesign {
  return onBoard(d, (b) => {
    const cut = /^cut:(\d+)$/.exec(id);
    if (cut) {
      const n = Number(cut[1]);
      const loop = b.cutouts?.[n];
      if (!loop) return b;
      const made = change(
        loop.map((c): P2 => [c.x, c.y]),
        loop.map((c) => c.bulge),
      );
      if (!made) return b;
      const next: Corner[] = made[0].map(([x, y], k) => (made[1][k] ? { x, y, bulge: made[1][k] } : { x, y }));
      return { ...b, cutouts: b.cutouts!.map((l, k) => (k === n ? next : l)) };
    }
    const flat = (pts: P2[]) =>
      change(
        pts,
        pts.map(() => undefined),
      )?.[0];
    const pour = b.pours.find((p) => p.id === id);
    const keep = b.keepouts.find((k) => k.id === id);
    const next = flat(pour?.outline ?? keep?.outline ?? []);
    if (!next) return b;
    if (pour) return { ...b, pours: b.pours.map((p) => (p === pour ? { ...p, outline: next } : p)) };
    if (keep) return { ...b, keepouts: b.keepouts.map((k) => (k === keep ? { ...k, outline: next } : k)) };
    return b;
  });
}

/** Moves corner `i` of an area to `to`. */
export function moveAreaCorner(d: ElectronicsDesign, id: string, i: number, to: P2): ElectronicsDesign {
  return setCorners(d, id, (pts, bulges) => (pts[i] ? [pts.map((p, k) => (k === i ? ([q(to[0]), q(to[1])] as P2) : p)), bulges] : null));
}

/** Adds a corner at `at` on the edge from corner `edge` to the next. Gives the new corner's place. */
export function addAreaCorner(d: ElectronicsDesign, id: string, edge: number, at: P2): { design: ElectronicsDesign; i: number } {
  const design = setCorners(d, id, (pts, bulges) =>
    pts[edge]
      ? [
          [...pts.slice(0, edge + 1), [q(at[0]), q(at[1])], ...pts.slice(edge + 1)],
          [...bulges.slice(0, edge), undefined, undefined, ...bulges.slice(edge + 1)],
        ]
      : null,
  );
  return { design, i: edge + 1 };
}

/** Takes corner `i` away from an area, while it keeps three. */
export function removeAreaCorner(d: ElectronicsDesign, id: string, i: number): ElectronicsDesign {
  return setCorners(d, id, (pts, bulges) => (pts.length > 3 && pts[i] ? [pts.filter((_, k) => k !== i), bulges.filter((_, k) => k !== i)] : null));
}
