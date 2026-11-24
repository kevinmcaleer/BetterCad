import { build, dependents, dependsOn, featureParts, insertedId, newId, type Feature, type ModelDoc, type ModelSource, type Vec3 } from "./document";
import { namesIn } from "./params";

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

/** Every string in a value (deep), for finding the blobs and parameters a set of steps uses. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** A copy of a value with every string that is a key of `map` swapped for its value (deep). */
function remap<T>(v: T, map: Map<string, string>): T {
  if (!map.size) return v;
  if (typeof v === "string") return (map.get(v) ?? v) as T;
  if (Array.isArray(v)) return v.map((x) => remap(x, map)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x, map)])) as T;
  return v;
}

/** Steps that tie components together, which stay in the assembly unless everything they tie goes with the component. */
const TIES = new Set<Feature["type"]>(["joint", "drive", "rigid"]);

export interface ExternalPlan {
  /** The component on its own, as a model to save: its steps, looks, parameters and files. Named after the component. */
  model: ModelDoc;
  /** This document with the component's steps swapped for one Insert model step of `model` from `source`. */
  link: (source: ModelSource) => ModelDoc;
  /** How many steps move into the new model. */
  steps: number;
}

/**
 * Make external (Fusion's): the steps that make a component (#171), and the components inside it, taken out as a model
 * of their own and put back as an inserted model (#482) with the same id, so its joints, drives and rigid groups still
 * hold. Its bodies come back as `<component>/<body>`, where they were. A string says why it can't be done: a step in
 * it reads a body outside it, or a step outside it needs a sketch or a component inside it.
 */
export function makeExternal(doc: ModelDoc, id: string): ExternalPlan | string {
  const link = doc.features.find((f) => f.id === id);
  if (!link || link.type !== "link") return "Only a component you made here can be made external";
  if (link.suppressed) return `Unsuppress ${link.name} first`;
  const before = build(doc);
  const inside = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of before.components) if (c.parent && inside.has(c.parent) && !inside.has(c.id)) grew = !!inside.add(c.id);
  }
  const finalLink = new Map(before.parts.map((p) => [p.id, p.link ?? null]));
  const bodies = new Set(before.parts.filter((p) => p.link && inside.has(p.link)).map((p) => p.id));
  if (!bodies.size) return `${link.name} has no bodies to save`;
  const moved = doc.owners ?? {};
  const ownerOf = (f: Feature) => (f.id in moved ? moved[f.id] : f.type === "link" ? f.parent : f.component) ?? null;
  const byId = new Map(doc.features.map((f) => [f.id, f]));
  const name = (fid: string) => byId.get(fid)?.name ?? "a step";
  const partName = (pid: string) => before.parts.find((p) => p.id === pid)?.name ?? doc.looks[pid]?.name ?? "a body";

  // The steps that go: made in it, its own components, and every step that makes or changes its bodies (deleted ones
  // too), with decals and sketches on them.
  const taken = new Set<string>();
  const touches = (f: Feature, ids: Set<string>) =>
    featureParts(f).some((p) => ids.has(p)) ||
    (f.type === "decal" && ids.has(f.part)) ||
    (f.type === "sketch" && f.sketch.plane.kind === "face" && ids.has(f.sketch.plane.face.body)) ||
    ((f.type === "delete" || f.type === "move" || f.type === "resize") && f.parts.some((p) => ids.has(p)));
  for (let grew = true; grew;) {
    grew = false;
    for (const f of doc.features) {
      if (f.id === id || taken.has(f.id) || TIES.has(f.type)) continue;
      const owner = ownerOf(f);
      if ((f.type === "link" && inside.has(f.id)) || (owner && inside.has(owner)) || touches(f, bodies)) {
        taken.add(f.id);
        grew = true;
        for (const p of f.type === "link" ? [] : featureParts(f)) bodies.add(p);
      }
    }
  }
  for (const pid of bodies) {
    const at = finalLink.get(pid);
    if (at === undefined || (at && inside.has(at))) continue;
    const by = doc.features.find((f) => taken.has(f.id) && featureParts(f).includes(pid));
    return `${by ? name(by.id) : "A step"} in ${link.name} also changes ${partName(pid)}, which isn't in it`;
  }
  // Sketches and construction its steps are built on go too; a body made outside it can't.
  for (let grew = true; grew;) {
    grew = false;
    for (const fid of [...taken]) {
      for (const d of dependsOn(doc, fid, true)) {
        if (taken.has(d) || d === id || inside.has(d)) continue;
        const g = byId.get(d)!;
        if (g.type === "sketch" || g.type === "construct") {
          taken.add(d);
          grew = true;
        } else return `${name(fid)} uses ${name(d)}, which isn't in ${link.name}`;
      }
    }
  }
  // Joints, drives and rigid groups go when everything they tie is inside (a joint on the component itself hangs from
  // the new model's base); the rest stay and keep tying the component.
  const nested = (l: string | null) => !!l && l !== id && inside.has(l);
  for (const f of doc.features) {
    if (f.type === "joint" && nested(f.child) && (f.parent === id || nested(f.parent))) taken.add(f.id);
    if (f.type === "rigid" && f.links.length && f.links.every(nested) && f.parts.every((p) => bodies.has(p))) taken.add(f.id);
  }
  for (const f of doc.features) if (f.type === "drive" && [f.driver, f.driven, ...(f.more ?? [])].every((j) => taken.has(j))) taken.add(f.id);

  // The new model: the steps in timeline order, out of the component (it is the model now).
  const steps = doc.features
    .filter((f) => taken.has(f.id))
    .map((f): Feature => {
      const g = { ...f } as Feature;
      if (g.type === "link") {
        if (g.parent === id) delete g.parent;
      } else if (g.component === id) delete g.component;
      if (g.type === "joint" && g.parent === id) g.parent = null;
      return g;
    });
  const keys = new Set([...bodies, ...taken]);
  const pick = <V>(r: Record<string, V> | undefined, keep: (k: string) => boolean) => (r ? Object.fromEntries(Object.entries(r).filter(([k]) => keep(k))) : {});
  const used = new Set(strings(steps));
  const blobs = pick(doc.blobs, (h) => used.has(h));
  const params = doc.params ?? [];
  const words = new Set(strings(steps).flatMap(namesIn));
  const wanted = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const p of params) {
      if (wanted.has(p.name) || !words.has(p.name)) continue;
      wanted.add(p.name);
      namesIn(p.expression).forEach((w) => words.add(w));
      grew = true;
    }
  }
  const owners: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(moved)) if (keys.has(k)) owners[k] = v === id ? null : v;
  const model: ModelDoc = {
    format: "bettercad",
    version: 2,
    name: link.name,
    features: steps,
    looks: pick(doc.looks, (k) => keys.has(k)),
    ...(Object.values(owners).some((v) => v) ? { owners: Object.fromEntries(Object.entries(owners).filter(([, v]) => v)) } : {}),
    ...(doc.order?.some((k) => bodies.has(k)) ? { order: doc.order.filter((k) => bodies.has(k)) } : {}),
    ...(wanted.size ? { params: params.filter((p) => wanted.has(p.name)) } : {}),
    ...(Object.keys(blobs).length ? { blobs } : {}),
    ...(doc.print ? { print: structuredClone(doc.print) } : {}),
  };

  // Whatever stays and names its bodies names them as they come in now.
  const ids = new Map([...bodies].map((b) => [b, insertedId(id, b)]));
  const at = doc.features.findIndex((f) => f.id === id || taken.has(f.id));
  const linked = (source: ModelSource): ModelDoc => {
    const rest = doc.features.filter((f) => f.id !== id && !taken.has(f.id));
    const kept = { ...structuredClone(model), name: source.name };
    for (const k of ["blobs", "print"] as const) delete kept[k];
    const step: Feature = {
      id,
      type: "model",
      name: link.name,
      source: { ...source },
      model: kept,
      position: { x: 0, y: 0, z: 0 },
      ...(link.component ? { component: link.component } : {}),
    };
    const features = remap(rest, ids);
    features.splice(Math.min(at, features.length), 0, step);
    const out: ModelDoc = { ...doc, features, looks: pick(doc.looks, (k) => !keys.has(k)) };
    if (doc.owners) out.owners = pick(doc.owners, (k) => !keys.has(k));
    if (doc.order) out.order = doc.order.map((k) => ids.get(k) ?? k);
    for (const k of ["drawings", "sections", "tools"] as const) if (doc[k]) (out as unknown as Record<string, unknown>)[k] = remap(doc[k], ids);
    return out;
  };

  // Check it: both builds must stand as before, so nothing is quietly lost.
  const trial = linked({ kind: "file", name: link.name });
  const after = build(trial);
  for (const [fid, why] of after.failed) {
    if (fid === id) return `${link.name} on its own doesn't build: ${why}`;
    if (!before.failed.has(fid)) return `${name(fid)} needs something inside ${link.name}, so it can't be made external`;
  }
  if (after.parts.length !== before.parts.length) return `${link.name} can't be made external without losing bodies`;
  return { model, link: linked, steps: steps.length };
}
