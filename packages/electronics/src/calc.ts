/**
 * Calculators (#739): pure sums for beginners, with where each comes from.
 *
 * - Track width and via current: IPC-2221 (2012), section 6.2, from its conductor current charts:
 *   I = k · ΔT^0.44 · A^0.725, with I in amps, ΔT the temperature rise in °C, A the cross-section in square mils,
 *   k = 0.048 for an outer layer and 0.024 for an inner one. Charted for up to 35 A, 400 mil wide and 10 to 100 °C.
 * - Copper weight: 1 oz/ft² is 34.79 µm (1.37 mil) thick.
 * - A via's barrel is taken as a ring of plating round its hole, 25 µm unless said, and rated as outer copper, as the
 *   usual calculators do.
 * - LED resistor: Ohm's law, R = (V supply − V forward) / I, rounded up to the E24 series so the current only falls.
 * - Resistor colour bands: IEC 60062.
 */

const MIL = 0.0254; // mm
const OZ = 0.03479; // mm of copper per oz/ft²

const k = (outer: boolean) => (outer ? 0.048 : 0.024);

export interface TrackAsk {
  /** Amps. */
  current: number;
  /** °C above the board's surroundings. */
  rise: number;
  /** Copper weight, oz/ft². */
  oz: number;
  /** On the top or bottom, in the air; inside the board runs hotter. */
  outer: boolean;
}

/** The narrowest track, in mm, that carries `current` with no more than `rise` of heating (IPC-2221). */
export function trackWidth({ current, rise, oz, outer }: TrackAsk): number {
  if (!(current > 0 && rise > 0 && oz > 0)) return 0;
  const area = (current / (k(outer) * rise ** 0.44)) ** (1 / 0.725); // mil²
  return (area / ((oz * OZ) / MIL)) * MIL;
}

/** The current, in amps, a track of `width` mm carries with `rise` of heating: the other way round. */
export function trackCurrent(width: number, { rise, oz, outer }: Omit<TrackAsk, "current">): number {
  if (!(width > 0 && rise > 0 && oz > 0)) return 0;
  const area = (width / MIL) * ((oz * OZ) / MIL);
  return k(outer) * rise ** 0.44 * area ** 0.725;
}

/** The current, in amps, one via carries with `rise` of heating: its barrel is a ring of plating round the hole. */
export function viaCurrent({ drill, plating = 0.025, rise }: { drill: number; plating?: number; rise: number }): number {
  if (!(drill > 0 && plating > 0 && rise > 0)) return 0;
  const area = (Math.PI * (drill + plating) * plating) / (MIL * MIL); // mil²
  return k(true) * rise ** 0.44 * area ** 0.725;
}

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

/** The E24 value at or above `ohms`. */
export function e24Up(ohms: number): number {
  if (!(ohms > 0)) return 0;
  const decade = 10 ** Math.floor(Math.log10(ohms));
  const r = ohms / decade;
  const step = E24.find((v) => v >= r - 1e-9);
  return Number(((step ?? 10) * decade).toPrecision(3));
}

export interface LedAnswer {
  /** The exact resistance, Ω. */
  exact: number;
  /** The E24 value to fit, Ω. */
  fit: number;
  /** The current with that resistor, A. */
  current: number;
  /** What the resistor burns, W. */
  power: number;
}

/** The resistor for an LED (Ohm's law), or nothing when the supply is not above the LED's forward voltage. */
export function ledResistor({ supply, forward, current }: { supply: number; forward: number; current: number }): LedAnswer | null {
  const drop = supply - forward;
  if (!(drop > 0 && current > 0)) return null;
  const exact = drop / current;
  const fit = e24Up(exact);
  const i = drop / fit;
  return { exact, fit, current: i, power: i * i * fit };
}

/** The colours of IEC 60062, in digit order. */
export const DIGITS = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"] as const;
export type BandColour = (typeof DIGITS)[number] | "gold" | "silver";

/** What a resistor's paint looks like. Materials, not interface colours, like the board's mask colours. */
export const BAND_PAINT: Record<BandColour, string> = {
  black: "#1b1b1b",
  brown: "#7a4a24",
  red: "#d0312d",
  orange: "#f08a24",
  yellow: "#f4d03f",
  green: "#2e9b4f",
  blue: "#2f6fd6",
  violet: "#8e44ad",
  grey: "#8c8c8c",
  white: "#f4f4f4",
  gold: "#c9a227",
  silver: "#c0c0c0",
};

export const TOLERANCE: Partial<Record<BandColour, number>> = { brown: 1, red: 2, green: 0.5, blue: 0.25, violet: 0.1, gold: 5, silver: 10 };

const MULTIPLIER: Record<BandColour, number> = {
  ...(Object.fromEntries(DIGITS.map((c, i) => [c, 10 ** i])) as Record<(typeof DIGITS)[number], number>),
  gold: 0.1,
  silver: 0.01,
};

/**
 * The bands for a value: four (two figures, a multiplier and the tolerance) when two figures say it, else five.
 * Nothing for a value the bands cannot show (under 0.1 Ω, or more than three figures).
 */
export function bandsFor(ohms: number, tolerance: number): BandColour[] | null {
  if (!(ohms >= 0.1)) return null;
  const tol = (Object.entries(TOLERANCE) as [BandColour, number][]).find(([, t]) => t === tolerance)?.[0];
  if (!tol) return null;
  for (const figures of [2, 3]) {
    const exp = Math.floor(Math.log10(ohms)) - (figures - 1);
    const mant = Math.round(ohms / 10 ** exp);
    if (Math.abs(mant * 10 ** exp - ohms) > ohms * 1e-9 || mant >= 10 ** figures) continue;
    const mult = (Object.entries(MULTIPLIER) as [BandColour, number][]).find(([, m]) => Math.abs(m - 10 ** exp) < 10 ** exp * 1e-9)?.[0];
    if (!mult) return null;
    return [...[...String(mant).padStart(figures, "0")].map((d): BandColour => DIGITS[Number(d)]!), mult, tol];
  }
  return null;
}

/** A value and its tolerance (%) from four or five bands. */
export function ohmsFromBands(bands: BandColour[]): { ohms: number; tolerance: number } | null {
  if (bands.length !== 4 && bands.length !== 5) return null;
  const figures = bands.slice(0, -2);
  const digits = figures.map((b) => DIGITS.indexOf(b as (typeof DIGITS)[number]));
  const tolerance = TOLERANCE[bands[bands.length - 1]!];
  if (digits.some((d) => d < 0) || tolerance === undefined) return null;
  const ohms = Number(digits.join("")) * MULTIPLIER[bands[bands.length - 2]!];
  return { ohms: Number(ohms.toPrecision(6)), tolerance };
}

/** Ω written the way a part's value is: 470 Ω, 4.7 kΩ, 1 MΩ. */
export function ohmsText(ohms: number): string {
  const [div, unit] = ohms >= 1e6 ? [1e6, "MΩ"] : ohms >= 1e3 ? [1e3, "kΩ"] : [1, "Ω"];
  return `${Number((ohms / div).toPrecision(3))} ${unit}`;
}
