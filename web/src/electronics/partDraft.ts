import { checkPinMap, type ComponentDef, type FootprintDef, type Model3D, type PackageChoice, type SymbolDef } from "@bettercad/electronics";
import {
  bgaFootprint,
  bodyBox,
  checkFootprint,
  chipFootprint,
  dipFootprint,
  dualFootprint,
  formatPinTable,
  headerPins,
  icSymbol,
  parsePinTable,
  quadFootprint,
  simpleBody,
  type BgaSizes,
  type ChipSizes,
  type DipSizes,
  type DualSizes,
  type HeaderSizes,
  type QuadSizes,
} from "@bettercad/electronics/tools";
import { checkSymbol } from "./symbolEdit";

/** The package families the footprint wizard makes. "keep" leaves the footprints of the part being edited alone. */
export type Family = "keep" | "chip" | "dual" | "quad" | "dip" | "header" | "bga";
export type BodyKind = "auto" | "none" | "box" | "cylinder" | "step";

/** A STEP file chosen as the body (#628): where its bytes are and what was found in it. */
export interface StepBody {
  blob: string;
  name: string;
  bodies: number;
  size: [number, number, number];
}

export interface Sizes {
  chip: ChipSizes;
  dual: DualSizes;
  quad: QuadSizes;
  dip: DipSizes;
  header: HeaderSizes;
  bga: BgaSizes;
}

/** A part while it is being made or changed: what the editor's fields hold. */
export interface Draft {
  /** The part of your library this will save over. None: a new part. */
  id?: string;
  /** The component this started from, whose drawing and footprints can be kept. */
  base?: ComponentDef;
  name: string;
  prefix: string;
  value: string;
  description: string;
  keywords: string;
  datasheet: string;
  shelf: string;
  licence: string;
  /** Who to credit: you, or where the part came from. */
  credit: string;
  manufacturer: string;
  mpn: string;
  lcsc: string;
  /** The pin table, a pin a line. */
  pins: string;
  /** Draw the symbol as a box from the pin table, not the drawing it came with. */
  box: boolean;
  /** The symbol drawn by hand (#626). While it is set it is the symbol, pins and all, and the pin table rests. */
  drawn?: SymbolDef;
  family: Family;
  sizes: Sizes;
  /** The footprint changed pad by pad (#627). While it is set it is the footprint, and the package's sizes rest. */
  land?: FootprintDef;
  body: BodyKind;
  /** A box's width, length and height, or a cylinder's diameter (w) and height, mm. */
  bodySize: { w: number; l: number; h: number };
  /** The STEP file that is the body, while `body` is "step". */
  step?: StepBody;
  /** Where the file's bottom centre sits from the footprint's origin (z is the lift off the board), and its turns, degrees. */
  stepAt: [number, number, number];
  stepTurn: [number, number, number];
}

/** A short list to pick from; the first is what a part you drew yourself starts with. */
export const LICENCES = [
  "CC0 1.0 (no rights kept)",
  "CC-BY 4.0",
  "CC-BY-SA 4.0",
  "CC-BY-SA 4.0 with the KiCad libraries exception",
  "MIT",
  "All rights reserved",
  "Not set",
];

interface FieldDef {
  key: string;
  label: string;
  /** A count, not a length. */
  whole?: boolean;
  min: number;
  max?: number;
}
export const FAMILIES: { id: Exclude<Family, "keep">; label: string; hint: string; fields: FieldDef[] }[] = [
  {
    id: "chip",
    label: "Two-pad chip",
    hint: "Resistors, capacitors, LEDs and diodes: 0402, 0603, 0805.",
    fields: [
      { key: "bodyL", label: "Body length", min: 0.2 },
      { key: "bodyW", label: "Body width", min: 0.2 },
      { key: "padW", label: "Pad length", min: 0.1 },
      { key: "padH", label: "Pad width", min: 0.1 },
      { key: "pitch", label: "Pad centre to pad centre", min: 0.2 },
    ],
  },
  {
    id: "dual",
    label: "Two rows, surface mount",
    hint: "SOIC, SOP, SSOP, TSSOP and MSOP.",
    fields: [
      { key: "pins", label: "Pins", whole: true, min: 2, max: 200 },
      { key: "pitch", label: "Pin pitch", min: 0.2 },
      { key: "span", label: "Row centre to row centre", min: 0.5 },
      { key: "padW", label: "Pad length", min: 0.1 },
      { key: "padH", label: "Pad width", min: 0.1 },
      { key: "bodyW", label: "Body width", min: 0.5 },
      { key: "bodyL", label: "Body length", min: 0.5 },
    ],
  },
  {
    id: "quad",
    label: "Four sides",
    hint: "QFP and QFN. Give a centre pad for a QFN.",
    fields: [
      { key: "pins", label: "Pins", whole: true, min: 4, max: 400 },
      { key: "pitch", label: "Pin pitch", min: 0.2 },
      { key: "span", label: "Row centre to row centre", min: 0.5 },
      { key: "padW", label: "Pad length", min: 0.1 },
      { key: "padH", label: "Pad width", min: 0.1 },
      { key: "body", label: "Body side", min: 0.5 },
      { key: "centre", label: "Centre pad side", min: 0 },
    ],
  },
  {
    id: "dip",
    label: "DIP, through hole",
    hint: "Two rows of holes: 7.62 mm apart, or 15.24 mm for a wide one.",
    fields: [
      { key: "pins", label: "Pins", whole: true, min: 2, max: 100 },
      { key: "pitch", label: "Pin pitch", min: 0.5 },
      { key: "span", label: "Row to row", min: 1 },
      { key: "drill", label: "Hole", min: 0.2 },
      { key: "pad", label: "Pad", min: 0.4 },
    ],
  },
  {
    id: "header",
    label: "Pin header",
    hint: "One or two rows of pins or sockets.",
    fields: [
      { key: "rows", label: "Rows", whole: true, min: 1, max: 2 },
      { key: "pins", label: "Pins in a row", whole: true, min: 1, max: 100 },
      { key: "pitch", label: "Pin pitch", min: 0.5 },
      { key: "drill", label: "Hole", min: 0.2 },
      { key: "pad", label: "Pad", min: 0.4 },
    ],
  },
  {
    id: "bga",
    label: "Ball grid",
    hint: "BGA: rows lettered from A, columns numbered from 1.",
    fields: [
      { key: "rows", label: "Rows", whole: true, min: 1, max: 60 },
      { key: "cols", label: "Columns", whole: true, min: 1, max: 60 },
      { key: "pitch", label: "Ball pitch", min: 0.2 },
      { key: "ball", label: "Pad", min: 0.1 },
      { key: "bodyW", label: "Body width", min: 0.5 },
      { key: "bodyL", label: "Body length", min: 0.5 },
    ],
  },
];

const startSizes = (): Sizes => ({
  chip: { bodyL: 1.6, bodyW: 0.8, padW: 0.8, padH: 0.95, pitch: 1.65 },
  dual: { pins: 8, pitch: 1.27, span: 4.95, padW: 1.95, padH: 0.6, bodyW: 3.9, bodyL: 4.9 },
  quad: { pins: 32, pitch: 0.8, span: 8.4, padW: 1.5, padH: 0.55, body: 7, centre: 0 },
  dip: { pins: 8, pitch: 2.54, span: 7.62, drill: 0.8, pad: 1.6 },
  header: { rows: 1, pins: 4, pitch: 2.54, drill: 1, pad: 1.7 },
  bga: { rows: 4, cols: 4, pitch: 0.8, ball: 0.4, bodyW: 4, bodyL: 4 },
});

export function newDraft(): Draft {
  return {
    name: "",
    prefix: "U",
    value: "",
    description: "",
    keywords: "",
    datasheet: "",
    shelf: "",
    licence: LICENCES[0]!,
    credit: "",
    manufacturer: "",
    mpn: "",
    lcsc: "",
    pins: "1\tVCC\tpower in\n2\tIN\tinput\n3\tOUT\toutput\n4\tGND\tpower in",
    box: true,
    family: "dual",
    sizes: { ...startSizes(), dual: { ...startSizes().dual, pins: 4, bodyL: 2.4 } },
    body: "auto",
    bodySize: { w: 4, l: 5, h: 1.5 },
    stepAt: [0, 0, 0],
    stepTurn: [0, 0, 0],
  };
}

/** A draft to change one of your parts (`id`), or to make your own copy of a library part. */
export function draftFrom(def: ComponentDef, opts: { id?: string; shelf?: string } = {}): Draft {
  const seen = new Set<string>();
  const pins = def.symbol.pins
    .filter((p) => !seen.has(p.number) && seen.add(p.number))
    .map((p) => ({ number: p.number, name: p.name, type: p.type }))
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const mine = !!opts.id;
  // A body that came from a file stays one, where it was put.
  const model = def.packages[0]?.model;
  const src = model?.source.kind === "step" ? model.source : undefined;
  const step: Partial<Draft> = src
    ? {
        body: "step",
        step: { blob: src.blob, name: src.name ?? "Body", bodies: src.bodies ?? 1, size: src.size ?? [1, 1, 1] },
        stepAt: model!.offset ?? [0, 0, 0],
        stepTurn: model!.rotate ?? [0, 0, 0],
      }
    : {};
  return {
    ...newDraft(),
    ...(opts.id ? { id: opts.id } : {}),
    base: def,
    name: mine ? def.name : `${def.name} copy`,
    prefix: def.prefix,
    value: def.value ?? "",
    description: def.description ?? "",
    keywords: (def.keywords ?? []).join(", "),
    datasheet: def.datasheet ?? "",
    shelf: opts.shelf ?? "",
    // A copy of someone's part keeps their licence and their name on it.
    licence: def.source?.licence ?? LICENCES[0]!,
    credit: def.source?.library === "You" ? "" : (def.source?.library ?? ""),
    manufacturer: def.supplier?.manufacturer ?? "",
    mpn: def.supplier?.mpn ?? "",
    lcsc: def.supplier?.lcsc ?? "",
    pins: formatPinTable(pins),
    box: false,
    family: def.packages.length ? "keep" : "dual",
    sizes: startSizes(),
    ...step,
  };
}

/** A symbol's pins as the pin table's text, a pin a line, in number order. */
export function tableOf(symbol: SymbolDef): string {
  const seen = new Set<string>();
  return formatPinTable(
    symbol.pins
      .filter((p) => !seen.has(p.number) && seen.add(p.number))
      .map((p) => ({ number: p.number, name: p.name, type: p.type }))
      .sort((x, y) => x.number.localeCompare(y.number, undefined, { numeric: true })),
  );
}

export interface Built {
  /** The component, or nothing while something stops it being whole. */
  def: ComponentDef | null;
  /** What to draw while editing, even when it cannot be saved yet. */
  symbol: SymbolDef;
  footprint: FootprintDef | null;
  /** The first package, with its body, even when the part cannot be saved yet. */
  pkg: PackageChoice | null;
  /** What must be put right before it can be saved. */
  problems: string[];
  /** Worth a look, but it can be saved. */
  notes: string[];
}

const fpName = (d: Draft): string => {
  const s = d.sizes;
  const base = d.name.trim() || "Part";
  if (d.family === "chip") return `${base} ${s.chip.bodyL}×${s.chip.bodyW} mm`;
  if (d.family === "dual") return `${base} SO-${s.dual.pins}`;
  if (d.family === "quad") return `${base} quad-${s.quad.pins}`;
  if (d.family === "dip") return `${base} DIP-${s.dip.pins}`;
  if (d.family === "header") return `${base} ${s.header.rows}×${s.header.pins}`;
  return `${base} BGA-${s.bga.rows * s.bga.cols}`;
};

/** A name of its own for a footprint changed by hand, so it never saves over the one it started from. */
function landName(d: Draft): string {
  if (d.family !== "keep" || !d.base) return fpName(d);
  const part = d.name.trim() || "Part";
  const was = (d.base.packages[0]?.footprint.name ?? "footprint").split(":").pop()!;
  return was.startsWith(`${part} `) ? was : `${part} ${was}`;
}

function footprintOf(d: Draft): FootprintDef | null {
  const s = d.sizes;
  const name = fpName(d);
  if (d.family === "chip") return chipFootprint(name, s.chip);
  if (d.family === "dual") return dualFootprint(name, s.dual);
  if (d.family === "quad") return quadFootprint(name, { ...s.quad, ...(s.quad.centre ? {} : { centre: undefined }) });
  if (d.family === "dip") return dipFootprint(name, s.dip);
  if (d.family === "header") return headerPins(name, s.header);
  if (d.family === "bga") return bgaFootprint(name, s.bga);
  return null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000 || 0;

/**
 * The box round a body after its turns (about X, then Y, then Z, degrees), from a box `size` standing with its bottom
 * centre on the origin. For sitting a turned file on the board and drawing its outline over the pads.
 */
export function turnedBox(size: [number, number, number], turn: [number, number, number]): { min: [number, number, number]; max: [number, number, number] } {
  const [a, b, c] = turn.map((t) => (t * Math.PI) / 180) as [number, number, number];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-0.5, 0.5])
    for (const sy of [-0.5, 0.5])
      for (const sz of [0, 1]) {
        let [x, y, z] = [sx * size[0], sy * size[1], sz * size[2]];
        [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
        [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
        [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)];
        [x, y, z].forEach((v, i) => {
          min[i] = Math.min(min[i]!, r3(v));
          max[i] = Math.max(max[i]!, r3(v));
        });
      }
  return { min, max };
}

/** The lift that sits a turned file's lowest point on the board. */
export const liftOntoBoard = (size: [number, number, number], turn: [number, number, number]): number => r3(-turnedBox(size, turn).min[2]);

/** The middle of a footprint's body, where a new body starts. */
export function bodyCentre(fp: FootprintDef): [number, number] {
  const b = bodyBox(fp);
  return [Math.round(((b.x1 + b.x2) / 2) * 100) / 100, Math.round(((b.y1 + b.y2) / 2) * 100) / 100];
}

function stepModel(d: Draft): Model3D | undefined {
  if (!d.step) return undefined;
  const { blob, name, bodies, size } = d.step;
  return {
    source: { kind: "step", blob, name, bodies, size },
    offset: [...d.stepAt],
    ...(d.stepTurn.some(Boolean) ? { rotate: [...d.stepTurn] } : {}),
  };
}

function bodyOf(d: Draft, fp: FootprintDef): Model3D | undefined {
  if (d.body === "none") return undefined;
  if (d.body === "step") return stepModel(d);
  const b = bodyBox(fp);
  const offset: [number, number, number] = [Math.round(((b.x1 + b.x2) / 2) * 100) / 100, Math.round(((b.y1 + b.y2) / 2) * 100) / 100, 0];
  if (d.body === "box") return { source: { kind: "box", size: [d.bodySize.w, d.bodySize.l, d.bodySize.h] }, offset };
  if (d.body === "cylinder") return { source: { kind: "cylinder", diameter: d.bodySize.w, height: d.bodySize.h }, offset };
  if (d.family === "header")
    return { source: { kind: "header", rows: d.sizes.header.rows, pins: d.sizes.header.pins, pitch: d.sizes.header.pitch, height: 2.5 } };
  return simpleBody(d.family === "dip" ? "Package_DIP:DIP" : d.family === "dual" ? "Package_SO:SOIC" : d.family === "quad" ? "QFN" : fp.name, fp);
}

/** Makes the component a draft describes, and says what stops it or deserves a look. */
export function build(d: Draft): Built {
  const problems: string[] = [];
  const notes: string[] = [];
  const table = parsePinTable(d.pins);
  for (const s of table.skipped) notes.push(`Could not read the pin line "${s.line}". ${s.why}.`);
  const name = d.name.trim();
  if (!name) problems.push("Give the part a name.");
  const twice = table.pins.map((p) => p.number).filter((n, i, all) => all.indexOf(n) !== i);
  if (twice.length) problems.push(`Pin ${[...new Set(twice)].join(", ")} is in the list more than once.`);

  let symbol: SymbolDef;
  if (d.drawn) {
    symbol = { ...d.drawn, name: name || d.drawn.name };
    const found = checkSymbol(symbol);
    // The table's own complaints are about a list nobody is using.
    problems.splice(name ? 0 : 1);
    notes.length = 0;
    problems.push(...found.problems);
    notes.push(...found.notes);
  } else if (d.base && !d.box) {
    const by = new Map(table.pins.map((p) => [p.number, p]));
    symbol = {
      ...d.base.symbol,
      name: name || d.base.symbol.name,
      pins: d.base.symbol.pins.map((p) => (by.has(p.number) ? { ...p, name: by.get(p.number)!.name, type: by.get(p.number)!.type } : p)),
    };
    const drawn = new Set(d.base.symbol.pins.map((p) => p.number));
    const extra = table.pins.filter((p) => !drawn.has(p.number)).map((p) => p.number);
    if (extra.length) notes.push(`Pin ${extra.join(", ")} is not on the drawing. Choose a box from a pin list, or draw it by hand, to add pins.`);
  } else {
    if (table.pins.length === 0) problems.push("List at least one pin.");
    symbol = icSymbol(name || "Part", table.pins);
  }

  let packages: PackageChoice[];
  let footprint: FootprintDef | null;
  if (d.land) {
    const kept = d.family === "keep" && d.base ? d.base.packages : [];
    footprint = { ...d.land, name: landName(d) };
    const model = kept[0] && d.body !== "step" ? kept[0].model : bodyOf(d, footprint);
    packages = [{ ...kept[0], footprint, ...(model ? { model } : {}) }, ...kept.slice(1)];
  } else if (d.family === "keep" && d.base) {
    // A library part keeps its footprints, and can still be given a file for its body.
    const model = d.body === "step" ? stepModel(d) : undefined;
    packages = model ? d.base.packages.map((k, i) => (i === 0 ? { ...k, model } : k)) : d.base.packages;
    footprint = packages[0]?.footprint ?? null;
  } else {
    footprint = footprintOf(d);
    const model = footprint ? bodyOf(d, footprint) : undefined;
    packages = footprint ? [{ footprint, ...(model ? { model } : {}) }] : [];
  }
  if (footprint && (d.family !== "keep" || d.land)) for (const p of checkFootprint(footprint)) (p.kind === "no-pads" ? problems : notes).push(p.text);

  const keywords = d.keywords
    .split(/[,\n]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const supplier = {
    ...(d.manufacturer.trim() ? { manufacturer: d.manufacturer.trim() } : {}),
    ...(d.mpn.trim() ? { mpn: d.mpn.trim() } : {}),
    ...(d.lcsc.trim() ? { lcsc: d.lcsc.trim() } : {}),
  };
  const def: ComponentDef = {
    name,
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    prefix: d.prefix.trim().toUpperCase() || "U",
    ...(d.value.trim() ? { value: d.value.trim() } : {}),
    symbol,
    packages,
    ...(keywords.length ? { keywords } : {}),
    ...(/^https?:\/\//.test(d.datasheet.trim()) ? { datasheet: d.datasheet.trim() } : {}),
    ...(Object.keys(supplier).length ? { supplier } : {}),
    source: {
      library: d.credit.trim() || "You",
      licence: d.licence,
      ...(d.base?.source?.url && d.credit.trim() === d.base.source.library ? { url: d.base.source.url } : {}),
    },
  };
  if (d.datasheet.trim() && !def.datasheet) notes.push("The datasheet link needs to start with https://, so it was left off.");
  for (const bad of checkPinMap(def))
    problems.push(
      `${bad.package} has no pad for ${bad.missing.length > 6 ? `${bad.missing.length} of the pins` : `pin ${bad.missing.join(", ")}`}. Change the pin numbers or the footprint.`,
    );
  if (packages.length === 0 && !symbol.power) notes.push("It has no footprint, so it cannot go on a board yet.");
  if (d.body === "step" && !d.step && packages.length) notes.push("Pick a file for the body.");
  return { def: problems.length ? null : def, symbol, footprint, pkg: packages[0] ?? null, problems, notes };
}
