import { boardPads, boardSize, type ElectronicsDesign } from "@bettercad/electronics";
import { copperOf } from "@bettercad/electronics/pcb/copper";
import { pourFills, pourShape } from "@bettercad/electronics/pcb/pour";
import { MASK_COLOURS } from "@bettercad/electronics/pcb/solid";
import { layersOf, viaLayers } from "@bettercad/electronics/pcb/stack";
import type { BodyMesh } from "@bettercad/kernel";
import { faceFrame, inFace, type Placement, type V3 } from "../decal/place";
import { mat4Apply, mat4ApplyDir, placeMatrix, type Part } from "../state/document";
import type { ViewDecal } from "../viewport/View3D";
import type { Colours } from "./colours";
import { drawBoard, padPath, type LayerId } from "./drawBoard";
import { HOLE, PAD, SILK, lighten } from "./materials";
import type { View2D } from "./view2d";

/**
 * The board's faces in 3D (#650): the copper, pads, holes and silkscreen of each side as a picture, laid on the top
 * and bottom faces of the Board step's body the way a decal is. The same painter draws the PCB view, with the colours
 * of the materials in place of the layer colours.
 */
/** Pixels per mm at most, and the longest side in pixels. */
const DENSITY = 24;
const LONGEST = 2048;

export interface BoardPicture {
  /** A PNG as a data: URL. */
  url: string;
  /** What it covers on the board, mm: its bottom left corner and its size. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const cache = new WeakMap<object, Partial<Record<"top" | "bottom", BoardPicture | null>>>();

/** One side of the board as a picture, drawn as it looks from the top (the bottom is laid on its face mirrored). */
export function boardPicture(d: ElectronicsDesign, side: "top" | "bottom", font = "sans-serif"): BoardPicture | null {
  const board = d.board;
  if (!board || typeof document === "undefined") return null;
  // A design is never changed in place, so a picture is good for as long as its design object lives.
  const had = cache.get(d)?.[side];
  if (had !== undefined) return had;
  const box = boardSize(board);
  const scale = Math.min(DENSITY, LONGEST / Math.max(box.w, box.h, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(box.w * scale));
  canvas.height = Math.max(2, Math.round(box.h * scale));
  const ctx = canvas.getContext("2d");
  let out: BoardPicture | null = null;
  if (ctx) {
    const mask = MASK_COLOURS[board.mask ?? "green"];
    const silk = board.silk === "black" ? SILK.black : SILK.white;
    // Copper under the mask shows as a lighter run of the mask's own colour.
    const copper = lighten(mask, 0.22);
    const colours = { font, mono: font } as Colours;
    for (const k of ["ec-pcb-bg", "ec-board"] as const) colours[k] = mask;
    for (const k of ["ec-copper-top", "ec-copper-bottom"] as const) colours[k] = copper;
    for (const k of ["ec-silk", "ec-silk-far"] as const) colours[k] = silk;
    colours["ec-pad"] = PAD;
    colours["ec-hole"] = HOLE;
    colours["ec-mark"] = mask;
    const far = side === "top" ? "bottom" : "top";
    // Only this side's copper shows: the far side and any inner layers (#648) are under it.
    const hidden = new Set<LayerId>([far, ...(layersOf(board).slice(1, -1) as LayerId[]), `silk-${far}`, "courtyard", "edge", "ratsnest"]);
    const v: View2D = { scale, ox: -box.x * scale, oy: (box.y + box.h) * scale };
    const pads = boardPads(d);
    const all = copperOf(d, pads);
    const pours = pourFills(d, pads, all)
      .filter((fill) => fill.pour.layer === side)
      .map((fill) => ({ fill, shape: pourShape(d, fill.pour, pads, all) }));
    drawBoard(
      ctx,
      v,
      { w: canvas.width, h: canvas.height },
      { ...d, board: { ...board, keepouts: [], vias: board.vias.filter((x) => viaLayers(board, x).includes(side)) } },
      colours,
      {
        selected: new Set(),
        hidden,
        active: side,
        pads,
        air: [],
        pours,
        pourAlpha: 0.55,
      },
    );
    // Pads are bare metal: the mask is opened over them.
    ctx.fillStyle = PAD;
    for (const p of pads) {
      if (p.pad.kind !== "smd" || p.side !== side) continue;
      padPath(ctx, v, p.pad, p.at, p.angle, 0, p);
      ctx.fill();
    }
    out = { url: canvas.toDataURL("image/png"), x: box.x, y: box.y, w: box.w, h: box.h };
  }
  cache.set(d, { ...cache.get(d), [side]: out });
  return out;
}

const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const deg = (r: number) => (r * 180) / Math.PI;

/**
 * Where a side's picture sits on its face. `place` is where the board body is (its corner and turn), so the picture
 * follows the board however it is moved. Null when the face is not there, or is not flat.
 */
export function pictureOnFace(
  mesh: BodyMesh,
  face: number,
  pic: BoardPicture,
  place: Pick<Part, "position" | "rotation">,
  z: number,
  bottom: boolean,
): Placement | null {
  const f = faceFrame(mesh, face);
  if (!f) return null;
  const r = place.rotation ?? { x: 0, y: 0, z: 0 };
  const m = placeMatrix([place.position.x, place.position.y, place.position.z], [r.x, r.y, r.z]);
  const middle = inFace(f, mat4Apply(m, [pic.x + pic.w / 2, pic.y + pic.h / 2, z]));
  // The board's own x, as the face sees it. From underneath the picture is mirrored, so its right runs the other way.
  const bx = unit(mat4ApplyDir(m, [1, 0, 0]));
  const s = bottom ? -1 : 1;
  const angle = deg(Math.atan2(s * dot(bx, f.y), s * dot(bx, f.x)));
  return { x: middle[0], y: middle[1], width: pic.w, height: pic.h, angle: Math.round(angle * 1e6) / 1e6 + 0, ...(bottom ? { flip: true } : {}) };
}

/** The decals that dress a Board step's body: one for each side that has a flat face to lie on. */
export function boardDecals(
  d: ElectronicsDesign,
  step: string,
  body: { mesh: BodyMesh; names?: { faces: string[] } },
  place: Pick<Part, "id" | "position" | "rotation">,
  font?: string,
): ViewDecal[] {
  const board = d.board;
  if (!board) return [];
  const out: ViewDecal[] = [];
  const r = place.rotation ?? { x: 0, y: 0, z: 0 };
  const up = unit(mat4ApplyDir(placeMatrix([0, 0, 0], [r.x, r.y, r.z]), [0, 0, 1]));
  /** A side's face by its name, or on a board with too many holes to name, the flat face that looks that way. */
  const faceOf = (side: "top" | "bottom") => {
    if (body.names) return body.names.faces.indexOf(side === "top" ? "cap.end" : "cap.start");
    for (let i = 0; i + 1 < body.mesh.faceTris.length; i += 1) {
      const f = faceFrame(body.mesh, i);
      if (f && dot(f.normal, up) * (side === "top" ? 1 : -1) > 0.999) return i;
    }
    return -1;
  };
  for (const side of ["top", "bottom"] as const) {
    const face = faceOf(side);
    const pic = face >= 0 ? boardPicture(d, side, font) : null;
    const at = pic && pictureOnFace(body.mesh, face, pic, place, side === "top" ? board.thickness : 0, side === "bottom");
    if (pic && at) out.push({ id: `${step}:${side}`, part: place.id, face, at, image: pic.url });
  }
  return out;
}
