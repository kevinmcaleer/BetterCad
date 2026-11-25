import type { BoardFeature, ModelDoc, Part } from "./document";
import { mat4Apply, mat4ApplyDir, mat4InvertRigid, mat4Mul, placeMatrix, placeOf, type Mat4 } from "./pose";

/**
 * The board and the model in step from the 3D side (#651): a part moved in the 3D view as a change to where it sits
 * on the board, the board itself moved as a change to its Board step, and holes made in its face as board holes.
 * Loaded when one of those happens.
 */
type Place = Pick<Part, "position" | "rotation">;
const matrixOf = (p: Place): Mat4 => {
  const r = p.rotation ?? { x: 0, y: 0, z: 0 };
  return placeMatrix([p.position.x, p.position.y, p.position.z], [r.x, r.y, r.z]);
};
const round = (v: number, to = 1000) => Math.round(v * to) / to + 0;

/** Which of the design's parts a body of the Board step stands for; null for the board itself and for any other body. */
export function boardPartOf(step: string, body: string, parts: readonly { id: string }[]): string | null {
  // A STEP file with several solids makes a body for each: "step/part", "step/part.1"…
  return (
    parts.find((p) => body === `${step}/${p.id}` || (body.startsWith(`${step}/${p.id}.`) && /^\d+$/.test(body.slice(step.length + p.id.length + 2))))?.id ??
    null
  );
}

/**
 * Where a part sits on the board after its body was moved or turned in 3D. It is held to the board: only the slide
 * along the board's face and the turn about its normal are taken; a lift or a tilt is dropped.
 */
export function moveOnBoard(board: Place, was: Place, to: Place, at: { x: number; y: number; rot: number }): { x: number; y: number; rot: number } {
  const by = matrixOf(board);
  // The move in the world, seen from the board.
  const move = mat4Mul(mat4InvertRigid(by), mat4Mul(mat4Mul(matrixOf(to), mat4InvertRigid(matrixOf(was))), by));
  const p = mat4Apply(move, [at.x, at.y, 0]);
  const x = mat4ApplyDir(move, [1, 0, 0]);
  const turn = (Math.atan2(x[1], x[0]) * 180) / Math.PI;
  return { x: round(p[0]), y: round(p[1]), rot: round((((at.rot + turn) % 360) + 360) % 360, 100) % 360 };
}

/** The Board step after its board body was moved in 3D: the step's own place changes, so every part comes with it. */
export function moveBoardStep(doc: ModelDoc, step: string, was: Place, to: Place): ModelDoc {
  const f = doc.features.find((x): x is BoardFeature => x.id === step && x.type === "board");
  if (!f) return doc;
  // Whatever the board stands on (a sketch, a face) stays under it: only the step's own place takes the move.
  const own = mat4Mul(matrixOf(f), mat4Mul(mat4InvertRigid(matrixOf(was)), matrixOf(to)));
  const { position, rotation } = placeOf(own);
  const next: BoardFeature = { ...f, position: { x: position[0], y: position[1], z: position[2] } };
  delete next.rotation;
  if (rotation.some((v) => v)) next.rotation = { x: rotation[0], y: rotation[1], z: rotation[2] };
  return { ...doc, features: doc.features.map((x) => (x === f ? next : x)) };
}

/**
 * Hole centres on the board, from points on one of its flat faces in 3D. Null when the face is not the board's top or
 * bottom: an edge of a board is not drilled.
 */
export function holesOnBoard(
  board: Place,
  frame: { origin: readonly number[]; x: readonly number[]; normal: readonly number[] },
  points: readonly (readonly [number, number])[],
): [number, number][] | null {
  const inv = mat4InvertRigid(matrixOf(board));
  const n = mat4ApplyDir(inv, [frame.normal[0]!, frame.normal[1]!, frame.normal[2]!]);
  if (Math.abs(n[2]) < 0.999) return null;
  const [fx, fn, o] = [frame.x, frame.normal, frame.origin] as [number[], number[], number[]];
  const fy = [fn[1]! * fx[2]! - fn[2]! * fx[1]!, fn[2]! * fx[0]! - fn[0]! * fx[2]!, fn[0]! * fx[1]! - fn[1]! * fx[0]!];
  return points.map(([u, v]) => {
    const p = mat4Apply(inv, [o[0]! + fx[0]! * u + fy[0]! * v, o[1]! + fx[1]! * u + fy[1]! * v, o[2]! + fx[2]! * u + fy[2]! * v]);
    return [round(p[0]), round(p[1])];
  });
}
