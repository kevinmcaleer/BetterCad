import type { BuiltLink } from "../state/document";

type JointEnds = { child: string; parent: string | null };
type Box = { min: readonly number[] } | null;

/**
 * The component at the top of a joint chain: up the joints from `link` until one hangs from Base (null) or from
 * nothing. A loop stops where it started.
 */
export function assemblyRoot(joints: readonly JointEnds[], link: string | null): string | null {
  const seen = new Set<string>();
  let at = link;
  while (at !== null && !seen.has(at)) {
    seen.add(at);
    const up = joints.find((j) => j.child === at);
    if (!up) return at;
    at = up.parent;
  }
  return at;
}

/** A component and everything that hangs from it: down the joints, and into the components nested in those. */
export function assemblyLinks(joints: readonly JointEnds[], links: readonly BuiltLink[], root: string): Set<string> {
  const out = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const j of joints) if (j.parent !== null && out.has(j.parent) && !out.has(j.child)) grew = !!out.add(j.child);
    for (const l of links) if (l.parent && out.has(l.parent) && !out.has(l.id)) grew = !!out.add(l.id);
  }
  return out;
}

/** Below this, in mm, a part counts as on the floor: an STL's rounding never sets the note off. */
const SLACK = 0.05;

/** How far under the floor (Z = 0) the lowest box goes, in mm; 0 when they all sit on or above it. */
export function underFloor(boxes: readonly Box[]): number {
  let low = Infinity;
  for (const b of boxes) if (b && b.min[2]! < low) low = b.min[2]!;
  return low < -SLACK ? -low : 0;
}
