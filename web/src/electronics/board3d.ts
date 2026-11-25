import { addHole, setPlacement } from "@bettercad/electronics/pcb/route";
import { boardPartOf, holesOnBoard, moveBoardStep, moveOnBoard } from "@bettercad/kernel/board-move";
import type { BodyMesh } from "@bettercad/kernel";
import { boardBodyId, boardStep, partBox } from "@bettercad/kernel/board";
import {
  addCombine,
  cutTool,
  mat4Apply,
  mat4ApplyDir,
  newId,
  placeMatrix,
  resolveHole,
  type HoleFeature,
  type ModelDoc,
  type Part,
  type Vec3,
} from "../state/document";

/**
 * The board followed from the 3D view (#651): a part dragged in 3D moves on the board, the board dragged moves its
 * step, and holes made in its face become board holes. Loaded when one of those happens.
 */
export interface Followed {
  /** The model after the change; the same one when nothing changed. */
  doc: ModelDoc;
  /** What to tell whoever did it. */
  say: string;
  error?: boolean;
  label: string;
}

/**
 * A body of the Board step moved or turned by the gizmo. Null when the body is not the board's, so it moves as any
 * body does.
 */
export function movedIn3D(doc: ModelDoc, parts: Part[], id: string, position: Vec3, rotation: Vec3, turned: boolean): Followed | null {
  const step = boardStep(doc);
  const design = doc.electronics;
  const was = parts.find((p) => p.id === id);
  const board = step && parts.find((p) => p.id === boardBodyId(step.id));
  if (!step || !design?.board || !was || !board) return null;
  const to = { position, rotation };
  if (id === board.id) return { doc: moveBoardStep(doc, step.id, was, to), say: "", label: turned ? "Turn the board" : "Move the board" };
  const part = boardPartOf(step.id, id, design.parts);
  const at = part && design.board.placements.find((p) => p.part === part);
  if (!part || !at) return null;
  const ref = design.parts.find((p) => p.id === part)?.ref ?? was.name;
  const label = `${turned ? "Turn" : "Move"} ${ref} on the board`;
  if (at.locked) return { doc, label, error: true, say: `${ref} is locked where it is. Unlock it in the PCB view to move it.` };
  const next = moveOnBoard(board, was, to, at);
  if (Math.abs(next.x - at.x) < 1e-6 && Math.abs(next.y - at.y) < 1e-6 && Math.abs(next.rot - at.rot) < 1e-6)
    return { doc, label, say: `${ref} stays on the board: it slides along it and turns flat on it.` };
  return {
    doc: { ...doc, electronics: setPlacement(design, part, next) },
    label,
    say: `${ref} moved on the board. The PCB view shows it there, and its tracks are left for you to route again.`,
  };
}

/**
 * Holes made with the Hole tool in the board's top or bottom face: board holes, drilled right through, in place of
 * the Hole step. Null when the step is not on the board's face, so it stays an ordinary Hole step.
 */
export function holesIn3D(doc: ModelDoc, parts: Part[], f: HoleFeature): Followed | null {
  const step = boardStep(doc);
  const design = doc.electronics;
  const board = step && parts.find((p) => p.id === boardBodyId(step.id));
  if (!step || !design?.board || !board || f.part !== board.id) return null;
  const at = holesOnBoard(board, f.frame, f.points);
  // A board is drilled, not printed: the screw's ordinary clearance, without the printer's hole offset.
  const size = resolveHole({ ...f, fit: f.fit === "printed" ? "normal" : f.fit });
  if (!at || "error" in size) return null;
  const drill = Math.round(size.diameter * 100) / 100;
  let next = design;
  for (const [x, y] of at) next = addHole(next, x, y, drill);
  const n = at.length;
  return {
    doc: { ...doc, features: doc.features.filter((x) => x.id !== f.id), electronics: next },
    label: n === 1 ? "Add a hole to the board" : "Add holes to the board",
    say: `Made ${n === 1 ? "1 hole" : `${n} holes`} of ${drill} mm in the board. ${n === 1 ? "It is" : "They are"} in the PCB view and the drill file too.`,
  };
}

type V3 = [number, number, number];

/** How far along a ray each crossing of a mesh is, nearest first. */
export function rayHits(mesh: Pick<BodyMesh, "positions" | "indices">, o: V3, d: V3): number[] {
  const P = mesh.positions;
  const out: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t]! * 3, mesh.indices[t + 1]! * 3, mesh.indices[t + 2]! * 3];
    const e1 = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!];
    const e2 = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!];
    const h = [d[1] * e2[2]! - d[2] * e2[1]!, d[2] * e2[0]! - d[0] * e2[2]!, d[0] * e2[1]! - d[1] * e2[0]!];
    const det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
    if (Math.abs(det) < 1e-12) continue;
    const s = [o[0] - P[a]!, o[1] - P[a + 1]!, o[2] - P[a + 2]!];
    const u = (s[0]! * h[0]! + s[1]! * h[1]! + s[2]! * h[2]!) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
    const v = (d[0] * q[0]! + d[1] * q[1]! + d[2] * q[2]!) / det;
    if (v < 0 || u + v > 1) continue;
    const at = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det;
    // A ray along a shared edge crosses two triangles at one place: count it once.
    if (at > 1e-6 && !out.some((x) => Math.abs(x - at) < 1e-6)) out.push(at);
  }
  return out.sort((x, y) => x - y);
}

/** How far to look for a wall from a connector's side, mm. */
export const WALL_REACH = 30;

/**
 * Connector opening (#652): a clearance hole through the wall in front of a part on the board, so its plug reaches
 * it. The wall is the nearest printed body any of the part's four sides looks at; the cut is the box round the
 * part's body pushed out through that wall, with a sliding fit, and it is made from the part each time the model
 * builds, so it follows the part along the wall.
 */
export function connectorOpening(
  doc: ModelDoc,
  parts: Part[],
  meshes: ReadonlyMap<string, { mesh: BodyMesh }>,
  id: string,
  at?: number,
  step = newId("f"),
): Followed {
  const label = "Connector opening";
  const board = boardStep(doc);
  const c = parts.find((p) => p.id === id);
  if (!board || !c?.pcb || c.id === boardBodyId(board.id)) return { doc, label, error: true, say: "Pick a part on the board first, such as its USB socket" };
  const box = partBox(c);
  if (!box) return { doc, label, error: true, say: `${c.name} has no simple body to cut an opening for. Give its component a body size.` };
  const [min, max] = box;
  const r = c.rotation ?? { x: 0, y: 0, z: 0 };
  const place = placeMatrix([c.position.x, c.position.y, c.position.z], [r.x, r.y, r.z]);
  const middle = [0, 1, 2].map((i) => (min[i]! + max[i]!) / 2);
  let best: { wall: Part; out: V3; enter: number; exit: number } | null = null;
  for (const axis of [0, 1] as const)
    for (const sign of [1, -1] as const) {
      const out: V3 = [0, 0, 0];
      out[axis] = sign;
      const from = [...middle] as V3;
      from[axis] = sign > 0 ? max[axis]! : min[axis]!;
      const o = mat4Apply(place, from);
      const d = mat4ApplyDir(place, out);
      for (const wall of parts) {
        const mesh = wall.hidden || wall.hole || wall.reference ? undefined : meshes.get(wall.id)?.mesh;
        if (!mesh) continue;
        const hits = rayHits(mesh, o, d);
        if (!hits.length) continue;
        // An odd count: the part's face is already inside the wall, and the first crossing is the way out.
        const inside = hits.length % 2 === 1;
        const enter = inside ? 0 : hits[0]!;
        const exit = inside ? hits[0]! : hits[1]!;
        if (enter <= WALL_REACH && (!best || enter < best.enter)) best = { wall, out, enter, exit };
      }
    }
  if (!best)
    return { doc, label, error: true, say: `No wall within ${WALL_REACH} mm of ${c.name}'s sides. Make the case first, or move the board nearer its wall.` };
  const tool = { ...cutTool(c.id, "sliding", 0, doc.print), reach: { out: best.out, by: Math.round((best.exit + 0.5) * 100) / 100 } };
  const made = addCombine(doc, { mode: "combine", target: best.wall.id, tools: [tool], keepTools: true }, step, at);
  const names = new Set(doc.features.map((f) => f.name));
  let n = 1;
  while (names.has(`Connector opening ${n}`)) n += 1;
  return {
    doc: { ...made, features: made.features.map((f) => (f.id === step ? { ...f, name: `Connector opening ${n}` } : f)) },
    label,
    say: `Cut an opening for ${c.name} through ${best.wall.name}, ${tool.gap ?? 0} mm clear all round. It follows the part.`,
  };
}
