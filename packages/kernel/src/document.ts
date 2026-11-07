/**
 * The model document (#45). The timeline is the document: an ordered list of features, replayed to get the parts.
 * It is plain JSON with no DOM, three.js or OCCT types, so the app, the kernel worker and Node tests share it. The
 * app's history store keeps immutable revisions of it for undo; the worker turns a revision into solids.
 */
import { newSketch, type PlaneRef, type Sketch } from "@bettercad/sketch";

export type PartKind = "box" | "cylinder" | "sphere";

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
export type Feature = AddFeature | DuplicateFeature | MoveFeature | ResizeFeature | DeleteFeature | SketchFeature;
export type FeatureType = Feature["type"];

/** How a part looks, and its name in the parts tree. Not part of the timeline, the way Fusion keeps visibility. */
export interface Look {
  name?: string;
  hidden?: boolean;
  ghost?: boolean;
  highlight?: boolean;
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

export const KIND_LABEL: Record<PartKind, string> = { box: "Box", cylinder: "Cylinder", sphere: "Sphere" };
export const FEATURE_LABEL: Record<FeatureType, string> = {
  add: "Add",
  duplicate: "Duplicate",
  move: "Move",
  resize: "Resize",
  delete: "Delete",
  sketch: "Sketch",
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
        const key = f.type === "move" ? "position" : "size";
        const change = f.type === "move" ? f.position : f.size;
        for (const id of f.parts) {
          const p = parts[find(id)];
          if (!p) continue;
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
        break;
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

/** The parts after the whole timeline. */
export const partsOf = (doc: ModelDoc, upTo?: number) => build(doc, upTo).parts;

/** Every name a part has had, so names stay unique even for parts deleted later on the timeline. */
function usedNames(doc: ModelDoc): Set<string> {
  const names = new Set<string>();
  for (const f of doc.features) {
    if (f.type === "add") names.add(f.part.name);
    if (f.type === "duplicate") f.copies.forEach((c) => names.add(c.name));
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
  const size = kind === "cylinder" ? { x: 20, y: 20, z: 30 } : { x: 20, y: 20, z: 20 };
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
