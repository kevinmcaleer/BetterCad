/**
 * The screw table (#70), data only so the Hole tool and the print-readiness checks (#11) can both read it.
 * Millimetres throughout. Clearances follow ISO 273 (close and normal) and common tap-drill charts; the printed fit is
 * the nominal plus 0.4 mm, which suits most FDM printers because printed holes come out small.
 */
export interface ScrewSize {
  id: string;
  label: string;
  system: "metric" | "imperial";
  nominal: number;
  /** The drill for cutting a thread (a tap hole is modelled as just this diameter). */
  tap: number;
  close: number;
  normal: number;
  /** Clearance for a printed part: nominal + 0.4 mm. */
  printed: number;
  /** Socket-head cap screw. */
  socketHead: { diameter: number; height: number };
  /** Countersunk (flat) head, and its included angle. */
  countersunkHead: { diameter: number; height: number; angle: number };
}

const PRINT_ALLOWANCE = 0.4;

function size(
  id: string,
  label: string,
  system: ScrewSize["system"],
  nominal: number,
  tap: number,
  close: number,
  normal: number,
  socket: [number, number],
  countersunk: [number, number],
): ScrewSize {
  return {
    id,
    label,
    system,
    nominal,
    tap,
    close,
    normal,
    printed: Math.round((nominal + PRINT_ALLOWANCE) * 1000) / 1000,
    socketHead: { diameter: socket[0], height: socket[1] },
    countersunkHead: { diameter: countersunk[0], height: countersunk[1], angle: system === "metric" ? 90 : 82 },
  };
}

export const SCREWS: ScrewSize[] = [
  size("M2", "M2", "metric", 2, 1.6, 2.2, 2.4, [3.8, 2], [3.8, 1.2]),
  size("M2.5", "M2.5", "metric", 2.5, 2.05, 2.7, 2.9, [4.5, 2.5], [4.7, 1.5]),
  size("M3", "M3", "metric", 3, 2.5, 3.2, 3.4, [5.5, 3], [6.72, 1.86]),
  size("M4", "M4", "metric", 4, 3.3, 4.3, 4.5, [7, 4], [8.96, 2.48]),
  size("M5", "M5", "metric", 5, 4.2, 5.3, 5.5, [8.5, 5], [11.2, 3.1]),
  size("M6", "M6", "metric", 6, 5, 6.4, 6.6, [10, 6], [13.44, 3.72]),
  size("4-40", "#4-40", "imperial", 2.845, 2.26, 2.95, 3.26, [5.5, 2.84], [5.6, 1.7]),
  size("6-32", "#6-32", "imperial", 3.505, 2.85, 3.66, 3.97, [6.86, 3.51], [7.1, 2.1]),
  size("1/4-20", "1/4-20", "imperial", 6.35, 5.1, 6.53, 6.75, [9.53, 6.35], [12.7, 3.5]),
];

export type HoleFit = "printed" | "normal" | "close" | "tap";

export const FITS: { id: HoleFit; label: string; title: string }[] = [
  { id: "printed", label: "Clearance for printing", title: "The screw slides through a printed hole: nominal + 0.4 mm" },
  { id: "normal", label: "Clearance", title: "The screw slides through a drilled or machined hole" },
  { id: "close", label: "Close", title: "A snug fit that still clears the thread" },
  { id: "tap", label: "Tap", title: "The tap drill: cut or self-tap a thread into it" },
];

export function screw(id: string): ScrewSize | undefined {
  return SCREWS.find((s) => s.id === id);
}

/** The hole's diameter for a size and fit. */
export function holeDiameter(s: ScrewSize, fit: HoleFit): number {
  return s[fit];
}
