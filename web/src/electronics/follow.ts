import { emptyBoard, type ElectronicsDesign } from "@bettercad/electronics";
import { followFace, followSketch, outlineBehind, type OutlineShape } from "@bettercad/electronics/pcb/outline";
import type { BodyMesh } from "@bettercad/kernel";
import { profiles, type Sketch } from "@bettercad/sketch";
import { faceShape } from "./faceOutline";

/**
 * Use as PCB profile: a body, a flat face or a sketch gives the board its shape, and the board keeps following it as
 * the model changes (Fusion's linked board outline). Loaded when a menu entry is used or a board follows something,
 * so none of it is in the shell.
 */

type Bodies = ReadonlyMap<string, { mesh: BodyMesh; names?: { faces: string[] } }>;

/** A sketch's biggest closed shape, with the shapes inside it as holes. */
export function sketchShape(sketch: Sketch): OutlineShape | null {
  const best = profiles(sketch).profiles.reduce<ReturnType<typeof profiles>["profiles"][number] | null>((a, b) => (a && a.area >= b.area ? a : b), null);
  return best ? { outer: best.points.map((p) => [p[0], p[1]]), holes: best.holes.map((h) => h.points.map((p) => [p[0], p[1]])) } : null;
}

/** The area of one face of a mesh, from its triangles. */
function faceArea(mesh: Pick<BodyMesh, "positions" | "indices" | "faceTris">, face: number): number {
  let sum = 0;
  const p = mesh.positions;
  for (let t = mesh.faceTris[face]!; t < mesh.faceTris[face + 1]!; t += 1) {
    const [a, b, c] = [mesh.indices[t * 3]! * 3, mesh.indices[t * 3 + 1]! * 3, mesh.indices[t * 3 + 2]! * 3];
    const [ux, uy, uz, vx, vy, vz] = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!, p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
    sum += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return sum;
}

/**
 * The face of a body a board takes its shape from (Kev's choice, 2026-11-26): the biggest flat face, and of two
 * about the same size the one that looks most upwards, so a plate gives its top. -1 for a body with no flat face.
 */
export function biggestFlatFace(mesh: Pick<BodyMesh, "positions" | "indices" | "faceTris">): number {
  let best = -1;
  let bestArea = 0;
  let bestUp = -2;
  for (let f = 0; f + 1 < mesh.faceTris.length; f += 1) {
    const shape = faceShape(mesh, f);
    if (!shape) continue;
    const area = faceArea(mesh, f);
    const up = shape.frame.normal[2];
    const tie = Math.abs(area - bestArea) <= bestArea * 0.01;
    if ((tie && up > bestUp) || (!tie && area > bestArea)) [best, bestArea, bestUp] = [f, area, up];
  }
  return best;
}

/** What the board can take its shape from: a sketch, or a body (its biggest flat face, or the face given). */
export type ProfileSource = { sketch: { id: string; sketch: Sketch } } | { body: string; face?: number };

/**
 * The change that makes a source the board's profile, or what to say when it can't be one. A design with no board
 * gets one, shaped by the source.
 */
export function profileChange(source: ProfileSource, bodies: Bodies): ((d: ElectronicsDesign) => ElectronicsDesign) | string {
  const withBoard = (d: ElectronicsDesign): ElectronicsDesign => (d.board ? d : { ...d, board: emptyBoard() });
  if ("sketch" in source) {
    const shape = sketchShape(source.sketch.sketch);
    if (!shape) return "That sketch has no closed shape to make a board from.";
    return (d) => followSketch(withBoard(d), source.sketch.id, shape);
  }
  const b = bodies.get(source.body);
  if (!b) return "That body is still being built. Try again in a moment.";
  const face = source.face ?? biggestFlatFace(b.mesh);
  const shape = face >= 0 ? faceShape(b.mesh, face) : null;
  if (!shape) return source.face === undefined ? "That body has no flat face to make a board from." : "That face is not flat, so it can't be a board's shape.";
  const id = `${source.body}|${b.names?.faces[face] ?? face}`;
  return (d) => followFace(withBoard(d), id, shape, shape.frame);
}

/**
 * Brings a board that follows a sketch or a face up to date with it. Null when there is nothing to do (it is up to
 * date, or the body is still being built); "gone" when the sketch, the body or the face is no longer there, or no
 * longer gives a shape. The board then keeps the shape it has.
 */
export function catchUp(
  d: ElectronicsDesign | undefined,
  sketches: readonly { id: string; sketch: Sketch }[],
  bodies: Bodies,
  /** Every body in the model, built or not. */
  partIds: ReadonlySet<string>,
): ElectronicsDesign | "gone" | null {
  const from = d?.board?.outlineFrom;
  if (!d?.board || !from) return null;
  // Behind in shape, or moved: a face that slid or turned takes the board with it.
  const changed = (shape: OutlineShape, next: ElectronicsDesign) =>
    outlineBehind(d.board!, shape) || JSON.stringify(next.board?.outlineFrom) !== JSON.stringify(from) ? next : null;
  if (from.sketch) {
    const s = sketches.find((x) => x.id === from.sketch);
    const shape = s ? sketchShape(s.sketch) : null;
    return shape ? changed(shape, followSketch(d, from.sketch, shape)) : "gone";
  }
  if (!from.face) return null;
  const cut = from.face.lastIndexOf("|");
  const [body, name] = [from.face.slice(0, cut), from.face.slice(cut + 1)];
  if (!partIds.has(body)) return "gone";
  const b = bodies.get(body);
  if (!b) return null;
  const index = b.names ? b.names.faces.indexOf(name) : /^\d+$/.test(name) ? Number(name) : -1;
  const face = index >= 0 ? faceShape(b.mesh, index) : null;
  return face ? changed(face, followFace(d, from.face, face, face.frame)) : "gone";
}
