/**
 * The bodies outside the active component (and the components inside it), which fade as Fusion's do so you can see
 * where new steps go. None while the whole model is active.
 */
export function fadedOutside(
  active: string | null,
  components: { id: string; parent?: string }[],
  parts: { id: string; link?: string }[],
): Set<string> | undefined {
  if (!active) return undefined;
  const inside = new Set([active]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of components) if (c.parent && inside.has(c.parent) && !inside.has(c.id)) grew = !!inside.add(c.id);
  }
  return new Set(parts.filter((p) => !p.link || !inside.has(p.link)).map((p) => p.id));
}
