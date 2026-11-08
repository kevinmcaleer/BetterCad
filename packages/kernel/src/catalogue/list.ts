/**
 * The catalogue's parts and what is built from them. Apart from index.ts so that code which only places, bounds or
 * frames a part (the document, on the app's first paint) does not carry the whole list (#320).
 */
import { tidy, type CataloguePart, type HolePattern } from "./index";
import { PARTS } from "./parts";

type V2 = [number, number];

export const CATALOGUE: readonly CataloguePart[] = PARTS;

export function cataloguePart(id: string): CataloguePart | undefined {
  return CATALOGUE.find((p) => p.id === id);
}

/** Hole patterns (#189): the catalogue parts with two or more screw holes, each centred on its own middle. */
export const HOLE_PATTERNS: HolePattern[] = CATALOGUE.filter((p) => p.cutout.holes.length >= 2).map((p) => {
  const hs = p.cutout.holes;
  const mx = hs.reduce((a, h) => a + h.at[0], 0) / hs.length;
  const my = hs.reduce((a, h) => a + h.at[1], 0) / hs.length;
  const xs = hs.map((h) => h.at[0]);
  const ys = hs.map((h) => h.at[1]);
  const w = tidy(Math.max(...xs) - Math.min(...xs));
  const h = tidy(Math.max(...ys) - Math.min(...ys));
  return {
    id: p.id,
    label: `${p.name} (${h ? `${w} × ${h}` : w} mm)`,
    screw: hs[0]!.screw,
    points: hs.map((x) => [tidy(x.at[0] - mx), tidy(x.at[1] - my)] as V2),
  };
});
