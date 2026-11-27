import type { BoardSolid, Edge } from "@bettercad/electronics/pcb/solid";
import type { ProfileSeg, ProfileShape } from "./extrude";
import { partBounds, type CataloguePart } from "./catalogue";
import { mat4Apply, mat4ApplyDir, mat4Mul, placeMatrix, placeOf, type Mat4 } from "./pose";
import { newId, type ModelDoc, type Part, type Vec3 } from "./document";

/**
 * The Board step's bodies (#649, #650): the board itself, pushed up from its outline with its cut-outs and drilled
 * holes, and a simple body for each part, standing on its side of the board. The board's own corner (0, 0) with its
 * bottom face sits at the step's `position`, turned by its `rotation`.
 */
export const boardBodyId = (step: string) => `${step}/board`;

const seg = (e: Edge): ProfileSeg => (e.kind === "arc" ? { kind: "arc", a: e.a, m: e.m, b: e.b, id: e.id } : { kind: "line", a: e.a, b: e.b, id: e.id });

/** The board's outline as a shape to extrude: the edge, with cut-outs and drills as holes. Faces are named by `id`. */
export function boardProfile(solid: BoardSolid): ProfileShape {
  return {
    outer: solid.outline.map(seg),
    holes: [...solid.cutouts.map((c) => c.map(seg)), ...solid.drills.map((h): ProfileSeg[] => [{ kind: "circle", c: h.c, r: h.r, id: h.id }])],
    area: solid.area,
  };
}

function placed(by: Mat4, local: Mat4): Pick<Part, "position" | "rotation"> {
  const at = placeOf(mat4Mul(by, local));
  const [x, y, z] = at.rotation;
  return { position: { x: at.position[0], y: at.position[1], z: at.position[2] }, ...(x || y || z ? { rotation: { x, y, z } } : {}) };
}

/** The bodies a Board step makes. */
export function boardParts(
  step: { id: string; position: Vec3; rotation?: Vec3 },
  solid: BoardSolid,
  on?: Mat4,
  /** Whether the model holds a STEP file (#628). A part whose file is missing stands as a box of the file's size. */
  hasBlob: (blob: string) => boolean = () => false,
): Part[] {
  const r = step.rotation ?? { x: 0, y: 0, z: 0 };
  const own = placeMatrix([step.position.x, step.position.y, step.position.z], [r.x, r.y, r.z]);
  const by = on ? mat4Mul(on, own) : own;
  const pts = solid.outline.flatMap((e) => (e.kind === "arc" ? [e.a, e.m, e.b] : [e.a, e.b]));
  const span = (i: 0 | 1) => Math.round((Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]))) * 1000) / 1000;
  const board: Part = {
    id: boardBodyId(step.id),
    name: "Board",
    kind: "solid",
    hidden: false,
    ...placed(by, placeMatrix([0, 0, 0], [0, 0, 0])),
    size: { x: span(0), y: span(1), z: solid.thickness },
    prism: { frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] }, profiles: [boardProfile(solid)], from: 0, to: solid.thickness, pierced: true },
    colour: solid.colour,
    mass: solid.mass,
    reference: true,
    pcb: true,
  };
  return [
    board,
    ...solid.bodies.flatMap((b): Part[] => {
      const stand = placeMatrix(b.at, [0, b.flip ? 180 : 0, b.rot]);
      const s = b.step;
      // A STEP file's solids, each a body of its own, lifted and turned on the footprint as the component says.
      if (s && hasBlob(s.blob)) {
        const own = mat4Mul(stand, placeMatrix([0, 0, s.lift], s.rotate));
        return Array.from({ length: s.bodies }, (_, index) => ({
          id: index ? `${step.id}/${b.part}.${index}` : `${step.id}/${b.part}`,
          name: b.ref,
          kind: "solid",
          hidden: false,
          ...placed(by, own),
          size: { x: 0, y: 0, z: 0 },
          imported: { blob: s.blob, format: "step", index, mesh: false, keepLayout: true },
          colour: b.colour,
          reference: true,
          pcb: true,
        }));
      }
      // A robot catalogue part, the same model Insert part places.
      if (b.catalogue) {
        const record = b.catalogue.part as unknown as CataloguePart;
        const [min, max] = partBounds(record);
        return [
          {
            id: `${step.id}/${b.part}`,
            name: b.ref,
            kind: "solid",
            hidden: false,
            ...placed(by, mat4Mul(stand, placeMatrix([0, 0, b.catalogue.lift], b.catalogue.rotate))),
            size: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
            catalogue: record,
            colour: b.colour,
            reference: true,
            pcb: true,
          },
        ];
      }
      // A true body drawn in code (#752): a body for each material, so each wears its own colour.
      if (b.drawn?.length)
        return b.drawn.map((piece, index) => ({
          id: index ? `${step.id}/${b.part}.${index}` : `${step.id}/${b.part}`,
          name: b.ref,
          kind: "solid",
          hidden: false,
          ...placed(by, stand),
          size: { x: b.size[0], y: b.size[1], z: b.size[2] },
          blocks: piece.blocks,
          colour: piece.colour,
          ...(piece.metal ? { finish: "metal" as const } : {}),
          reference: true,
          pcb: true,
        }));
      return [
        {
          id: `${step.id}/${b.part}`,
          name: b.ref,
          kind: b.kind === "cylinder" ? "cylinder" : "box",
          hidden: false,
          ...placed(by, stand),
          size: { x: b.size[0], y: b.size[1], z: b.size[2] },
          colour: b.colour,
          reference: true,
          pcb: true,
        },
      ];
    }),
  ];
}

/**
 * Where a board that takes its outline from a sketch stands (#653): on the sketch's plane, its own (0, 0) at `at` in
 * the sketch, so the board sits on the shape it was drawn from.
 */
export function onSketch(frame: { origin: number[]; x: number[]; normal: number[] }, at: readonly [number, number]): Mat4 {
  const [x, n, o] = [frame.x, frame.normal, frame.origin] as [number[], number[], number[]];
  const y = [n[1]! * x[2]! - n[2]! * x[1]!, n[2]! * x[0]! - n[0]! * x[2]!, n[0]! * x[1]! - n[1]! * x[0]!];
  const p = [0, 1, 2].map((i) => o[i]! + x[i]! * at[0] + y[i]! * at[1]);
  return [x[0]!, x[1]!, x[2]!, 0, y[0]!, y[1]!, y[2]!, 0, n[0]!, n[1]!, n[2]!, 0, p[0]!, p[1]!, p[2]!, 1];
}

/** The model's Board step, if it has one. One board per model. */
export const boardStep = (doc: ModelDoc) => doc.features.find((f) => f.type === "board");

/**
 * Adds the Board step (#650), so the model's board stands in 3D as one component. A model has one board, so a second
 * call changes nothing.
 */
export function addBoard(doc: ModelDoc, place: { position?: Vec3; rotation?: Vec3 } = {}, id = newId("f"), at?: number, component?: string): ModelDoc {
  if (boardStep(doc)) return doc;
  const names = new Set(doc.features.map((f) => f.name));
  let name = "Board";
  for (let n = 2; names.has(name); n += 1) name = `Board ${n}`;
  const r = place.rotation;
  const features = [...doc.features];
  features.splice(at === undefined ? features.length : Math.max(0, Math.min(at, features.length)), 0, {
    id,
    type: "board",
    name,
    position: { x: 0, y: 0, z: 0, ...place.position },
    ...(r && (r.x || r.y || r.z) ? { rotation: { ...r } } : {}),
    ...(component ? { component } : {}),
  });
  return { ...doc, features };
}

/**
 * Standoffs under a board (#652): where its mounting holes fall on a face it lies flat over, and how far the board is
 * above that face. Null when the board has no holes, is not parallel to the face, or is not above it.
 */
export function standoffsUnder(
  board: Pick<Part, "position" | "rotation">,
  thickness: number,
  holes: readonly { x: number; y: number }[],
  frame: { origin: readonly number[]; x: readonly number[]; normal: readonly number[] },
): { points: [number, number][]; height: number } | null {
  if (!holes.length) return null;
  const r = board.rotation ?? { x: 0, y: 0, z: 0 };
  const by = placeMatrix([board.position.x, board.position.y, board.position.z], [r.x, r.y, r.z]);
  const [o, fx, n] = [frame.origin, frame.x, frame.normal] as [number[], number[], number[]];
  const up = mat4ApplyDir(by, [0, 0, 1]);
  if (Math.abs(up[0] * n[0]! + up[1] * n[1]! + up[2] * n[2]!) < 0.999) return null;
  const fy = [n[1]! * fx[2]! - n[2]! * fx[1]!, n[2]! * fx[0]! - n[0]! * fx[2]!, n[0]! * fx[1]! - n[1]! * fx[0]!];
  const from = (p: number[]) => [p[0]! - o[0]!, p[1]! - o[1]!, p[2]! - o[2]!];
  const along = (d: number[], a: number[]) => d[0]! * a[0]! + d[1]! * a[1]! + d[2]! * a[2]!;
  // The face of the board nearer the face it stands over.
  const height = Math.min(along(from(mat4Apply(by, [0, 0, 0])), n), along(from(mat4Apply(by, [0, 0, thickness])), n));
  if (!(height > 0.05)) return null;
  const q = (v: number) => Math.round(v * 1000) / 1000 + 0;
  return {
    points: holes.map((h) => {
      const d = from(mat4Apply(by, [h.x, h.y, 0]));
      return [q(along(d, fx)), q(along(d, fy))];
    }),
    height: q(height),
  };
}

/** The box round a board part's body, in the body's own axes; null when its size is not known. */
export function partBox(p: Part): [number[], number[]] | null {
  if (p.catalogue) {
    const [min, max] = partBounds(p.catalogue);
    return [[...min], [...max]];
  }
  // A drawn body (#752) keeps the box its simple body had, so an opening is cut round the whole part.
  if (p.kind !== "box" && p.kind !== "cylinder" && !p.blocks) return null;
  return [
    [-p.size.x / 2, -p.size.y / 2, 0],
    [p.size.x / 2, p.size.y / 2, p.size.z],
  ];
}

/**
 * The cut for a connector opening (#652): the box round a board part's body, from its middle out past its face on
 * the `out` side by `by` mm, as a box body where the part stands. Null for a body whose size is not known (a STEP
 * file's solids).
 */
export function openingBox(p: Part, reach: { out: readonly number[]; by: number }): Part | null {
  const box = partBox(p);
  if (!box) return null;
  const [min, max] = box;
  const axis = [0, 1, 2].reduce((a, i) => (Math.abs(reach.out[i] ?? 0) > Math.abs(reach.out[a] ?? 0) ? i : a), 0);
  const middle = (min[axis]! + max[axis]!) / 2;
  if ((reach.out[axis] ?? 0) >= 0) [min[axis], max[axis]] = [middle, max[axis]! + reach.by];
  else [min[axis], max[axis]] = [min[axis]! - reach.by, middle];
  const size = { x: max[0]! - min[0]!, y: max[1]! - min[1]!, z: max[2]! - min[2]! };
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) return null;
  const r = p.rotation ?? { x: 0, y: 0, z: 0 };
  // A box stands on the middle of its base.
  const at = mat4Apply(placeMatrix([p.position.x, p.position.y, p.position.z], [r.x, r.y, r.z]), [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, min[2]!]);
  return {
    id: `${p.id}~opening`,
    name: p.name,
    kind: "box",
    hidden: false,
    position: { x: at[0], y: at[1], z: at[2] },
    ...(p.rotation ? { rotation: { ...p.rotation } } : {}),
    size,
  };
}
