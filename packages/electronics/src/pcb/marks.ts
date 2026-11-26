/**
 * Fiducials and test points (#735): round copper pads of the board's own, with no part behind them. They come into
 * `boardPads` like any other pad, so the copper files, the mask, the ratsnest and the board check all see them.
 */
import type { BoardPad } from "../board";
import { eid, type Board, type BoardMark, type ElectronicsDesign, type Id, type Pad, type Side } from "../model";

/** The usual sizes: a 1 mm fiducial in a 2 mm mask opening, and a 1 mm test point a probe can land on. */
export const MARK_SIZE: Record<BoardMark["kind"], number> = { fiducial: 1, testpoint: 1 };
const PREFIX: Record<BoardMark["kind"], string> = { fiducial: "FID", testpoint: "TP" };

const onBoard = (d: ElectronicsDesign, change: (b: Board) => Board): ElectronicsDesign => (d.board ? { ...d, board: change(d.board) } : d);

/** The next free reference of a kind: FID1, FID2… or TP1, TP2… */
export function nextMarkRef(board: Pick<Board, "marks">, kind: BoardMark["kind"]): string {
  const used = new Set((board.marks ?? []).map((m) => m.ref));
  let n = 1;
  while (used.has(`${PREFIX[kind]}${n}`)) n += 1;
  return `${PREFIX[kind]}${n}`;
}

/** Adds a fiducial or a test point. A test point takes `net`; a fiducial is on none. */
export function addMark(
  d: ElectronicsDesign,
  kind: BoardMark["kind"],
  x: number,
  y: number,
  side: Side = "top",
  net?: string,
): { design: ElectronicsDesign; id: Id } {
  const id = eid("mk");
  const design = onBoard(d, (b) => ({
    ...b,
    marks: [...(b.marks ?? []), { id, kind, ref: nextMarkRef(b, kind), x, y, side, size: MARK_SIZE[kind], ...(kind === "testpoint" && net ? { net } : {}) }],
  }));
  return { design, id };
}

/** Changes a mark: its size, its side or a test point's net ("" takes it off its net). */
export function setMark(d: ElectronicsDesign, id: Id, change: { size?: number; side?: Side; net?: string }): ElectronicsDesign {
  return onBoard(d, (b) => ({
    ...b,
    marks: (b.marks ?? []).map((m) => {
      if (m.id !== id) return m;
      const next: BoardMark = { ...m, ...(change.size ? { size: change.size } : {}), ...(change.side ? { side: change.side } : {}) };
      if (change.net !== undefined && m.kind === "testpoint") {
        if (change.net) next.net = change.net;
        else delete next.net;
      }
      return next;
    }),
  }));
}

/** A mark's one pad: round, surface, no paste. A fiducial's mask opening is twice its copper, as assembly lines ask. */
export function markPad(m: BoardMark): Pad {
  return {
    number: "1",
    kind: "smd",
    shape: "circle",
    x: 0,
    y: 0,
    w: m.size,
    h: m.size,
    noPaste: true,
    ...(m.kind === "fiducial" ? { maskMargin: m.size / 2 } : {}),
  };
}

/** The board's marks as pads, for `boardPads`. Their `part` is the mark's own id. */
export function markPads(board: Pick<Board, "marks">): BoardPad[] {
  return (board.marks ?? []).map((m) => ({ part: m.id, ref: m.ref, pad: markPad(m), net: m.net ?? "", at: [m.x, m.y], angle: 0, side: m.side }));
}
