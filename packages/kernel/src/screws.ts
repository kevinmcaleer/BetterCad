/**
 * The screw table (#70), data only so the Hole tool and the print-readiness checks (#11) can both read it.
 * Millimetres throughout. Clearances follow ISO 273 (close and normal) and common tap-drill charts; the printed fit is
 * the nominal plus the printer's hole offset (0.4 mm by default, #104), which suits most FDM printers because printed
 * holes come out small. The copy that explains each fit lives here too, so the Learn course (#12) can quote it.
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
  /** Clearance for a printed part at the default offset: nominal + 0.4 mm. */
  printed: number;
  /** The printed hole for a heat-set insert, and the insert's length (#104). */
  insert?: { diameter: number; depth: number };
  /** Socket-head cap screw. */
  socketHead: { diameter: number; height: number };
  /** Countersunk (flat) head, and its included angle. */
  countersunkHead: { diameter: number; height: number; angle: number };
}

/** What a printed hole needs on top of the screw's size, mm, unless the printer is tuned (#104). */
export const DEFAULT_HOLE_OFFSET = 0.4;
const PRINT_ALLOWANCE = DEFAULT_HOLE_OFFSET;

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
  insert?: [number, number],
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
    ...(insert ? { insert: { diameter: insert[0], depth: insert[1] } } : {}),
  };
}

/**
 * Heat-set insert holes: the printed hole and the insert's length for the common short brass inserts (the sizes
 * CNC Kitchen and Ruthex publish for their M-series inserts). Make the hole a little deeper than the insert.
 */
export const INSERT_SOURCE = "Hole sizes for common short brass heat-set inserts, as their makers publish them.";

export const SCREWS: ScrewSize[] = [
  size("M2", "M2", "metric", 2, 1.6, 2.2, 2.4, [3.8, 2], [3.8, 1.2], [3.2, 3]),
  size("M2.5", "M2.5", "metric", 2.5, 2.05, 2.7, 2.9, [4.5, 2.5], [4.7, 1.5], [3.5, 4]),
  size("M3", "M3", "metric", 3, 2.5, 3.2, 3.4, [5.5, 3], [6.72, 1.86], [4, 5.7]),
  size("M4", "M4", "metric", 4, 3.3, 4.3, 4.5, [7, 4], [8.96, 2.48], [5.6, 8.1]),
  size("M5", "M5", "metric", 5, 4.2, 5.3, 5.5, [8.5, 5], [11.2, 3.1], [6.4, 9.5]),
  size("M6", "M6", "metric", 6, 5, 6.4, 6.6, [10, 6], [13.44, 3.72]),
  size("4-40", "#4-40", "imperial", 2.845, 2.26, 2.95, 3.26, [5.5, 2.84], [5.6, 1.7]),
  size("6-32", "#6-32", "imperial", 3.505, 2.85, 3.66, 3.97, [6.86, 3.51], [7.1, 2.1]),
  size("1/4-20", "1/4-20", "imperial", 6.35, 5.1, 6.53, 6.75, [9.53, 6.35], [12.7, 3.5]),
];

export type HoleFit = "printed" | "insert" | "normal" | "close" | "tap";

export const FITS: { id: HoleFit; label: string; title: string }[] = [
  { id: "printed", label: "Clearance for printing", title: "The screw slides through a printed hole: its size plus your printer's hole offset" },
  { id: "insert", label: "Heat-set insert", title: "A hole to melt a brass insert into, for a thread that lasts" },
  { id: "normal", label: "Clearance", title: "The screw slides through a drilled or machined hole" },
  { id: "close", label: "Close", title: "A snug fit that still clears the thread" },
  { id: "tap", label: "Tap", title: "The tap drill: cut or self-tap a thread into it" },
];

export function screw(id: string): ScrewSize | undefined {
  return SCREWS.find((s) => s.id === id);
}

/** The hole's diameter for a size and fit, with the printer's offset for a printed clearance; null if it has none. */
export function holeDiameter(s: ScrewSize, fit: HoleFit, offset = DEFAULT_HOLE_OFFSET): number | null {
  if (fit === "printed") return Math.round((s.nominal + offset) * 1000) / 1000;
  if (fit === "insert") return s.insert?.diameter ?? null;
  return s[fit];
}

const mm = (n: number) => `${Math.round(n * 100) / 100} mm`;

/** The Fit control's text, with the diameter it comes to: "Clearance for printing (3.4 mm)". */
export function fitLabel(s: ScrewSize, fit: HoleFit, offset = DEFAULT_HOLE_OFFSET): string {
  const label = FITS.find((f) => f.id === fit)!.label;
  const d = holeDiameter(s, fit, offset);
  return d === null ? `${label} (none for ${s.label})` : `${label} (${mm(d)})`;
}

/** One line under the Fit control, in the brand book's voice, explaining what the fit does. */
export function fitNote(s: ScrewSize, fit: HoleFit, offset = DEFAULT_HOLE_OFFSET): string {
  const d = holeDiameter(s, fit, offset);
  switch (fit) {
    case "printed":
      return `Printed holes come out small. ${s.label} → ${mm(d!)} so a screw slides in.`;
    case "insert":
      return s.insert
        ? `For a ${s.label} heat-set insert: ${mm(s.insert.diameter)} across, at least ${mm(s.insert.depth + 1)} deep. Press it in with a soldering iron.`
        : `There's no heat-set insert for ${s.label} in the table. Pick another fit.`;
    case "normal":
      return `${s.label} → ${mm(d!)}, for a drilled hole. Printed, it may be tight.`;
    case "close":
      return `${s.label} → ${mm(d!)}: a snug fit for a drilled or reamed hole.`;
    case "tap":
      return `${s.label} → ${mm(d!)}: cut a thread, or let a screw cut its own in plastic.`;
  }
}
