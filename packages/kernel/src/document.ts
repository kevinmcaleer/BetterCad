/**
 * The model document (#45). The timeline is the document: an ordered list of features, replayed to get the parts.
 * It is plain JSON with no DOM, three.js or OCCT types, so the app, the kernel worker and Node tests share it. The
 * app's history store keeps immutable revisions of it for undo; the worker turns a revision into solids.
 */
import { newSketch, planeFrame, type Frame, type PlaneRef, type Sketch, type Vec2 } from "@bettercad/sketch";
import { resolveHole, holeLabel, type HoleParams, type HoleSpec } from "./holes";
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
export * from "./holes";
export * from "./screws";

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
}

export interface AddFeature extends FeatureBase {
  type: "add";
  part: { id: string; name: string; kind: PartKind; position: Vec3; size: Vec3 };
}
export interface DuplicateFeature extends FeatureBase {
  type: "duplicate";
  copies: { from: string; id: string; name: string }[];
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
}
/**
 * Combine (#66): bodies joined to, cut from or intersected with a target. A Group is the Tinkercad way: solids
 * joined and holes cut in one step, the originals put away until it is undone or deleted (Ungroup).
 */
export interface CombineFeature extends FeatureBase {
  type: "combine";
  mode: "combine" | "group";
  target: string;
  /** Each tool body and what it does, in order. */
  tools: { id: string; op: "join" | "cut" | "intersect" }[];
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
export type Feature =
  | AddFeature
  | DuplicateFeature
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
  for (const f of doc.features.slice(0, upTo)) {
    if (f.suppressed) continue;
    switch (f.type) {
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
        t.ops = [...(t.ops ?? []), { op: f.operation, tool, feature: f.id }];
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
          ops.push({
            op: x.op,
            body: { ...b, hole: undefined },
            at: { position: { ...t.position }, rotation: t.rotation && { ...t.rotation } },
            feature: f.id,
          });
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
    if (f.type === "add") names.add(f.part.name);
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
      return [f.part];
    case "revolve":
      return f.operation === "new" ? [f.body.id] : f.target ? [f.target] : [];
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
    if (g.type === "add") names.set(g.part.id, g.part.name);
    if (g.type === "duplicate") g.copies.forEach((c) => names.set(c.id, c.name));
    if ((g.type === "extrude" || g.type === "revolve") && g.operation === "new") names.set(g.body.id, g.body.name);
  }
  for (const [id, l] of Object.entries(doc.looks)) if (l.name) names.set(id, l.name);
  const who = (ids: string[]) => (ids.length === 1 ? (names.get(ids[0]!) ?? "1 part") : `${ids.length} parts`);
  switch (f.type) {
    case "add": {
      const s = f.part.size;
      return `${KIND_LABEL[f.part.kind]}, ${s.x} × ${s.y} × ${s.z} mm`;
    }
    case "duplicate":
      return `Copies ${who(f.copies.map((c) => c.from))}`;
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
export function groupParams(parts: Part[], ids: string[]): CombineParams | string {
  const picked = parts.filter((p) => ids.includes(p.id));
  if (picked.length < 2) return "Select two or more bodies to group them";
  const solids = picked.filter((p) => !p.hole);
  if (!solids.length) return "Pick at least one solid to cut the holes from";
  const [target, ...rest] = solids;
  const holes = picked.filter((p) => p.hole);
  return {
    mode: "group",
    target: target!.id,
    tools: [...rest.map((p) => ({ id: p.id, op: "join" as const })), ...holes.map((p) => ({ id: p.id, op: "cut" as const }))],
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

/** Parses a saved file, throwing a one-line message when it is not a BetterCad model. */
export function parseDoc(text: string): ModelDoc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not a BetterCad model.");
  }
  const d = data as Record<string, unknown> | null;
  if (d?.format !== "bettercad" || typeof d.name !== "string") throw new Error("That file is not a BetterCad model.");
  if (d.version === 1 && Array.isArray(d.parts)) return migrateV1(d as unknown as { name: string; parts: Part[] });
  if (d.version === 2 && Array.isArray(d.features)) {
    const looks = d.looks && typeof d.looks === "object" ? (d.looks as Record<string, Look>) : {};
    const order = Array.isArray(d.order) ? (d.order as string[]) : undefined;
    const views = Array.isArray(d.views) ? (d.views as NamedView[]) : undefined;
    return {
      format: "bettercad",
      version: 2,
      name: d.name,
      features: d.features as Feature[],
      looks,
      ...(order ? { order } : {}),
      ...(views ? { views } : {}),
    };
  }
  throw new Error("That file is not a BetterCad model.");
}

export type HoleStepParams = Pick<HoleFeature, "part" | "frame" | "points" | "size" | "fit" | "diameter" | "head" | "depth">;

/** Adds a Hole step at `at` (the marker), or at the end. */
export function addHole(doc: ModelDoc, params: HoleStepParams, id = newId("f"), at?: number): ModelDoc {
  return insert(doc, at, { id, type: "hole", name: nextFeatureName(doc, "hole"), ...params });
}

/** Changes a Hole step (the tool edits it live, as one undo step). */
export function updateHole(doc: ModelDoc, id: string, change: Partial<HoleStepParams>): ModelDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === id && f.type === "hole" ? { ...f, ...change } : f)) };
}
