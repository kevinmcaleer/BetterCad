import { outlinePoints, pointInPolygon } from "../board";
import { q } from "../geom";
import type { Board, Corner, ElectronicsDesign, Id, P2 } from "../model";

/**
 * A board outline taken from a sketch in the model (#638): the sketch's biggest closed shape is the edge and the
 * shapes inside it are cut-outs, so the board fits the case it was drawn for and follows when the sketch changes.
 */
export interface OutlineShape {
  /** The edge, with arcs already as short straight runs. */
  outer: P2[];
  holes: P2[][];
}

/** Takes out points that repeat and points in the middle of a straight run. */
function corners(loop: P2[], dx: number, dy: number): Corner[] {
  const pts = loop
    .map(([x, y]) => [q(x + dx), q(y + dy)] as P2)
    .filter((p, i, all) => {
      const prev = all[(i + all.length - 1) % all.length]!;
      return p[0] !== prev[0] || p[1] !== prev[1];
    });
  const out: Corner[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[(i + pts.length - 1) % pts.length]!;
    const b = pts[i]!;
    const c = pts[(i + 1) % pts.length]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-9) out.push({ x: b[0], y: b[1] });
  }
  return out;
}

const low = (pts: P2[]): P2 => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))];

/** The shape as an outline and cut-outs, moved so its bottom left corner sits at `at`. */
export function outlineOf(shape: OutlineShape, at: P2 = [0, 0]): Pick<Board, "outline" | "cutouts"> {
  const from = low(shape.outer);
  const dx = at[0] - from[0];
  const dy = at[1] - from[1];
  const cutouts = shape.holes.map((h) => corners(h, dx, dy)).filter((h) => h.length > 2);
  return { outline: corners(shape.outer, dx, dy), ...(cutouts.length ? { cutouts } : {}) };
}

const same = (a: Corner[][], b: Corner[][]): boolean =>
  a.length === b.length && a.every((loop, i) => loop.length === b[i]!.length && loop.every((c, k) => c.x === b[i]![k]!.x && c.y === b[i]![k]!.y && !c.bulge));

/** True when the sketch the outline follows no longer gives the outline the board has. */
export function outlineBehind(board: Board, shape: OutlineShape): boolean {
  const next = outlineOf(shape, low(outlinePoints(board.outline)));
  return !same([board.outline, ...(board.cutouts ?? [])], [next.outline, ...(next.cutouts ?? [])]);
}

/**
 * Makes the board the shape of a sketch and remembers which, or brings it up to date with it. The board's bottom left
 * corner stays where it is, so the parts stay on the board.
 */
export function followSketch(d: ElectronicsDesign, sketch: Id, shape: OutlineShape): ElectronicsDesign {
  const board = d.board;
  if (!board || shape.outer.length < 3) return d;
  const corner = low(outlinePoints(board.outline));
  const from = low(shape.outer);
  // `at` is where the board's own (0, 0) sits in the sketch, so the board can stand on the sketch in 3D (#653).
  const next: Board = { ...board, ...outlineOf(shape, corner), outlineFrom: { sketch, at: [q(from[0] - corner[0]), q(from[1] - corner[1])] } };
  if (!shape.holes.length) delete next.cutouts;
  return { ...d, board: next };
}

/**
 * The same for a flat face of a body in the model: `face` names the body and the face ("body|face name"). The board
 * is not moved onto the face in 3D; its step in the model places it.
 */
export function followFace(d: ElectronicsDesign, face: string, shape: OutlineShape): ElectronicsDesign {
  const board = d.board;
  if (!board || shape.outer.length < 3) return d;
  const next: Board = { ...board, ...outlineOf(shape, low(outlinePoints(board.outline))), outlineFrom: { face } };
  if (!shape.holes.length) delete next.cutouts;
  return { ...d, board: next };
}

/** Gives the board a shape once, from a file say, following nothing. Its bottom left corner stays where it is. */
export function takeShape(d: ElectronicsDesign, shape: OutlineShape): ElectronicsDesign {
  const board = d.board;
  if (!board || shape.outer.length < 3) return d;
  const next: Board = { ...board, ...outlineOf(shape, low(outlinePoints(board.outline))) };
  if (!shape.holes.length) delete next.cutouts;
  delete next.outlineFrom;
  return { ...d, board: next };
}

const areaOf = (loop: P2[]): number =>
  Math.abs(loop.reduce((a, p, i) => a + p[0] * loop[(i + 1) % loop.length]![1] - loop[(i + 1) % loop.length]![0] * p[1], 0)) / 2;

/** Closed loops as a board's shape: the biggest is the edge, and the loops inside it are cut-outs. Null with none. */
export function shapeFromLoops(loops: P2[][]): OutlineShape | null {
  const real = loops.filter((l) => l.length > 2 && areaOf(l) > 1e-6).sort((a, b) => areaOf(b) - areaOf(a));
  const outer = real[0];
  return outer ? { outer, holes: real.slice(1).filter((l) => pointInPolygon(l[0]!, outer)) } : null;
}

/** Stops following a sketch or a face. The outline stays as it is. */
export function unfollowSketch(d: ElectronicsDesign): ElectronicsDesign {
  if (!d.board?.outlineFrom) return d;
  const board = { ...d.board };
  delete board.outlineFrom;
  return { ...d, board };
}
