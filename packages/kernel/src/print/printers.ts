/**
 * Printers (#100): bed sizes for the print bed preview and the fit check. Data only, so the other print checks (#11)
 * read the nozzle and the hole offset from the same place. Sizes are the build volume in mm, from each maker's specs.
 */
import type { FitGaps } from "./fits";

export interface Printer {
  id: string;
  name: string;
  /** Build volume, mm: X and Y across the bed, Z up. */
  x: number;
  y: number;
  z: number;
  /** Where the slicer puts 0,0: the bed's centre (Bambu, Prusa) or its front-left corner (Ender, Elegoo). */
  origin: "centre" | "corner";
  /** Nozzle width, mm. Thin-wall checks use twice this. */
  nozzle: number;
  /** Added to a printed hole so a screw slides in (#104). */
  holeOffset: number;
}

const p = (id: string, name: string, x: number, y: number, z: number, origin: Printer["origin"]): Printer => ({
  id,
  name,
  x,
  y,
  z,
  origin,
  nozzle: 0.4,
  holeOffset: 0.4,
});

export const PRINTERS: readonly Printer[] = [
  p("bambu-a1-mini", "Bambu A1 Mini", 180, 180, 180, "centre"),
  p("bambu-a1", "Bambu A1, P1 or X1", 256, 256, 256, "centre"),
  p("prusa-mk4", "Prusa MK4", 250, 210, 220, "centre"),
  p("prusa-mini", "Prusa Mini", 180, 180, 180, "centre"),
  p("ender-3", "Ender 3", 220, 220, 250, "corner"),
  p("elegoo-neptune-4", "Elegoo Neptune 4", 225, 225, 265, "corner"),
];

export const DEFAULT_PRINTER = "bambu-a1";

/** The print settings a document keeps (#100, #105), so a shared model shows the bed its author meant. */
export interface PrintSettings {
  /** A preset's id, or "custom". */
  printer?: string;
  custom?: { x: number; y: number; z: number };
  /** A material's id (#105). */
  material?: string;
  /** Infill, percent. */
  infill?: number;
  /** What printed holes add, mm (#104), when tuned away from the printer's default. */
  holeOffset?: number;
  /** Fit gaps on each side, mm (#181), when tuned away from the defaults. */
  fits?: FitGaps;
  /** The printer profile these values came from (#180), if any. The values themselves are the snapshot. */
  profile?: string;
}

/** The hole offset in use: the tuned one, else the printer's. */
export function holeOffsetOf(s: PrintSettings | undefined): number {
  return s?.holeOffset ?? printerOf(s).holeOffset;
}

export function printerOf(s: PrintSettings | undefined): Printer {
  if (s?.printer === "custom" && s.custom) return { ...p("custom", "Custom printer", s.custom.x, s.custom.y, s.custom.z, "centre") };
  return PRINTERS.find((x) => x.id === s?.printer) ?? PRINTERS.find((x) => x.id === DEFAULT_PRINTER)!;
}

export interface Box3 {
  min: [number, number, number];
  max: [number, number, number];
}

/** Joins boxes into the one that holds them all; null for none. */
export function unionBox(boxes: Box3[]): Box3 | null {
  if (!boxes.length) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, b.min[i]!);
      max[i] = Math.max(max[i]!, b.max[i]!);
    }
  }
  return { min, max };
}

export interface FitProblem {
  axis: "x" | "y" | "z";
  /** How much too big, mm. */
  over: number;
}

const WORD = { x: "wide", y: "deep", z: "tall" } as const;
const round = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

/**
 * Whether the model fits the printer's volume, by size alone (it can be moved). The bed is centred under the
 * origin, so "Centre on bed" can always put a model that fits inside it.
 */
export function fitCheck(box: Box3 | null, printer: Printer): FitProblem[] {
  if (!box) return [];
  const size = { x: box.max[0] - box.min[0], y: box.max[1] - box.min[1], z: box.max[2] - box.min[2] };
  return (["x", "y", "z"] as const).filter((a) => size[a] > printer[a] + 1e-6).map((a) => ({ axis: a, over: size[a] - printer[a] }));
}

/** "The model is 12 mm too wide for a Bambu A1 Mini. Rotate it or pick a bigger printer." */
export function fitMessage(problems: FitProblem[], printer: Printer): string | null {
  if (!problems.length) return null;
  const parts = problems.map((q) => `${round(q.over)} mm too ${WORD[q.axis]}`);
  const what = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `The model is ${what} for ${printer.id === "custom" ? "your printer" : `a ${printer.name}`}. Rotate it or pick a bigger printer.`;
}

/** Bodies outside the volume when the model sits centred on the bed: which ones to tint. */
export function outside(boxes: Map<string, Box3>, printer: Printer, centre: [number, number] = [0, 0]): string[] {
  const out: string[] = [];
  for (const [id, b] of boxes) {
    if (
      b.min[0] < centre[0] - printer.x / 2 - 1e-6 ||
      b.max[0] > centre[0] + printer.x / 2 + 1e-6 ||
      b.min[1] < centre[1] - printer.y / 2 - 1e-6 ||
      b.max[1] > centre[1] + printer.y / 2 + 1e-6 ||
      b.min[2] < -1e-6 ||
      b.max[2] > printer.z + 1e-6
    )
      out.push(id);
  }
  return out;
}

/** The move that centres the model on the bed with its lowest point on it. */
export function centreMove(box: Box3): { x: number; y: number; z: number } {
  return { x: -(box.min[0] + box.max[0]) / 2, y: -(box.min[1] + box.max[1]) / 2, z: -box.min[2] };
}
