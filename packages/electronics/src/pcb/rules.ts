import { DEFAULT_RULES, type ElectronicsDesign, type Rules } from "../model";
import data from "./presets.json";

/**
 * Rule presets (#643): a board house's limits as data, each with the page it was read from and the day it was read.
 * Adding a house is an entry in `presets.json`, no code.
 */
export interface Preset {
  id: string;
  name: string;
  /** Where the numbers came from, and when they were last checked (YYYY-MM-DD). None for our own set. */
  source?: string;
  checked?: string;
  rules: Rules;
  /** The fields that are our working values and not the house's limits. */
  ours?: string[];
  notes?: string[];
}

export const PRESETS: Preset[] = [{ id: "safe", name: "Safe for most board houses", rules: { ...DEFAULT_RULES } }, ...(data.presets as Preset[])];

/** The preset a board's rules came from. */
export const presetOf = (rules: Rules): Preset | undefined => PRESETS.find((p) => p.id === (rules.preset ?? "safe"));

/** True when the rules still match their preset, number for number. */
export function matchesPreset(rules: Rules): boolean {
  const p = presetOf(rules);
  return !!p && RULE_FIELDS.every((f) => (rules[f.id] ?? undefined) === (p.rules[f.id] ?? undefined));
}

/** The rules as fields to show and edit, in the order they are worth reading. */
export const RULE_FIELDS: { id: Exclude<keyof Rules, "preset">; label: string; hint: string }[] = [
  { id: "clearance", label: "Clearance", hint: "The gap copper on different nets keeps" },
  { id: "trackWidth", label: "Track width", hint: "The width new tracks start with" },
  { id: "minTrackWidth", label: "Narrowest track", hint: "Tracks thinner than this are flagged" },
  { id: "viaDiameter", label: "Via size", hint: "The copper round a new via, edge to edge" },
  { id: "viaDrill", label: "Via hole", hint: "The hole of a new via" },
  { id: "minDrill", label: "Smallest hole", hint: "Holes smaller than this are flagged" },
  { id: "minRing", label: "Ring round a hole", hint: "The least copper round a pad's hole" },
  { id: "minViaRing", label: "Ring round a via", hint: "The least copper round a via's hole" },
  { id: "holeToHole", label: "Hole to hole", hint: "The least gap between two holes" },
  { id: "copperToEdge", label: "Copper to edge", hint: "The gap copper keeps from the board's edge" },
  { id: "minSilkWidth", label: "Thinnest silkscreen line", hint: "Thinner lines may not print" },
  { id: "minSilkHeight", label: "Smallest silkscreen text", hint: "Smaller text may not be readable" },
  { id: "maskMargin", label: "Solder mask margin", hint: "How far the mask opens beyond a pad" },
];

/** Swaps the board's rules for a preset's. Net classes keep their own sizes. */
export function applyPreset(d: ElectronicsDesign, id: string): ElectronicsDesign {
  const p = PRESETS.find((x) => x.id === id);
  if (!p || !d.board) return d;
  return { ...d, board: { ...d.board, rules: { ...p.rules, ...(p.id === "safe" ? {} : { preset: p.id }) } } };
}

/** Changes one rule. The preset's name stays, so the card can say the rules were changed from it. */
export function setRule(d: ElectronicsDesign, field: Exclude<keyof Rules, "preset">, value: number | undefined): ElectronicsDesign {
  if (!d.board || (value !== undefined && !(value >= 0))) return d;
  const rules = { ...d.board.rules };
  if (value === undefined) {
    if (field !== "minViaRing") return d;
    delete rules.minViaRing;
  } else rules[field] = value;
  return { ...d, board: { ...d.board, rules } };
}
