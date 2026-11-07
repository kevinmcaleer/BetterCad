/**
 * Printer profiles (#180): the printers someone owns, each with its bed, hole offset (#104) and fit gaps (#181). A
 * model keeps a snapshot of the values in its print settings, so it builds the same for someone without the profile.
 */
import { GAP_FITS, fitGap, type FitGaps } from "./fits";
import { DEFAULT_PRINTER, holeOffsetOf, PRINTERS, type PrintSettings } from "./printers";

export interface PrinterProfile {
  id: string;
  name: string;
  /** A preset's id, or "custom". */
  printer: string;
  custom?: { x: number; y: number; z: number };
  /** What printed holes add to their diameter, mm. */
  holeOffset: number;
  /** Fit gaps on each side, mm. */
  fits: Required<FitGaps>;
  /** A material's id. */
  material?: string;
  /** When it last changed, from the server or this browser. */
  modified?: string;
}

const allFits = (s: PrintSettings): Required<FitGaps> => Object.fromEntries(GAP_FITS.map((f) => [f.id, fitGap(f.id, s.fits)])) as Required<FitGaps>;

/** A profile made from what the model uses now. */
export function profileFromSettings(id: string, name: string, s: PrintSettings): PrinterProfile {
  const p: PrinterProfile = { id, name, printer: s.printer ?? DEFAULT_PRINTER, holeOffset: holeOffsetOf(s), fits: allFits(s) };
  if (p.printer === "custom" && s.custom) p.custom = { ...s.custom };
  if (s.material) p.material = s.material;
  return p;
}

/** The model's print settings with a profile's values copied in. Infill stays: it belongs to the part, not the printer. */
export function applyProfile(s: PrintSettings, p: PrinterProfile): PrintSettings {
  const out: PrintSettings = { ...s, profile: p.id, printer: p.printer, holeOffset: p.holeOffset, fits: { ...p.fits } };
  if (p.printer === "custom" && p.custom) out.custom = { ...p.custom };
  else delete out.custom;
  if (p.material) out.material = p.material;
  return out;
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Whether the model's settings still match the profile, or have been changed since it was picked. */
export function matchesProfile(s: PrintSettings, p: PrinterProfile): boolean {
  if ((s.printer ?? DEFAULT_PRINTER) !== p.printer) return false;
  if (p.printer === "custom" && JSON.stringify(s.custom ?? null) !== JSON.stringify(p.custom ?? null)) return false;
  if (!same(holeOffsetOf(s), p.holeOffset)) return false;
  const f = allFits(s);
  if (GAP_FITS.some((x) => !same(f[x.id], p.fits[x.id]))) return false;
  return !p.material || s.material === p.material;
}

/** Checks a profile read from storage or the server, dropping anything that isn't one. */
export function readProfile(x: unknown): PrinterProfile | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string" || typeof o.printer !== "string") return null;
  if (o.printer !== "custom" && !PRINTERS.some((p) => p.id === o.printer)) return null;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const fits = (o.fits && typeof o.fits === "object" ? o.fits : {}) as Record<string, unknown>;
  const p: PrinterProfile = {
    id: o.id,
    name: o.name,
    printer: o.printer,
    holeOffset: num(o.holeOffset, 0.4),
    fits: Object.fromEntries(GAP_FITS.map((f) => [f.id, num(fits[f.id], f.gap)])) as Required<FitGaps>,
  };
  const c = o.custom as Record<string, unknown> | undefined;
  if (o.printer === "custom" && c) p.custom = { x: num(c.x, 200), y: num(c.y, 200), z: num(c.z, 200) };
  if (typeof o.material === "string") p.material = o.material;
  if (typeof o.modified === "string") p.modified = o.modified;
  return p;
}
