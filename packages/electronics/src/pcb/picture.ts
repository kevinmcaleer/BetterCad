import { eid, type Board, type BoardPicture, type ElectronicsDesign, type Id } from "../model";

/**
 * Pictures on the silkscreen (#642): a logo or a drawing as ink and bare board, a bit a cell. A picture is kept small
 * (at most `MAX_COLS` cells across), since a board house prints nothing finer than about 0.15 mm anyway.
 */
export const MAX_COLS = 200;
/** The finest cell worth keeping, mm. */
export const FINEST = 0.15;

const bytesOf = (bits: string): Uint8Array => Uint8Array.from(atob(bits), (c) => c.charCodeAt(0));
const textOf = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const rowBytes = (cols: number) => Math.ceil(cols / 8);

/** Packs cells (true: ink), rows from the top, into the text a picture keeps. */
export function packInk(ink: ArrayLike<boolean | number>, cols: number, rows: number): string {
  const per = rowBytes(cols);
  const out = new Uint8Array(per * rows);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) if (ink[y * cols + x]) out[y * per + (x >> 3)]! |= 0x80 >> (x & 7);
  return textOf(out);
}

/** The side of one cell, mm. */
export const cellOf = (p: Pick<BoardPicture, "w" | "cols">): number => p.w / p.cols;
/** How tall the picture is on the board, mm. */
export const pictureHeight = (p: Pick<BoardPicture, "w" | "cols" | "rows">): number => cellOf(p) * p.rows;

/**
 * The ink as rectangles on the board, mm: each run of inked cells along a row. A picture on the bottom is flipped left
 * to right inside its own box, so it reads the right way round from underneath.
 */
export function pictureRects(p: BoardPicture): { x1: number; y1: number; x2: number; y2: number }[] {
  const bytes = bytesOf(p.bits);
  const per = rowBytes(p.cols);
  const cell = cellOf(p);
  const top = p.y + pictureHeight(p);
  const flip = p.layer === "silk-bottom";
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  for (let y = 0; y < p.rows; y += 1) {
    let from = -1;
    for (let x = 0; x <= p.cols; x += 1) {
      const on = x < p.cols && ((bytes[y * per + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0;
      if (on && from < 0) from = x;
      if (!on && from >= 0) {
        const [a, b] = flip ? [p.cols - x, p.cols - from] : [from, x];
        out.push({ x1: r6(p.x + a * cell), y1: r6(top - (y + 1) * cell), x2: r6(p.x + b * cell), y2: r6(top - y * cell) });
        from = -1;
      }
    }
  }
  return out;
}

/**
 * Ink from an image's pixels (RGBA, rows from the top): dark and solid is ink, light or see-through is bare board.
 * The image is sampled down to `cols` cells across, its shape kept.
 */
export function inkFromPixels(rgba: ArrayLike<number>, width: number, height: number, cols: number): Pick<BoardPicture, "cols" | "rows" | "bits"> {
  const c = Math.max(1, Math.min(MAX_COLS, Math.round(cols), width));
  const rows = Math.max(1, Math.round((height / width) * c));
  const ink = new Uint8Array(c * rows);
  for (let y = 0; y < rows; y += 1)
    for (let x = 0; x < c; x += 1) {
      // The average over the pixels the cell covers.
      const [x0, x1] = [Math.floor((x * width) / c), Math.max(Math.floor((x * width) / c) + 1, Math.floor(((x + 1) * width) / c))];
      const [y0, y1] = [Math.floor((y * height) / rows), Math.max(Math.floor((y * height) / rows) + 1, Math.floor(((y + 1) * height) / rows))];
      let dark = 0;
      let n = 0;
      for (let py = y0; py < Math.min(y1, height); py += 1)
        for (let px = x0; px < Math.min(x1, width); px += 1) {
          const i = (py * width + px) * 4;
          const light = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) / 255;
          dark += (1 - light) * (rgba[i + 3]! / 255);
          n += 1;
        }
      if (n && dark / n > 0.5) ink[y * c + x] = 1;
    }
  return { cols: c, rows, bits: packInk(ink, c, rows) };
}

/** Ink and bare board changed over, for a light logo drawn on a dark ground. */
export function invertInk(p: BoardPicture): BoardPicture {
  const bytes = bytesOf(p.bits);
  const per = rowBytes(p.cols);
  const ink = new Uint8Array(p.cols * p.rows);
  for (let y = 0; y < p.rows; y += 1) for (let x = 0; x < p.cols; x += 1) ink[y * p.cols + x] = (bytes[y * per + (x >> 3)] ?? 0) & (0x80 >> (x & 7)) ? 0 : 1;
  return { ...p, bits: packInk(ink, p.cols, p.rows) };
}

const onBoard = (d: ElectronicsDesign, change: (b: Board) => Board): ElectronicsDesign => (d.board ? { ...d, board: change(d.board) } : d);

/** Puts a picture on the silkscreen, its bottom left corner at (x, y). Nothing is added when it holds no ink. */
export function addPicture(d: ElectronicsDesign, pic: Omit<BoardPicture, "id">, id: Id = eid("pi")): ElectronicsDesign {
  if (!(pic.w > 0) || pic.cols < 1 || pic.rows < 1 || !/[^A=]/.test(pic.bits)) return d;
  return onBoard(d, (b) => ({ ...b, pictures: [...(b.pictures ?? []), { ...pic, id }] }));
}

export function setPicture(d: ElectronicsDesign, id: Id, change: Partial<Pick<BoardPicture, "x" | "y" | "w" | "layer" | "bits">>): ElectronicsDesign {
  if (change.w !== undefined && !(change.w > 0)) return d;
  return onBoard(d, (b) => ({ ...b, pictures: (b.pictures ?? []).map((p) => (p.id === id ? { ...p, ...change } : p)) }));
}
