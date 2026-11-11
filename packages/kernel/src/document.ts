/**
 * The model document (#45). The timeline is the document: an ordered list of features, replayed to get the parts.
 * It is plain JSON with no DOM, three.js or OCCT types, so the app, the kernel worker and Node tests share it. The
 * app's history store keeps immutable revisions of it for undo; the worker turns a revision into solids.
 */
import {
  drawCentreRectangle,
  drawCircle,
  newSketch,
  planeFrame,
  removeEntities,
  WORLD_FRAMES,
  type Frame,
  type PlaneRef,
  type Sketch,
  type Vec2,
  type WorldPlane,
} from "@bettercad/sketch";
import { resolveHole, holeLabel, type HoleParams, type HoleSpec } from "./holes";
import type { ImportFormat } from "./imports";
import type { Plug } from "./recognise/holes";
import { partBounds, partFrame, type CataloguePart } from "./catalogue";
import type { FinishId } from "./looks";
export {
  CATALOGUE_CATEGORIES,
  checkPart,
  partBounds,
  partFrame,
  rectPattern,
  circlePattern,
  type HolePattern,
  placeOnFace,
  type CataloguePart,
  type CatalogueCategory,
} from "./catalogue";
import { JOINT_KINDS, JOINT_LIMITS, jointLinkProblem, limitUnit, type JointKind } from "./joints";
import { clampJoint, jointMove, mat4Apply, mat4ApplyDir, mat4Mul, moveFrame, placeMatrix, placeOf, type Mat4, type Pose } from "./pose";
import { driveMultiplier, driveProblem, driveTo, togetherMultiplier, togetherProblem, type DriveGear, type DriveKind, type PoseDrive } from "./drivelinks";
import {
  MIRRORED_OPS,
  PATTERN_DEFAULTS,
  copyName,
  copyPart,
  copyId,
  mirrorPlane,
  copiesWhat,
  moveToLocal,
  opMoves,
  patternAxis,
  patternCopyIds,
  patternMoves,
  patternProblem,
  patternSummary,
} from "./pattern";
import { trackLayoutOf, type TrackHome, type TrackSpec } from "./track";
import type { CopyMove, CopySpec, MirrorFace, MirrorOf, MirrorPlane, PatternKind, Plane, WorldAxis } from "./pattern";
import {
  CONSTRUCT_BASE,
  bodyGeo,
  construct as constructGeo,
  constructKind,
  constructSummary,
  geoOf,
  originGeo,
  refText,
  type ConstructGeo,
  type ConstructKind,
  type ConstructRef,
  type Geo,
} from "./construct";
import { NAME_RE, bindExprs, evaluateParams, namesIn, renameIn, type Parameter } from "./params";
import { evaluate } from "@bettercad/ui/expr";
import {
  axisInSketch,
  axisOf,
  crossesAxis,
  extent,
  frameToLocal,
  startDistance,
  fromPartLocal,
  pickProfiles,
  profilesMiddle,
  upToDistance,
  targetsOf,
  throughAllAllowed,
  type AxisRef,
  type ExtrudeDirection,
  type ExtrudeExtent,
  type ExtrudeOperation,
  type ExtrudeStart,
  type ExtrudeUpTo,
  type PrismSpec,
  type ProfileSeg,
  type ProfileShape,
  type RevolveSpec,
  type SketchAxis,
} from "./extrude";

export * from "./extrude";
export * from "./construct";
export * from "./pattern";
export * from "./track";
export * from "./holes";
export * from "./screws";
import { screw } from "./screws";
import {
  centreDistance,
  dFlat,
  dFlatSegs,
  gearArea,
  gearCircles,
  gearProblem,
  gearSegs,
  meshProblem,
  meshTurn,
  polyArea,
  polySegs,
  pulleyProblem,
  rackOutline,
  rackProblem,
  ratioText,
  beltLength,
  centreForBelt,
  nearestBelt,
  GT2,
  gt2Outside,
  gt2Segs,
  type GearParams,
  type RackSize,
} from "./gears";
export * from "./gears";
export * from "./joints";
export * from "./pose";
export * from "./drivelinks";
export * from "./mass";
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
  /** Its colour (#196), sRGB "#rrggbb"; none means the theme's part colour. From its look. */
  colour?: string;
  /** The link step (#171) it belongs to; none means the base link. Copies keep their original's link. */
  link?: string;
  /** Its finish in renders and glTF (#196). From its look. */
  finish?: FinishId;
  /** Grams from its datasheet (#174), in place of the printed estimate. From its look. */
  mass?: number;
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
  op: "join" | "cut" | "intersect" | "fillet" | "chamfer" | "shell" | "pushpull" | "hole" | "plug";
  /** Edges (fillet, chamfer) or faces left open (shell), numbered on the part as it was before this op. */
  refs?: number[];
  /** The same edges or faces by name (#47), found again when earlier steps change; `refs` is the fallback. */
  names?: string[];
  /** The fillet radius, chamfer distance or shell wall, mm. */
  size?: number;
  /** A shell that grows outward instead of keeping the outer size. */
  outside?: boolean;
  /** An extrude's prism, in the part's own coordinates. */
  tool?: PrismSpec;
  /** Holes (#70) cut into the part, in its own coordinates. */
  holes?: HoleSpec;
  /** Recognised holes filled in (Convert, #448), in its own coordinates. */
  plugs?: Plug[];
  /** Or a revolve's solid, in the part's own coordinates. */
  rev?: RevolveSpec;
  /** Or a whole body (Combine, #66), as it stood then, placed in the world. */
  body?: Part;
  /** A cut's printed gap (#183): the tool grows by this much on every side first, mm. */
  gap?: number;
  /** Where the part itself stood when the body was combined into it, so the body moves with the part later. */
  at?: { position: Vec3; rotation?: Vec3 };
  /**
   * A mirrored copy of another step's op (Mirror of features): the op made with its tool mirrored across these planes,
   * in the part's own coordinates, the first one first.
   */
  mirror?: Plane[];
  /**
   * A copy of another step's op (Mirror or Pattern of features): the op made with its tool moved by these, in the part's
   * own coordinates, after any `mirror`, the first one first.
   */
  by?: CopyMove[];
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
  /**
   * The component (a link step, #171) that was active when this step was made: the bodies it makes go into it, and its
   * sketch or construction geometry sits under it in the browser. None means the model itself.
   */
  component?: string;
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
  /** Mirror: a flat face to mirror across instead of `plane`. */
  face?: MirrorFace;
  /** Mirror: a construction plane step (#265) to mirror across instead of `plane`, where it is now. */
  step?: string;
  /** What it copies: bodies when not set. Only a Mirror copies a component. */
  of?: MirrorOf;
  /**
   * Mirror or Pattern of features: the steps whose joins, cuts and holes are made again, mirrored, moved or turned, on
   * the same bodies. Bodies they made are copied whole, and are kept in `parts`.
   */
  features?: string[];
  /** Mirror of a component: the link step (#171) whose bodies are mirrored, into a new component. */
  link?: string;
  /** Rectangle: `count1` along `dir1` every `spacing1` mm, and `count2` along `dir2` (1 for a single row). */
  dir1: WorldAxis;
  count1: number;
  spacing1: number;
  dir2: WorldAxis;
  count2: number;
  spacing2: number;
  /** Circle: `count` round the world `axis` through the origin, over `angle` degrees (360 for all the way round). */
  axis: WorldAxis;
  /** Circle: a construction axis step (#265) to turn round instead of `axis`, where it is now. */
  axisStep?: string;
  /**
   * Circle: a body's round edge or face (its centre line) or straight edge to turn round instead, kept in the body's
   * own coordinates so it follows the body's moves and pose.
   */
  axisRef?: ConstructRef;
  count: number;
  angle: number;
  /** Track: the piece's pins and the wheels it goes round. The piece (the one body in `parts`) becomes its first link. */
  track?: TrackSpec;
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
/**
 * A component (Fusion's), stored as a link step (#171): bodies named as one rigid part, without joining them, and the
 * sketches and construction geometry made while it was active (each step's `component`). Each body keeps its own look
 * and still prints and exports on its own. A body is in at most one component: a later one takes it from an earlier
 * one. Bodies in none belong to the model itself, which is URDF's base link. Each component is one URDF link; one
 * inside another (`parent`) with no joint of its own is fixed to its parent.
 */
export interface LinkFeature extends FeatureBase {
  type: "link";
  parts: string[];
  /** The component it sits inside; none for the model itself. */
  parent?: string;
}
/**
 * A joint (#172): a child link hanging from a parent link (null for Base), as URDF has it. The origin and axis are
 * stored in world space when it's made, as a hole's frame is, so they don't move if the picked geometry changes.
 * Limits are degrees for a hinge, mm for a slider; a wheel and a fixed joint have none.
 */
export interface JointFeature extends FeatureBase {
  type: "joint";
  kind: JointKind;
  child: string;
  parent: string | null;
  origin: [number, number, number];
  axis: [number, number, number];
  lower: number;
  upper: number;
  /**
   * The line-up (as the Projects scene editor joins parts): the moving component's own snap, where it stood before the
   * joint, which lands on the parent's snap (`origin`, `axis`) face to face; then a turn of `angle`° about the axis, a
   * `gap` off the face and an `offset` (mm, world X, Y and Z). `flip` turns it over. Left out, it stays where it was
   * modelled, and they're 0 and off. See `jointMove`.
   */
  from?: { point: [number, number, number]; normal: [number, number, number] };
  angle?: number;
  gap?: number;
  offset?: [number, number, number];
  flip?: boolean;
}
/**
 * A drive link (#194): turning the driver joint turns (or slides) the driven one by a ratio. For gears, a belt or a
 * rack, the ratio comes from the tooth counts of the gears on the two joints' links when they are there; `ratio` is
 * used for a custom drive and when they aren't. `ratio` is the driven joint's move per unit of the driver's (mm a degree
 * from a hinge to a slider). `reverse` turns it the other way.
 */
export interface DriveFeature extends FeatureBase {
  type: "drive";
  kind: DriveKind;
  driver: string;
  driven: string;
  ratio: number;
  reverse?: boolean;
  /**
   * A motion link (`kind: "together"`): more joints that move with the driver, besides `driven`, all at the same speed.
   * `against` lists the ones that turn the other way. Built as one mimic per joint.
   */
  more?: string[];
  against?: string[];
}
export interface DeleteFeature extends FeatureBase {
  type: "delete";
  parts: string[];
}
/**
 * Construction geometry (#265): a plane, axis or point worked out from its picks, as Fusion's Construct menu makes them.
 * `value` is the kind's one number, if it has one: a distance (mm), an angle (degrees) or how far along (%).
 */
export interface ConstructFeature extends FeatureBase {
  type: "construct";
  kind: ConstructKind;
  refs: ConstructRef[];
  value: number;
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
  /**
   * Its shapes are the regions curves make where they cross, and edges projected from the model bound them too, as in
   * Fusion. Every new step sets it; older ones leave it off and keep picking whole shapes, so they build as before.
   */
  split?: boolean;
  /** Texts picked whole, by id: every letter, whatever the words become. */
  texts?: string[];
  distance: number;
  direction: ExtrudeDirection;
  /** The second side's distance, for "two". */
  distance2?: number;
  /**
   * A distance (the default), through all (Cut and Intersect), or "to": up to the face, edge or point in `to`, one
   * side only. Through all keeps `distance` for its side; "to" keeps the distance it last reached there.
   */
  extent?: ExtrudeExtent;
  /** For extent "to": what it ends at. */
  to?: ExtrudeUpTo;
  /**
   * Where it starts: the sketch's plane (the default, and every older step), `startOffset` mm off it, or level with
   * the face, edge or point in `from`. `distance` is measured from there.
   */
  start?: ExtrudeStart;
  /** For start "offset": mm along the sketch's normal; may be a parameter. */
  startOffset?: number;
  /** For start "object": what it starts at, kept the way To object keeps what it ends at. */
  from?: ExtrudeUpTo;
  operation: ExtrudeOperation;
  /** The part joined to, cut or intersected (not for "new"). The first of `targets` when there are several. */
  target?: string;
  /** Every body it cuts or intersects (Join takes the first). Missing in older files: `target` alone. */
  targets?: string[];
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
  /**
   * The same edges or faces by their names (#47), so they are found again when an earlier step changes the body.
   * Older models have only `refs`.
   */
  names?: string[];
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
  /**
   * Its shapes are the regions curves make where they cross, and edges projected from the model bound them too, as in
   * Fusion. Every new step sets it; older ones leave it off and keep picking whole shapes, so they build as before.
   */
  split?: boolean;
  /** Texts picked whole, as for Extrude. */
  texts?: string[];
  /** What it turns round. None until one is picked: the tool asks for the axis after the shapes. */
  axis?: AxisRef;
  /** Degrees, 1 to 360. */
  angle: number;
  symmetric?: boolean;
  operation: ExtrudeOperation;
  target?: string;
  /** Every body it cuts or intersects (Join takes the first), as for Extrude. */
  targets?: string[];
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
 * Convert (#448): an imported mesh body made editable. It makes a new body from the mesh as it stood, with the holes
 * that were recognised in it filled, so Hole steps after it cut them again as true holes. The mesh body stays.
 */
export interface ConvertFeature extends FeatureBase {
  type: "convert";
  /** The mesh body it reads. */
  part: string;
  body: { id: string; name: string };
  /** What fills each recognised hole, in the world as the mesh stood when it was converted. */
  plugs: Plug[];
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
/** A shaft hole through a gear: round, D-flat for a motor shaft, or a servo horn's hub and four arm holes. */
export interface GearBore {
  kind: "none" | "round" | "dflat" | "horn";
  /** The hole's diameter, or the horn's hub, mm. */
  diameter: number;
  /** D-flat: the flat's distance from the centre, mm. */
  flat?: number;
  /** Horn: the arm holes' distance from the centre, mm. */
  arm?: number;
}

/** Spur gear (#191): an involute gear made from its settings, standing `width` tall on its frame (its axis the normal). */
export interface GearFeature extends FeatureBase {
  type: "gear";
  body: { id: string; name: string };
  gear: GearParams;
  width: number;
  bore: GearBore;
  /** A boss on top, round the bore. */
  hub?: { diameter: number; length: number };
  frame: Frame;
  /**
   * Meshes with an earlier gear (#192): this one then stands beside it at the centre distance, `angle` degrees round
   * from its x, on its plane, turned so the teeth interleave. Its own frame and turn are ignored, and it takes the
   * other gear's module and pressure angle.
   */
  mesh?: { gear: string; angle: number };
  /** Spur (the default), a rack (#193) along the frame's x with teeth toward +y, or a GT2 timing pulley (#193). */
  form?: "spur" | "rack" | "gt2";
  /** A rack's length and the solid under its roots, mm. */
  rack?: RackSize;
  /** A pulley's flanges: 1 mm discs either side of the teeth, 1.5 mm proud of them. */
  flanges?: boolean;
  /**
   * A pulley on a belt from an earlier pulley (#193): it stands `angle` degrees round from that one, at the centre
   * distance that makes a `length` mm belt fit.
   */
  belt?: { pulley: string; angle: number; length: number };
  /** Degrees about the gear's axis, so a mating gear's teeth fall between this one's. */
  turn?: number;
}

export type Feature =
  | ConstructFeature
  | DriveFeature
  | JointFeature
  | LinkFeature
  | GearFeature
  | MountFeature
  | ImportFeature
  | ConvertFeature
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
  /** Its colour (#196), sRGB "#rrggbb". Shown in the view, renders and glTF. */
  colour?: string;
  /** Its finish (#196): roughness and metalness in renders and glTF. */
  finish?: FinishId;
  /** Grams from its datasheet (#174), in place of the printed estimate. */
  mass?: number;
}

export interface ModelDoc {
  format: "bettercad";
  version: 2;
  name: string;
  features: Feature[];
  looks: Record<string, Look>;
  /** Parts tree order, when the person has dragged rows. Parts not listed follow in build order. */
  order?: string[];
  /**
   * Where bodies, sketches, construction steps and components were moved in the browser (#334), by id: the component
   * each now sits in, or null for the model. It wins over where they were made. Not a step, as looks aren't.
   */
  owners?: Record<string, string | null>;
  /** Named views: saved cameras. */
  views?: NamedView[];
  /** The view cube's home view, when set from the cube's menu. Without it, home is the corner view, fitted. */
  home?: ViewCamera;
  /** Parameters (#75): named values that feature fields can use. */
  params?: Parameter[];
  /** Imported files' bytes, base64, by content hash (#82), so the model rebuilds without the original file. */
  blobs?: Record<string, string>;
  /** The printer, material and infill (#100, #105), so a shared model shows the bed its author meant. */
  print?: PrintSettings;
  /** How the joints are posed (#173), saved with the view so a shared model opens as it was left. Not a step. */
  pose?: Pose;
  /** Tool points (#176): a point on a link to drag the arm by, one per chain. Not a step. */
  tools?: ToolPoint[];
  /** Named poses (#177): joint values saved under a name, to go back to. Home (all zeros) is always there besides. */
  poses?: NamedPose[];
  /** Section analyses: saved cuts through the model, under Analysis in the browser. Not steps, as looks aren't. */
  sections?: SectionAnalysis[];
  /** The section analysis applied to the view now, by id; none shows the whole model. Only one at a time. */
  section?: string;
  /**
   * The kevsrobots project the build steps were last sent to (Send to kevsrobots), so the next send updates it. Not a
   * step. `sent` is an ISO time.
   */
  kevsrobots?: { project: number; title: string; sent: string };
}

/** A section analysis: a plane through `origin` facing `normal`, pushed `offset` mm along it. The view keeps the back. */
export interface SectionAnalysis {
  id: string;
  name: string;
  origin: [number, number, number];
  normal: [number, number, number];
  offset: number;
}

/** A named pose (#177): each moving joint's value, by joint id, as in `pose`. */
export interface NamedPose {
  id: string;
  name: string;
  values: Pose;
}

/** A tool point (#176): where it sits on its link at home, and the joints kept out of the solve. */
export interface ToolPoint {
  link: string;
  point: [number, number, number];
  locked?: string[];
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
  convert: "Convert",
  insert: "Insert part",
  mount: "Mount",
  gear: "Gear",
  link: "Component",
  joint: "Joint",
  drive: "Drive",
  construct: "Construct",
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
  /** Sketches on the timeline up to the marker, by feature id, in order, with the component each was made in. */
  sketches: { id: string; name: string; sketch: Sketch; component?: string }[];
  /** Features that could not apply, with the reason: the part they change is gone. */
  failed: Map<string, string>;
  /**
   * Links (#171) up to the marker, in timeline order, with the bodies in each now. Empty links are left out, and each
   * one's `parent` is its nearest enclosing component that has bodies, so URDF always gets one tree.
   */
  links: BuiltLink[];
  /** Every component up to the marker, empty ones too, as the person nests them (`parent` as stored). */
  components: BuiltLink[];
  /** Joints (#172) up to the marker that built, in timeline order. */
  joints: JointFeature[];
  /** Drive links (#194) that built, with their multipliers worked out. */
  drives: BuiltDrive[];
  /** Construction planes, axes and points (#265) up to the marker that built, in timeline order. */
  construct: BuiltConstruct[];
  /** Tracks that built: their pieces in order round the loop, so they can run round as the wheels turn. */
  tracks?: BuiltTrack[];
}

/** A track as built: its pieces, link 1 first, and what they were laid from. */
export interface BuiltTrack extends TrackHome {
  id: string;
  parts: string[];
  track: TrackSpec;
}

/** A construction step as built: its geometry in the world now. */
export interface BuiltConstruct {
  id: string;
  name: string;
  /** The component it was made in (#171). */
  component?: string;
  kind: ConstructKind;
  geo: ConstructGeo;
}

/** A drive as built (#194): the driven joint's value is multiplier × the driver's. */
export interface BuiltDrive extends PoseDrive {
  name: string;
  kind: DriveKind;
  /** Whether the ratio came from the gears' teeth rather than the typed ratio. */
  fromTeeth: boolean;
}

/** A link as built: its step's id and name, its bodies, and the component it sits inside. */
export interface BuiltLink {
  id: string;
  name: string;
  parts: string[];
  parent?: string;
}

const BUILT = new Set<string>([
  "construct",
  "drive",
  "joint",
  "link",
  "gear",
  "mount",
  "import",
  "convert",
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

/** Construction geometry carried by a move: a plane, axis or point riding on its component. */
export function moveGeo(m: Mat4, g: ConstructGeo): ConstructGeo {
  if (g.what === "plane") return { what: "plane", frame: moveFrame(m, g.frame) };
  if (g.what === "axis") {
    const d = mat4ApplyDir(m, g.dir);
    const l = Math.hypot(...d) || 1;
    return { what: "axis", origin: mat4Apply(m, g.origin), dir: [d[0] / l, d[1] / l, d[2] / l] };
  }
  return { what: "point", at: mat4Apply(m, g.at) };
}

/** Replays the first `upTo` features (all of them by default) into parts. */
export function build(doc: ModelDoc, upTo = doc.features.length): Build {
  const parts: Part[] = [];
  /** Each copy a Mirror, Pattern or Track made, and the body it copies: a copy wears its colour and finish. */
  const copied = new Map<string, string>();
  const sketches: Build["sketches"] = [];
  const sketchById = new Map<string, Sketch>();
  const failed = new Map<string, string>();
  /** Gear steps as built, for gears that mesh with them (#192). */
  const gearSteps = new Map<string, GearFeature>();
  /** Link steps as built (#171), in order. */
  const linkSteps: LinkFeature[] = [];
  /** Joints as built (#172). */
  const joints: JointFeature[] = [];
  const drives: BuiltDrive[] = [];
  const tracks: BuiltTrack[] = [];
  const built: BuiltConstruct[] = [];
  const find = (id: string) => parts.findIndex((p) => p.id === id);
  const missing = (f: Feature, ids: string[]) => {
    const gone = ids.filter((id) => find(id) < 0);
    if (gone.length) failed.set(f.id, gone.length === ids.length ? "The parts it changes are gone" : "Some of the parts it changes are gone");
    return gone;
  };
  /** A construction pick (#265) where it is now: an origin plane or axis, a built step, or a body's face or edge. */
  const refGeo = (r: ConstructRef): Geo | string => {
    if ("origin" in r) return originGeo(r.origin);
    if ("step" in r) {
      const c = built.find((x) => x.id === r.step);
      return c ? geoOf(c.geo) : "A step it was made from is gone";
    }
    const p = parts[find(r.body)];
    return p ? bodyGeo(r, p) : "The body it was made from is gone";
  };
  const { values } = evaluateParams(doc.params);
  // Bodies a step makes while a component is active go into it, unless they already have one (a copy keeps its own).
  let owner: { component: string; had: Set<string> } | null = null;
  // Then a move in the browser (#334) wins.
  const moved = doc.owners ?? {};
  const own = () => {
    if (owner) for (let i = 0; i < parts.length; i++) if (!owner.had.has(parts[i]!.id) && !parts[i]!.link) parts[i] = { ...parts[i]!, link: owner.component };
    owner = null;
    for (let i = 0; i < parts.length; i++) {
      const to = moved[parts[i]!.id];
      if (to === undefined || (parts[i]!.link ?? null) === to) continue;
      parts[i] = { ...parts[i]! };
      if (to) parts[i]!.link = to;
      else delete parts[i]!.link;
    }
  };
  /** The component a sketch, construction step or component sits in: where it was moved, or where it was made. */
  const ownerOf = (id: string, made?: string) => (id in moved ? moved[id] : made) ?? undefined;
  for (const raw of doc.features.slice(0, upTo)) {
    own();
    if (raw.suppressed) continue;
    if (raw.component && raw.type !== "link") owner = { component: raw.component, had: new Set(parts.map((p) => p.id)) };
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
      case "convert": {
        const i = find(f.part);
        const src = parts[i];
        if (!src) {
          failed.set(f.id, "The body it converts is gone");
          break;
        }
        if (find(f.body.id) >= 0) break;
        // A copy of the mesh in its own right: not in the mesh's component, so it goes into the one being worked in.
        const rest = { ...src };
        delete rest.link;
        const plugs = f.plugs.map((p) => {
          const l = frameToLocal({ origin: p.origin, x: p.axis, normal: p.axis }, src);
          return { ...p, origin: l.origin, axis: l.normal };
        });
        parts.splice(i + 1, 0, {
          ...rest,
          id: f.body.id,
          name: f.body.name,
          position: { ...src.position },
          size: { ...src.size },
          ops: [...(src.ops ?? []), { op: "plug", plugs, feature: f.id }],
        });
        break;
      }
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
        const of = copiesWhat(f);
        const problem = patternProblem(f);
        if (problem) {
          failed.set(f.id, problem);
          break;
        }
        const plane = f.kind === "mirror" ? mirrorPlane(f, parts, built) : undefined;
        if (typeof plane === "string") {
          failed.set(f.id, plane);
          break;
        }
        if (f.kind === "track") {
          // The piece becomes the track's first link; the rest are copies of it, each moved and turned into place.
          if (missing(f, f.parts).length) break;
          const i = find(f.parts[0]!);
          const lay = trackLayoutOf(f.track!, refGeo);
          if (typeof lay === "string") {
            failed.set(f.id, lay);
            break;
          }
          const src = parts[i]!;
          const moves: CopyMove[] = lay.pieces.map((m) => ({ place: m }));
          const copies = moves.slice(1).map((m, k) => copyPart(src, m, copyId(f, src.id, k), copyName(f, src.name, k)));
          for (const c of copies) copied.set(c.id, src.id);
          parts[i] = { ...copyPart(src, moves[0]!, src.id, src.name), hidden: src.hidden };
          parts.splice(i + 1, 0, ...copies.filter((c) => find(c.id) < 0));
          tracks.push({ id: f.id, parts: [src.id, ...copies.map((c) => c.id)], track: f.track!, piece: lay.piece, wheels: lay.wheels });
          break;
        }
        const axis = patternAxis(f, built, f.kind === "circle" && f.axisRef ? refGeo(f.axisRef) : undefined);
        if (typeof axis === "string") {
          failed.set(f.id, axis);
          break;
        }
        const moves = patternMoves(f, plane, axis);
        // The bodies it copies: those picked, those the picked features made, or the component's bodies now.
        let from = f.parts;
        if (of === "component") {
          from = parts.filter((p) => p.link === f.link).map((p) => p.id);
          if (!from.length) failed.set(f.id, "The component it mirrors is gone");
        } else if (of === "bodies") missing(f, f.parts);
        if (of === "features") {
          // Each picked feature's joins, cuts and holes, made again (mirrored, moved or turned) on the bodies they changed.
          const wanted = new Set(f.features);
          // A body it copies whole already carries every op made on it, so those ops aren't made on it again.
          const whole = new Set(f.parts);
          let made = 0;
          let skipped = 0;
          for (const p of parts) {
            if (whole.has(p.id)) continue;
            const extra: BodyOp[] = [];
            for (const o of p.ops ?? []) {
              if (!wanted.has(o.feature)) continue;
              if (!MIRRORED_OPS.has(o.op)) {
                skipped += 1;
                continue;
              }
              const was = opMoves(o);
              const rest = { ...o };
              delete rest.mirror;
              for (const m of moves) extra.push({ ...rest, by: [...was, moveToLocal(m, p)], feature: f.id });
            }
            if (extra.length) p.ops = [...p.ops!, ...extra];
            made += extra.length;
          }
          const bodies = f.parts.filter((id) => find(id) >= 0).length;
          const verb = f.kind === "mirror" ? "mirrored" : "copied";
          if (!made && !bodies)
            failed.set(
              f.id,
              skipped
                ? `Fillets, chamfers and shells can't be ${verb}. ${f.kind === "mirror" ? "Mirror" : "Pattern"} the body instead.`
                : `The features it ${f.kind === "mirror" ? "mirrors" : "copies"} are gone`,
            );
        }
        const component: string[] = [];
        for (const from1 of from) {
          const i = find(from1);
          const src = parts[i];
          if (!src) continue;
          const copies = moves.map((m, k) => copyPart(src, m, copyId(f, from1, k), copyName(f, src.name, k)));
          if (of === "component" && !f.join) for (const c of copies) c.link = f.id;
          if (!f.join) for (const c of copies) copied.set(c.id, src.id);
          component.push(...copies.map((c) => c.id));
          if (f.join) {
            const at = { position: { ...src.position }, rotation: src.rotation && { ...src.rotation } };
            src.ops = [
              ...(src.ops ?? []),
              ...copies.map((c): BodyOp => ({ op: "join", body: { ...c, hole: undefined, fit: undefined, gap: undefined }, at, feature: f.id })),
            ];
          } else parts.splice(i + 1, 0, ...copies.filter((c) => find(c.id) < 0));
        }
        // A mirrored component is a component of its own, which joints can move.
        if (of === "component" && !f.join && component.length) {
          const of = linkSteps.find((l) => l.id === f.link);
          linkSteps.push({
            id: f.id,
            type: "link",
            name: `${of?.name ?? "Component"} mirrored`,
            parts: component,
            ...(of?.parent ? { parent: of.parent } : {}),
          });
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
      case "link": {
        const here = f.parts.filter((id) => find(id) >= 0);
        // A new component starts empty; one whose bodies have all gone says so.
        if (f.parts.length && !here.length) failed.set(f.id, "The bodies it links are gone");
        for (const id of here) {
          const i = find(id);
          parts[i] = { ...parts[i]!, link: f.id };
        }
        linkSteps.push(f);
        break;
      }
      case "construct": {
        const inputs: Geo[] = [];
        let gone: string | null = null;
        for (const r of f.refs) {
          const g = refGeo(r);
          if (typeof g === "string") gone ??= g;
          else inputs.push(g);
        }
        const geo = gone ?? constructGeo(f.kind, inputs, f.value);
        if (typeof geo === "string") failed.set(f.id, geo);
        else {
          const component = ownerOf(f.id, f.component);
          built.push({ id: f.id, name: f.name, kind: f.kind, geo, ...(component ? { component } : {}) });
        }
        break;
      }
      case "joint": {
        const here = (l: string) => linkSteps.some((x) => x.id === l) && parts.some((p) => p.link === l);
        const why = !here(f.child)
          ? "The link it moves is gone"
          : f.parent !== null && !here(f.parent)
            ? "The link it hangs from is gone"
            : (jointLinkProblem(joints, f.child, f.parent) ??
              (Math.hypot(...f.axis) < 1e-9 ? "Pick an axis" : limitUnit(f.kind) && f.lower > f.upper ? "The lower limit is above the upper one" : null));
        if (why) failed.set(f.id, why);
        else {
          // The moving component, and the ones inside it, go where the joint lines them up.
          const m = jointMove(f);
          if (m) {
            const moved = new Set([f.child]);
            for (let grew = true; grew;) {
              grew = false;
              for (const l of linkSteps) if (l.parent && moved.has(l.parent) && !moved.has(l.id)) grew = !!moved.add(l.id);
            }
            parts.forEach((p, i) => {
              if (!p.link || !moved.has(p.link)) return;
              const r = p.rotation ?? ZERO;
              const at = placeOf(mat4Mul(m, placeMatrix([p.position.x, p.position.y, p.position.z], [r.x, r.y, r.z])));
              const [x, y, z] = at.rotation;
              parts[i] = {
                ...p,
                position: { x: at.position[0], y: at.position[1], z: at.position[2] },
                ...(x || y || z || p.rotation ? { rotation: { x, y, z } } : {}),
              };
            });
            // Its sketches and construction so far go with it, as Fusion's do, so they stay on its bodies and a later
            // extrude from one of them lands on the moved part. Ones made after the joint were drawn where it is now.
            sketches.forEach((s, i) => {
              const plane = s.sketch.plane;
              // A sketch on a face goes with the body it sits on, whichever component it is filed under.
              const on = plane.kind === "face" ? parts[find(plane.face.body)]?.link : s.component;
              if (!on || !moved.has(on)) return;
              const frame = moveFrame(m, plane.frame ?? WORLD_FRAMES[(plane as { plane: WorldPlane }).plane]);
              const sk = { ...s.sketch, plane: { ...plane, frame } };
              sketches[i] = { ...s, sketch: sk };
              sketchById.set(s.id, sk);
            });
            built.forEach((c, i) => {
              if (c.component && moved.has(c.component)) built[i] = { ...c, geo: moveGeo(m, c.geo) };
            });
          }
          joints.push(alignedJoint(f));
        }
        break;
      }
      case "drive": {
        if (f.kind === "together") {
          const lead = joints.find((j) => j.id === f.driver);
          // A joint deleted since is left out; the link fails only when the lead or every other joint has gone.
          const followers = [...new Set([f.driven, ...(f.more ?? [])])].filter((id) => id !== f.driver && joints.some((j) => j.id === id));
          if (!lead || !followers.length) {
            failed.set(f.id, "A joint it links is gone");
            break;
          }
          const made: BuiltDrive[] = [];
          let why: string | null = null;
          for (const id of followers) {
            const j = joints.find((x) => x.id === id)!;
            why = driveProblem(joints, [...drives, ...made], f.driver, id) ?? togetherProblem(lead, j);
            if (why) break;
            const multiplier = togetherMultiplier(lead, j, f.against?.includes(id));
            made.push({ id: f.id, name: f.name, kind: f.kind, driver: f.driver, driven: id, multiplier, offset: 0, fromTeeth: false });
          }
          if (why) failed.set(f.id, why);
          else drives.push(...made);
          break;
        }
        const why = driveProblem(joints, drives, f.driver, f.driven);
        if (why) {
          failed.set(f.id, why);
          break;
        }
        const a = joints.find((j) => j.id === f.driver)!;
        const b = joints.find((j) => j.id === f.driven)!;
        let m: number | null = null;
        if (f.kind !== "custom") {
          const k = f.kind;
          const gears = (l: string) =>
            [...gearSteps.values()].filter((g) => parts.find((p) => p.id === g.body.id)?.link === l).map((g) => ({ step: g, gear: driveGear(g) }));
          const ga = gears(a.child);
          const gb = gears(b.child);
          const linked = (x: GearFeature, y: GearFeature) =>
            x.mesh?.gear === y.id || y.mesh?.gear === x.id || x.belt?.pulley === y.id || y.belt?.pulley === x.id;
          const dot = a.axis[0] * b.axis[0] + a.axis[1] * b.axis[1] + a.axis[2] * b.axis[2];
          // Gears that mesh or share a belt first, then any pair that fits.
          const pairs = ga.flatMap((x) => gb.map((y) => ({ x, y, linked: linked(x.step, y.step) }))).sort((p, q) => Number(q.linked) - Number(p.linked));
          for (const { x, y } of pairs) {
            m = driveMultiplier(k, { kind: a.kind, gear: x.gear }, { kind: b.kind, gear: y.gear }, dot);
            if (m !== null) break;
          }
        }
        const fromTeeth = m !== null;
        const ratio = m ?? f.ratio;
        if (!Number.isFinite(ratio) || ratio === 0) {
          failed.set(f.id, "Give it a ratio other than 0");
          break;
        }
        drives.push({ id: f.id, name: f.name, kind: f.kind, driver: f.driver, driven: f.driven, multiplier: f.reverse ? -ratio : ratio, offset: 0, fromTeeth });
        break;
      }
      case "delete":
        missing(f, f.parts);
        for (const id of f.parts) {
          const i = find(id);
          if (i >= 0) parts.splice(i, 1);
        }
        break;
      case "sketch": {
        // A sketch on a construction plane sits where that plane is now.
        let sk = f.sketch;
        if (sk.plane.kind === "construct") {
          const step = (sk.plane as { step: string }).step;
          const on = built.find((c) => c.id === step);
          if (on?.geo.what === "plane") sk = { ...sk, plane: { ...sk.plane, frame: on.geo.frame } };
          else failed.set(f.id, "The plane it sits on is gone. Redefine its plane from the timeline menu.");
        }
        const component = ownerOf(f.id, f.component);
        sketches.push({ id: f.id, name: f.name, sketch: sk, ...(component ? { component } : {}) });
        sketchById.set(f.id, sk);
        const why = sketchLinkProblem(sk, (id) => find(id) >= 0);
        if (why) failed.set(f.id, why);
        break;
      }
      case "extrude": {
        const sk = sketchById.get(f.sketch);
        if (!sk) {
          failed.set(f.id, "Its sketch is gone or comes later on the timeline");
          break;
        }
        const { shapes, lost, picked } = pickProfiles(sk, f.seeds, f.texts, f.split);
        if (!shapes.length) {
          failed.set(f.id, "The shapes it extruded are no longer closed. Close them in the sketch, or edit the extrude.");
          break;
        }
        if (lost) failed.set(f.id, `${lost === 1 ? "One shape" : `${lost} shapes`} it extruded ${lost === 1 ? "is" : "are"} no longer closed`);
        let side = f.direction;
        let distance = f.distance;
        // Where it starts along the normal: the sketch's plane unless a start is set.
        const start = startDistance(f, planeFrame(sk.plane), profilesMiddle(picked), (id) => parts[find(id)]);
        if (typeof start === "string") {
          failed.set(f.id, start);
          break;
        }
        if (f.extent === "to") {
          // To object: one side, as far as the picked face, edge or point is along the normal, where its body is now.
          const by = f.to ? parts[find(f.to.body)] : undefined;
          if (!f.to || !by) {
            failed.set(
              f.id,
              f.to ? "The body it goes up to is gone. Pick something else, or give it a distance." : "Click a face, edge or point for it to go up to",
            );
            break;
          }
          const reach = upToDistance(planeFrame(sk.plane), profilesMiddle(picked), {
            point: fromPartLocal(f.to.point, by),
            normal: f.to.normal && fromPartLocal(f.to.normal, by, true),
          });
          if (typeof reach === "string") {
            failed.set(f.id, reach);
            break;
          }
          side = "one";
          distance = reach - start;
          if (!(Math.abs(distance) > 1e-6)) {
            failed.set(f.id, "It starts where it would end. Change the start or the end.");
            break;
          }
        }
        if (!(Math.abs(distance) > 1e-9)) {
          failed.set(f.id, "Give it a distance other than 0 mm");
          break;
        }
        const all = f.extent === "all";
        if (all && !throughAllAllowed(f.operation)) {
          failed.set(f.id, "Through all works with Cut and Intersect. Give it a distance to join or make a body.");
          break;
        }
        const span = extent(side, distance, f.distance2, all);
        const spec: PrismSpec = { frame: planeFrame(sk.plane), profiles: shapes, from: span.from + start, to: span.to + start };
        if (f.operation === "new") {
          if (find(f.body.id) < 0)
            parts.push({ id: f.body.id, name: f.body.name, kind: "solid", hidden: false, position: { ...ZERO }, size: prismSize(spec), prism: spec });
          break;
        }
        const ts = profileTargets(f, parts, find, failed);
        for (const t of ts) {
          const tool: PrismSpec = { ...spec, frame: frameToLocal(spec.frame, t) };
          t.ops = [...(t.ops ?? []), { op: f.operation, tool, ...(f.operation === "cut" && f.gap ? { gap: f.gap } : {}), feature: f.id }];
        }
        break;
      }
      case "revolve": {
        const sk = sketchById.get(f.sketch);
        if (!sk) {
          failed.set(f.id, "Its sketch is gone or comes later on the timeline");
          break;
        }
        const { shapes, lost, picked } = pickProfiles(sk, f.seeds, f.texts, f.split);
        if (!shapes.length) {
          failed.set(f.id, "The shapes it revolved are no longer closed. Close them in the sketch, or edit the revolve.");
          break;
        }
        if (lost) failed.set(f.id, `${lost === 1 ? "One shape" : `${lost} shapes`} it revolved ${lost === 1 ? "is" : "are"} no longer closed`);
        if (!f.axis) {
          failed.set(f.id, "Pick an axis to turn it round: an axis, a sketch line or a straight edge");
          break;
        }
        let axis: SketchAxis | null;
        if (f.axis.kind === "ref") {
          // An origin axis, a construction axis or a straight edge, where it is now.
          const g = refGeo(f.axis.ref);
          const on =
            typeof g === "string"
              ? g.replace("it was made from", "it turns round")
              : g.t !== "line"
                ? "Pick a straight edge, a line or an axis to turn it round"
                : axisInSketch(planeFrame(sk.plane), g.origin, g.dir);
          if (typeof on === "string") {
            failed.set(f.id, on);
            break;
          }
          axis = on;
        } else axis = axisOf(sk, f.axis);
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
        for (const t of profileTargets(f, parts, find, failed))
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
        t.ops = [
          ...(t.ops ?? []),
          { op: f.type, refs: [...f.refs], ...(f.names ? { names: [...f.names] } : {}), size: f.size, outside: f.outside, feature: f.id },
        ];
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
      case "gear": {
        let g: GearFeature = f;
        if (f.mesh) {
          const a = gearSteps.get(f.mesh.gear);
          if (!a) {
            failed.set(f.id, "The gear this one meshes with is gone or broken");
            break;
          }
          if ((a.form ?? "spur") !== "spur") {
            failed.set(f.id, "Gears and racks mesh with a spur gear");
            break;
          }
          g = meshedWith(a, f);
        } else if (f.belt) {
          const a = gearSteps.get(f.belt.pulley);
          if (!a || a.form !== "gt2") {
            failed.set(f.id, "The pulley this one's belt goes round is gone or broken");
            break;
          }
          const placed = beltedTo(a, f);
          if (!placed) {
            failed.set(f.id, `A ${f.belt.length} mm belt is too short for these pulleys`);
            break;
          }
          g = placed;
        }
        const r = gearSpec(g);
        if (typeof r === "string") {
          failed.set(f.id, r);
          break;
        }
        if (find(f.body.id) < 0)
          parts.push({
            id: f.body.id,
            name: f.body.name,
            kind: "solid",
            hidden: false,
            position: { ...ZERO },
            size: prismSize(r.prism),
            prism: r.prism,
            ops: r.ops,
          });
        gearSteps.set(f.id, g);
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
  own();
  // A body made in a component that is gone (deleted, or after the marker) belongs to the model.
  const steps = new Set(linkSteps.map((l) => l.id));
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]!.link && !steps.has(parts[i]!.link!)) {
      parts[i] = { ...parts[i]! };
      delete parts[i]!.link;
    }
  }
  // A copy (mirrored, patterned or a track's piece) wears its body's colour and finish unless it was given its own.
  const lookOf = (id: string, depth = 0): Look | undefined => {
    const own = doc.looks[id];
    const from = copied.get(id);
    if (!from || depth > 64 || (own?.colour && own?.finish)) return own;
    const worn = lookOf(from, depth + 1);
    if (!worn?.colour && !worn?.finish) return own;
    return { ...own, colour: own?.colour ?? worn.colour, finish: own?.finish ?? worn.finish };
  };
  const looked = parts.map((p) => {
    const look = lookOf(p.id);
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
  const components: BuiltLink[] = linkSteps.map((l) => {
    const parent = ownerOf(l.id, l.parent);
    return { id: l.id, name: l.name, parts: looked.filter((p) => p.link === l.id).map((p) => p.id), ...(parent ? { parent } : {}) };
  });
  const links = components
    .filter((l) => l.parts.length)
    .map((l) => {
      // Up past empty or gone components to the nearest one with bodies (a loop stops at the model).
      const seen = new Set([l.id]);
      let up = l.parent;
      while (up && !seen.has(up)) {
        seen.add(up);
        const c = components.find((x) => x.id === up);
        if (c?.parts.length) return { ...l, parent: up };
        up = c?.parent;
      }
      return { id: l.id, name: l.name, parts: l.parts };
    });
  return { parts: looked, sketches, failed, links, components, joints, drives, construct: built, tracks };
}

/** A revolve's rough size: the box round the profiles swept a full turn (good enough for the props panel). */
function revolveSize(spec: RevolveSpec): Vec3 {
  const pts = spec.profiles.flatMap((p) =>
    p.outer.flatMap((g) => (g.kind === "circle" ? [[g.c[0] + g.r, g.c[1]] as Vec2, [g.c[0] - g.r, g.c[1]] as Vec2] : [g.a, g.b])),
  );
  const { origin: o, dir: d, offset = 0 } = spec.axis;
  const r = Math.max(0, ...pts.map((p) => Math.hypot((p[0] - o[0]) * d[1] - (p[1] - o[1]) * d[0], offset)));
  const along = pts.map((p) => (p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1]);
  const [a0, a1] = [Math.min(...along), Math.max(...along)];
  const f = spec.frame;
  const y = [f.normal[1] * f.x[2] - f.normal[2] * f.x[1], f.normal[2] * f.x[0] - f.normal[0] * f.x[2], f.normal[0] * f.x[1] - f.normal[1] * f.x[0]];
  const axisW = [0, 1, 2].map((i) => f.x[i]! * d[0] + y[i]! * d[1]);
  // Along the axis: its length; across: the radius both ways.
  const span = (i: number) => Math.round((Math.abs(axisW[i]!) * (a1 - a0) + 2 * r * Math.sqrt(Math.max(0, 1 - axisW[i]! ** 2))) * 1000) / 1000;
  return pts.length ? { x: span(0), y: span(1), z: span(2) } : { ...ZERO };
}

/** The parts an extrude or revolve changes, as they stand now; notes on the step any that are gone. */
function profileTargets(f: ExtrudeFeature | RevolveFeature, parts: Part[], find: (id: string) => number, failed: Map<string, string>): Part[] {
  const ids = targetsOf(f);
  if (!ids.length) {
    failed.set(f.id, f.operation === "join" ? "Pick the body to change" : "Pick the bodies to change");
    return [];
  }
  const found = ids.map((id) => parts[find(id)]).filter((p): p is Part => !!p);
  if (found.length < ids.length) {
    const gone = ids.length - found.length;
    failed.set(
      f.id,
      ids.length === 1 ? "The body it changes is gone" : `${gone === 1 ? "One body" : `${gone} bodies`} it changes ${gone === 1 ? "is" : "are"} gone`,
    );
  }
  return found;
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
    if (f.type === "convert" || ((f.type === "extrude" || f.type === "revolve") && f.operation === "new")) names.add(f.body.name);
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

/** Sets the home view, or clears it back to the corner view with null. */
export function setHome(doc: ModelDoc, camera: ViewCamera | null): ModelDoc {
  if (camera) return { ...doc, home: { ...camera, target: [...camera.target] } };
  const rest = { ...doc };
  delete rest.home;
  return rest;
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

/** The parts with every other piece of any track they belong to: a colour or finish set on one piece goes on them all. */
export function withTrackMates(doc: ModelDoc, ids: string[]): string[] {
  const out = new Set(ids);
  for (const f of doc.features) {
    if (f.type !== "pattern" || f.kind !== "track") continue;
    const all = featureParts(f);
    if (all.some((id) => out.has(id))) all.forEach((id) => out.add(id));
  }
  return [...out];
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
      return f.kind === "track" ? [...f.parts, ...patternCopyIds(f)] : f.join ? [...f.parts] : patternCopyIds(f);
    case "sketch":
      return [];
    case "extrude":
      return f.operation === "new" ? [f.body.id] : targetsOf(f);
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
      return f.operation === "new" ? [f.body.id] : targetsOf(f);
    case "import":
      return f.bodies.map((b) => b.id);
    case "insert":
      return [f.part.id];
    case "gear":
    case "convert":
      return [f.body.id];
    case "link":
    case "joint":
    case "drive":
    case "construct":
      return [];
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
    if (g.type === "convert" || ((g.type === "extrude" || g.type === "revolve") && g.operation === "new")) names.set(g.body.id, g.body.name);
  }
  for (const [id, l] of Object.entries(doc.looks)) if (l.name) names.set(id, l.name);
  const who = (ids: string[]) => (ids.length === 1 ? (names.get(ids[0]!) ?? "1 part") : `${ids.length} parts`);
  switch (f.type) {
    case "construct":
      return constructSummary(f.kind, f.refs, f.value, (r) => refText(r, (id) => names.get(id) ?? doc.features.find((g) => g.id === id)?.name));
    case "link":
      return f.parts.length ? `${who(f.parts)}, one rigid component` : "A component to work in";
    case "joint": {
      const name = (l: string | null) => (l === null ? "Base" : (doc.features.find((g) => g.id === l)?.name ?? "a gone link"));
      const k = JOINT_KINDS.find((x) => x.id === f.kind)!;
      const u = limitUnit(f.kind);
      const lim = u ? `, ${f.lower}${u === "°" ? "°" : " mm"} to ${f.upper}${u === "°" ? "°" : " mm"}` : "";
      return `${k.label} (${k.urdf}): ${name(f.child)} on ${name(f.parent)}${lim}`;
    }
    case "drive": {
      const name = (id: string) => doc.features.find((g) => g.id === id)?.name ?? "a gone joint";
      if (f.kind === "together") {
        const rest = [f.driven, ...(f.more ?? [])].map(name);
        return `${name(f.driver)} moves ${rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(", ")} and ${rest.at(-1)}`} with it`;
      }
      const k = DRIVE_KIND_LABEL[f.kind];
      return `${k}: ${name(f.driver)} drives ${name(f.driven)}`;
    }
    case "gear": {
      const a = f.mesh && doc.features.find((g): g is GearFeature => g.id === f.mesh!.gear && g.type === "gear");
      if (a) return `${f.gear.teeth} teeth, meshes with ${a.name}, ${ratioText(a.gear.teeth, f.gear.teeth).split(",")[0]}`;
      return `${f.gear.teeth} teeth, module ${f.gear.module}, ${mm(f.width)} wide`;
    }
    case "mount":
      return f.kind === "standoffs"
        ? `${f.points.length} × ${f.size}, ${mm(f.height)} tall${f.hole === "insert" ? ", heat-set inserts" : ""}`
        : `${f.horn === "single" ? "Single" : f.horn === "double" ? "Double" : "Cross"} horn, ${f.size} holes ${mm(f.arm)} out`;
    case "insert":
      return `${f.record.name}, ${f.record.mass} g${f.record.checked ? "" : ", sizes not checked"}`;
    case "import":
      return `${f.bodies.length === 1 ? "1 body" : `${f.bodies.length} bodies`} from ${f.file}`;
    case "convert":
      return `${who([f.part])} made editable${f.plugs.length ? ", holes filled ready to cut again" : ""}`;
    case "add": {
      const s = f.part.size;
      return `${KIND_LABEL[f.part.kind]}, ${s.x} × ${s.y} × ${s.z} mm`;
    }
    case "duplicate":
      return `Copies ${who(f.copies.map((c) => c.from))}`;
    case "pattern": {
      const step = (id: string) => doc.features.find((g) => g.id === id)?.name;
      const of = copiesWhat(f);
      const what =
        of === "features"
          ? (f.features ?? []).map((id) => step(id) ?? "a gone step").join(", ") || "no features"
          : of === "component"
            ? (f.link && step(f.link)) || "a gone component"
            : who(f.parts);
      return patternSummary(
        f,
        what,
        f.step ? (doc.features.find((g) => g.id === f.step)?.name ?? "a gone plane") : f.face && (names.get(f.face.body) ?? "a body"),
        f.axisRef && "body" in f.axisRef
          ? `${f.axisRef.kind === "face" ? "a face" : "an edge"} of ${names.get(f.axisRef.body) ?? "a gone body"}`
          : f.axisStep
            ? (doc.features.find((g) => g.id === f.axisStep)?.name ?? "a gone axis")
            : undefined,
      );
    }
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
      const all = f.extent === "all";
      const how = f.direction === "symmetric" || (all && f.direction === "two") ? ", both ways" : f.direction === "two" ? ` and ${mm(f.distance2 ?? 0)}` : "";
      const op = f.operation === "new" ? "new body" : `${f.operation} ${who(targetsOf(f))}`;
      const from = f.start === "offset" ? `, from ${mm(f.startOffset ?? 0)} off` : f.start === "object" ? ", from an object" : "";
      if (f.extent === "to") return `Up to ${f.to?.kind === "vertex" ? "a point" : f.to?.kind === "edge" ? "an edge" : "a face"}${from}, ${op}`;
      return `${f.extent === "all" ? "Through all" : mm(f.distance)}${how}${from}, ${op}`;
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
      const op = f.operation === "new" ? "new body" : `${f.operation} ${who(targetsOf(f))}`;
      const a = f.axis;
      const axis = !a
        ? "an axis still to pick"
        : a.kind === "line"
          ? "a sketch line"
          : a.kind === "ref"
            ? refText(a.ref, (id) => names.get(id) ?? doc.features.find((g) => g.id === id)?.name)
            : `the sketch's ${a.kind.toUpperCase()} axis`;
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
  const on = s.plane.kind === "world" ? `On the ${s.plane.plane} plane` : s.plane.kind === "construct" ? "On a construction plane" : "On a face";
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

export type ExtrudeParams = Pick<
  ExtrudeFeature,
  | "sketch"
  | "seeds"
  | "split"
  | "texts"
  | "distance"
  | "direction"
  | "distance2"
  | "extent"
  | "to"
  | "start"
  | "startOffset"
  | "from"
  | "operation"
  | "target"
  | "targets"
>;

/** Adds an Extrude step. Its new body (when it makes one) gets the part id `bodyId`. */
export function addExtrude(doc: ModelDoc, params: ExtrudeParams, id = newId("f"), bodyId = newId(), at?: number): ModelDoc {
  const name = nextFeatureName(doc, "extrude");
  return insert(doc, at, { id, type: "extrude", name, ...params, body: { id: bodyId, name: nextName(doc, "solid") } });
}

/** Changes an Extrude step's settings (the dialog edits it live, as one undo step). */
export function updateExtrude(doc: ModelDoc, id: string, change: Partial<ExtrudeParams>): ModelDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === id && f.type === "extrude" ? { ...f, ...change } : f)) };
}

export type FinishParams = Pick<FinishFeature, "type" | "part" | "refs" | "size" | "outside"> & { names?: string[] };

/** Adds a Fillet, Chamfer or Shell step at `at` (the marker), or at the end. */
export function addFinish(doc: ModelDoc, params: FinishParams, id = newId("f"), at?: number): ModelDoc {
  const { names, ...rest } = params;
  return insert(doc, at, { id, name: nextFeatureName(doc, params.type), ...rest, ...(names?.length ? { names } : {}) });
}

/** Changes a Fillet, Chamfer or Shell step (the tool edits it live, as one undo step). */
export function updateFinish(doc: ModelDoc, id: string, change: Partial<FinishParams>): ModelDoc {
  return {
    ...doc,
    features: doc.features.map((f) => {
      if (f.id !== id || (f.type !== "fillet" && f.type !== "chamfer" && f.type !== "shell" && f.type !== "pushpull")) return f;
      const next = { ...f, ...change } as FinishFeature;
      // New picks without names drop the old names, which would otherwise win over them.
      if (change.refs && !change.names?.length) delete next.names;
      // Switching between round and bevel renames a step that still has its default name.
      if (change.type && change.type !== f.type && f.name.startsWith(FEATURE_LABEL[f.type])) next.name = nextFeatureName(doc, change.type);
      return next;
    }),
  };
}

export type RevolveParams = Pick<RevolveFeature, "sketch" | "seeds" | "split" | "texts" | "axis" | "angle" | "symmetric" | "operation" | "target" | "targets">;

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
/** The projected entities whose body is gone at that point on the timeline: their links are broken. */
export function brokenProjections(sketch: Sketch, hasBody: (id: string) => boolean): string[] {
  return sketch.entities.filter((e) => e.projectedFrom && !hasBody(e.projectedFrom.body)).map((e) => e.id);
}

/** What is wrong with a sketch's links to the model: the face it sits on is gone, or projected edges lost their body. */
export function sketchLinkProblem(sketch: Sketch, hasBody: (id: string) => boolean): string | null {
  if (sketch.plane.kind === "face" && !hasBody(sketch.plane.face.body)) return "The face it sits on is gone. Redefine its plane from the timeline menu.";
  const lost = brokenProjections(sketch, hasBody).filter((id) => sketch.entities.find((e) => e.id === id)?.kind !== "point").length;
  if (!lost) return null;
  return `${lost === 1 ? "1 projected edge has" : `${lost} projected edges have`} lost the body they came from. Fix the links from the timeline menu.`;
}

/** A sketch's broken projections, found against the model just before it. */
export function sketchBrokenLinks(doc: ModelDoc, id: string): string[] {
  const i = doc.features.findIndex((f) => f.id === id);
  const f = doc.features[i];
  if (f?.type !== "sketch") return [];
  const here = new Set(build(doc, i).parts.map((p) => p.id));
  return brokenProjections(f.sketch, (b) => here.has(b));
}

/** Fixes broken projections: "keep" leaves the geometry where it is as ordinary fixed lines, "delete" removes it. */
export function fixSketchLinks(doc: ModelDoc, id: string, how: "keep" | "delete"): ModelDoc {
  const broken = new Set(sketchBrokenLinks(doc, id));
  if (!broken.size) return doc;
  const unlink = (s: Sketch): Sketch => ({ ...s, entities: s.entities.map((e) => (broken.has(e.id) ? { ...e, projectedFrom: undefined } : e)) });
  return updateSketch(doc, id, (s) => {
    if (how === "keep") return unlink(s);
    // The curves go; a point stays (unlinked) while your own geometry still uses it.
    const curves = s.entities.filter((e) => broken.has(e.id) && e.kind !== "point").map((e) => e.id);
    return unlink(removeEntities(s, curves));
  });
}

/** Moves a sketch onto another plane or face. Its geometry keeps its place in the sketch's own frame, as in Fusion. */
export function redefineSketchPlane(doc: ModelDoc, id: string, plane: PlaneRef): ModelDoc {
  return updateSketch(doc, id, (s) => ({ ...s, plane }));
}

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

/** Adds a Convert step (#448): a new body from a mesh body, with its recognised holes filled. */
export function addConvert(doc: ModelDoc, p: Pick<ConvertFeature, "part" | "body" | "plugs" | "component">, id = newId("f"), at?: number): ModelDoc {
  return insert(doc, at, { id, type: "convert", name: nextFeatureName(doc, "convert"), ...p });
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

/** A gear step's solid: the toothed prism, then its hub joined and bore cut, in world space. Or why it can't be made. */
export function gearSpec(f: GearFeature): { prism: PrismSpec; ops: BodyOp[] } | string {
  const form = f.form ?? "spur";
  const what = form === "rack" ? "rack" : form === "gt2" ? "pulley" : "gear";
  if (!(f.width > 0)) return `Give the ${what} a width above 0 mm`;
  const turn = ((f.turn ?? 0) * Math.PI) / 180;
  const frame = f.frame;
  if (form === "rack") {
    const size = f.rack ?? { length: 60, height: 5 };
    const problem = rackProblem(f.gear, size);
    if (problem) return problem;
    const pts = rackOutline(f.gear, size);
    return { prism: { frame, profiles: [{ outer: polySegs(pts), holes: [], area: polyArea(pts) }], from: 0, to: f.width }, ops: [] };
  }
  const problem = form === "gt2" ? pulleyProblem(f.gear.teeth) : gearProblem(f.gear);
  if (problem) return problem;
  const ops: BodyOp[] = [];
  const disc = (r: number, from: number, to: number) =>
    ops.push({
      op: "join",
      tool: { frame, profiles: [{ outer: [{ kind: "circle", c: [0, 0], r }], holes: [], area: Math.PI * r * r }], from, to },
      feature: f.id,
    });
  let root: number;
  let prism: PrismSpec;
  let teethTop = f.width;
  if (form === "gt2") {
    const ro = gt2Outside(f.gear.teeth) / 2;
    root = ro - GT2.depth;
    const flange = f.flanges ? 1 : 0;
    teethTop = f.width + flange;
    prism = { frame, profiles: [{ outer: gt2Segs(f.gear.teeth, turn), holes: [], area: Math.PI * (ro - GT2.depth / 2) ** 2 }], from: flange, to: teethTop };
    if (f.flanges) {
      disc(ro + 1.5, 0, 1.01);
      disc(ro + 1.5, teethTop - 0.01, teethTop + 1);
      teethTop += 1;
    }
  } else {
    root = gearCircles(f.gear).root;
    prism = { frame, profiles: [{ outer: gearSegs(f.gear, turn), holes: [], area: gearArea(f.gear) }], from: 0, to: f.width };
  }
  const top = teethTop + (f.hub && f.hub.length > 0 ? f.hub.length : 0);
  if (f.hub && f.hub.length > 0) {
    if (!(f.hub.diameter / 2 < root)) return `Make the hub narrower than the ${what}'s root`;
    if (f.bore.kind !== "none" && !(f.hub.diameter > f.bore.diameter + 1)) return "Make the hub wider than the bore";
    disc(f.hub.diameter / 2, teethTop - 0.01, top);
  }
  // Every hole goes in one cut: each cut against the toothed body costs about the same, however small the hole.
  const holes: ProfileShape[] = [];
  const cut = (outer: ProfileSeg[], area: number) => holes.push({ outer, holes: [], area });
  const b = f.bore;
  if (b.kind !== "none") {
    if (!(b.diameter > 0)) return "Give the bore a diameter above 0 mm";
    if (!(b.diameter / 2 < root - 0.5)) return `The bore is wider than the ${what}'s root`;
    if (b.kind === "round" || b.kind === "horn") cut([{ kind: "circle", c: [0, 0], r: b.diameter / 2 }], (Math.PI * b.diameter ** 2) / 4);
    if (b.kind === "dflat") {
      const flat = b.flat ?? b.diameter * 0.4;
      cut(dFlatSegs(b.diameter, flat, turn), polyArea(dFlat(b.diameter, flat)));
    }
    if (b.kind === "horn") {
      const arm = b.arm ?? 7;
      const d = screw("M2")!.printed;
      if (!(arm + d / 2 < root - 0.5)) return `Put the horn's arm holes inside the ${what}'s root`;
      if (!(arm - d / 2 > b.diameter / 2)) return "Put the horn's arm holes outside its hub";
      const spin = ([x, y]: Vec2): Vec2 => [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn)];
      for (const q of hornPoints("cross", arm).map(spin)) cut([{ kind: "circle", c: q, r: d / 2 }], (Math.PI * d * d) / 4);
    }
  }
  if (holes.length) ops.push({ op: "cut", tool: { frame, profiles: holes, from: -1, to: top + 1 }, feature: f.id });
  return { prism, ops };
}

/** Gear b as it stands meshed with gear a: on a's plane at the centre distance, turned to interleave. */
export function meshedWith(a: GearFeature, b: GearFeature): GearFeature {
  const gear = { ...b.gear, module: a.gear.module, pressure: a.gear.pressure };
  const theta = ((b.mesh?.angle ?? 0) * Math.PI) / 180;
  const { x, normal: n, origin } = a.frame;
  const y: Vec3t = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const dir: Vec3t = [0, 1, 2].map((i) => Math.cos(theta) * x[i]! + Math.sin(theta) * y[i]!) as Vec3t;
  const turnA = ((a.turn ?? 0) * Math.PI) / 180;
  if (b.form === "rack") {
    // The rack's pitch line touches the gear's pitch circle (moved out by both shifts), its teeth toward the gear,
    // slid along so a gap sits where the gear's tooth is.
    const r = gearCircles(a.gear).pitch + a.gear.module * (a.gear.shift + gear.shift);
    const tangent: Vec3t = [n[1] * dir[2] - n[2] * dir[1], n[2] * dir[0] - n[0] * dir[2], n[0] * dir[1] - n[1] * dir[0]];
    const pitch = Math.PI * a.gear.module;
    const phi = turnA - theta;
    const raw = gearCircles(a.gear).pitch * phi + pitch / 2;
    const slide = raw - Math.round(raw / pitch) * pitch;
    const o = [0, 1, 2].map((i) => origin[i]! + r * dir[i]! + slide * tangent[i]!) as Vec3t;
    return { ...b, gear, frame: { origin: o, x: tangent, normal: n }, turn: 0 };
  }
  const cd = centreDistance(a.gear, gear);
  const along = (i: number) => origin[i]! + cd * dir[i]!;
  const turn = (meshTurn(a.gear.teeth, turnA, theta, gear.teeth) * 180) / Math.PI;
  return { ...b, gear, frame: { origin: [along(0), along(1), along(2)], x, normal: n }, turn: ((turn % 360) + 360) % 360 };
}
type Vec3t = [number, number, number];

/** Pulley b where its belt from pulley a puts it, or null when the belt is too short. */
export function beltedTo(a: GearFeature, b: GearFeature): GearFeature | null {
  if (!b.belt) return b;
  const c = centreForBelt(b.belt.length, a.gear.teeth, b.gear.teeth);
  if (c === null) return null;
  const theta = (b.belt.angle * Math.PI) / 180;
  const { x, normal: n, origin } = a.frame;
  const y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const o = [0, 1, 2].map((i) => origin[i]! + c * (Math.cos(theta) * x[i]! + Math.sin(theta) * y[i]!)) as Vec3t;
  return { ...b, frame: { origin: o, x, normal: n } };
}

/** A gear step as it stands, following any gears it meshes with. Null when it, or one it follows, is missing. */
export function resolveGear(doc: ModelDoc, id: string, seen = new Set<string>()): GearFeature | null {
  const f = doc.features.find((g): g is GearFeature => g.id === id && g.type === "gear");
  if (!f || seen.has(id)) return null;
  const link = f.mesh?.gear ?? f.belt?.pulley;
  if (!link) return f;
  const a = resolveGear(doc, link, new Set([...seen, id]));
  return a ? (f.mesh ? meshedWith(a, f) : beltedTo(a, f)) : null;
}

/** Adds a gear that meshes with gear step `with` (#192), `angle` degrees round from its x. Same width and bore. */
export function addMatingGear(doc: ModelDoc, withId: string, teeth: number, angle = 0, id = newId("f"), bodyId = newId(), at?: number): ModelDoc {
  const a = doc.features.find((f): f is GearFeature => f.id === withId && f.type === "gear");
  if (!a) return doc;
  return addGear(doc, { gear: { ...a.gear, teeth, shift: 0 }, width: a.width, bore: a.bore, frame: a.frame, mesh: { gear: a.id, angle } }, id, bodyId, at);
}

/**
 * Meshes two existing gear steps (#192): the later one moves beside the earlier, keeping the side it was on. Or why
 * they can't mesh.
 */
export function meshGears(doc: ModelDoc, one: string, two: string): { doc: ModelDoc; error?: string } {
  const gears = doc.features.filter((f): f is GearFeature => f.type === "gear");
  const i = gears.findIndex((g) => g.id === one);
  const j = gears.findIndex((g) => g.id === two);
  if (i < 0 || j < 0 || i === j) return { doc, error: "Pick two gears to mesh" };
  const [a, b] = i < j ? [gears[i]!, gears[j]!] : [gears[j]!, gears[i]!];
  const problem = meshProblem(a.gear, b.gear);
  if (problem) return { doc, error: problem };
  if (b.mesh?.gear === a.id) return { doc };
  // Keep b on the side it's on now, measured on a's plane.
  const d = [0, 1, 2].map((k) => b.frame.origin[k]! - a.frame.origin[k]!);
  const { x, normal: n } = a.frame;
  const y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const dot = (u: number[], v: readonly number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const angle = Math.hypot(dot(d, x), dot(d, y)) > 1e-6 ? Math.round(((Math.atan2(dot(d, y), dot(d, x)) * 180) / Math.PI) * 100) / 100 : 0;
  return { doc: updateGear(doc, b.id, { mesh: { gear: a.id, angle } }) };
}

/** Adds a rack meshing with gear step `with` (#193), under it, as long as four of the gear's teeth either side. */
export function addRack(doc: ModelDoc, withId: string, angle = -90, id = newId("f"), bodyId = newId(), at?: number): ModelDoc {
  const a = doc.features.find((f): f is GearFeature => f.id === withId && f.type === "gear");
  if (!a) return doc;
  const length = Math.max(40, Math.round(gearCircles(a.gear).pitch * 2 + 8 * Math.PI * a.gear.module));
  return addGear(
    doc,
    {
      gear: { ...a.gear, shift: 0 },
      width: a.width,
      bore: { kind: "none", diameter: 0 },
      frame: a.frame,
      form: "rack",
      rack: { length, height: 5 },
      mesh: { gear: a.id, angle },
    },
    id,
    bodyId,
    at,
  );
}

/**
 * Puts a belt round two pulley steps (#193): the stock GT2 belt nearest what they need where they stand, and the
 * later pulley moved to fit it, keeping its side. `length` picks a belt instead. Or why not.
 */
export function fitBelt(doc: ModelDoc, one: string, two: string, length?: number): { doc: ModelDoc; error?: string; needed?: number; length?: number } {
  const pulleys = doc.features.filter((f): f is GearFeature => f.type === "gear" && f.form === "gt2");
  const i = pulleys.findIndex((g) => g.id === one);
  const j = pulleys.findIndex((g) => g.id === two);
  if (i < 0 || j < 0 || i === j) return { doc, error: "Pick two GT2 pulleys" };
  const [a0, b] = i < j ? [pulleys[i]!, pulleys[j]!] : [pulleys[j]!, pulleys[i]!];
  const a = resolveGear(doc, a0.id);
  const bNow = resolveGear(doc, b.id);
  if (!a || !bNow) return { doc, error: "Fix the pulleys' steps first" };
  const d = [0, 1, 2].map((k) => bNow.frame.origin[k]! - a.frame.origin[k]!);
  const { x, normal: n } = a.frame;
  const y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const dot = (u: number[], v: readonly number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const [u, v] = [dot(d, x), dot(d, y)];
  const c = Math.hypot(u, v);
  const angle = c > 1e-6 ? Math.round(((Math.atan2(v, u) * 180) / Math.PI) * 100) / 100 : 0;
  const needed = c > 1e-6 ? beltLength(c, a.gear.teeth, b.gear.teeth) : undefined;
  const belt = length ?? nearestBelt(needed ?? 200);
  if (centreForBelt(belt, a.gear.teeth, b.gear.teeth) === null) return { doc, error: `A ${belt} mm belt is too short for these pulleys` };
  return { doc: updateGear(doc, b.id, { belt: { pulley: a.id, angle, length: belt } }), needed, length: belt };
}

export type GearParamsStep = Omit<GearFeature, "id" | "name" | "type" | "body">;

/** Adds a Gear step making a new body. */
/** The name a gear step starts with: "Gear 20T", "Pulley 20T" or "Rack". */
export const gearBaseName = (f: Pick<GearFeature, "form" | "gear">) =>
  f.form === "rack" ? "Rack" : `${f.form === "gt2" ? "Pulley" : "Gear"} ${f.gear.teeth}T`;

export function addGear(doc: ModelDoc, params: GearParamsStep, id = newId("f"), bodyId = newId(), at?: number): ModelDoc {
  const taken = usedNames(doc);
  doc.features.forEach((f) => taken.add(f.name));
  const base = gearBaseName(params);
  let unique = base;
  for (let n = 2; taken.has(unique); n += 1) unique = `${base} ${n}`;
  return insert(doc, at, { id, type: "gear", name: unique, ...params, body: { id: bodyId, name: unique } });
}

/** Changes a Gear step (the bar edits it live, as one undo step). */
export function updateGear(doc: ModelDoc, id: string, change: Partial<GearParamsStep>): ModelDoc {
  return {
    ...doc,
    features: doc.features.map((f) => {
      if (f.id !== id || f.type !== "gear") return f;
      const next = { ...f, ...change };
      // A name still saying the old form or tooth count follows the new one.
      const was = gearBaseName(f);
      const now = gearBaseName(next);
      const auto = (n: string) => n === was || (/^ \d+$/.test(n.slice(was.length)) && n.startsWith(was));
      if (was === now || !auto(f.name)) return next;
      const taken = usedNames({ ...doc, features: doc.features.filter((g) => g.id !== id) });
      doc.features.forEach((g) => g.id !== id && taken.add(g.name));
      let name = now;
      for (let n = 2; taken.has(name); n += 1) name = `${now} ${n}`;
      return { ...next, name, body: { ...f.body, name: auto(f.body.name) ? name : f.body.name } };
    }),
  };
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

export type HoleStepParams = Pick<
  HoleFeature,
  "part" | "frame" | "points" | "size" | "fit" | "diameter" | "offset" | "head" | "depth" | "headSize" | "component"
>;

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
    case "link":
      return f.parts;
    case "pattern": {
      const track = f.kind === "track" && f.track ? [f.track.start, f.track.end, ...f.track.wheels] : [];
      const extra = [
        f.face?.body,
        f.kind === "circle" && f.axisRef && "body" in f.axisRef ? f.axisRef.body : undefined,
        ...track.map((r) => (r && "body" in r ? r.body : undefined)),
      ];
      return [...new Set([...f.parts, ...extra.filter((x): x is string => !!x)])];
    }
    case "extrude":
      return [...new Set([...targetsOf(f), ...(f.extent === "to" && f.to ? [f.to.body] : []), ...(f.start === "object" && f.from ? [f.from.body] : [])])];
    case "revolve":
      return f.axis?.kind === "ref" && "body" in f.axis.ref ? [...new Set([...targetsOf(f), f.axis.ref.body])] : targetsOf(f);
    case "combine":
      return [f.target, ...f.tools.map((t) => t.id)];
    case "construct":
      return [...new Set(f.refs.flatMap((r) => ("body" in r ? [r.body] : [])))];
    case "import":
    case "insert":
    case "gear":
    case "joint":
    case "drive":
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
  if (f.type === "gear" || f.type === "convert") return [f.body.id];
  if ((f.type === "extrude" || f.type === "revolve") && f.operation === "new") return [f.body.id];
  return [];
}

/** Features that pick edges or faces by number need the part exactly as the steps before left it. */
const PICKS_BY_NUMBER = new Set<FeatureType>(["fillet", "chamfer", "shell", "pushpull", "hole", "mount"]);

/**
 * The features one feature needs before it on the timeline: the steps that made the parts it reads, its sketch, and
 * for edge and face picks, every earlier step that changed that part (the numbering depends on them). `strict` leaves
 * those out: only what the step can't build without (the part's maker, its sketch), the way a reorder is checked.
 */
export function dependsOn(doc: ModelDoc, id: string, strict = false): string[] {
  const i = doc.features.findIndex((f) => f.id === id);
  const f = doc.features[i];
  if (!f) return [];
  const before = doc.features.slice(0, i);
  const out = new Set<string>();
  for (const pid of partsRead(f)) {
    for (const g of before) {
      if (partsMade(g).includes(pid)) out.add(g.id);
      else if (!strict && PICKS_BY_NUMBER.has(f.type) && featureParts(g).includes(pid) && g.type !== "move") out.add(g.id);
    }
  }
  if (f.type === "extrude" || f.type === "revolve") {
    if (before.some((g) => g.id === f.sketch)) out.add(f.sketch);
  }
  // A revolve round a construction axis needs that axis.
  if (f.type === "revolve" && f.axis?.kind === "ref" && "step" in f.axis.ref) {
    const step = f.axis.ref.step;
    if (before.some((g) => g.id === step)) out.add(step);
  }
  // Construction geometry needs the steps it was made from; a sketch, the plane it sits on.
  if (f.type === "construct") for (const r of f.refs) if ("step" in r && before.some((g) => g.id === r.step)) out.add(r.step);
  if (f.type === "sketch" && f.sketch.plane.kind === "construct") {
    const step = f.sketch.plane.step;
    if (before.some((g) => g.id === step)) out.add(step);
  }
  // A Mirror of features needs those features; a Mirror of a component needs its link; one across a construction plane,
  // that plane.
  if (f.type === "pattern") {
    for (const c of [f.step, f.kind === "circle" ? f.axisStep : undefined]) if (c && before.some((x) => x.id === c)) out.add(c);
    for (const g of [...(f.features ?? []), ...(f.link ? [f.link] : [])]) if (before.some((x) => x.id === g)) out.add(g);
  }
  // A joint needs the links it joins, and the joint its parent link hangs from.
  if (f.type === "joint") {
    for (const l of [f.child, f.parent]) if (l && before.some((g) => g.id === l)) out.add(l);
    const up = before.find((g) => g.type === "joint" && g.child === f.parent);
    if (up) out.add(up.id);
  }
  // A drive needs its two joints, and the drive that drives its driver.
  if (f.type === "drive") {
    for (const j of [f.driver, f.driven, ...(f.more ?? [])]) if (before.some((g) => g.id === j)) out.add(j);
    const up = before.find((g) => g.type === "drive" && (g.driven === f.driver || g.more?.includes(f.driver)));
    if (up) out.add(up.id);
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

/**
 * Why a feature can't move before `beforeId` (null for the end), or null when it can. Only what a step can't build
 * without blocks a move: the step that made its part, and its sketch. Edge and face picks only warn (`moveWarning`).
 */
export function moveProblem(doc: ModelDoc, id: string, beforeId: string | null): string | null {
  const next = reorderFeature(doc, id, beforeId);
  if (next === doc) return null;
  const pos = new Map(next.features.map((f, i) => [f.id, i]));
  const name = (fid: string) => doc.features.find((f) => f.id === fid)?.name ?? "a step";
  for (const f of next.features) {
    for (const d of dependsOn(doc, f.id, true)) {
      if (pos.get(d)! > pos.get(f.id)!) return `${f.name} needs ${name(d)} before it`;
    }
  }
  return null;
}

/** The earlier steps that change a picking step's part, which its edge and face numbers depend on. */
function pickBasis(features: Feature[], i: number): string {
  const f = features[i]!;
  const read = partsRead(f);
  return features
    .slice(0, i)
    .filter((g) => !g.suppressed && g.type !== "move" && featureParts(g).some((p) => read.includes(p)))
    .map((g) => g.id)
    .join(" ");
}

/** The steps a move leaves picking edges or faces on a part that different steps now shape, in timeline order. */
export function movedPicks(doc: ModelDoc, id: string, beforeId: string | null): Feature[] {
  const next = reorderFeature(doc, id, beforeId);
  if (next === doc) return [];
  const was = new Map(doc.features.map((f, i) => [f.id, i]));
  return next.features.filter((f, i) => PICKS_BY_NUMBER.has(f.type) && pickBasis(next.features, i) !== pickBasis(doc.features, was.get(f.id)!));
}

/** "Shell 1 and Fillet 1 may now pick the wrong edges or faces", for the steps named. Null when none. */
export function lostText(names: string[]): string | null {
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list} may now pick the wrong edges or faces`;
}

/** What to say after a move made without the kernel, which can't find picks again: every step whose picks moved. */
export function moveWarning(doc: ModelDoc, id: string, beforeId: string | null): string | null {
  return lostText(movedPicks(doc, id, beforeId).map((f) => f.name));
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

/** Every expression a step holds: its fields' and, for a sketch, its dimensions'. */
function featureExprs(f: Feature): string[] {
  const out = Object.values(f.exprs ?? {});
  if (f.type === "sketch") for (const d of f.sketch.dimensions) out.push(d.expression);
  return out;
}

/** Steps and parameters whose expressions use a name. */
export function paramUses(doc: ModelDoc, name: string): { features: Feature[]; params: Parameter[] } {
  return {
    features: doc.features.filter((f) => featureExprs(f).some((e) => namesIn(e).includes(name))),
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
    features = features.map((f) => {
      if (!featureExprs(f).some((e) => namesIn(e).includes(old.name))) return f;
      const exprs = f.exprs && Object.fromEntries(Object.entries(f.exprs).map(([k, e]) => [k, renameIn(e, old.name, to)]));
      const g = { ...f, exprs } as Feature;
      if (g.type !== "sketch") return g;
      const dimensions = g.sketch.dimensions.map((d) => ({ ...d, expression: renameIn(d.expression, old.name, to) }));
      return { ...g, sketch: { ...g.sketch, dimensions } };
    });
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

/**
 * Sketch sizes that use parameters, worked out again after the parameters change, and each sketch that moved solved
 * by `solve` (the planegcs solver, which the app loads). A size whose expression no longer works, or a sketch the
 * solver can't meet, keeps what it had.
 */
export function relinkSketches(doc: ModelDoc, solve: (sketch: Sketch) => Sketch | null): ModelDoc {
  const scope = paramScope(doc);
  let changed = false;
  const features = doc.features.map((f) => {
    if (f.type !== "sketch") return f;
    let moved = false;
    const dimensions = f.sketch.dimensions.map((d) => {
      if (!d.driving || !namesIn(d.expression).length) return d;
      let v: number;
      try {
        v = evaluate(d.expression, scope);
      } catch {
        return d;
      }
      if (!(v > 0) || (d.kind === "angle" && v >= 180) || Math.abs(v - d.value) < 1e-9) return d;
      moved = true;
      return { ...d, value: v };
    });
    if (!moved) return f;
    const solved = solve({ ...f.sketch, dimensions });
    if (!solved) return f;
    changed = true;
    return { ...f, sketch: solved };
  });
  return changed ? { ...doc, features } : doc;
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
  const next = insert(doc, clampAt(doc, at), { id, type: "pattern", name, ...PATTERN_DEFAULTS, ...params });
  return syncMirrorParts(next, id);
}

/**
 * Keeps a Mirror's `parts` to what it copies when it mirrors features (the bodies they made) or a component (its bodies
 * at that point), so its copies' ids, and the steps that need it, follow.
 */
function syncMirrorParts(doc: ModelDoc, id: string): ModelDoc {
  const i = doc.features.findIndex((f) => f.id === id);
  const f = doc.features[i];
  if (f?.type !== "pattern" || copiesWhat(f) === "bodies") return doc;
  let parts: string[];
  if (copiesWhat(f) === "features") {
    const made = new Set(
      doc.features
        .slice(0, i)
        .filter((g) => f.features?.includes(g.id))
        .flatMap(partsMade),
    );
    parts = build(doc, i)
      .parts.filter((p) => made.has(p.id))
      .map((p) => p.id);
  } else parts = f.link ? (build(doc, i).links.find((l) => l.id === f.link)?.parts ?? []) : [];
  if (parts.join(",") === f.parts.join(",")) return doc;
  return { ...doc, features: doc.features.map((g) => (g.id === id ? { ...f, parts } : g)) };
}

/**
 * The steps before `id` (or before the end) a Mirror or Pattern of features can copy: those that cut, joined, made holes
 * or made a body, and earlier Mirror and Pattern steps that did, so a mirror can be mirrored again.
 */
export function mirrorableFeatures(doc: ModelDoc, before = doc.features.length): Feature[] {
  const { parts } = build(doc, before);
  const ops = new Set(parts.flatMap((p) => (p.ops ?? []).filter((o) => MIRRORED_OPS.has(o.op)).map((o) => o.feature)));
  const here = new Set(parts.map((p) => p.id));
  return doc.features
    .slice(0, before)
    .filter(
      (f) =>
        !f.suppressed &&
        (ops.has(f.id) ||
          ((f.type === "extrude" || f.type === "revolve" || f.type === "gear" || f.type === "pattern") && partsMade(f).some((p) => here.has(p)))),
    );
}

/** Changes a Mirror or Pattern step (the tool edits it live, as one undo step). Switching kind renames a default name. */
export function updatePattern(doc: ModelDoc, id: string, change: Partial<PatternParams>): ModelDoc {
  const out: ModelDoc = {
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
  return syncMirrorParts(out, id);
}

/**
 * Makes a component (#171) of bodies, or an empty one to work in: "Component 1", inside `parent` when given. The bodies
 * leave any component they were in.
 */
export function addLink(doc: ModelDoc, parts: string[], id = newId("f"), at?: number, parent?: string, name?: string): ModelDoc {
  const named = name && !doc.features.some((f) => f.type === "link" && f.name === name) ? name : nextNamed(doc, "Component");
  return insert(doc, clampAt(doc, at), { id, type: "link", name: named, parts: [...parts], ...(parent ? { parent } : {}) });
}

/**
 * Makes a component of bodies, as the browser's New component and the Joint tool do: like `addLink`, and the bodies
 * also leave wherever they were dragged to (#334), so the new component takes them. `name` is used when no other component
 * has it.
 */
export function makeComponent(doc: ModelDoc, parts: string[], id = newId("f"), at?: number, parent?: string, name?: string): ModelDoc {
  const owners = doc.owners;
  const out =
    owners && parts.some((x) => x in owners) ? { ...doc, owners: Object.fromEntries(Object.entries(owners).filter(([k]) => !parts.includes(k))) } : doc;
  return addLink(out, parts, id, at, parent, name);
}

/**
 * Moves bodies, sketches, construction steps or components into a component, or into the model (null), as the browser
 * does when you drag them (#334). A component never goes inside itself or one of its own.
 */
export function moveInto(doc: ModelDoc, ids: string[], to: string | null): ModelDoc {
  const owners = { ...doc.owners };
  const parentOf = (c: string) => {
    if (c in owners) return owners[c];
    const f = doc.features.find((g) => g.id === c);
    return f?.type === "link" ? f.parent : undefined;
  };
  for (const id of ids) {
    // Up from the target: if this id is on the way, it would sit inside itself.
    let loop = false;
    for (let up: string | null | undefined = to, n = 0; up && n < 1000; up = parentOf(up), n++) if (up === id) loop = true;
    if (!loop) owners[id] = to;
  }
  return { ...doc, owners };
}

/**
 * Marks the steps `after` has that `before` didn't as made in `component` (#171), so their bodies go into it. A sketch
 * on a face goes into the component of the body it sits on instead (`bodyComponent`, null for the model), so it rides
 * with that body when a joint moves it.
 */
export function stampComponent(
  before: ModelDoc,
  after: ModelDoc,
  component: string | null,
  bodyComponent?: (body: string) => string | null | undefined,
): ModelDoc {
  if ((!component && !bodyComponent) || after.features === before.features) return after;
  const had = new Set(before.features.map((f) => f.id));
  let changed = false;
  const features = after.features.map((f) => {
    if (had.has(f.id) || f.component || f.type === "link" || f.type === "joint" || f.type === "drive") return f;
    const plane = f.type === "sketch" ? f.sketch.plane : null;
    const on = plane?.kind === "face" && bodyComponent ? bodyComponent(plane.face.body) : undefined;
    const to = on === undefined ? component : on;
    if (!to) return f;
    changed = true;
    return { ...f, component: to };
  });
  return changed ? { ...after, features } : after;
}

export type JointParams = Pick<JointFeature, "kind" | "child" | "parent" | "origin" | "axis" | "lower" | "upper"> &
  Partial<Pick<JointFeature, "from" | "angle" | "gap" | "offset" | "flip">>;

/** A joint as built: where its axis sits once the moving part is lined up (the gap and offset carry it). */
export function alignedJoint(f: JointFeature): JointFeature {
  const g = f.gap ?? 0;
  const o = f.offset ?? [0, 0, 0];
  if (!g && !o[0] && !o[1] && !o[2]) return f;
  const l = Math.hypot(...f.axis) || 1;
  return { ...f, origin: [0, 1, 2].map((i) => f.origin[i]! + (f.axis[i]! / l) * g + o[i]!) as [number, number, number] };
}
/** Adds a joint (#172): "Joint 1". */
export function addJoint(doc: ModelDoc, params: JointParams, id = newId("f"), at?: number): ModelDoc {
  return insert(doc, clampAt(doc, at), { id, type: "joint", name: nextNamed(doc, "Joint"), ...params });
}

/**
 * Sets one joint's value in the pose (#173), kept in range. Back at home, the joint leaves the pose. A joint in a drive
 * (#194) sets the joint driving it instead, within every limit along the drive.
 */
export function setPose(doc: ModelDoc, id: string, value: number): ModelDoc {
  const j = doc.features.find((f): f is JointFeature => f.id === id && f.type === "joint");
  if (!j) return doc;
  const hasDrives = doc.features.some((f) => f.type === "drive");
  const { joints, drives } = hasDrives ? build(doc) : { joints: [], drives: [] };
  const to = hasDrives ? driveTo(joints, drives, doc.pose, id, value) : { id, value: clampJoint(j, value) };
  const v = to.value;
  const pose: Pose = { ...doc.pose };
  delete pose[id];
  if (v === 0) delete pose[to.id];
  else pose[to.id] = v;
  return { ...doc, pose: Object.keys(pose).length ? pose : undefined };
}

/** The links above `link` on the joint tree, and it. */
function linksUp(doc: ModelDoc, link: string): Set<string> {
  const { joints } = build(doc);
  const out = new Set<string>([link]);
  for (let at: string | null = link, n = 0; at !== null && n <= joints.length; n++) {
    const j: JointFeature | undefined = joints.find((x) => x.child === at);
    at = j?.parent ?? null;
    if (at) out.add(at);
  }
  return out;
}

/** Sets a link's tool point (#176), in place of any other on the same chain (above or below it). */
export function setToolPoint(doc: ModelDoc, link: string, point: [number, number, number]): ModelDoc {
  const up = linksUp(doc, link);
  const kept = (doc.tools ?? []).filter((t) => !up.has(t.link) && !linksUp(doc, t.link).has(link));
  return { ...doc, tools: [...kept, { link, point: [...point] }] };
}

/** Takes a link's tool point off. */
export function clearToolPoint(doc: ModelDoc, link: string): ModelDoc {
  const tools = (doc.tools ?? []).filter((t) => t.link !== link);
  const next: ModelDoc = { ...doc, tools };
  if (!tools.length) delete next.tools;
  return next;
}

/** Keeps a joint out of every tool point's solve (#176), or lets it back in. */
export function lockJoint(doc: ModelDoc, joint: string, locked: boolean): ModelDoc {
  if (!doc.tools?.length) return doc;
  return {
    ...doc,
    tools: doc.tools.map((t) => {
      const rest = (t.locked ?? []).filter((id) => id !== joint);
      const next: ToolPoint = { ...t, locked: locked ? [...rest, joint] : rest };
      if (!next.locked!.length) delete next.locked;
      return next;
    }),
  };
}

/** Puts every joint back home (#173). */
export function homePose(doc: ModelDoc): ModelDoc {
  if (!doc.pose) return doc;
  const next = { ...doc };
  delete next.pose;
  return next;
}

// ---- section analyses

/** Adds or updates a section analysis and applies it, so it is the one the view shows. */
export function saveSection(doc: ModelDoc, section: SectionAnalysis): ModelDoc {
  const sections = doc.sections ?? [];
  const next: SectionAnalysis = { ...section, origin: [...section.origin], normal: [...section.normal] };
  const i = sections.findIndex((x) => x.id === section.id);
  return { ...doc, sections: i < 0 ? [...sections, next] : sections.map((x) => (x.id === section.id ? next : x)), section: section.id };
}

/** Applies one section analysis, turning off the one before; null shows the whole model again. */
export function applySection(doc: ModelDoc, id: string | null): ModelDoc {
  if (id && !doc.sections?.some((x) => x.id === id)) return doc;
  if ((doc.section ?? null) === id) return doc;
  const next: ModelDoc = { ...doc };
  if (id) next.section = id;
  else delete next.section;
  return next;
}

export function removeSection(doc: ModelDoc, id: string): ModelDoc {
  const sections = (doc.sections ?? []).filter((x) => x.id !== id);
  const next: ModelDoc = { ...doc, sections };
  if (!sections.length) delete next.sections;
  if (next.section === id) delete next.section;
  return next;
}

export function renameSection(doc: ModelDoc, id: string, name: string): ModelDoc {
  const n = name.trim();
  if (!n) return doc;
  return { ...doc, sections: (doc.sections ?? []).map((x) => (x.id === id ? { ...x, name: n } : x)) };
}

/** The section analysis the view shows now, if any. */
export function appliedSection(doc: ModelDoc): SectionAnalysis | null {
  return (doc.section && doc.sections?.find((x) => x.id === doc.section)) || null;
}

/** The next free section name: "Section 1", "Section 2"… */
export function nextSectionName(doc: ModelDoc): string {
  const names = new Set((doc.sections ?? []).map((x) => x.name));
  let n = 1;
  while (names.has(`Section ${n}`)) n += 1;
  return `Section ${n}`;
}

// ---- named poses (#177)

/** Saves a named pose, or replaces the one with its id (Update, Rename). */
export function savePose(doc: ModelDoc, pose: NamedPose): ModelDoc {
  const poses = doc.poses ?? [];
  const next = { ...pose, values: { ...pose.values } };
  const i = poses.findIndex((p) => p.id === pose.id);
  return { ...doc, poses: i < 0 ? [...poses, next] : poses.map((p) => (p.id === pose.id ? next : p)) };
}

export function removePose(doc: ModelDoc, id: string): ModelDoc {
  const poses = (doc.poses ?? []).filter((p) => p.id !== id);
  const next: ModelDoc = { ...doc, poses };
  if (!poses.length) delete next.poses;
  return next;
}

/** The next free pose name: "Pose 1", "Pose 2"… */
export function nextPoseName(doc: ModelDoc): string {
  const names = new Set((doc.poses ?? []).map((p) => p.name));
  let n = 1;
  while (names.has(`Pose ${n}`)) n += 1;
  return `Pose ${n}`;
}

/**
 * A named pose's values for the joints the model has now (#177): each kept to its joint's limits, and the ids of
 * joints that have gone since it was saved, which are dropped.
 */
export function namedPoseValues(doc: ModelDoc, id: string): { values: Pose; dropped: string[] } | null {
  const named = doc.poses?.find((p) => p.id === id);
  if (!named) return null;
  const joints = new Map(build(doc).joints.map((j) => [j.id, j]));
  const values: Pose = {};
  const dropped: string[] = [];
  for (const [jid, v] of Object.entries(named.values)) {
    const j = joints.get(jid);
    if (!j) dropped.push(jid);
    else if (j.kind !== "fixed" && v !== 0) values[jid] = clampJoint(j, v);
  }
  return { values, dropped };
}

export type DriveParams = Pick<DriveFeature, "kind" | "driver" | "driven" | "ratio" | "reverse" | "more" | "against">;

/**
 * Adds a drive link (#194): "Drive 1", or a motion link "Motion link 1" for joints that move together. The driven joints
 * leave the pose, since their driver sets them now.
 */
export function addDrive(doc: ModelDoc, params: DriveParams, id = newId("f"), at?: number): ModelDoc {
  const next = insert(doc, clampAt(doc, at), { id, type: "drive", name: nextNamed(doc, params.kind === "together" ? "Motion link" : "Drive"), ...params });
  const driven = [params.driven, ...(params.more ?? [])].filter((j) => next.pose?.[j] !== undefined);
  if (!driven.length) return next;
  const pose: Pose = { ...next.pose };
  for (const j of driven) delete pose[j];
  return { ...next, pose: Object.keys(pose).length ? pose : undefined };
}

/** Changes a drive link. */
export function updateDrive(doc: ModelDoc, id: string, change: Partial<DriveParams>): ModelDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === id && f.type === "drive" ? { ...f, ...change } : f)) };
}

/** A gear step as a drive reads it. */
function driveGear(g: GearFeature): DriveGear {
  return { teeth: g.gear.teeth, module: g.gear.module, form: g.form ?? "spur" };
}

const DRIVE_KIND_LABEL: Record<DriveKind, string> = { gear: "Gears", belt: "Belt", rack: "Rack", custom: "Custom", together: "Motion link" };

/** Changes a joint (its bar edits it live). Switching kind brings that kind's starting limits. */
export function updateJoint(doc: ModelDoc, id: string, change: Partial<JointParams>): ModelDoc {
  return {
    ...doc,
    features: doc.features.map((f) => {
      if (f.id !== id || f.type !== "joint") return f;
      const next = { ...f, ...change };
      if (change.kind && change.kind !== f.kind && change.lower === undefined && change.upper === undefined) Object.assign(next, JOINT_LIMITS[change.kind]);
      return next;
    }),
  };
}

export type ConstructParams = Pick<ConstructFeature, "kind" | "refs" | "value">;

/** Adds a construction plane, axis or point (#265), named "Plane 1", "Axis 1" or "Point 1". */
export function addConstruct(doc: ModelDoc, params: ConstructParams, id = newId("f"), at?: number): ModelDoc {
  const name = nextNamed(doc, CONSTRUCT_BASE[constructKind(params.kind).what]);
  return insert(doc, clampAt(doc, at), { id, type: "construct", name, ...params });
}

/** Changes a construction step's picks or value. A change of kind keeps the step's name. */
export function updateConstruct(doc: ModelDoc, id: string, change: Partial<ConstructParams>): ModelDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === id && f.type === "construct" ? { ...f, ...change } : f)) };
}
