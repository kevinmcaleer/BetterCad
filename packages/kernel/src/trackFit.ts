import { pieceFrame, type Pivots } from "./track";

/** A track's line-up helpers for its panel, kept out of the document code the app loads first. */

/**
 * How far the piece reaches past its pivot line towards the wheels (world corners, xyz after xyz): the lift that sets
 * its inside face on their round edges, rounded to 0.01 mm.
 */
export function insideReach(positions: ArrayLike<number>, p: Pivots, flip = false): number {
  const { o } = pieceFrame(p);
  const k = flip ? -1 : 1;
  let most = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const v = ((positions[i]! - p.start[0]) * o[0] + (positions[i + 1]! - p.start[1]) * o[1] + (positions[i + 2]! - p.start[2]) * o[2]) * k;
    if (v > most) most = v;
  }
  return Math.round(most * 100) / 100;
}

/** How the count compares with the loop: "41.2 pieces go round: a good fit." */
export function trackFitText(count: number, fits: number, pitch: number): string {
  if (!fits) return "";
  const off = count - fits;
  const by = Math.abs(off) * pitch;
  const r = (n: number) => Math.round(n * 10) / 10;
  const how = by < 0.5 ? "a good fit" : off > 0 ? `${r(by)} mm too long, so it overlaps` : `${r(by)} mm short of closing`;
  return `${r(fits)} pieces go round: ${how}.`;
}
