/**
 * The electronics design (epic #606, #615): what a `.bcad` file keeps under `electronics`.
 *
 * One design, three views. The schematic, the board and the 3D board are views of the same parts and nets, tied by
 * ids, so keeping them in step is a comparison (`sync.ts`), never three copies.
 *
 * Everything is millimetres, x to the right and y up, angles in degrees anticlockwise. Schematics sit on a 2.54 mm
 * grid; the numbers are still millimetres.
 */

export type Id = string;
export type P2 = [number, number];

let counter = 0;
let fixed: number | null = null;
/** A fresh id. Ids only need to be unique inside one design. */
export function eid(prefix: string): Id {
  if (fixed !== null) {
    fixed += 1;
    return `${prefix}${fixed.toString(36)}`;
  }
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Runs a builder with ids counted from one, so a sample or a fixture comes out the same every time. */
export function withFixedIds<T>(build: () => T): T {
  const was = fixed;
  fixed = 0;
  try {
    return build();
  } finally {
    fixed = was;
  }
}

// ---------------------------------------------------------------- shapes

/** How a closed shape is filled: `true` with the body tint, "solid" with the line's own colour (arrow heads, dots). */
export type Fill = boolean | "solid";

/** Line work shared by symbols, footprints and the board. `fill` closes the shape and fills it. */
export type Shape =
  | { kind: "line"; pts: P2[]; width?: number; fill?: Fill }
  | { kind: "rect"; x1: number; y1: number; x2: number; y2: number; width?: number; fill?: Fill }
  | { kind: "circle"; cx: number; cy: number; r: number; width?: number; fill?: Fill }
  /** From angle `a0` anticlockwise to `a1`, degrees. */
  | { kind: "arc"; cx: number; cy: number; r: number; a0: number; a1: number; width?: number }
  | { kind: "text"; x: number; y: number; text: string; size: number; angle?: number; align?: "left" | "centre" | "right" };

// ---------------------------------------------------------------- symbols

/**
 * What a pin does, used by the electrical rules check. The names are the usual ones (KiCad's), so imported symbols
 * keep their meaning.
 */
export type PinType =
  "input" | "output" | "bidirectional" | "tristate" | "passive" | "power_in" | "power_out" | "open_collector" | "open_emitter" | "unspecified" | "no_connect";

export const PIN_TYPES: { id: PinType; label: string }[] = [
  { id: "input", label: "Input" },
  { id: "output", label: "Output" },
  { id: "bidirectional", label: "In and out" },
  { id: "tristate", label: "Three-state" },
  { id: "passive", label: "Passive" },
  { id: "power_in", label: "Power in" },
  { id: "power_out", label: "Power out" },
  { id: "open_collector", label: "Open collector" },
  { id: "open_emitter", label: "Open emitter" },
  { id: "unspecified", label: "Not set" },
  { id: "no_connect", label: "Not connected" },
];

export interface SymbolPin {
  /** The pin's number on the package ("1", "A3"). Unique in a symbol unless pins are stacked on purpose. */
  number: string;
  name: string;
  type: PinType;
  /** Where a wire joins the pin. */
  x: number;
  y: number;
  /** How long the pin's line is, from its wire end towards the body. */
  length: number;
  /** The way the pin's line runs from the wire end to the body: 0 right, 90 up, 180 left, 270 down. */
  dir: 0 | 90 | 180 | 270;
  /** The unit it belongs to in a symbol with several (1 based). None: every unit. */
  unit?: number;
  hidden?: boolean;
  /**
   * Pins that carry the same word here do the same job and can change places on the board (#645): a resistor's two
   * ends ("ends"), a gate's inputs. None: the pin stays where it is.
   */
  swap?: string;
}

export interface SymbolDef {
  name: string;
  /** How many units (gates) the symbol has; 1 for most parts. */
  units: number;
  shapes: (Shape & { unit?: number })[];
  pins: SymbolPin[];
  /** Where the reference and value texts start, before the part is moved. */
  refAt?: P2;
  valueAt?: P2;
  /** A power symbol (GND, 3V3): it is not a real part, and its value names the net its pin sits on. */
  power?: boolean;
}

// ---------------------------------------------------------------- footprints

export type PadShape = "circle" | "rect" | "roundrect" | "oval";
/** `smd`: copper on one side. `thru`: a plated hole with copper both sides. `npth`: a bare hole, no copper. */
export type PadKind = "smd" | "thru" | "npth";

export interface Pad {
  number: string;
  kind: PadKind;
  shape: PadShape;
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
  /** Corner radius of a `roundrect`, as a share of the shorter side (0 to 0.5). */
  round?: number;
  /** Hole diameter, for `thru` and `npth`. */
  drill?: number;
  /** A slot: the hole's length along the pad's x, `drill` wide. */
  slot?: number;
  /** Gap between pad and mask opening; none uses the board's rule. */
  maskMargin?: number;
  /** Gap between pad and paste opening: negative makes the opening smaller than the pad. None: the pad's own size. */
  pasteMargin?: number;
  /** No paste on this pad (test points, edge fingers). */
  noPaste?: boolean;
  /** A surface pad on the far side of the board from its part: the other face of an edge connector. */
  back?: boolean;
}

/** Layers of a footprint, named from the part's own side; flipping the part to the bottom flips them. */
export type FootprintLayer = "silk" | "fab" | "courtyard" | "copper";

export interface FootprintDef {
  name: string;
  pads: Pad[];
  shapes: (Shape & { layer: FootprintLayer })[];
  /** Where the reference text starts on the silkscreen. */
  refAt?: P2;
}

/**
 * The body of a part in 3D (#628): a STEP file kept in the model's blobs, another BetterCad model, or a simple shape
 * made from a few sizes. `offset` and `rotate` sit it on the footprint, whose origin is on the board's top face.
 */
export interface Model3D {
  source:
    /**
     * `bodies`: how many solids the file holds (one when left out). `size`: the whole file's box, mm. The file stands
     * with the bottom centre of that box on the footprint's origin before `offset` and `rotate` move it.
     */
    | { kind: "step"; blob: string; name?: string; bodies?: number; size?: [number, number, number] }
    | { kind: "model"; id: string; version?: number }
    /**
     * A part from the robot parts catalogue (#167, #624): the record it was taken from, kept whole so a catalogue
     * change never moves a board's parts. `size` is the box round it. The record's own origin goes on the footprint's
     * origin before `offset` and `rotate` move it.
     */
    | { kind: "catalogue"; part: CatalogueBody; size: [number, number, number] }
    | { kind: "box"; size: [number, number, number] }
    | { kind: "cylinder"; diameter: number; height: number }
    /** Rows of square pins on a plastic strip. */
    | { kind: "header"; rows: number; pins: number; pitch: number; height: number };
  offset?: [number, number, number];
  rotate?: [number, number, number];
  colour?: string;
}

/** A robot parts catalogue record, as `@bettercad/kernel` defines it (`CataloguePart`). Only the kernel reads inside. */
export interface CatalogueBody {
  id: string;
  version: number;
  name: string;
  model: unknown[];
  [more: string]: unknown;
}

// ---------------------------------------------------------------- components

export interface Supplier {
  manufacturer?: string;
  /** Manufacturer part number. */
  mpn?: string;
  /** LCSC part number ("C25804"), which JLCPCB's assembly BOM asks for. */
  lcsc?: string;
}

/** One package a component can come in. */
export interface PackageChoice {
  footprint: FootprintDef;
  /** Pin number to pad numbers, where they differ. None: a pin joins the pads with its own number. */
  pinMap?: Record<string, string[]>;
  model?: Model3D;
}

/**
 * A component (#622): a symbol, the packages it comes in and a 3D model for each. A design keeps its own copy of every
 * component it uses, so it opens offline and never breaks when a library changes.
 */
export interface ComponentDef {
  name: string;
  description?: string;
  /** Reference prefix: R, C, U, J. */
  prefix: string;
  /** The value a new part starts with ("10 kΩ"). */
  value?: string;
  symbol: SymbolDef;
  packages: PackageChoice[];
  keywords?: string[];
  datasheet?: string;
  supplier?: Supplier;
  /** Where it came from, shown on the part and carried into exported libraries. */
  source?: { library: string; licence: string; url?: string };
  /** A design's own copy with pins swapped on the board (#645), so it is not taken for an older copy of the part. */
  swapped?: boolean;
  /** Pick and place corrections (#659): added to the part's turn and position in the file only. */
  pnp?: { rotation?: number; dx?: number; dy?: number };
}

// ---------------------------------------------------------------- the design

/** A part in the design: one R1. Its symbols sit on sheets and its footprint on the board, all by this id. */
export interface Part {
  id: Id;
  /** Key into `defs`. */
  def: Id;
  /** "R1". Power symbols get "#PWR1" and never show it. */
  ref: string;
  value: string;
  /** Which of the component's packages it uses. */
  pkg: number;
  supplier?: Supplier;
  /** False: on the board and schematic but left off the BOM and pick and place. */
  fitted?: boolean;
}

export type Rot = 0 | 90 | 180 | 270;

/** One unit of a part placed on a sheet. */
export interface SchSymbol {
  id: Id;
  part: Id;
  unit: number;
  x: number;
  y: number;
  rot: Rot;
  /** Flipped left to right, before turning. */
  mirror?: boolean;
}

export interface Wire {
  id: Id;
  a: P2;
  b: P2;
}

export interface NetLabel {
  id: Id;
  x: number;
  y: number;
  name: string;
  rot?: Rot;
}

export interface Sheet {
  id: Id;
  name: string;
  symbols: SchSymbol[];
  wires: Wire[];
  /** Dots where crossing wires join. Ends that land on a wire join without one. */
  junctions: { id: Id; x: number; y: number }[];
  labels: NetLabel[];
  /** Marks on pins left open on purpose. */
  noConnects: { id: Id; x: number; y: number }[];
  notes?: (Shape & { id: Id })[];
  /** Things gathered in a named outline that move as one (#766). A thing is in one group at most. */
  groups?: SchGroup[];
}

/** A group on a sheet: a name, and the ids of the symbols, wires, labels and marks inside its outline. */
export interface SchGroup {
  id: Id;
  name: string;
  members: Id[];
  /** Set when the group is a circuit block dropped from the library (#767). */
  block?: PlacedBlock;
}

/** What a connection point is for: its icon and colour, and what the rules check expects of it (#767). */
export type PointKind = "power-in" | "power-out" | "ground" | "i2c-sda" | "i2c-scl" | "signal-in" | "signal-out" | "load" | "plain";

/** A place on a block's outline the rest of the design hooks on. It is a net label on the outline. */
export interface BlockPoint {
  /** The label that is the point. */
  label: Id;
  name: string;
  kind: PointKind;
  /** "3.3 V", "6 to 10 V". */
  volts?: string;
  /** What it is for, in a few words. */
  note?: string;
  /** The block does not work until this is joined. */
  required?: boolean;
}

/** A placed circuit block: which block, which version, and its points. */
export interface PlacedBlock {
  def: Id;
  version: number;
  /** The block's own tag ("MD1"): the start of its inside net names, so two copies' nets stay apart. */
  tag: string;
  points: BlockPoint[];
  /** What each part inside is for, by part id, in plain words. */
  notes?: Record<Id, string>;
  /** The outline as laid out, from the first point's label: it moves with the block. */
  frame?: { x1: number; y1: number; x2: number; y2: number };
  /** Where its parts go on the board, from the block's layout guide: millimetres from the first part, by part id (#774). */
  layout?: Record<Id, { x: number; y: number; rot: number }>;
}

// ---------------------------------------------------------------- the board

export type Side = "top" | "bottom";
/** Copper layers. Inner layers (#648) are "in1", "in2" and so on, counted down from the top. */
export type CopperLayer = "top" | "bottom" | `in${number}`;

/** A corner of an outline. `bulge` bends the edge to the next corner into an arc, as DXF does: tan(sweep / 4). */
export interface Corner {
  x: number;
  y: number;
  bulge?: number;
}

export interface Placement {
  part: Id;
  x: number;
  y: number;
  rot: number;
  side: Side;
  locked?: boolean;
  /** The part's reference and footprint name when the board last took the schematic, so changes can be listed. */
  ref?: string;
  footprint?: string;
  /** Where the reference text sits, from the part's origin, and whether it is drawn. */
  refAt?: P2;
  refHidden?: boolean;
  /** How a pad joins a pour on its net, by pad number, where it differs from the pour's own way (#641). */
  joins?: Record<string, "spokes" | "solid">;
}

export interface Track {
  id: Id;
  net: string;
  layer: CopperLayer;
  width: number;
  pts: P2[];
}

export interface Via {
  id: Id;
  net: string;
  x: number;
  y: number;
  diameter: number;
  drill: number;
  /** The first and last layer it joins (#648), for a blind or buried via. None: right through the board. */
  span?: [CopperLayer, CopperLayer];
  /** Covered by the solder mask or left open (#736), when this via differs from the board's `viaMask`. */
  mask?: ViaMask;
}

/** Whether a via's copper rings are under the solder mask (tented) or left bare. */
export type ViaMask = "covered" | "open";

export interface Pour {
  id: Id;
  net: string;
  layer: CopperLayer;
  outline: P2[];
  /** Thermal spokes to its own pads, or solid joins. */
  thermal?: boolean;
  /** Higher fills first where pours overlap. */
  priority?: number;
}

export type BoardLayer = "silk-top" | "silk-bottom" | "copper-top" | "copper-bottom";

/** A picture printed on the silkscreen: ink or bare board, a bit a cell. */
export interface BoardPicture {
  id: Id;
  layer: "silk-top" | "silk-bottom";
  /** Its bottom left corner on the board, and how wide it is, mm. Its height follows from its cells. */
  x: number;
  y: number;
  w: number;
  cols: number;
  rows: number;
  /** The ink: rows from the top, each a whole number of bytes, first cell in the top bit, as base64. */
  bits: string;
}

export interface BoardHole {
  id: Id;
  x: number;
  y: number;
  drill: number;
  /** Copper ring diameter for a plated hole; none is a bare hole. */
  pad?: number;
}

export interface Keepout {
  id: Id;
  outline: P2[];
  tracks?: boolean;
  pours?: boolean;
  parts?: boolean;
}

/** The numbers a board must obey (#643), mm. */
export interface Rules {
  /** The preset they came from ("jlcpcb-2layer"), if any. */
  preset?: string;
  /** The day the preset's numbers had last been checked when the board took them, so a later check can be offered. */
  presetChecked?: string;
  clearance: number;
  trackWidth: number;
  minTrackWidth: number;
  viaDiameter: number;
  viaDrill: number;
  minDrill: number;
  /** Narrowest copper ring round a hole. */
  minRing: number;
  /** Narrowest ring round a via's hole, where the board house allows less than for a pad. None: `minRing`. */
  minViaRing?: number;
  holeToHole: number;
  copperToEdge: number;
  minSilkWidth: number;
  minSilkHeight: number;
  maskMargin: number;
}

/** Safe for the standard 2-layer services of the common board houses; presets (#643) refine them. */
export const DEFAULT_RULES: Rules = {
  clearance: 0.2,
  trackWidth: 0.25,
  minTrackWidth: 0.15,
  viaDiameter: 0.7,
  viaDrill: 0.3,
  minDrill: 0.3,
  minRing: 0.15,
  holeToHole: 0.5,
  copperToEdge: 0.3,
  minSilkWidth: 0.15,
  minSilkHeight: 1,
  maskMargin: 0.05,
};

export interface NetClass {
  id: Id;
  name: string;
  nets: string[];
  trackWidth: number;
  clearance: number;
  viaDiameter?: number;
  viaDrill?: number;
}

export interface Board {
  /** The edge, anticlockwise, then any cut-outs. */
  outline: Corner[];
  cutouts?: Corner[][];
  /** A sketch or face in the model the outline follows (#638). */
  outlineFrom?: {
    sketch?: string;
    face?: string;
    at?: P2;
    /** Round cut-outs of the source are drilled as holes. */
    holes?: boolean;
    /** For a face: the plane it lies in, in the model, so the board can stand on it in 3D. */
    frame?: { origin: [number, number, number]; x: [number, number, number]; normal: [number, number, number] };
  };
  thickness: number;
  copperLayers: 2 | 4 | 6;
  /** The build the board is made as (#648): one of `STACKS` in pcb/stack.ts. None: plain two layers. */
  stack?: string;
  placements: Placement[];
  tracks: Track[];
  vias: Via[];
  pours: Pour[];
  texts: { id: Id; layer: BoardLayer; x: number; y: number; text: string; size: number; angle?: number }[];
  shapes: (Shape & { id: Id; layer: BoardLayer })[];
  /** Pictures on the silkscreen (#642). */
  pictures?: BoardPicture[];
  holes: BoardHole[];
  keepouts: Keepout[];
  rules: Rules;
  classes: NetClass[];
  /** What the board last took from the schematic: each net's pins, to tell a renamed net from a deleted one. */
  synced?: { nets: Record<string, string[]> };
  mask?: "green" | "black" | "blue" | "red" | "white" | "purple" | "yellow";
  silk?: "white" | "black";
  /** Whether vias are under the mask (#736). None: covered. */
  viaMask?: ViaMask;
  /** How a net looks on the board (#740), by its name: a colour for its unrouted lines and when it is lit. */
  netLooks?: Record<string, NetLook>;
}

/** Colours a net can be given (#740), each drawn from the theme's own tokens. */
export type NetColour = "green" | "orange" | "teal" | "pink" | "yellow" | "purple" | "blue";

export interface NetLook {
  colour?: NetColour;
  /** Its unrouted lines are not drawn. They still count as left to route. */
  hideAir?: true;
}

export type CheckLevel = "error" | "warning" | "ignore";

/** What a `.bcad` model keeps under `electronics`. One board per model (Kev, 2026-11-24). */
export interface ElectronicsDesign {
  /** The design's own copy of each component it uses, by id. */
  defs: Record<Id, ComponentDef>;
  parts: Part[];
  sheets: Sheet[];
  board?: Board;
  /** Rule levels changed from their defaults, and results waived with a note, by a result's stable key. */
  checks?: { levels?: Record<string, CheckLevel>; waived?: Record<string, string> };
}

export const emptySheet = (name = "Sheet 1"): Sheet => ({ id: eid("sh"), name, symbols: [], wires: [], junctions: [], labels: [], noConnects: [] });

/** A design with nothing on it. Its one sheet has a fixed id, so a view of a design that is not saved yet and its first edit agree on it. */
export const emptyDesign = (): ElectronicsDesign => ({ defs: {}, parts: [], sheets: [{ ...emptySheet(), id: "sh1" }] });

/** A rectangle outline with its bottom left corner at the origin. */
export const rectOutline = (w: number, h: number): Corner[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

export const emptyBoard = (w = 50, h = 40): Board => ({
  outline: rectOutline(w, h),
  thickness: 1.6,
  copperLayers: 2,
  placements: [],
  tracks: [],
  vias: [],
  pours: [],
  texts: [],
  shapes: [],
  holes: [],
  keepouts: [],
  rules: { ...DEFAULT_RULES },
  classes: [],
});

export const partOf = (d: ElectronicsDesign, id: Id): Part | undefined => d.parts.find((p) => p.id === id);
export const defOf = (d: ElectronicsDesign, part: Part): ComponentDef | undefined => d.defs[part.def];
export const isPower = (d: ElectronicsDesign, part: Part): boolean => !!defOf(d, part)?.symbol.power;
export const packageOf = (d: ElectronicsDesign, part: Part): PackageChoice | undefined => {
  const def = defOf(d, part);
  return def?.packages[part.pkg] ?? def?.packages[0];
};
/** The pads a pin joins on the part's package. */
export function padsOfPin(pkg: PackageChoice, pin: string): string[] {
  return pkg.pinMap?.[pin] ?? (pkg.footprint.pads.some((p) => p.number === pin) ? [pin] : []);
}
