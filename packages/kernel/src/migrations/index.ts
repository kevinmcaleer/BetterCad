/**
 * One step per schema change of the .bcad file (#79), applied in order. Step N takes a file at schema N to N + 1.
 * Schema 0 is the bare document JSON that the editor downloaded before .bcad existed (`*.bettercad.json`).
 */
import { v0to1 } from "./v0to1";
import { v1to2 } from "./v1to2";
import { v2to3 } from "./v2to3";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Migration = (file: any) => any;

export const MIGRATIONS: Record<number, Migration> = {
  0: v0to1,
  1: v1to2,
  2: v2to3,
};
