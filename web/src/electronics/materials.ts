/**
 * What a made board is made of, as colours: bare pads, the board under the mask, holes and ink. These are materials
 * in a picture of the board (the 3D board's faces, the manufacturing preview's As made view), not interface colours,
 * so they are not design tokens. Mask colours are `MASK_COLOURS` in `@bettercad/electronics/pcb/solid`.
 */
export const PAD = "#c8a84a";
export const HOLE = "#17181a";
export const FR4 = "#8f8a5f";
export const SILK = { white: "#f1f1ec", black: "#16171a" } as const;

/** A colour moved a share of the way to white. */
export function lighten(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) + (255 - ((n >> shift) & 255)) * by);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
