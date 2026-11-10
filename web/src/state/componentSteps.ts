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
