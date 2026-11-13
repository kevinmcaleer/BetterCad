import { build, featureParts, type ModelDoc } from "./document";

/**
 * The steps that belong to a component and the ones inside it, in timeline order, for the timeline to show only those
 * when the component is active: its own step and nested ones, steps made while it was active (or moved into it in the
 * browser), steps that make or change its bodies, joints that move it, and the sketches its extrudes and revolves use.
 * Bodies are where they are with every step built, so a rolled-back timeline keeps the same steps.
 */
export function componentSteps(doc: ModelDoc, component: string): string[] {
  const { parts, components } = build(doc);
  const inside = new Set([component]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of components) if (c.parent && inside.has(c.parent) && !inside.has(c.id)) grew = !!inside.add(c.id);
  }
  const bodies = new Set(parts.filter((p) => p.link && inside.has(p.link)).map((p) => p.id));
  const moved = doc.owners ?? {};
  const out = new Set<string>();
  for (const f of doc.features) {
    const owner = (f.id in moved ? moved[f.id] : f.type === "link" ? f.parent : f.component) ?? null;
    if (inside.has(f.id) || (owner && inside.has(owner)) || featureParts(f).some((id) => bodies.has(id)) || (f.type === "joint" && inside.has(f.child)))
      out.add(f.id);
  }
  for (const f of doc.features) if ((f.type === "extrude" || f.type === "revolve") && out.has(f.id)) out.add(f.sketch);
  return doc.features.filter((f) => out.has(f.id)).map((f) => f.id);
}

/**
 * The steps that make or change any of these bodies, in timeline order, for the timeline to mark when you pick a body
 * (as Fusion does): the step that made it, every step that changes it, decals on it, sketches on its faces, and the
 * sketches its extrudes and revolves use.
 */
export function bodySteps(doc: ModelDoc, bodies: readonly string[]): string[] {
  const want = new Set(bodies);
  if (!want.size) return [];
  const out = new Set<string>();
  for (const f of doc.features) {
    if (
      featureParts(f).some((id) => want.has(id)) ||
      (f.type === "decal" && want.has(f.part)) ||
      (f.type === "sketch" && f.sketch.plane.kind === "face" && want.has(f.sketch.plane.face.body))
    )
      out.add(f.id);
  }
  for (const f of doc.features) if ((f.type === "extrude" || f.type === "revolve") && out.has(f.id)) out.add(f.sketch);
  return doc.features.filter((f) => out.has(f.id)).map((f) => f.id);
}

/**
 * Which component each step belongs to, for the timeline's colour bars (Fusion's component colours): the innermost
 * component it was made in or moved into, the component a Component step makes, or else the component of the bodies it
 * makes or changes. Sketches go with the extrude or revolve that uses them. Steps of the model itself are left out.
 * `cycle` is the colour cycle's keys in its order (each body's component, or the body when it has none), then any
 * component with no bodies, so a component's place in it gives the same colour the view's colour cycle does.
 */
export function stepComponents(doc: ModelDoc): { of: Map<string, string>; cycle: string[]; names: Map<string, string> } {
  const { parts, components } = build(doc);
  const known = new Set(components.map((c) => c.id));
  const linkOf = new Map(parts.map((p) => [p.id, p.link ?? null]));
  const moved = doc.owners ?? {};
  const of = new Map<string, string>();
  for (const f of doc.features) {
    const owner = f.type === "link" ? f.id : ((f.id in moved ? moved[f.id] : f.component) ?? null);
    const comp =
      owner ??
      (f.type === "decal" ? linkOf.get(f.part) : f.type === "sketch" && f.sketch.plane.kind === "face" ? linkOf.get(f.sketch.plane.face.body) : null) ??
      featureParts(f)
        .map((id) => linkOf.get(id))
        .find((c) => c) ??
      null;
    if (comp && known.has(comp)) of.set(f.id, comp);
  }
  for (const f of doc.features) {
    if ((f.type === "extrude" || f.type === "revolve") && of.has(f.id) && !of.has(f.sketch)) of.set(f.sketch, of.get(f.id)!);
  }
  const keys = new Set(parts.map((p) => p.link ?? p.id));
  for (const c of components) keys.add(c.id);
  return { of, cycle: [...keys], names: new Map(components.map((c) => [c.id, c.name])) };
}
