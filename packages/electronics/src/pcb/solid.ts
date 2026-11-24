import { area, outlinePoints, pointInPolygon } from "../outlineGeom";
import { distToSegment, placeOnBoard, q } from "../geom";
import { bodyBox } from "../library/body";
import { packageOf, type Board, type Corner, type ElectronicsDesign, type Id, type P2 } from "../model";

/**
 * The board as a solid (#649, #650): what the modelling kernel needs to build it in 3D, worked out from the board
 * alone. An outline with its cut-outs and drilled holes to push up by the thickness, and a simple body for each part,
 * standing on the side it is placed on. No kernel here: `@bettercad/kernel` turns this into bodies.
 */
export type Edge = { kind: "line"; a: P2; b: P2; id: string } | { kind: "arc"; a: P2; m: P2; b: P2; id: string };

export interface PartBody {
  part: Id;
  ref: string;
  /** `step`: a STEP file from the model's blobs (#628); `size` is then the file's box, for when the file is missing. */
  kind: "box" | "cylinder" | "step";
  /** Across, deep and tall, mm. A cylinder is as wide as it is deep. */
  size: [number, number, number];
  /** A STEP body: the file, how many solids it holds, and its own lift off the board and turns about X, Y and Z. */
  step?: { blob: string; bodies: number; lift: number; rotate: [number, number, number] };
  /** The middle of its base, on the board (z is the face it stands on). */
  at: [number, number, number];
  /** Turned anticlockwise seen from the top, degrees, after any flip. */
  rot: number;
  /** On the bottom: turned over about its own y first, so it hangs down from the bottom face. */
  flip: boolean;
  colour: string;
}

export interface BoardSolid {
  thickness: number;
  outline: Edge[];
  /** Cut-outs, as outlines. */
  cutouts: Edge[][];
  /** Drilled holes that go in the solid. */
  drills: { c: P2; r: number; id: string }[];
  /** Holes left out of the solid: too small to matter, or where they could not be cut cleanly. */
  left: number;
  /** Board area, mm², with cut-outs and holes taken off. */
  area: number;
  /** Grams: FR4 with copper on both sides. */
  mass: number;
  colour: string;
  bodies: PartBody[];
}

/** Solder mask colours as they look on a made board. Materials, not interface colours. */
export const MASK_COLOURS: Record<NonNullable<Board["mask"]>, string> = {
  green: "#1e6b3c",
  black: "#1b1c1e",
  blue: "#1c4c96",
  red: "#a1282b",
  white: "#e9e9e3",
  purple: "#4c2c7c",
  yellow: "#cfa71f",
};
const BODY_COLOURS: Record<string, string> = { "plastic-black": "#232427", metal: "#b9bcc0" };
/** FR4, and copper, g/mm³; the copper is 35 µm a side, taken as covering a third of the board. */
const FR4 = 1.85e-3;
const COPPER = 8.96e-3 * 0.035 * 2 * (1 / 3);
/** Holes narrower than this are left out of the solid unless asked for: vias, mostly. */
export const MIN_DRILL = 0.5;

function edges(corners: Corner[], name: string): Edge[] {
  return corners.map((a, i): Edge => {
    const b = corners[(i + 1) % corners.length]!;
    const id = `${name}.${i}`;
    if (!a.bulge) return { kind: "line", a: [a.x, a.y], b: [b.x, b.y], id };
    // The middle of the arc: off the chord's middle by the sagitta, to the right of travel for an anticlockwise arc.
    const m: P2 = [q((a.x + b.x) / 2 + ((b.y - a.y) * a.bulge) / 2), q((a.y + b.y) / 2 - ((b.x - a.x) * a.bulge) / 2)];
    return { kind: "arc", a: [a.x, a.y], m, b: [b.x, b.y], id };
  });
}

/** The board as a solid, or null when there is no board or its outline is not a shape. */
export function boardSolid(d: ElectronicsDesign, minDrill = MIN_DRILL): BoardSolid | null {
  const board = d.board;
  if (!board || board.outline.length < 3) return null;
  const edge = outlinePoints(board.outline, 0.02);
  const cuts = (board.cutouts ?? []).filter((c) => c.length > 2);
  const loops = [edge, ...cuts.map((c) => outlinePoints(c, 0.02))];
  const bodies: PartBody[] = [];

  // Every hole drilled through: mounting holes, through-hole pads and vias.
  const wanted: { c: P2; r: number; id: string }[] = [];
  for (const h of board.holes) wanted.push({ c: [h.x, h.y], r: h.drill / 2, id: `hole.${h.id}` });
  for (const at of board.placements) {
    const part = d.parts.find((p) => p.id === at.part);
    const pkg = part && packageOf(d, part);
    if (!part || !pkg) continue;
    for (const pad of pkg.footprint.pads)
      if (pad.drill && pad.kind !== "smd") wanted.push({ c: placeOnBoard([pad.x, pad.y], at), r: pad.drill / 2, id: `pad.${part.id}.${pad.number}` });

    // Its body: the component's own simple shape, else a low box over its outline.
    const name = pkg.footprint.name;
    const m = pkg.model;
    if (!m && /MountingHole|Fiducial|TestPoint|SolderJumper/.test(name)) continue;
    const box = bodyBox(pkg.footprint);
    const src = m?.source;
    const off = m?.offset ?? [(box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2, 0];
    const flip = at.side === "bottom";
    const c = placeOnBoard([off[0], off[1]], at);
    const size: [number, number, number] =
      src?.kind === "box"
        ? src.size
        : src?.kind === "step" && src.size
          ? src.size
          : src?.kind === "cylinder"
            ? [src.diameter, src.diameter, src.height]
            : [q(box.x2 - box.x1), q(box.y2 - box.y1), src?.kind === "header" ? src.height : 2];
    if (!(size[0] > 0 && size[1] > 0 && size[2] > 0)) continue;
    bodies.push({
      part: part.id,
      ref: part.ref,
      kind: src?.kind === "cylinder" ? "cylinder" : src?.kind === "step" ? "step" : "box",
      size,
      ...(src?.kind === "step" ? { step: { blob: src.blob, bodies: Math.max(1, src.bodies ?? 1), lift: off[2] ?? 0, rotate: m?.rotate ?? [0, 0, 0] } } : {}),
      at: [c[0], c[1], flip ? 0 : board.thickness],
      rot: ((at.rot % 360) + 360) % 360,
      flip,
      colour: BODY_COLOURS[m?.colour ?? "plastic-black"] ?? BODY_COLOURS["plastic-black"]!,
    });
  }
  for (const v of board.vias) wanted.push({ c: [v.x, v.y], r: v.drill / 2, id: `via.${v.id}` });

  // A hole goes in the solid when it is big enough, wholly on the board and clear of every other hole.
  const drills: BoardSolid["drills"] = [];
  const clear = 0.05;
  for (const h of wanted) {
    const fits =
      h.r * 2 >= minDrill - 1e-9 &&
      pointInPolygon(h.c, edge) &&
      !loops.slice(1).some((l) => pointInPolygon(h.c, l)) &&
      !loops.some((l) => l.some((p, i) => distToSegment(h.c, p, l[(i + 1) % l.length]!) < h.r + clear)) &&
      !drills.some((o) => Math.hypot(o.c[0] - h.c[0], o.c[1] - h.c[1]) < o.r + h.r + clear);
    if (fits) drills.push(h);
  }
  const flat = loops.slice(1).reduce((a, l) => a - Math.abs(area(l)), Math.abs(area(edge))) - drills.reduce((a, h) => a + Math.PI * h.r * h.r, 0);
  return {
    thickness: board.thickness,
    outline: edges(board.outline, "edge"),
    cutouts: cuts.map((c, i) => edges(c, `cut${i}`)),
    drills,
    left: wanted.length - drills.length,
    area: q(flat),
    mass: Math.round(flat * (board.thickness * FR4 + COPPER) * 100) / 100,
    colour: MASK_COLOURS[board.mask ?? "green"],
    bodies,
  };
}
