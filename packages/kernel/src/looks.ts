/**
 * Colours and finishes (#196): how a body looks in a render and in glTF. A finish is a roughness and metalness
 * preset for a printing material. A colour shows in the modelling view too; a finish shows only in renders and
 * exports, so the modelling view keeps its plain shading.
 */
import type { CataloguePart } from "./catalogue";
import type { PbrLook } from "./export/gltf";

export type FinishId = "matte-pla" | "glossy-petg" | "silk" | "metal" | "rubber";

export interface Finish {
  id: FinishId;
  label: string;
  /** What it is for, for the menu's tooltip. */
  note: string;
  roughness: number;
  metalness: number;
}

export const FINISHES: Finish[] = [
  { id: "matte-pla", label: "Matte PLA", note: "Most printed parts", roughness: 0.85, metalness: 0 },
  { id: "glossy-petg", label: "Glossy PETG", note: "A shiny plastic", roughness: 0.25, metalness: 0 },
  { id: "silk", label: "Silk", note: "Silk PLA's pearly sheen", roughness: 0.35, metalness: 0.55 },
  { id: "metal", label: "Metal", note: "Bearings, shafts and screws", roughness: 0.3, metalness: 1 },
  { id: "rubber", label: "Rubber (TPU)", note: "Tyres and feet", roughness: 0.95, metalness: 0 },
];

export const DEFAULT_FINISH: FinishId = "matte-pla";

export const finishById = (id: FinishId | undefined): Finish => FINISHES.find((f) => f.id === id) ?? FINISHES[0]!;

/** Filament colours to pick from; any other colour comes from the custom picker. sRGB hex. */
export const FILAMENT_COLOURS: { name: string; hex: string }[] = [
  { name: "White", hex: "#f2f2ee" },
  { name: "Grey", hex: "#8c8f94" },
  { name: "Black", hex: "#26272a" },
  { name: "Red", hex: "#d2332e" },
  { name: "Orange", hex: "#f07a1a" },
  { name: "Yellow", hex: "#f4c81d" },
  { name: "Green", hex: "#3a9d4a" },
  { name: "Blue", hex: "#2d6fd0" },
  { name: "Purple", hex: "#7e4fc1" },
];

/** The light grey a body without a colour exports and renders in. */
export const DEFAULT_COLOUR = "#b4b4b4";

/** What a body's look depends on. */
export interface Looked {
  colour?: string;
  finish?: FinishId;
  catalogue?: CataloguePart;
}

/** A body's finish: its own, or a catalogue part's sensible one (bearings are metal, the rest matte). */
export function finishOf(p: Looked): FinishId {
  if (p.finish) return p.finish;
  return p.catalogue?.category === "bearing" ? "metal" : DEFAULT_FINISH;
}

/** "#rrggbb" when the text is one, else undefined. */
export function parseHex(s: string | undefined): string | undefined {
  return s && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : undefined;
}

/** sRGB hex to the linear 0..1 values glTF's base colour wants. */
export function linearRgb(hex: string): [number, number, number] {
  const h = parseHex(hex) ?? DEFAULT_COLOUR;
  const c = (i: number) => {
    const v = parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    const l = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return Math.round(l * 1e4) / 1e4;
  };
  return [c(0), c(1), c(2)];
}

/** A body's PBR look for glTF and renders. */
export function pbrOf(p: Looked): PbrLook {
  const f = finishById(finishOf(p));
  return { color: linearRgb(p.colour ?? DEFAULT_COLOUR), roughness: f.roughness, metalness: f.metalness };
}
