import type { Board, CopperLayer, ElectronicsDesign, Id, Via } from "../model";

/**
 * The board's layers (#648): two, four or six of copper, the inner ones "in1", "in2" and so on from the top down.
 * A via joins every layer unless it has a span, which makes it blind (from an outside layer part of the way in) or
 * buried (between inner layers only).
 */
export const LAYER_COUNTS = [2, 4, 6] as const;
export type LayerCount = (typeof LAYER_COUNTS)[number];

/** The board's copper layers, top to bottom. */
export function layersOf(board: Pick<Board, "copperLayers">): CopperLayer[] {
  const inner = Array.from({ length: Math.max(0, (board.copperLayers ?? 2) - 2) }, (_, i): CopperLayer => `in${i + 1}`);
  return ["top", ...inner, "bottom"];
}

/** A layer's name as it is shown: "Top copper", "Inner 1 copper". */
export const layerName = (l: CopperLayer): string => (l === "top" ? "Top copper" : l === "bottom" ? "Bottom copper" : `Inner ${l.slice(2)} copper`);
export const layerShort = (l: CopperLayer): string => (l === "top" ? "Top" : l === "bottom" ? "Bottom" : `Inner ${l.slice(2)}`);

/** The layers a via joins: all of them, or those of its span. A span the board no longer has joins what is left of it. */
export function viaLayers(board: Pick<Board, "copperLayers">, via: Pick<Via, "span">): CopperLayer[] {
  const all = layersOf(board);
  if (!via.span) return all;
  const a = all.indexOf(via.span[0]);
  const b = all.indexOf(via.span[1]);
  if (a < 0 || b < 0 || a === b) return all;
  return all.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** What kind of via a span makes. */
export function viaKind(board: Pick<Board, "copperLayers">, via: Pick<Via, "span">): "through" | "blind" | "buried" {
  const all = layersOf(board);
  const on = viaLayers(board, via);
  if (on.length === all.length) return "through";
  return on[0] === "top" || on[on.length - 1] === "bottom" ? "blind" : "buried";
}

/** One sheet of the build, top to bottom. */
export interface Ply {
  kind: "copper" | "prepreg" | "core";
  /** For copper: the layer it is. */
  layer?: CopperLayer;
  /** mm. */
  thickness: number;
}

export interface Stack {
  id: string;
  name: string;
  layers: LayerCount;
  /** What the plies add up to as written here, mm. A board of another thickness has thicker or thinner sheets between its copper. */
  thickness: number;
  plies: Ply[];
  note: string;
}

const cu = (layer: CopperLayer, thickness: number): Ply => ({ kind: "copper", layer, thickness });
const build = (id: string, name: string, layers: LayerCount, plies: Ply[], note: string): Stack => ({
  id,
  name,
  layers,
  thickness: Math.round(plies.reduce((n, p) => n + p.thickness, 0) * 1000) / 1000,
  plies,
  note,
});

/**
 * Builds to start from. These are usual builds of FR-4, written here by us: they are not any board house's own. A
 * house's sheet thicknesses differ a little, and it is theirs that matter for controlled impedance.
 */
export const STACKS: Stack[] = [
  build("2", "2 layers", 2, [cu("top", 0.035), { kind: "core", thickness: 1.53 }, cu("bottom", 0.035)], "One core with 1 oz copper on each side."),
  build(
    "4",
    "4 layers",
    4,
    [
      cu("top", 0.035),
      { kind: "prepreg", thickness: 0.2 },
      cu("in1", 0.0175),
      { kind: "core", thickness: 1.095 },
      cu("in2", 0.0175),
      { kind: "prepreg", thickness: 0.2 },
      cu("bottom", 0.035),
    ],
    "Signals outside, two planes close under them: ground on Inner 1 and power on Inner 2 is the usual choice.",
  ),
  build(
    "6",
    "6 layers",
    6,
    [
      cu("top", 0.035),
      { kind: "prepreg", thickness: 0.1 },
      cu("in1", 0.0175),
      { kind: "core", thickness: 0.55 },
      cu("in2", 0.0175),
      { kind: "prepreg", thickness: 0.16 },
      cu("in3", 0.0175),
      { kind: "core", thickness: 0.55 },
      cu("in4", 0.0175),
      { kind: "prepreg", thickness: 0.1 },
      cu("bottom", 0.035),
    ],
    "Signals outside and on Inner 2 and 3, with ground on Inner 1 and power on Inner 4.",
  ),
];

/** The build a board is made as: the one it names, else the first with its number of layers. */
export const stackOf = (board: Pick<Board, "copperLayers" | "stack">): Stack =>
  STACKS.find((s) => s.id === board.stack && s.layers === board.copperLayers) ?? STACKS.find((s) => s.layers === (board.copperLayers ?? 2)) ?? STACKS[0]!;

/** The build at the board's own thickness: the copper as it is, the sheets between made thicker or thinner to suit. */
export function buildOf(board: Pick<Board, "copperLayers" | "stack" | "thickness">): Ply[] {
  const stack = stackOf(board);
  const copper = stack.plies.reduce((n, p) => n + (p.kind === "copper" ? p.thickness : 0), 0);
  const scale = Math.max(0.05, board.thickness - copper) / (stack.thickness - copper);
  return stack.plies.map((p) => (p.kind === "copper" ? p : { ...p, thickness: Math.round(p.thickness * scale * 1000) / 1000 }));
}

/** How far below the top of the board each copper layer's top face lies, mm. */
export function layerDepths(board: Pick<Board, "copperLayers" | "stack" | "thickness">): Partial<Record<CopperLayer, number>> {
  const out: Partial<Record<CopperLayer, number>> = {};
  let z = 0;
  for (const p of buildOf(board)) {
    if (p.layer) out[p.layer] = Math.round(z * 1000) / 1000;
    z += p.thickness;
  }
  return out;
}

const onBoard = (d: ElectronicsDesign, change: (b: Board) => Board): ElectronicsDesign => {
  const next = d.board && change(d.board);
  return next && next !== d.board ? { ...d, board: next } : d;
};

/**
 * Takes a build: its number of layers. The board keeps its thickness. Copper on a layer the board no longer has is
 * taken away with it, and a via whose span has lost an end goes right through again.
 */
export function setStack(d: ElectronicsDesign, id: string): ElectronicsDesign {
  const stack = STACKS.find((s) => s.id === id);
  if (!stack) return d;
  return onBoard(d, (b) => {
    const next: Board = { ...b, copperLayers: stack.layers, stack: stack.id };
    const have = new Set(layersOf(next));
    const tracks = b.tracks.filter((t) => have.has(t.layer));
    const pours = b.pours.filter((p) => have.has(p.layer));
    const vias = b.vias.map((v) => {
      if (!v.span || (have.has(v.span[0]) && have.has(v.span[1]))) return v;
      const through = { ...v };
      delete through.span;
      return through;
    });
    return { ...next, tracks, pours, vias };
  });
}

/** What taking a build would take off the board: tracks and pours on layers it does not have. */
export function stackLoses(board: Board, id: string): { tracks: number; pours: number } {
  const stack = STACKS.find((s) => s.id === id);
  if (!stack) return { tracks: 0, pours: 0 };
  const have = new Set(layersOf({ copperLayers: stack.layers }));
  return { tracks: board.tracks.filter((t) => !have.has(t.layer)).length, pours: board.pours.filter((p) => !have.has(p.layer)).length };
}

/** Makes a via join only some layers, or (with no span, or the whole board) go right through. */
export function setViaSpan(d: ElectronicsDesign, id: Id, span?: [CopperLayer, CopperLayer]): ElectronicsDesign {
  return onBoard(d, (b) => {
    const all = layersOf(b);
    const whole = !span || all.indexOf(span[0]) < 0 || all.indexOf(span[1]) < 0 || viaLayers(b, { span }).length === all.length;
    return {
      ...b,
      vias: b.vias.map((v) => {
        if (v.id !== id) return v;
        const rest = { ...v };
        delete rest.span;
        if (whole) return rest;
        const [a, c] = [all.indexOf(span[0]), all.indexOf(span[1])];
        return { ...rest, span: [all[Math.min(a, c)]!, all[Math.max(a, c)]!] };
      }),
    };
  });
}
