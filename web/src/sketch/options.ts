import type { Frame, Vec2 } from "@bettercad/sketch";
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
  /**
   * Auto project geometry, as in Fusion: a sketch on a face brings in the face's edges, and sizing or constraining to
   * any model edge or corner brings that in too.
   */
  autoProject: boolean;
  /**
   * Slice, as in Fusion: hide the model on the near side of the sketch's plane, so a sketch on an inner face shows.
   * Off at the start of every sketch, so it is never remembered.
   */
  slice: boolean;
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
  autoProject: true,
  slice: false,
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
  {
    id: "autoProject",
    label: "Auto project geometry",
    title: "Bring in the edges of the face you sketch on, and any model edge or corner you size or constrain to",
  },
  { id: "slice", label: "Slice", title: "Hide the model between you and the sketch's plane" },
];

/** Options that last for one sketch only. */
const NOT_SAVED: SketchOption[] = ["slice"];

const KEY = "bettercad.sketchOptions";

export function loadOptions(): SketchOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SketchOptions>;
    const out = { ...DEFAULT_OPTIONS };
    for (const k of Object.keys(DEFAULT_OPTIONS) as SketchOption[]) if (typeof saved[k] === "boolean" && !NOT_SAVED.includes(k)) out[k] = saved[k];
    return out;
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveOptions(o: SketchOptions): void {
  try {
    const kept: Partial<SketchOptions> = { ...o };
    for (const k of NOT_SAVED) delete kept[k];
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    /* storage blocked: the options last for this visit */
  }
}

/** How far in front of the sketch's plane the slice cuts, mm, so the face you sketch on stays whole. */
export const SLICE_GAP = 0.01;

/** Which side of a sketch's plane the camera is on: 1 in front of its normal, -1 behind. `toCamera` points from the view's target towards the camera. */
export function sliceSide(frame: Frame, toCamera: readonly [number, number, number]): 1 | -1 {
  const n = frame.normal;
  return n[0] * toCamera[0] + n[1] * toCamera[1] + n[2] * toCamera[2] >= 0 ? 1 : -1;
}

/**
 * The section that slices the model at a sketch's plane, cutting away the camera's `side` (see `sliceSide`) so the
 * material in front of the sketch goes, whichever way you look. Shaped like the viewport's section: the kept side is
 * the one behind `normal`.
 */
export function sliceSection(frame: Frame, side: 1 | -1): { origin: [number, number, number]; normal: [number, number, number]; offset: number } {
  const n = frame.normal;
  return { origin: [frame.origin[0], frame.origin[1], frame.origin[2]], normal: [n[0] * side, n[1] * side, n[2] * side], offset: SLICE_GAP };
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
