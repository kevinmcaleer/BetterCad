import { mat4Mul, placeMatrix, placeOf, type Mat4, type Part } from "../state/document";

/** A body placed where it is shown: its own place carried by its component's pose. Loaded with the arrow and axis picks. */
export function shownPart(p: Part, moves?: Map<string, Mat4>): Part {
  const m = moves?.get(p.id);
  if (!m) return p;
  const r = p.rotation ?? { x: 0, y: 0, z: 0 };
  const at = placeOf(mat4Mul(m, placeMatrix([p.position.x, p.position.y, p.position.z], [r.x, r.y, r.z])));
  return {
    ...p,
    position: { x: at.position[0], y: at.position[1], z: at.position[2] },
    rotation: { x: at.rotation[0], y: at.rotation[1], z: at.rotation[2] },
  };
}
