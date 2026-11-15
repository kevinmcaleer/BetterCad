import { newId, type ModelDoc, type ModelSource, type Vec3 } from "./document";

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
