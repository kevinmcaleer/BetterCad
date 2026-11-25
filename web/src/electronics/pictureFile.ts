import type { BoardPicture } from "@bettercad/electronics";
import { FINEST, MAX_COLS, inkFromPixels } from "@bettercad/electronics/pcb/picture";

/**
 * A picture file as ink for the silkscreen (#642), `width` mm wide on the board. The browser decodes the file; dark,
 * solid pixels become ink. Loaded when a picture is added.
 */
export async function pictureFromFile(file: Blob, width: number): Promise<Pick<BoardPicture, "cols" | "rows" | "bits">> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((done, fail) => {
      img.onload = () => done();
      img.onerror = () => fail(new Error("That file is not a picture this browser can read."));
      img.src = url;
    });
    const w = img.naturalWidth || 300;
    const h = img.naturalHeight || 150;
    // As fine as a board house prints, and no finer than the picture itself.
    const cols = Math.max(8, Math.min(MAX_COLS, Math.round(width / FINEST), w));
    // Drawn at a few pixels a cell, so each cell is an average and thin lines are not lost between samples.
    const scale = Math.min(1, (cols * 4) / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser could not read the picture.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const ink = inkFromPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, cols);
    if (!/[^A=]/.test(ink.bits)) throw new Error("That picture has nothing dark in it to print. Try one with dark lines on a light or clear ground.");
    return ink;
  } finally {
    URL.revokeObjectURL(url);
  }
}
