import type { BoardSolid, Edge } from "@bettercad/electronics/pcb/solid";
import type { ProfileSeg, ProfileShape } from "./extrude";
import { partBounds, type CataloguePart } from "./catalogue";
import { mat4Mul, placeMatrix, placeOf, type Mat4 } from "./pose";
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
