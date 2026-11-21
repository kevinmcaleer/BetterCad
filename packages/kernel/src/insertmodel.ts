import { dependents, newId, type Feature, type ModelDoc, type ModelSource, type Vec3 } from "./document";

/*
 * Inserting one model into another (#482), apart from the document code so it loads with the Insert model picker
 * rather than at first paint. Building an inserted model is in document.ts (`build`).
 */

/**
 * Adds an Insert model step (#482): a copy of `model` brought in as one component, its origin at `place.position`.
 * Its imported files join this document's blobs; what only matters to its own view (cameras, canvases, sections,
 * poses) is left behind. Named after the model, made unique.
 */
export function insertModel(
  doc: ModelDoc,
  source: ModelSource,
  model: ModelDoc,
  place: { position: Vec3; rotation?: Vec3 },
  id = newId("f"),
  at?: number,
  component?: string,
): ModelDoc {
  const names = new Set(doc.features.map((f) => f.name));
  let name = source.name;
  for (let n = 2; names.has(name); n += 1) name = `${source.name} ${n}`;
  const kept = structuredClone(model);
  const blobs = { ...doc.blobs };
  for (const [hash, data] of Object.entries(kept.blobs ?? {})) if (data || !(hash in blobs)) blobs[hash] = data;
  for (const k of ["blobs", "views", "home", "sections", "section", "kevsrobots", "canvases", "tools", "poses", "pose", "print"] as const) delete kept[k];
  const turned = place.rotation && (place.rotation.x || place.rotation.y || place.rotation.z);
  const features = [...doc.features];
  features.splice(at === undefined ? features.length : Math.max(0, Math.min(at, features.length)), 0, {
    id,
    type: "model",
    name,
    source: { ...source },
    model: kept,
    position: { ...place.position },
    ...(turned ? { rotation: { ...place.rotation! } } : {}),
    ...(component ? { component } : {}),
  });
  return { ...doc, features, ...(Object.keys(blobs).length ? { blobs } : {}) };
}

/** Steps that only tie components together: they go with an inserted model, since they mean nothing without it. */
const ASSEMBLY = new Set<Feature["type"]>(["joint", "drive", "rigid"]);

/**
 * What removing an inserted model takes with it: the joints, drives and rigid groups that need it (`ties`), and any
 * other steps that use its bodies (`uses`), which are yours to keep or delete.
 */
export function modelRemoval(doc: ModelDoc, id: string): { ties: Feature[]; uses: Feature[] } {
  const deps = dependents(doc, id);
  return { ties: deps.filter((f) => ASSEMBLY.has(f.type)), uses: deps.filter((f) => !ASSEMBLY.has(f.type)) };
}

/**
 * Removes an inserted model (#480) as one change: its step, the joints, drives and rigid groups that need it, and,
 * with `all`, every other step that uses its bodies. Anything that was made inside it or moved into it now sits in
 * the component it was inserted into; its bodies' looks are dropped.
 */
export function removeInsertedModel(doc: ModelDoc, id: string, all = false): ModelDoc {
  const f = doc.features.find((x) => x.id === id);
  if (!f || f.type !== "model") return doc;
  const { ties, uses } = modelRemoval(doc, id);
  const gone = new Set([id, ...ties.map((x) => x.id), ...(all ? uses.map((x) => x.id) : [])]);
  const up = f.component;
  const inside = (k: string) => k.startsWith(`${id}/`);
  const features = doc.features
    .filter((x) => !gone.has(x.id))
    .map((x): Feature => {
      if (x.component !== id) return x;
      const moved = { ...x };
      if (up) moved.component = up;
      else delete moved.component;
      return moved;
    });
  const out: ModelDoc = { ...doc, features };
  if (doc.owners) {
    const owners: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(doc.owners)) if (!inside(k)) owners[k] = v === id ? (up ?? null) : v;
    out.owners = owners;
  }
  if (Object.keys(doc.looks).some(inside)) out.looks = Object.fromEntries(Object.entries(doc.looks).filter(([k]) => !inside(k)));
  if (doc.order?.some(inside)) out.order = doc.order.filter((k) => !inside(k));
  return out;
}
