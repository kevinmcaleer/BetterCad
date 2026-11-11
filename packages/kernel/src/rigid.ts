import { build, newId, nextFeatureName, placePart, type ModelDoc, type MoveFeature, type RigidFeature, type Vec3 } from "./document";
import { mat4InvertRigid, mat4Mul, placeMatrix, placeOf } from "./pose";

/**
 * Rigid groups' edits, loaded when first used to keep them out of first paint. The build and `rigidMates` are in
 * document.ts.
 */

const ZERO = { x: 0, y: 0, z: 0 };
const clampAt = (doc: ModelDoc, at?: number) => (at === undefined ? doc.features.length : Math.max(0, Math.min(at, doc.features.length)));
const insert = (doc: ModelDoc, at: number, f: MoveFeature | RigidFeature): ModelDoc => {
  const features = [...doc.features];
  features.splice(at, 0, f);
  return { ...doc, features };
};

/**
 * Adds a Rigid group step: the components and loose bodies lock together where they stand. `ids` are bodies or
 * component ids; a body in a component brings its whole component, as Fusion's rigid groups hold components.
 */
export function addRigid(doc: ModelDoc, ids: string[], id = newId("f"), at?: number): ModelDoc {
  const i = clampAt(doc, at);
  const b = build(doc, i);
  const comps = new Set(b.components.map((c) => c.id));
  const links: string[] = [];
  const parts: string[] = [];
  for (const x of ids) {
    const to = comps.has(x) ? x : (b.parts.find((p) => p.id === x)?.link ?? null);
    if (to) {
      if (!links.includes(to)) links.push(to);
    } else if (b.parts.some((p) => p.id === x) && !parts.includes(x)) parts.push(x);
  }
  return insert(doc, i, { id, type: "rigid", name: nextFeatureName(doc, "rigid"), links, parts });
}

/**
 * Moves a body to a new place and the bodies locked to it (`mates`, from `rigidMates`) with it, as one Move step: the
 * same turn and shift that takes the body from where it is to `position` and `rotation`.
 */
export function placeRigid(doc: ModelDoc, id: string, position: Vec3, rotation: Vec3, mates: string[], at?: number): ModelDoc {
  const i = clampAt(doc, at);
  const here = build(doc, i).parts;
  const lead = here.find((p) => p.id === id);
  const ids = [...new Set([id, ...mates])].filter((x) => here.some((p) => p.id === x));
  if (!lead || ids.length < 2) return placePart(doc, id, position, rotation, at);
  const r0 = { ...ZERO, ...lead.rotation };
  const from = placeMatrix([lead.position.x, lead.position.y, lead.position.z], [r0.x, r0.y, r0.z]);
  const to = placeMatrix([position.x, position.y, position.z], [rotation.x, rotation.y, rotation.z]);
  const by = placeOf(mat4Mul(to, mat4InvertRigid(from)));
  const still = (v: number[]) => v.every((n) => Math.abs(n) < 1e-9);
  if (still(by.position) && still(by.rotation)) return doc;
  const [x, y, z] = by.position;
  const [rx, ry, rz] = by.rotation;
  const f: MoveFeature = { id: newId("f"), type: "move", name: nextFeatureName(doc, "move"), parts: ids, position: { x, y, z }, together: true };
  if (!still(by.rotation)) f.rotation = { x: rx, y: ry, z: rz };
  return insert(doc, i, f);
}
