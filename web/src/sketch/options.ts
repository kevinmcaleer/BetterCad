import type { Vec2 } from "@bettercad/sketch";
import { snapStep } from "./snap";

/**
 * What the sketch palette shows and does while a sketch is open, as in Fusion's Sketch Palette: the grid on the
 * sketch's plane, snapping to it, the shaded profiles, the points, the sizes, the constraint marks, and projected and
 * construction geometry. Remembered on this device between sketches.
 */
export interface SketchOptions {
  grid: boolean;
  snap: boolean;
  profile: boolean;
  points: boolean;
  dimensions: boolean;
  constraints: boolean;
  projected: boolean;
  construction: boolean;
}

export type SketchOption = keyof SketchOptions;

export const DEFAULT_OPTIONS: SketchOptions = {
  grid: true,
  snap: true,
  profile: true,
  points: true,
  dimensions: true,
  constraints: true,
  projected: true,
  construction: true,
};

/** The palette's rows, in order, with what each one does. */
export const OPTION_ROWS: { id: SketchOption; label: string; title: string }[] = [
  { id: "grid", label: "Sketch grid", title: "Show a grid on the sketch's plane" },
  { id: "snap", label: "Snap", title: "Snap to the grid. Hold Shift to place freely." },
  { id: "profile", label: "Profile", title: "Shade the closed shapes you can extrude" },
  { id: "points", label: "Points", title: "Show the end and centre points" },
  { id: "dimensions", label: "Dimensions", title: "Show the sizes on the sketch" },
  { id: "constraints", label: "Constraints", title: "Show the constraint marks" },
  { id: "projected", label: "Projected geometry", title: "Show edges projected from the model" },
  { id: "construction", label: "Construction geometry", title: "Show dashed construction lines" },
];

const KEY = "bettercad.sketchOptions";

export function loadOptions(): SketchOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SketchOptions>;
    const out = { ...DEFAULT_OPTIONS };
    for (const k of Object.keys(DEFAULT_OPTIONS) as SketchOption[]) if (typeof saved[k] === "boolean") out[k] = saved[k];
    return out;
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveOptions(o: SketchOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* storage blocked: the options last for this visit */
  }
}

/**
 * The grid on the sketch's plane around `centre` (sketch mm), wide enough to cover `span` mm each way. Minor lines
 * sit at least 25 px apart; every line on the next step up is a major line, so the grid reads like graph paper and
 * keeps its spacing as you zoom. At most 120 lines each way.
 */
export function sketchGrid(centre: Vec2, span: number, px: number): { minor: Vec2[][]; major: Vec2[][]; step: number } {
  const step = snapStep(px * 2.5);
  const majorStep = STEPS.find((x) => x > step + 1e-9) ?? step * 10;
  const n = Math.min(120, Math.ceil(span / step));
  const cx = Math.round(centre[0] / step) * step;
  const cy = Math.round(centre[1] / step) * step;
  const lo: Vec2 = [cx - n * step, cy - n * step];
  const hi: Vec2 = [cx + n * step, cy + n * step];
  const minor: Vec2[][] = [];
  const major: Vec2[][] = [];
  const isMajor = (v: number) => Math.abs(v / majorStep - Math.round(v / majorStep)) < 1e-6;
  for (let i = -n; i <= n; i++) {
    const x = cx + i * step;
    const y = cy + i * step;
    (isMajor(x) ? major : minor).push([
      [x, lo[1]],
      [x, hi[1]],
    ]);
    (isMajor(y) ? major : minor).push([
      [lo[0], y],
      [hi[0], y],
    ]);
  }
  return { minor, major, step };
}

const STEPS = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000];
