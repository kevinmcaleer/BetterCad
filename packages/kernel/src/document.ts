/**
 * The model document (#45). The timeline is the document: an ordered list of features, replayed to get the parts.
 * It is plain JSON with no DOM, three.js or OCCT types, so the app, the kernel worker and Node tests share it. The
 * app's history store keeps immutable revisions of it for undo; the worker turns a revision into solids.
 */
import { drawCentreRectangle, drawCircle, newSketch, planeFrame, type Frame, type PlaneRef, type Sketch, type Vec2 } from "@bettercad/sketch";
import { resolveHole, holeLabel, type HoleParams, type HoleSpec } from "./holes";
import type { ImportFormat } from "./imports";
import { partBounds, partFrame, type CataloguePart } from "./catalogue";
export {
  CATALOGUE,
  CATALOGUE_CATEGORIES,
  cataloguePart,
  checkPart,
  partBounds,
  partFrame,
  HOLE_PATTERNS,
  rectPattern,
  circlePattern,
  type HolePattern,
  placeOnFace,
  type CataloguePart,
  type CatalogueCategory,
} from "./catalogue";
import { PATTERN_DEFAULTS, copyName, copyPart, copyId, patternCopyIds, patternMoves, patternProblem, patternSummary } from "./pattern";
import type { CopySpec, MirrorPlane, PatternKind, WorldAxis } from "./pattern";
import { NAME_RE, bindExprs, evaluateParams, namesIn, renameIn, type Parameter } from "./params";
import {
  axisOf,
  crossesAxis,
  extent,
  frameToLocal,
  pickProfiles,
  type AxisRef,
  type ExtrudeDirection,
  type ExtrudeOperation,
  type PrismSpec,
  type RevolveSpec,
} from "./extrude";

export * from "./extrude";
export * from "./pattern";
export * from "./holes";
export * from "./screws";
import { screw } from "./screws";
export * from "./params";
export * from "./print";
import { fitGap, holeOffsetOf, type FitId, type PrintSettings } from "./print";

export type PartKind = "box" | "cylinder" | "sphere" | "cone" | "torus" | "wedge" | "solid";

/** The kinds the Library adds (#64). Cone: W is the base, H the height. Torus: W across, H the tube. */
export const PRIMITIVES = ["box", "cylinder", "sphere", "cone", "torus", "wedge"] as const satisfies readonly PartKind[];
export const DEFAULT_SIZE: Record<(typeof PRIMITIVES)[number], Vec3> = {
  box: { x: 20, y: 20, z: 20 },
  cylinder: { x: 20, y: 20, z: 30 },
  sphere: { x: 20, y: 20, z: 20 },
  cone: { x: 20, y: 20, z: 20 },
  torus: { x: 26, y: 26, z: 6 },
  wedge: { x: 20, y: 20, z: 20 },
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Part {
  id: string;
  name: string;
  kind: PartKind;
  hidden: boolean;
  ghost?: boolean;
  highlight?: boolean;
  position: Vec3;
  size: Vec3;
  /** Degrees about X, Y and Z, applied Z first. Missing means not turned. */
  rotation?: Vec3;
  /** A "solid" part's shape: profiles pushed along a sketch's normal (Extrude, #61), in world space before any move. */
  prism?: PrismSpec;
  /** Or profiles turned round an axis (Revolve, #62). */
  revolve?: RevolveSpec;
  /** Joins, cuts and intersections made into the part, in its own coordinates, in timeline order. */
  ops?: BodyOp[];
  /** A hole (#64): drawn see-through, and cut away rather than joined when grouped. */
  hole?: boolean;
  /** A reference body (#185): shown to design around, but never printed, exported or weighed. */
  reference?: boolean;
  /** A hole's fit (#183): cut with a printed gap round it when grouped. A named fit, or a custom `gap`. */
  fit?: FitId;
  /** A custom gap on each side, mm, when `fit` isn't set. */
  gap?: number;
  /** A body brought in from a file (#82): the file's bytes are in the document's blobs. */
  imported?: ImportSpec;
  /** A catalogue part (#187): the record it was inserted from, kept whole so a catalogue change never moves it. */
  catalogue?: CataloguePart;
  /** A mirrored or turned copy of another body (#69), made from it as it stood. */
  copy?: CopySpec;
}

/** Where an imported body comes from: body `index` of the file kept as `blob`. Meshes (STL, 3MF) can't be filleted. */
export interface ImportSpec {
  blob: string;
  format: ImportFormat;
  index: number;
  mesh: boolean;
}

/** One boolean made into a part by a later step (the step's id, so a failure lands on its tile). */
export interface BodyOp {
  /** A boolean with a tool, or a finish on the part's own edges and faces. */
  op: "join" | "cut" | "intersect" | "fillet" | "chamfer" | "shell" | "pushpull" | "hole";
  /** Edges (fillet, chamfer) or faces left open (shell), numbered on the part as it was before this op. */
  refs?: number[];
  /** The fillet radius, chamfer distance or shell wall, mm. */
  size?: number;
  /** A shell that grows outward instead of keeping the outer size. */
  outside?: boolean;
  /** An extrude's prism, in the part's own coordinates. */
  tool?: PrismSpec;
  /** Holes (#70) cut into the part, in its own coordinates. */
  holes?: HoleSpec;
  /** Or a revolve's solid, in the part's own coordinates. */
  rev?: RevolveSpec;
  /** Or a whole body (Combine, #66), as it stood then, placed in the world. */
  body?: Part;
  /** A cut's printed gap (#183): the tool grows by this much on every side first, mm. */
  gap?: number;
  /** Where the part itself stood when the body was combined into it, so the body moves with the part later. */
  at?: { position: Vec3; rotation?: Vec3 };
  feature: string;
}

/** A camera as the viewport saves it: Z up, turning round `target` (see web/src/viewport/camera.ts). */
export interface ViewCamera {
  target: [number, number, number];
  azimuth: number;
  elevation: number;
  distance: number;
  ortho: boolean;
}

/** A saved camera (Named views, #40). */
export interface NamedView {
  id: string;
  name: string;
  camera: ViewCamera;
}

interface FeatureBase {
  id: string;
  /** The name on the timeline: "Box 1", "Move 2". */
  name: string;
  /** Suppressed features stay on the timeline but are skipped when the model is built. */
  suppressed?: boolean;
  /** Expressions typed into this step's fields (#75), by field path ("distance", "size.x"), worked out at build time. */
  exprs?: Record<string, string>;
}

export interface AddFeature extends FeatureBase {
  type: "add";
  part: { id: string; name: string; kind: PartKind; position: Vec3; size: Vec3 };
}
export interface DuplicateFeature extends FeatureBase {
  type: "duplicate";
  copies: { from: string; id: string; name: string }[];
}
/**
 * Mirror and patterns (#69): copies of bodies across a world plane, in rows along world axes, or round a world axis.
 * Every kind's settings are kept, so switching kind on the bar and back loses nothing.
 */
export interface PatternFeature extends FeatureBase {
  type: "pattern";
  kind: PatternKind;
  parts: string[];
  /** Mirror: the plane, moved along its normal by `offset` mm. */
  plane: MirrorPlane;
  offset: number;
  /** Rectangle: `count1` along `dir1` every `spacing1` mm, and `count2` along `dir2` (1 for a single row). */
  dir1: WorldAxis;
  count1: number;
  spacing1: number;
  dir2: WorldAxis;
  count2: number;
  spacing2: number;
  /** Circle: `count` round the world `axis` through the origin, over `angle` degrees (360 for all the way round). */
  axis: WorldAxis;
  count: number;
  angle: number;
  /** Join each copy to its original, for one printable body, instead of keeping separate bodies. */
  join: boolean;
}
export interface MoveFeature extends FeatureBase {
  type: "move";
  parts: string[];
  position: Partial<Vec3>;
  /** Turns, in degrees (the gizmo's turn handles and the Rotation fields). */
  rotation?: Partial<Vec3>;
}
export interface ResizeFeature extends FeatureBase {
  type: "resize";
  parts: string[];
  size: Partial<Vec3>;
}
export interface DeleteFeature extends FeatureBase {
  type: "delete";
  parts: string[];
}
/** A sketch (epic #5): its geometry, constraints and dimensions, on a plane. Extrude (#6) turns its profiles into solids. */
export interface SketchFeature extends FeatureBase {
  type: "sketch";
  sketch: Sketch;
}
/**
 * Extrude (#61): closed shapes of a sketch, picked by a point inside each (so the pick survives edits to the sketch),
 * pushed along its normal into a new body, or joined to, cut from or intersected with an existing one.
 */
export interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  /** The sketch step's id. */
  sketch: string;
  seeds: Vec2[];
  distance: number;
  direction: ExtrudeDirection;
  /** The second side's distance, for "two". */
  distance2?: number;
  operation: ExtrudeOperation;
  /** The part joined to, cut or intersected (not for "new"). */
  target?: string;
  /** The new body's part, for "new". */
  body: { id: string; name: string };
  /** Cuts only (#188): the named fit it was made with, and the gap on each side then, mm. */
  fit?: FitId;
  gap?: number;
}
/**
 * Combine (#66): bodies joined to, cut from or intersected with a target. A Group is the Tinkercad way: solids
 * joined and holes cut in one step, the originals put away until it is undone or deleted (Ungroup).
 */
export interface CombineTool {
  id: string;
  op: "join" | "cut" | "intersect";
  /** Cuts only (#183): the named fit it was made with, so a printer change can offer to update it. */
  fit?: FitId;
  /** Cuts only: the gap on each side, mm, as it was when the step was made. */
  gap?: number;
}
export interface CombineFeature extends FeatureBase {
  type: "combine";
  mode: "combine" | "group";
  target: string;
  /** Each tool body and what it does, in order. */
  tools: CombineTool[];
  /** Leave the tool bodies in the model (Combine only). */
  keepTools?: boolean;
}
/**
 * Fillet and chamfer (#67) round or bevel a part's edges; Shell (#68) hollows it to a wall, leaving faces open.
 * Edges and faces are numbered as the kernel numbers them on the part at that point of the timeline.
 */
export interface FinishFeature extends FeatureBase {
  /** Push/pull (#65) moves one flat face along its normal: out joins, in cuts. Its size is signed. */
  type: "fillet" | "chamfer" | "shell" | "pushpull";
  part: string;
  /** Edges for fillet and chamfer; faces to leave open for shell. */
  refs: number[];
  /** Radius, distance or wall thickness, mm. */
  size: number;
  /** Shell only: grow outward. */
  outside?: boolean;
}
/** Revolve (#62): closed shapes of a sketch turned round an axis, made into a new body or combined with one. */
export interface RevolveFeature extends FeatureBase {
  type: "revolve";
  sketch: string;
  seeds: Vec2[];
  axis: AxisRef;
  /** Degrees, 1 to 360. */
  angle: number;
  symmetric?: boolean;
  operation: ExtrudeOperation;
  target?: string;
  body: { id: string; name: string };
}
/** Hole (#70): screw holes on one flat face of a part, sized from the screw table. */
export interface HoleFeature extends FeatureBase, HoleParams {
  type: "hole";
  part: string;
  /** The face's plane in the world when the holes were placed: origin on the face, normal out of the body. */
  frame: Frame;
  /** Hole centres in the face's plane, mm. */
  points: Vec2[];
}
/** Import (#82): the bodies of an STL, STEP or 3MF file, standing with their bottom centre at `position`. */
export interface ImportFeature extends FeatureBase {
  type: "import";
  /** The file's name when it was imported. */
  file: string;
  blob: string;
  format: ImportFormat;
  bodies: { id: string; name: string }[];
  position: Vec3;
}
/**
 * A mounting feature (#189) on a flat face: standoffs on a hole pattern, or a servo horn mount (the horn's hub
 * recess, a screwdriver hole to the servo's own screw, and screw holes to bolt the horn's arms to the part).
 */
export interface MountFeature extends FeatureBase {
  type: "mount";
  kind: "standoffs" | "horn";
  part: string;
  /** The face's plane when the mount was placed: origin on the face, normal out of the body. */
  frame: Frame;
  /** Standoff centres, or the horn's centre first, in the face's plane, mm. */
  points: Vec2[];
  /** The screw, from the screw table. */
  size: string;
  /** The printer's hole offset when it was made (#104), mm. */
  offset?: number;
  /** Standoffs: how tall, how wide, and a clearance hole right through or a heat-set insert at the top. */
  height: number;
  outer: number;
  hole: "through" | "insert";
  /** Horn: which horn, the hub recess's diameter and depth, the arm holes' distance from the centre, and the hole to
   * reach the servo's screw. */
  horn: "single" | "double" | "cross";
  hub: number;
  recess: number;
  arm: number;
  access: number;
}

/** Insert part (#187): a catalogue part, with the record it used, placed as a reference body. */
export interface InsertFeature extends FeatureBase {
  type: "insert";
  part: { id: string; name: string };
  record: CataloguePart;
  position: Vec3;
  rotation?: Vec3;
}
export type Feature =
  | MountFeature
  | ImportFeature
  | InsertFeature
  | AddFeature
  | DuplicateFeature
  | PatternFeature
  | MoveFeature
  | ResizeFeature
  | DeleteFeature
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | CombineFeature
  | FinishFeature
  | HoleFeature;
export type FeatureType = Feature["type"];

/** How a part looks, and its name in the parts tree. Not part of the timeline, the way Fusion keeps visibility. */
export interface Look {
  name?: string;
  hidden?: boolean;
  ghost?: boolean;
  highlight?: boolean;
  hole?: boolean;
  /** A reference body (#185). */
  reference?: boolean;
  /** A hole's fit (#183). */
  fit?: FitId;
  /** A hole's custom gap, mm. */
  gap?: number;
}

export interface ModelDoc {
  format: "bettercad";
  version: 2;
  name: string;
  features: Feature[];
  looks: Record<string, Look>;
  /** Parts tree order, when the person has dragged rows. Parts not listed follow in build order. */
  order?: string[];
  /** Named views: saved cameras. */
  views?: NamedView[];
  /** Parameters (#75): named values that feature fields can use. */
  params?: Parameter[];
  /** Imported files' bytes, base64, by content hash (#82), so the model rebuilds without the original file. */
  blobs?: Record<string, string>;
  /** The printer, material and infill (#100, #105), so a shared model shows the bed its author meant. */
  print?: PrintSettings;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export const KIND_LABEL: Record<PartKind, string> = {
  box: "Box",
  cylinder: "Cylinder",
  sphere: "Sphere",
  cone: "Cone",
  torus: "Torus",
  wedge: "Wedge",
  solid: "Body",
};
export const FEATURE_LABEL: Record<FeatureType, string> = {
  add: "Add",
  duplicate: "Duplicate",
  pattern: "Pattern",
  move: "Move",
  resize: "Resize",
  delete: "Delete",
  sketch: "Sketch",
  extrude: "Extrude",
  combine: "Combine",
  fillet: "Fillet",
  chamfer: "Chamfer",
  shell: "Shell",
  pushpull: "Push/pull",
  revolve: "Revolve",
  hole: "Hole",
  import: "Import",
  insert: "Insert part",
  mount: "Mount",
};

export function newDoc(name = "Untitled model"): ModelDoc {
  return { format: "bettercad", version: 2, name, features: [], looks: {} };
}

let counter = 0;
export function newId(prefix = "p"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Where a feature goes: at the marker when rolled back, else at the end. */
const clampAt = (doc: ModelDoc, at?: number) => (at === undefined ? doc.features.length : Math.max(0, Math.min(at, doc.features.length)));

export interface Build {
  parts: Part[];
  /** Sketches on the timeline up to the marker, by feature id, in order. */
  sketches: { id: string; name: string; sketch: Sketch }[];
  /** Features that could not apply, with the reason: the part they change is gone. */
  failed: Map<string, string>;
}

const BUILT = new Set<string>([
  "mount",
  "import",
  "insert",
  "add",
  "duplicate",
  "pattern",
  "move",
  "resize",
  "delete",
  "sketch",
  "extrude",
  "revolve",
  "combine",
  "fillet",
  "chamfer",
  "shell",
  "pushpull",
  "hole",
]);

/** Replays the first `upTo` features (all of them by default) into parts. */
export function build(doc: ModelDoc, upTo = doc.features.length): Build {
  const parts: Part[] = [];
  const sketches: Build["sketches"] = [];
  const sketchById = new Map<string, Sketch>();
  const failed = new Map<string, string>();
  const find = (id: string) => parts.findIndex((p) => p.id === id);
  const missing = (f: Feature, ids: string[]) => {
    const gone = ids.filter((id) => find(id) < 0);
    if (gone.length) failed.set(f.id, gone.length === ids.length ? "The parts it changes are gone" : "Some of the parts it changes are gone");
    return gone;
  };
  const { values } = evaluateParams(doc.params);
  for (const raw of doc.features.slice(0, upTo)) {
    if (raw.suppressed) continue;
    const { feature: f, error } = bindExprs(raw, values);
    if (error) failed.set(f.id, error);
    if (!BUILT.has(f.type)) {
      failed.set(f.id, "This step needs a newer BetterCad");
      continue;
    }
    switch (f.type) {
      case "import":
        f.bodies.forEach((b, index) => {
          if (find(b.id) >= 0) return;
          parts.push({
            id: b.id,
            name: b.name,
            kind: "solid",
            hidden: false,
            position: { ...f.position },
            size: { x: 0, y: 0, z: 0 },
            imported: { blob: f.blob, format: f.format, index, mesh: f.format !== "step" },
          });
        });
        break;
      case "insert":
        if (find(f.part.id) < 0) {
          const [min, max] = partBounds(f.record);
          parts.push({
            id: f.part.id,
            name: f.part.name,
            kind: "solid",
            hidden: false,
            position: { ...f.position },
            ...(f.rotation ? { rotation: { ...f.rotation } } : {}),
            size: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
            catalogue: f.record,
            reference: true,
          });
        }
        break;
      case "add":
        if (find(f.part.id) < 0) parts.push({ ...f.part, position: { ...f.part.position }, size: { ...f.part.size }, hidden: false });
        break;
      case "duplicate":
        missing(
          f,
          f.copies.map((c) => c.from),
        );
        for (const c of f.copies) {
          const i = find(c.from);
          const src = parts[i];
          if (!src || find(c.id) >= 0) continue;
          parts.splice(i + 1, 0, { ...src, id: c.id, name: c.name, position: { ...src.position, x: src.position.x + 10 }, size: { ...src.size } });
        }
        break;
      case "pattern": {
        missing(f, f.parts);
        const problem = patternProblem(f);
        if (problem) {
          failed.set(f.id, problem);
          break;
        }
        const moves = patternMoves(f);
        for (const from of f.parts) {
          const i = find(from);
          const src = parts[i];
          if (!src) continue;
          const copies = moves.map((m, k) => copyPart(src, m, copyId(f, from, k), copyName(f, src.name, k)));
          if (f.join) {
            const at = { position: { ...src.position }, rotation: src.rotation && { ...src.rotation } };
            src.ops = [
              ...(src.ops ?? []),
              ...copies.map((c): BodyOp => ({ op: "join", body: { ...c, hole: undefined, fit: undefined, gap: undefined }, at, feature: f.id })),
            ];
          } else parts.splice(i + 1, 0, ...copies.filter((c) => find(c.id) < 0));
        }
        break;
      }
      case "move":
      case "resize": {
        missing(f, f.parts);
        if (f.type === "resize" && f.parts.some((id) => parts[find(id)]?.kind === "solid")) {
          failed.set(f.id, "Resize works on boxes, cylinders and spheres. Change a body's sketch or its extrude instead.");
        }
        const key = f.type === "move" ? "position" : "size";
        const change = f.type === "move" ? f.position : f.size;
        for (const id of f.parts) {
          const p = parts[find(id)];
          if (!p || (f.type === "resize" && p.kind === "solid")) continue;
          p[key] = { ...p[key], ...change };
          if (f.type === "move" && f.rotation) p.rotation = { ...ZERO, ...p.rotation, ...f.rotation };
        }
        break;
      }
      case "delete":
        missing(f, f.parts);
        for (const id of f.parts) {
          const i = find(id);
          if (i >= 0) parts.splice(i, 1);
        }
        break;
      case "sketch":
        sketches.push({ id: f.id, name: f.name, sketch: f.sketch });
        sketchById.set(f.id, f.sketch);
        break;
      case "extrude": {
        const sk = sketchById.get(f.sketch);
        if (!sk) {
          failed.set(f.id, "Its sketch is gone or comes later on the timeline");
          break;
        }
        const { shapes, lost } = pickProfiles(sk, f.seeds);
        if (!shapes.length) {
          failed.set(f.id, "The shapes it extruded are no longer closed. Close them in the sketch, or edit the extrude.");
          break;
        }
        if (lost) failed.set(f.id, `${lost === 1 ? "One shape" : `${lost} shapes`} it extruded ${lost === 1 ? "is" : "are"} no longer closed`);
        if (!(Math.abs(f.distance) > 1e-9)) {
          failed.set(f.id, "Give it a distance other than 0 mm");
          break;
        }
        const spec: PrismSpec = { frame: planeFrame(sk.plane), profiles: shapes, ...extent(f.direction, f.distance, f.distance2) };
        if (f.operation === "new") {
          if (find(f.body.id) < 0)
            parts.push({ id: f.body.id, name: f.body.name, kind: "solid", hidden: false, position: { ...ZERO }, size: prismSize(spec), prism: spec });
          break;
        }
        const t = f.target ? parts[find(f.target)] : undefined;
        if (!t) {
          failed.set(f.id, f.target ? "The body it changes is gone" : "Pick the body to change");
          break;
        }
        const tool: PrismSpec = { ...spec, frame: frameToLocal(spec.frame, t) };
        t.ops = [...(t.ops ?? []), { op: f.operation, tool, ...(f.operation === "cut" && f.gap ? { gap: f.gap } : {}), feature: f.id }];
        break;
      }
      case "revolve": {
        const sk = sketchById.get(f.sketch);
        if (!sk) {
          failed.set(f.id, "Its sketch is gone or comes later on the timeline");
          break;
        }
        const { shapes, lost, picked } = pickProfiles(sk, f.seeds);
        if (!shapes.length) {
          failed.set(f.id, "The shapes it revolved are no longer closed. Close them in the sketch, or edit the revolve.");
          break;
        }
        if (lost) failed.set(f.id, `${lost === 1 ? "One shape" : `${lost} shapes`} it revolved ${lost === 1 ? "is" : "are"} no longer closed`);
        const axis = axisOf(sk, f.axis);
        if (!axis) {
          failed.set(f.id, "The line it turns round is gone. Pick another axis.");
          break;
        }
        if (crossesAxis(picked, axis)) {
          failed.set(f.id, "The shape crosses the axis, so it can't be revolved. Move it to one side.");
          break;
        }
        const angle = Math.min(360, Math.max(0, f.angle));
        if (!(angle > 0)) {
          failed.set(f.id, "Give it an angle from 1° to 360°");
          break;
        }
        const spec: RevolveSpec = { frame: planeFrame(sk.plane), profiles: shapes, axis, angle, start: f.symmetric && angle < 360 ? -angle / 2 : 0 };
        if (f.operation === "new") {
          if (find(f.body.id) < 0)
            parts.push({ id: f.body.id, name: f.body.name, kind: "solid", hidden: false, position: { ...ZERO }, size: revolveSize(spec), revolve: spec });
          break;
        }
        const t = f.target ? parts[find(f.target)] : undefined;
        if (!t) {
          failed.set(f.id, f.target ? "The body it changes is gone" : "Pick the body to change");
          break;
        }
        t.ops = [...(t.ops ?? []), { op: f.operation, rev: { ...spec, frame: frameToLocal(spec.frame, t) }, feature: f.id }];
        break;
      }
      case "fillet":
      case "chamfer":
      case "shell":
      case "pushpull": {
        const t = parts[find(f.part)];
        if (!t) {
          failed.set(f.id, "The body it changes is gone");
          break;
        }
        if (f.type !== "shell" && !f.refs.length) {
          failed.set(f.id, `Pick at least one edge to ${f.type === "fillet" ? "round" : "bevel"}`);
          break;
        }
        if (f.type === "pushpull" ? !f.refs.length : !(f.size > 0)) {
          failed.set(f.id, f.type === "pushpull" ? "Pick the face to pull" : "Give it a size above 0 mm");
          break;
        }
        t.ops = [...(t.ops ?? []), { op: f.type, refs: [...f.refs], size: f.size, outside: f.outside, feature: f.id }];
        break;
      }
      case "hole": {
        const t = parts[find(f.part)];
        if (!t) {
          failed.set(f.id, "The body it changes is gone");
          break;
        }
        if (!f.points.length) {
          failed.set(f.id, "Click the face to place a hole");
          break;
        }
        const r = resolveHole(f);
        if ("error" in r) {
          failed.set(f.id, r.error);
          break;
        }
        if (f.depth !== null && !(f.depth > 0)) {
          failed.set(f.id, "Give it a depth above 0 mm, or choose Through all");
          break;
        }
        const holes: HoleSpec = {
          frame: frameToLocal(f.frame, t),
          points: f.points.map((q) => [q[0], q[1]]),
          diameter: r.diameter,
          depth: f.depth,
          head: r.head,
        };
        t.ops = [...(t.ops ?? []), { op: "hole", holes, feature: f.id }];
        break;
      }
      case "mount": {
        const t = parts[find(f.part)];
        if (!t) {
          failed.set(f.id, "The body it changes is gone");
          break;
        }
        const r = mountOps(f);
        if (typeof r === "string") {
          failed.set(f.id, r);
          break;
        }
        const local = (op: BodyOp): BodyOp =>
          op.tool
            ? { ...op, tool: { ...op.tool, frame: frameToLocal(op.tool.frame, t) } }
            : op.holes
              ? { ...op, holes: { ...op.holes, frame: frameToLocal(op.holes.frame, t) } }
              : op;
        t.ops = [...(t.ops ?? []), ...r.map(local)];
        break;
      }
      case "combine": {
        const t = parts[find(f.target)];
        const gone = [f.target, ...f.tools.map((x) => x.id)].filter((id) => find(id) < 0);
        if (!t) {
          failed.set(f.id, "The body it keeps is gone");
          break;
        }
        if (gone.length) failed.set(f.id, gone.length === 1 ? "One of the bodies it combines is gone" : `${gone.length} of the bodies it combines are gone`);
        const ops: BodyOp[] = [];
        for (const x of f.tools) {
          const i = find(x.id);
          const b = parts[i];
          if (!b || b === t) continue;
          const op: BodyOp = {
            op: x.op,
            body: { ...b, hole: undefined, fit: undefined, gap: undefined },
            at: { position: { ...t.position }, rotation: t.rotation && { ...t.rotation } },
            feature: f.id,
          };
          if (x.op === "cut" && x.gap && x.gap > 0) op.gap = x.gap;
          ops.push(op);
          if (!(f.mode === "combine" && f.keepTools)) parts.splice(i, 1);
        }
        t.ops = [...(t.ops ?? []), ...ops];
        break;
      }
    }
  }
  const looked = parts.map((p) => {
    const look = doc.looks[p.id];
    return look ? { ...p, ...look, name: look.name ?? p.name, hidden: !!look.hidden } : p;
  });
  if (doc.order?.length) {
    const rank = new Map(doc.order.map((id, i) => [id, i]));
    const r = (p: Part) => rank.get(p.id) ?? Number.MAX_SAFE_INTEGER;
    looked.sort((a, b) => r(a) - r(b));
  }
  // A step that can't build because something it needs is suppressed says so, rather than "gone".
  if (doc.features.some((f) => f.suppressed)) {
    for (const id of failed.keys()) {
      const why = suppressedNeed(doc, id);
      if (why) failed.set(id, why);
    }
  }
  return { parts: looked, sketches, failed };
}

/** A revolve's rough size: the box round the profiles swept a full turn (good enough for the props panel). */
function revolveSize(spec: RevolveSpec): Vec3 {
  const pts = spec.profiles.flatMap((p) =>
    p.outer.flatMap((g) => (g.kind === "circle" ? [[g.c[0] + g.r, g.c[1]] as Vec2, [g.c[0] - g.r, g.c[1]] as Vec2] : [g.a, g.b])),
  );
  const { origin: o, dir: d } = spec.axis;
  const r = Math.max(0, ...pts.map((p) => Math.abs((p[0] - o[0]) * d[1] - (p[1] - o[1]) * d[0])));
  const along = pts.map((p) => (p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1]);
  const [a0, a1] = [Math.min(...along), Math.max(...along)];
  const f = spec.frame;
  const y = [f.normal[1] * f.x[2] - f.normal[2] * f.x[1], f.normal[2] * f.x[0] - f.normal[0] * f.x[2], f.normal[0] * f.x[1] - f.normal[1] * f.x[0]];
  const axisW = [0, 1, 2].map((i) => f.x[i]! * d[0] + y[i]! * d[1]);
  // Along the axis: its length; across: the radius both ways.
  const span = (i: number) => Math.round((Math.abs(axisW[i]!) * (a1 - a0) + 2 * r * Math.sqrt(Math.max(0, 1 - axisW[i]! ** 2))) * 1000) / 1000;
  return pts.length ? { x: span(0), y: span(1), z: span(2) } : { ...ZERO };
}

/** A prism's rough size along X, Y and Z, for the props panel and the gizmo. */
function prismSize(spec: PrismSpec): Vec3 {
  const pts = spec.profiles.flatMap((p) =>
    p.outer.flatMap((g) =>
      g.kind === "circle" ? [[g.c[0] - g.r, g.c[1] - g.r] as Vec2, [g.c[0] + g.r, g.c[1] + g.r] as Vec2] : g.kind === "arc" ? [g.a, g.m, g.b] : [g.a, g.b],
    ),
  );
  const f = spec.frame;
  const y = [f.normal[1] * f.x[2] - f.normal[2] * f.x[1], f.normal[2] * f.x[0] - f.normal[0] * f.x[2], f.normal[0] * f.x[1] - f.normal[1] * f.x[0]];
  const corners = pts.flatMap(([u, v]) => [spec.from, spec.to].map((w) => [0, 1, 2].map((i) => f.origin[i]! + f.x[i]! * u + y[i]! * v + f.normal[i]! * w)));
  const span = (i: number) => Math.round((Math.max(...corners.map((c) => c[i]!)) - Math.min(...corners.map((c) => c[i]!))) * 1000) / 1000;
  return corners.length ? { x: span(0), y: span(1), z: span(2) } : { ...ZERO };
}

/** The parts after the whole timeline. */
export const partsOf = (doc: ModelDoc, upTo?: number) => build(doc, upTo).parts;

/** Every name a part has had, so names stay unique even for parts deleted later on the timeline. */
function usedNames(doc: ModelDoc): Set<string> {
  const names = new Set<string>();
  for (const f of doc.features) {
    if (f.type === "add" || f.type === "insert") names.add(f.part.name);
    if (f.type === "duplicate") f.copies.forEach((c) => names.add(c.name));
    if ((f.type === "extrude" || f.type === "revolve") && f.operation === "new") names.add(f.body.name);
  }
  Object.values(doc.looks).forEach((l) => l.name && names.add(l.name));
  return names;
}

/** The next free part name for a kind: "Box 1", "Box 2"… */
export function nextName(doc: ModelDoc, kind: PartKind): string {
  const base = KIND_LABEL[kind];
  const names = usedNames(doc);
  let n = 1;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** The next free feature name for a type: "Move 1", "Move 2"… */
export function nextFeatureName(doc: ModelDoc, type: Exclude<FeatureType, "add">): string {
  const base = FEATURE_LABEL[type];
  const names = new Set(doc.features.map((f) => f.name));
  let n = 1;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

function insert(doc: ModelDoc, at: number | undefined, f: Feature): ModelDoc {
  const features = [...doc.features];
  features.splice(clampAt(doc, at), 0, f);
  return { ...doc, features };
}

/** Adds a part as a new feature at `at` (the marker), or at the end. */
export function addPart(doc: ModelDoc, kind: PartKind, id = newId(), at?: number): ModelDoc {
  const i = clampAt(doc, at);
  const size = { ...(kind === "solid" ? DEFAULT_SIZE.box : DEFAULT_SIZE[kind]) };
  const offset = partsOf(doc, i).length * 25;
  const name = nextName(doc, kind);
  return insert(doc, i, { id: newId("f"), type: "add", name, part: { id, name, kind, position: { x: offset, y: 0, z: 0 }, size } });
}

/** Duplicates parts as one feature. `newIds` are the copies' ids, in the same order. */
export function duplicateParts(doc: ModelDoc, ids: string[], newIds = ids.map(() => newId()), at?: number): ModelDoc {
  const i = clampAt(doc, at);
  const built = partsOf(doc, i);
  const names = usedNames(doc);
  const copies = ids.flatMap((from, k) => {
    const src = built.find((p) => p.id === from);
    if (!src) return [];
    let name = `${src.name} copy`;
    for (let n = 2; names.has(name); n += 1) name = `${src.name} copy ${n}`;
    names.add(name);
    return [{ from, id: newIds[k] ?? newId(), name }];
  });
  if (!copies.length) return doc;
  return insert(doc, i, { id: newId("f"), type: "duplicate", name: nextFeatureName(doc, "duplicate"), copies });
}

export function duplicatePart(doc: ModelDoc, id: string, newPartId = newId(), at?: number): ModelDoc {
  return duplicateParts(doc, [id], [newPartId], at);
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Moves or resizes parts. A change right after a move (or resize) of the same parts folds into it, so scrubbing a
 * field or typing a value makes one feature, not one per keystroke.
 */
export function changeParts(doc: ModelDoc, ids: string[], key: "position" | "size" | "rotation", change: Partial<Vec3>, at?: number): ModelDoc {
  if (!ids.length) return doc;
  const i = clampAt(doc, at);
  const type = key === "size" ? "resize" : "move";
  const prev = doc.features[i - 1];
  if (prev && prev.type === type && !prev.suppressed && sameSet(prev.parts, ids)) {
    const features = [...doc.features];
    features[i - 1] =
      prev.type === "move"
        ? key === "rotation"
          ? { ...prev, rotation: { ...prev.rotation, ...change } }
          : { ...prev, position: { ...prev.position, ...change } }
        : { ...prev, size: { ...(prev as ResizeFeature).size, ...change } };
    return { ...doc, features };
  }
  const base = { id: newId("f"), name: nextFeatureName(doc, type), parts: [...ids] };
  if (type === "resize") return insert(doc, i, { ...base, type, size: change });
  return insert(doc, i, key === "rotation" ? { ...base, type, position: {}, rotation: change } : { ...base, type, position: change });
}

/** Places one part where the gizmo left it: one Move feature with its position and turn. */
export function placePart(doc: ModelDoc, id: string, position: Vec3, rotation: Vec3, at?: number): ModelDoc {
  const i = clampAt(doc, at);
  const before = partsOf(doc, i).find((p) => p.id === id);
  if (!before) return doc;
  const r0 = { ...ZERO, ...before.rotation };
  const moved = (["x", "y", "z"] as const).some((a) => Math.abs(before.position[a] - position[a]) > 1e-9);
  const turned = (["x", "y", "z"] as const).some((a) => Math.abs(r0[a] - rotation[a]) > 1e-9);
  if (!moved && !turned) return doc;
  const f: MoveFeature = { id: newId("f"), type: "move", name: nextFeatureName(doc, "move"), parts: [id], position: moved ? { ...position } : {} };
  if (turned) f.rotation = { ...rotation };
  return insert(doc, i, f);
}

// ---- named views

export function saveView(doc: ModelDoc, view: NamedView): ModelDoc {
  const views = doc.views ?? [];
  const i = views.findIndex((v) => v.id === view.id);
  return { ...doc, views: i < 0 ? [...views, view] : views.map((v) => (v.id === view.id ? view : v)) };
}

export function removeView(doc: ModelDoc, id: string): ModelDoc {
  return { ...doc, views: (doc.views ?? []).filter((v) => v.id !== id) };
}

/** The next free view name: "View 1", "View 2"… */
export function nextViewName(doc: ModelDoc): string {
  const names = new Set((doc.views ?? []).map((v) => v.name));
  let n = 1;
  while (names.has(`View ${n}`)) n += 1;
  return `View ${n}`;
}

export function removeParts(doc: ModelDoc, ids: string[], at?: number): ModelDoc {
  if (!ids.length) return doc;
  return insert(doc, at, { id: newId("f"), type: "delete", name: nextFeatureName(doc, "delete"), parts: [...ids] });
}

export function removePart(doc: ModelDoc, id: string, at?: number): ModelDoc {
  return removeParts(doc, [id], at);
}

/** Changes how parts look (name, visibility). Not a timeline feature. */
export function setLook(doc: ModelDoc, ids: string[], change: (id: string) => Look): ModelDoc {
  const looks = { ...doc.looks };
  for (const id of ids) looks[id] = { ...looks[id], ...change(id) };
  return { ...doc, looks };
}

/** Moves a part before another in the parts tree (or to the end when beforeId is null). */
export function reorderPart(doc: ModelDoc, id: string, beforeId: string | null): ModelDoc {
  const ids = partsOf(doc).map((p) => p.id);
  if (!ids.includes(id) || id === beforeId) return doc;
  const rest = ids.filter((x) => x !== id);
  const to = beforeId === null ? rest.length : rest.indexOf(beforeId);
  if (to < 0) return doc;
  rest.splice(to, 0, id);
  return { ...doc, order: rest };
}

// ---- timeline edits

export function updateFeature(doc: ModelDoc, id: string, change: Partial<Pick<FeatureBase, "name" | "suppressed">>): ModelDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === id ? { ...f, ...change } : f)) };
}

export function removeFeature(doc: ModelDoc, id: string): ModelDoc {
  return { ...doc, features: doc.features.filter((f) => f.id !== id) };
}

/** Moves a feature before another on the timeline (or to the end when beforeId is null). */
export function reorderFeature(doc: ModelDoc, id: string, beforeId: string | null): ModelDoc {
  const f = doc.features.find((x) => x.id === id);
  if (!f || id === beforeId) return doc;
  const rest = doc.features.filter((x) => x.id !== id);
  const to = beforeId === null ? rest.length : rest.findIndex((x) => x.id === beforeId);
  if (to < 0) return doc;
  rest.splice(to, 0, f);
  return { ...doc, features: rest };
}

/** The parts a feature makes or changes. */
export function featureParts(f: Feature): string[] {
  switch (f.type) {
    case "add":
      return [f.part.id];
    case "duplicate":
      return f.copies.map((c) => c.id);
    case "pattern":
      return f.join ? [...f.parts] : patternCopyIds(f);
    case "sketch":
      return [];
    case "extrude":
      return f.operation === "new" ? [f.body.id] : f.target ? [f.target] : [];
    case "combine":
      return [f.target];
    case "fillet":
    case "chamfer":
    case "shell":
    case "pushpull":
    case "hole":
    case "mount":
      return [f.part];
    case "revolve":
      return f.operation === "new" ? [f.body.id] : f.target ? [f.target] : [];
    case "import":
      return f.bodies.map((b) => b.id);
    case "insert":
      return [f.part.id];
    default:
      return f.parts;
  }
}

const mm = (n: number) => `${Math.round(n * 100) / 100} mm`;
const axes = (v: Partial<Vec3>) =>
  (["x", "y", "z"] as const)
    .filter((a) => v[a] !== undefined)
    .map((a) => `${a.toUpperCase()} ${mm(v[a]!)}`)
    .join(", ");

/** The feature's key value for its tooltip: "20 × 20 × 30 mm", "Box 1, X 25 mm". */
export function featureSummary(doc: ModelDoc, f: Feature): string {
  const names = new Map<string, string>();
  for (const g of doc.features) {
    if (g.type === "add" || g.type === "insert") names.set(g.part.id, g.part.name);
    if (g.type === "duplicate") g.copies.forEach((c) => names.set(c.id, c.name));
    if ((g.type === "extrude" || g.type === "revolve") && g.operation === "new") names.set(g.body.id, g.body.name);
  }
  for (const [id, l] of Object.entries(doc.looks)) if (l.name) names.set(id, l.name);
  const who = (ids: string[]) => (ids.length === 1 ? (names.get(ids[0]!) ?? "1 part") : `${ids.length} parts`);
  switch (f.type) {
    case "mount":
      return f.kind === "standoffs"
        ? `${f.points.length} × ${f.size}, ${mm(f.height)} tall${f.hole === "insert" ? ", heat-set inserts" : ""}`
        : `${f.horn === "single" ? "Single" : f.horn === "double" ? "Double" : "Cross"} horn, ${f.size} holes ${mm(f.arm)} out`;
    case "insert":
      return `${f.record.name}, ${f.record.mass} g${f.record.checked ? "" : ", sizes not checked"}`;
    case "import":
      return `${f.bodies.length === 1 ? "1 body" : `${f.bodies.length} bodies`} from ${f.file}`;
    case "add": {
      const s = f.part.size;
      return `${KIND_LABEL[f.part.kind]}, ${s.x} × ${s.y} × ${s.z} mm`;
    }
    case "duplicate":
      return `Copies ${who(f.copies.map((c) => c.from))}`;
    case "pattern":
      return patternSummary(f, who(f.parts));
    case "move": {
      const turn = f.rotation
        ? (["x", "y", "z"] as const)
            .filter((a) => f.rotation![a] !== undefined)
            .map((a) => `turn ${a.toUpperCase()} ${Math.round(f.rotation![a]! * 100) / 100}°`)
            .join(", ")
        : "";
      return [who(f.parts), axes(f.position), turn].filter(Boolean).join(", ");
    }
    case "resize":
      return `${who(f.parts)}, ${axes(f.size)}`;
    case "delete":
      return who(f.parts);
    case "sketch":
      return sketchSummary(f.sketch);
    case "extrude": {
      const how = f.direction === "symmetric" ? ", both ways" : f.direction === "two" ? ` and ${mm(f.distance2 ?? 0)}` : "";
      const op = f.operation === "new" ? "new body" : `${f.operation} ${who(f.target ? [f.target] : [])}`;
      return `${mm(f.distance)}${how}, ${op}`;
    }
    case "fillet":
    case "chamfer": {
      const n = f.refs.length;
      return `${f.type === "fillet" ? "R " : ""}${mm(f.size)}, ${n === 1 ? "1 edge" : `${n} edges`} of ${who([f.part])}`;
    }
    case "pushpull":
      return `${f.size >= 0 ? "Out" : "In"} ${mm(Math.abs(f.size))}, ${who([f.part])}`;
    case "hole": {
      const n = f.points.length;
      const head = f.head === "none" ? "" : `, ${f.head}`;
      return `${n === 1 ? "1 hole" : `${n} holes`}, ${holeLabel(f)}${head}, ${f.depth === null ? "through" : `${mm(f.depth)} deep`}, ${who([f.part])}`;
    }
    case "revolve": {
      const op = f.operation === "new" ? "new body" : `${f.operation} ${who(f.target ? [f.target] : [])}`;
      const axis = f.axis.kind === "line" ? "a sketch line" : `the sketch's ${f.axis.kind.toUpperCase()} axis`;
      return `${f.angle >= 360 ? "Full turn" : `${Math.round(f.angle * 100) / 100}°${f.symmetric ? " both ways" : ""}`} round ${axis}, ${op}`;
    }
    case "shell": {
      const n = f.refs.length;
      return `${mm(f.size)} wall${f.outside ? " outside" : ""}, ${n ? `${n === 1 ? "1 face" : `${n} faces`} open` : "sealed"}, ${who([f.part])}`;
    }
    case "combine": {
      const n = f.tools.length;
      const holes = f.tools.filter((x) => x.op === "cut").length;
      if (f.mode === "group")
        return `${who([f.target])} with ${n === 1 ? "1 body" : `${n} bodies`}${holes ? `, ${holes === 1 ? "1 hole" : `${holes} holes`}` : ""}`;
      return `${f.tools[0]?.op ?? "join"} ${n === 1 ? "1 body" : `${n} bodies`} ${f.tools[0]?.op === "join" ? "to" : f.tools[0]?.op === "cut" ? "from" : "with"} ${who([f.target])}`;
    }
  }
}

/** "On the XY plane, 4 lines and 2 circles". */
export function sketchSummary(s: Sketch): string {
  const on = s.plane.kind === "world" ? `On the ${s.plane.plane} plane` : "On a face";
  const offset = s.plane.offset ? `, ${mm(s.plane.offset)} up` : "";
  const counts = (["line", "arc", "circle"] as const)
    .map((k) => [k, s.entities.filter((e) => e.kind === k && !e.construction).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`);
  return `${on}${offset}${counts.length ? `, ${counts.join(" and ").replace(/ and (?=.* and )/g, ", ")}` : ", empty"}`;
}

/** Starts a sketch on a plane as a new feature at `at` (the marker), or at the end. */
export function addSketch(doc: ModelDoc, plane: PlaneRef, id = newId("f"), at?: number): ModelDoc {
  const name = nextFeatureName(doc, "sketch");
  return insert(doc, clampAt(doc, at), { id, type: "sketch", name, sketch: newSketch(plane, name, id) });
}

export type ExtrudeParams = Pick<ExtrudeFeature, "sketch" | "seeds" | "distance" | "direction" | "distance2" | "operation" | "target">;

/** Adds an Extrude step. Its new body (when it makes one) gets the part id `bodyId`. */
export function addExtrude(doc: ModelDoc, params: ExtrudeParams, id = newId("f"), bodyId = newId(), at?: number): ModelDoc {
  const name = nextFeatureName(doc, "extrude");
  return insert(doc, at, { id, type: "extrude", name, ...params, body: { id: bodyId, name: nextName(doc, "solid") } });
}

/** Changes an Extrude step's settings (the dialog edits it live, as one undo step). */
export function updateExtrude(doc: ModelDoc, id: string, change: Partial<ExtrudeParams>): ModelDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === id && f.type === "extrude" ? { ...f, ...change } : f)) };
}

export type FinishParams = Pick<FinishFeature, "type" | "part" | "refs" | "size" | "outside">;

/** Adds a Fillet, Chamfer or Shell step at `at` (the marker), or at the end. */
export function addFinish(doc: ModelDoc, params: FinishParams, id = newId("f"), at?: number): ModelDoc {
  return insert(doc, at, { id, name: nextFeatureName(doc, params.type), ...params });
}

/** Changes a Fillet, Chamfer or Shell step (the tool edits it live, as one undo step). */
export function updateFinish(doc: ModelDoc, id: string, change: Partial<FinishParams>): ModelDoc {
  return {
    ...doc,
    features: doc.features.map((f) => {
      if (f.id !== id || (f.type !== "fillet" && f.type !== "chamfer" && f.type !== "shell" && f.type !== "pushpull")) return f;
      const next = { ...f, ...change } as FinishFeature;
      // Switching between round and bevel renames a step that still has its default name.
      if (change.type && change.type !== f.type && f.name.startsWith(FEATURE_LABEL[f.type])) next.name = nextFeatureName(doc, change.type);
      return next;
    }),
  };
}

export type RevolveParams = Pick<RevolveFeature, "sketch" | "seeds" | "axis" | "angle" | "symmetric" | "operation" | "target">;

/** Adds a Revolve step. Its new body (when it makes one) gets the part id `bodyId`. */
export function addRevolve(doc: ModelDoc, params: RevolveParams, id = newId("f"), bodyId = newId(), at?: number): ModelDoc {
  return insert(doc, at, { id, type: "revolve", name: nextFeatureName(doc, "revolve"), ...params, body: { id: bodyId, name: nextName(doc, "solid") } });
}

/** Changes a Revolve step's settings (the tool edits it live, as one undo step). */
export function updateRevolve(doc: ModelDoc, id: string, change: Partial<RevolveParams>): ModelDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === id && f.type === "revolve" ? { ...f, ...change } : f)) };
}

export type CombineParams = Pick<CombineFeature, "mode" | "target" | "tools" | "keepTools">;

/** Adds a Combine or Group step at `at` (the marker), or at the end. */
export function addCombine(doc: ModelDoc, params: CombineParams, id = newId("f"), at?: number): ModelDoc {
  const name = params.mode === "group" ? nextGroupName(doc) : nextFeatureName(doc, "combine");
  return insert(doc, at, { id, type: "combine", name, ...params });
}

function nextGroupName(doc: ModelDoc): string {
  const names = new Set(doc.features.map((f) => f.name));
  let n = 1;
  while (names.has(`Group ${n}`)) n += 1;
  return `Group ${n}`;
}

/**
 * Group (Tinkercad): the first solid keeps its name; the other solids join it and the holes are cut from it. Returns
 * a reason instead when there is nothing to group.
 */
/** The gap a hole body cuts with (#183), mm: its named fit from the printer's tuning, or its custom gap. */
export function holeGap(p: Pick<Part, "fit" | "gap">, print?: PrintSettings): number {
  if (p.fit) return fitGap(p.fit, print?.fits);
  return p.gap && p.gap > 0 ? p.gap : 0;
}

/** A cut tool with its fit (#183): the gap is fixed now, so changing printer never quietly resizes the cut. */
export function cutTool(id: string, fit: FitId | null, gap: number, print?: PrintSettings): CombineTool {
  const g = fit ? fitGap(fit, print?.fits) : gap;
  const t: CombineTool = { id, op: "cut" };
  if (fit) t.fit = fit;
  if (g > 0) t.gap = g;
  return t;
}

/** Whether a part is printed (#185): not hidden, not a hole and not a reference body. */
export const printed = (p: Pick<Part, "hidden" | "hole" | "reference">) => !p.hidden && !p.hole && !p.reference;

/** What a mate (#184) needs to change to fix its gap: the bodies, the faces and the gap now. */
export interface MateRef {
  kind: "pin" | "faces";
  a: string;
  b: string;
  faceA: number;
  gap: number;
}

/**
 * Gives a mate (#184) the gap of a fit, as one edit. A pin cut out of the body it sits in gets the fit on that cut
 * (#183); a pair of flat faces gets a Push/pull that moves body `a`'s face back. Returns why not, for a pin whose hole
 * came from somewhere else.
 */
export function fixMate(doc: ModelDoc, m: MateRef, fit: FitId, at?: number): ModelDoc | string {
  const want = fitGap(fit, doc.print?.fits);
  if (m.kind === "pin") {
    const f = [...doc.features]
      .reverse()
      .find((x): x is CombineFeature => x.type === "combine" && !x.suppressed && x.target === m.a && x.tools.some((t) => t.id === m.b && t.op === "cut"));
    if (!f) return `This hole wasn't cut by the pin, so widen it by ${Math.round((want - m.gap) * 2 * 100) / 100} mm in the step that made it.`;
    return {
      ...doc,
      features: doc.features.map((x) => (x === f ? { ...f, tools: f.tools.map((t) => (t.id === m.b && t.op === "cut" ? { ...t, fit, gap: want } : t)) } : x)),
    };
  }
  const by = want - m.gap;
  if (Math.abs(by) < 1e-6) return doc;
  return addFinish(doc, { type: "pushpull", part: m.a, refs: [m.faceA], size: -by }, newId("f"), at);
}

/** Fitted cuts (#183) made with a gap other than the one their named fit comes to now: what a printer change can update. */
export function staleFits(doc: ModelDoc, print?: PrintSettings): CombineFeature[] {
  return doc.features.filter(
    (f): f is CombineFeature => f.type === "combine" && f.tools.some((t) => t.fit && Math.abs((t.gap ?? 0) - fitGap(t.fit, print?.fits)) > 1e-9),
  );
}

/** Brings every fitted cut to the gap its named fit comes to now (#180), as one edit. */
export function updateFits(doc: ModelDoc, print?: PrintSettings): ModelDoc {
  const stale = new Set(staleFits(doc, print).map((f) => f.id));
  if (!stale.size) return doc;
  return {
    ...doc,
    features: doc.features.map((f) =>
      f.type === "combine" && stale.has(f.id) ? { ...f, tools: f.tools.map((t) => (t.fit ? { ...t, gap: fitGap(t.fit, print?.fits) } : t)) } : f,
    ),
  };
}

export function groupParams(parts: Part[], ids: string[], print?: PrintSettings): CombineParams | string {
  const picked = parts.filter((p) => ids.includes(p.id));
  if (picked.length < 2) return "Select two or more bodies to group them";
  const solids = picked.filter((p) => !p.hole);
  if (!solids.length) return "Pick at least one solid to cut the holes from";
  const [target, ...rest] = solids;
  const holes = picked.filter((p) => p.hole);
  return {
    mode: "group",
    target: target!.id,
    tools: [...rest.map((p) => ({ id: p.id, op: "join" as const })), ...holes.map((p) => cutTool(p.id, p.fit ?? null, holeGap(p, print), print))],
  };
}

/** The Group step that made a part, if the part is one (for Ungroup). */
export function groupOf(doc: ModelDoc, partId: string, upTo = doc.features.length): CombineFeature | null {
  for (const f of doc.features.slice(0, upTo).reverse()) if (f.type === "combine" && f.mode === "group" && f.target === partId && !f.suppressed) return f;
  return null;
}

/** Changes a sketch in place (each drawing step is one undo step). */
export function updateSketch(doc: ModelDoc, id: string, fn: (s: Sketch) => Sketch): ModelDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === id && f.type === "sketch" ? { ...f, sketch: fn(f.sketch) } : f)) };
}

/** Turns an epic #2 file (a flat list of parts) into a timeline: one Add feature per part. */
function migrateV1(d: { name: string; parts: Part[] }): ModelDoc {
  const doc = newDoc(d.name);
  doc.features = d.parts.map((p, i) => ({
    id: `f${i + 1}`,
    type: "add" as const,
    name: p.name,
    part: { id: p.id, name: p.name, kind: p.kind, position: p.position, size: p.size },
  }));
  for (const p of d.parts) {
    if (p.hidden || p.ghost || p.highlight) doc.looks[p.id] = { hidden: p.hidden, ghost: p.ghost, highlight: p.highlight };
  }
  return doc;
}

/**
 * Brings a stored document up to the current version, keeping every field it carries, known or not, so a file from
 * a newer BetterCad survives a round trip here.
 */
export function upgradeDoc(d: Record<string, unknown>): ModelDoc {
  if (d.version === 1 && Array.isArray(d.parts)) return migrateV1(d as unknown as { name: string; parts: Part[] });
  const looks = d.looks && typeof d.looks === "object" ? (d.looks as Record<string, Look>) : {};
  return { ...d, format: "bettercad", version: 2, name: String(d.name ?? "Untitled model"), features: (d.features ?? []) as Feature[], looks } as ModelDoc;
}

/** Parses a saved document, throwing a one-line message when it is not a BetterCad model. (.bcad files: see bcad.ts.) */
export function parseDoc(text: string): ModelDoc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not a BetterCad model.");
  }
  const d = data as Record<string, unknown> | null;
  if (d?.format !== "bettercad" || typeof d.name !== "string") throw new Error("That file is not a BetterCad model.");
  if ((d.version === 1 && Array.isArray(d.parts)) || (d.version === 2 && Array.isArray(d.features))) return upgradeDoc(d);
  throw new Error("That file is not a BetterCad model.");
}

export interface ImportParams {
  file: string;
  format: ImportFormat;
  /** The file's bytes, base64, and their hash: kept once however many times the file is imported. */
  blob: string;
  data: string;
  bodies: { id: string; name: string }[];
  position: Vec3;
}

/** Adds an Import step (#82) and keeps the file's bytes in the document. */
export function addImport(doc: ModelDoc, p: ImportParams, id = newId("f"), at?: number): ModelDoc {
  const { data, ...rest } = p;
  const blobs = doc.blobs?.[p.blob] ? doc.blobs : { ...doc.blobs, [p.blob]: data };
  return insert({ ...doc, blobs }, at, { id, type: "import", name: nextFeatureName(doc, "import"), ...rest });
}

/** Adds an Insert part step (#187): a catalogue part, kept whole, standing at `position` turned by `rotation`. */
export function insertCatalogue(
  doc: ModelDoc,
  record: CataloguePart,
  place: { position: Vec3; rotation?: Vec3 },
  partId = newId(),
  id = newId("f"),
  at?: number,
): ModelDoc {
  const names = usedNames(doc);
  doc.features.forEach((f) => names.add(f.name));
  let name = record.name;
  for (let n = 2; names.has(name); n += 1) name = `${record.name} ${n}`;
  const turned = place.rotation && (place.rotation.x || place.rotation.y || place.rotation.z);
  return insert(doc, at, {
    id,
    type: "insert",
    name,
    part: { id: partId, name },
    record: structuredClone(record),
    position: { ...place.position },
    ...(turned ? { rotation: { ...place.rotation! } } : {}),
  });
}

/** The points a horn's arm holes sit on, about its centre: along x, both ways, or both ways along x and y. */
export function hornPoints(horn: MountFeature["horn"], arm: number): Vec2[] {
  const out: Vec2[] = [[arm, 0]];
  if (horn !== "single") out.push([-arm, 0]);
  if (horn === "cross") out.push([0, arm], [0, -arm]);
  return out;
}

/** A mount's joins and holes, in world space, or why it can't be made. */
export function mountOps(f: MountFeature): BodyOp[] | string {
  if (!f.points.length) return "Click the face to place it";
  const s = screw(f.size);
  if (!s) return "Pick a screw size";
  const printed = resolveHole({ size: f.size, fit: "printed", head: "none", depth: null, offset: f.offset });
  if ("error" in printed) return printed.error;
  const n = f.frame.normal;
  const lift = (h: number): Frame => ({ ...f.frame, origin: [f.frame.origin[0] + n[0] * h, f.frame.origin[1] + n[1] * h, f.frame.origin[2] + n[2] * h] });
  const holes = (frame: Frame, points: Vec2[], diameter: number, depth: number | null): BodyOp => ({
    op: "hole",
    holes: { frame, points: points.map((p) => [p[0], p[1]]), diameter, depth },
    feature: f.id,
  });
  if (f.kind === "standoffs") {
    if (!(f.height > 0)) return "Give the standoffs a height above 0 mm";
    const insert = f.hole === "insert" ? s.insert : undefined;
    if (f.hole === "insert" && !insert) return `There's no heat-set insert for ${s.label} in the screw table`;
    const bore = insert ? insert.diameter : printed.diameter;
    if (!(f.outer > bore + 0.8)) return `Make the standoffs wider than ${Math.round((bore + 0.8) * 100) / 100} mm, so they keep a wall`;
    const r = f.outer / 2;
    const tool: PrismSpec = {
      frame: f.frame,
      profiles: f.points.map((c) => ({ outer: [{ kind: "circle", c: [c[0], c[1]], r }], holes: [], area: Math.PI * r * r })),
      from: 0,
      to: f.height,
    };
    return [{ op: "join", tool, feature: f.id }, holes(lift(f.height), f.points, bore, insert ? insert.depth + 1 : null)];
  }
  if (!(f.hub > 0 && f.recess > 0)) return "Give the hub recess a diameter and depth above 0 mm";
  if (!(f.arm > f.hub / 2)) return "Put the arm holes outside the hub";
  const [cx, cy] = f.points[0]!;
  const at = (p: Vec2): Vec2 => [cx + p[0], cy + p[1]];
  const ops = [holes(f.frame, [[cx, cy]], f.hub, f.recess), holes(f.frame, hornPoints(f.horn, f.arm).map(at), printed.diameter, null)];
  if (f.access > 0) ops.push(holes(f.frame, [[cx, cy]], f.access, null));
  return ops;
}

/** The settings a new mount starts with: M2.5 standoffs 6 mm tall (a Pi's screws), or a micro servo's single-arm horn. */
export const MOUNT_DEFAULTS: Omit<MountFeature, "id" | "name" | "type" | "kind" | "part" | "frame" | "points"> = {
  size: "M2.5",
  height: 6,
  outer: 6,
  hole: "through",
  horn: "single",
  hub: 7.5,
  recess: 2,
  arm: 10,
  access: 3,
};

export type MountParams = Omit<MountFeature, "id" | "name" | "type">;

/** Adds a Mount step at `at` (the marker), or at the end. */
export function addMount(doc: ModelDoc, params: MountParams, id = newId("f"), at?: number): ModelDoc {
  const name = params.kind === "standoffs" ? nextNamed(doc, "Standoffs") : nextNamed(doc, "Horn mount");
  return insert(doc, at, { id, type: "mount", name, ...params });
}

/** Changes a Mount step (the tool edits it live, as one undo step). */
export function updateMount(doc: ModelDoc, id: string, change: Partial<MountParams>): ModelDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === id && f.type === "mount" ? { ...f, ...change } : f)) };
}

function nextNamed(doc: ModelDoc, base: string): string {
  const names = new Set(doc.features.map((f) => f.name));
  let n = 1;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export interface PocketOptions {
  /** The body the part sits on. */
  target: string;
  /** How deep the pocket goes, mm. The part's own pocket depth when missing. */
  depth?: number;
  /** The pocket's fit (#183): sliding by default. Null for none. */
  fit?: FitId | null;
  /** The screw holes' fit: printed clearance, or heat-set inserts. */
  holes?: "printed" | "insert";
}

/**
 * Cut pocket (#188): a catalogue part's cutout as ordinary steps in the body it sits on. A sketch of the pocket on the
 * part's surface, an extrude cut with a fit, and a Hole step for each screw size, all through the target. Returns the
 * document unchanged, with a reason, when there's nothing to cut.
 */
export function cutPocket(doc: ModelDoc, partId: string, o: PocketOptions, at?: number): { doc: ModelDoc; error?: string } {
  const step = doc.features.find((f): f is InsertFeature => f.type === "insert" && f.part.id === partId);
  if (!step) return { doc, error: "Pick a part from the catalogue" };
  if (o.target === partId) return { doc, error: "Pick the body the part sits on" };
  const rec = step.record;
  const frame = partFrame(step.position, step.rotation);
  let d = doc;
  let i = at;
  const next = () => (i === undefined ? undefined : i++);
  if (rec.cutout.pocket.length) {
    const sketchId = newId("f");
    d = addSketch(d, { kind: "face", face: { body: partId, face: 0 }, offset: 0, frame }, sketchId, next());
    const sf = d.features.find((f) => f.id === sketchId) as SketchFeature;
    let sk = sf.sketch;
    for (const s of rec.cutout.pocket) {
      const [cx, cy] = s.at;
      const [w, h] = s.size;
      sk = (s.kind === "rect" ? drawCentreRectangle(sk, [cx, cy], [cx + w / 2, cy + h / 2], { width: w, height: h }) : drawCircle(sk, [cx, cy], w / 2, w))
        .sketch;
    }
    d = {
      ...d,
      features: d.features.map((f) => (f.id === sketchId ? { ...sf, name: `${rec.name} pocket`, sketch: { ...sk, name: `${rec.name} pocket` } } : f)),
    };
    const fit = o.fit === undefined ? "sliding" : o.fit;
    const gap = fit ? fitGap(fit, doc.print?.fits) : 0;
    const depth = o.depth ?? rec.cutout.depth;
    const exId = newId("f");
    d = addExtrude(
      d,
      { sketch: sketchId, seeds: rec.cutout.pocket.map((s) => s.at), distance: -depth, direction: "one", operation: "cut", target: o.target },
      exId,
      newId(),
      next(),
    );
    d = {
      ...d,
      features: d.features.map((f) => (f.id === exId && f.type === "extrude" ? { ...f, ...(fit ? { fit } : {}), ...(gap > 0 ? { gap } : {}) } : f)),
    };
  }
  const sizes = [...new Set(rec.cutout.holes.map((h) => h.screw))];
  for (const size of sizes) {
    const points = rec.cutout.holes.filter((h) => h.screw === size).map((h) => h.at);
    // An insert's hole is as deep as the insert, plus 1 mm for the melt to go; a clearance hole goes right through.
    const insert = o.holes === "insert" ? screw(size)?.insert : undefined;
    d = addHole(
      d,
      {
        part: o.target,
        frame,
        points,
        size,
        fit: o.holes ?? "printed",
        head: "none",
        depth: insert ? insert.depth + 1 : null,
        offset: holeOffsetOf(doc.print),
      },
      newId("f"),
      next(),
    );
  }
  if (d === doc) return { doc, error: `The ${rec.name} has no pocket or screw holes to cut` };
  return { doc: d };
}

export type HoleStepParams = Pick<HoleFeature, "part" | "frame" | "points" | "size" | "fit" | "diameter" | "offset" | "head" | "depth">;

/** Adds a Hole step at `at` (the marker), or at the end. */
export function addHole(doc: ModelDoc, params: HoleStepParams, id = newId("f"), at?: number): ModelDoc {
  return insert(doc, at, { id, type: "hole", name: nextFeatureName(doc, "hole"), ...params });
}

/** Changes a Hole step (the tool edits it live, as one undo step). */
export function updateHole(doc: ModelDoc, id: string, change: Partial<HoleStepParams>): ModelDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === id && f.type === "hole" ? { ...f, ...change } : f)) };
}

// ---- dependencies (#74)

/** The parts a feature reads (it needs them to exist before it), as opposed to the ones it makes. */
function partsRead(f: Feature): string[] {
  switch (f.type) {
    case "add":
    case "sketch":
      return f.type === "sketch" && f.sketch.plane.kind === "face" ? [f.sketch.plane.face.body] : [];
    case "duplicate":
      return f.copies.map((c) => c.from);
    case "move":
    case "resize":
    case "delete":
    case "pattern":
      return f.parts;
    case "extrude":
    case "revolve":
      return f.operation !== "new" && f.target ? [f.target] : [];
    case "combine":
      return [f.target, ...f.tools.map((t) => t.id)];
    case "import":
    case "insert":
      return [];
    default:
      return [f.part];
  }
}

/** Parts a feature brings into being. */
function partsMade(f: Feature): string[] {
  if (f.type === "add") return [f.part.id];
  if (f.type === "duplicate") return f.copies.map((c) => c.id);
  if (f.type === "pattern") return patternCopyIds(f);
  if (f.type === "import") return f.bodies.map((b) => b.id);
  if (f.type === "insert") return [f.part.id];
  if ((f.type === "extrude" || f.type === "revolve") && f.operation === "new") return [f.body.id];
  return [];
}

/** Features that pick edges or faces by number need the part exactly as the steps before left it. */
const PICKS_BY_NUMBER = new Set<FeatureType>(["fillet", "chamfer", "shell", "pushpull", "hole", "mount"]);

/**
 * The features one feature needs before it on the timeline: the steps that made the parts it reads, its sketch, and
 * for edge and face picks, every earlier step that changed that part (the numbering depends on them).
 */
export function dependsOn(doc: ModelDoc, id: string): string[] {
  const i = doc.features.findIndex((f) => f.id === id);
  const f = doc.features[i];
  if (!f) return [];
  const before = doc.features.slice(0, i);
  const out = new Set<string>();
  for (const pid of partsRead(f)) {
    for (const g of before) {
      if (partsMade(g).includes(pid)) out.add(g.id);
      else if (PICKS_BY_NUMBER.has(f.type) && featureParts(g).includes(pid) && g.type !== "move") out.add(g.id);
    }
  }
  if (f.type === "extrude" || f.type === "revolve") {
    if (before.some((g) => g.id === f.sketch)) out.add(f.sketch);
  }
  return [...out];
}

/** Every feature that needs this one, directly or through others, in timeline order. */
export function dependents(doc: ModelDoc, id: string): Feature[] {
  const hit = new Set([id]);
  const out: Feature[] = [];
  const start = doc.features.findIndex((f) => f.id === id);
  for (const f of doc.features.slice(start + 1)) {
    if (dependsOn(doc, f.id).some((d) => hit.has(d))) {
      hit.add(f.id);
      out.push(f);
    }
  }
  return out;
}

/** Why a feature can't move before `beforeId` (null for the end), or null when it can. */
export function moveProblem(doc: ModelDoc, id: string, beforeId: string | null): string | null {
  const next = reorderFeature(doc, id, beforeId);
  if (next === doc) return null;
  const pos = new Map(next.features.map((f, i) => [f.id, i]));
  const name = (fid: string) => doc.features.find((f) => f.id === fid)?.name ?? "a step";
  for (const f of next.features) {
    for (const d of dependsOn(doc, f.id)) {
      if (pos.get(d)! > pos.get(f.id)!) return `${f.name} needs ${name(d)} before it`;
    }
  }
  return null;
}

/** "Sketch 1 is used by Extrude 1 and Extrude 2". */
export function usedByText(doc: ModelDoc, id: string): string | null {
  const f = doc.features.find((x) => x.id === id);
  const deps = dependents(doc, id);
  if (!f || !deps.length) return null;
  const names = deps.map((d) => d.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${f.name} is used by ${list}`;
}

/** Deletes a feature and everything that needs it, as one change. */
export function removeWithDependents(doc: ModelDoc, id: string): ModelDoc {
  const gone = new Set([id, ...dependents(doc, id).map((f) => f.id)]);
  return { ...doc, features: doc.features.filter((f) => !gone.has(f.id)) };
}

/** For a feature that can't build: the suppressed step it needs, as "Needs Extrude 2, which is suppressed". */
export function suppressedNeed(doc: ModelDoc, id: string): string | null {
  const byId = new Map(doc.features.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const walk = (fid: string): string | null => {
    for (const d of dependsOn(doc, fid)) {
      if (seen.has(d)) continue;
      seen.add(d);
      const g = byId.get(d);
      if (g?.suppressed) return `Needs ${g.name}, which is suppressed`;
      const deeper = walk(d);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(id);
}

// ---- parameters (#75)

/** Steps and parameters whose expressions use a name. */
export function paramUses(doc: ModelDoc, name: string): { features: Feature[]; params: Parameter[] } {
  return {
    features: doc.features.filter((f) => Object.values(f.exprs ?? {}).some((e) => namesIn(e).includes(name))),
    params: (doc.params ?? []).filter((p) => p.name !== name && namesIn(p.expression).includes(name)),
  };
}

/** Why a name can't be used for a parameter, or null. */
export function paramNameProblem(doc: ModelDoc, name: string, exceptId?: string): string | null {
  if (!NAME_RE.test(name)) return "Use letters, digits and _, starting with a letter";
  if (/^(mm|cm|m|in|deg)$/i.test(name)) return `${name} is a unit, so it can't be a name`;
  if ((doc.params ?? []).some((p) => p.name === name && p.id !== exceptId)) return `There is already a parameter called ${name}`;
  return null;
}

/** Adds a parameter with the next free name ("p1", "p2"). */
export function addParam(doc: ModelDoc, p: Partial<Omit<Parameter, "id">> = {}, id = newId("p")): ModelDoc {
  const list = doc.params ?? [];
  let n = list.length + 1;
  while (list.some((x) => x.name === `p${n}`)) n++;
  return { ...doc, params: [...list, { id, name: p.name ?? `p${n}`, expression: p.expression ?? "10", unit: p.unit ?? "mm", comment: p.comment }] };
}

/** Changes a parameter. A new name is written into every expression that used the old one. */
export function updateParam(doc: ModelDoc, id: string, change: Partial<Omit<Parameter, "id">>): ModelDoc {
  const old = (doc.params ?? []).find((p) => p.id === id);
  if (!old) return doc;
  let params = (doc.params ?? []).map((p) => (p.id === id ? { ...p, ...change } : p));
  let features = doc.features;
  const to = change.name;
  if (to && to !== old.name) {
    params = params.map((p) => ({ ...p, expression: renameIn(p.expression, old.name, to) }));
    features = features.map((f) =>
      f.exprs && Object.values(f.exprs).some((e) => namesIn(e).includes(old.name))
        ? { ...f, exprs: Object.fromEntries(Object.entries(f.exprs).map(([k, e]) => [k, renameIn(e, old.name, to)])) }
        : f,
    );
  }
  return { ...doc, params, features };
}

/** Why a parameter can't be deleted (it is in use), or null. */
export function removeParamProblem(doc: ModelDoc, id: string): string | null {
  const p = (doc.params ?? []).find((x) => x.id === id);
  if (!p) return null;
  const u = paramUses(doc, p.name);
  const names = [...u.features.map((f) => f.name), ...u.params.map((q) => q.name)];
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${p.name} is used by ${list}`;
}

export function removeParam(doc: ModelDoc, id: string): ModelDoc {
  return { ...doc, params: (doc.params ?? []).filter((p) => p.id !== id) };
}

/** Keeps (or with undefined, drops) the expression typed into one of a step's fields. */
export function setExpr(doc: ModelDoc, featureId: string, path: string, expression: string | undefined): ModelDoc {
  return {
    ...doc,
    features: doc.features.map((f) => {
      if (f.id !== featureId) return f;
      const exprs = { ...f.exprs };
      if (expression === undefined) delete exprs[path];
      else exprs[path] = expression;
      return { ...f, exprs: Object.keys(exprs).length ? exprs : undefined };
    }),
  };
}

/** The values of every parameter, for number fields to use. */
export function paramScope(doc: ModelDoc): Record<string, number> {
  return evaluateParams(doc.params).values;
}

// ---- mirror and patterns (#69)

export type PatternParams = Omit<PatternFeature, "id" | "name" | "type">;

/** Adds a Mirror or Pattern step for `parts`, with the defaults for anything not given. */
export function addPattern(doc: ModelDoc, params: Partial<PatternParams> & { parts: string[]; kind: PatternKind }, id = newId("f"), at?: number): ModelDoc {
  const name = params.kind === "mirror" ? nextNamed(doc, "Mirror") : nextFeatureName(doc, "pattern");
  return insert(doc, clampAt(doc, at), { id, type: "pattern", name, ...PATTERN_DEFAULTS, ...params });
}

/** Changes a Mirror or Pattern step (the tool edits it live, as one undo step). Switching kind renames a default name. */
export function updatePattern(doc: ModelDoc, id: string, change: Partial<PatternParams>): ModelDoc {
  return {
    ...doc,
    features: doc.features.map((f) => {
      if (f.id !== id || f.type !== "pattern") return f;
      const next: PatternFeature = { ...f, ...change };
      const was = f.kind === "mirror" ? "Mirror" : "Pattern";
      const now = next.kind === "mirror" ? "Mirror" : "Pattern";
      if (was !== now && new RegExp(`^${was} \\d+$`).test(f.name)) next.name = nextNamed(doc, now);
      return next;
    }),
  };
}
