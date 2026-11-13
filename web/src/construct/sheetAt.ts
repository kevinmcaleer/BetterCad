import { Raycaster, Vector3 } from "three";
import type { Engine } from "../viewport/engine";

type V3 = [number, number, number];

/**
 * The plane a tool can take under a point: a construction plane or a shown origin plane (`origin:XY`). `distance` is
 * how far along the pointer's ray it is, so the tool can tell it from a face in front of or behind it; `border` says
 * the pointer is within 6 px of its outline, which picks it even through a body. Loaded with the Construct tool's
 * first plane pick.
 */
export function sheetAt(eng: Engine, x: number, y: number): { id: string; distance: number; border: boolean } | null {
  const sheets = eng.planeSheets();
  let best: { id: string; px: number } | null = null;
  for (const s of sheets) {
    const pos = s.mesh.geometry.getAttribute("position");
    const c = s.outline.map((i) => eng.project(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(s.mesh.matrixWorld).toArray() as V3));
    for (let i = 1; i < c.length; i++) {
      const [a, b] = [c[i - 1]!, c[i]!];
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const px = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
      if (px <= 6 && (!best || px < best.px)) best = { id: s.id, px };
    }
  }
  if (best) return { id: best.id, distance: 0, border: true };
  const r = eng.ray(x, y);
  const hit = new Raycaster(new Vector3(...r.origin), new Vector3(...r.dir)).intersectObjects(
    sheets.map((s) => s.mesh),
    false,
  )[0];
  return hit ? { id: sheets.find((s) => s.mesh === hit.object)!.id, distance: hit.distance, border: false } : null;
}

/**
 * A construction plane (not an origin one) under a point that should win over the model there: by its border, or
 * where it is nearer than the surface under the pointer. Mirror's Face pick uses it.
 */
export function planeInFront(eng: Engine, x: number, y: number): string | null {
  const s = sheetAt(eng, x, y);
  if (!s || s.id.startsWith("origin:")) return null;
  if (s.border) return s.id;
  const at = eng.surfaceAt(x, y);
  const r = eng.ray(x, y);
  return !at || Math.hypot(at.point[0] - r.origin[0], at.point[1] - r.origin[1], at.point[2] - r.origin[2]) > s.distance ? s.id : null;
}
