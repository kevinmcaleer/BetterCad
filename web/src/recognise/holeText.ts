import type { FoundHole, HoleGroup, Recognition } from "@bettercad/kernel/recognise";

const mm = (v: number) => `${Math.round(v * 100) / 100} mm`;

const headText = (h: FoundHole["head"]) => (h ? `, ${h.kind} ${mm(h.diameter)}` : "");
const depthText = (d: number | null) => (d === null ? "through" : `${mm(d)} deep`);

/** A run of like holes in a few words: "4 × 3.4 mm holes, through, M3 clearance". */
export function groupText(g: HoleGroup): string {
  const n = g.points.length;
  return `${n > 1 ? `${n} × ` : ""}${mm(g.diameter)} ${n > 1 ? "holes" : "hole"}, ${depthText(g.depth)}${headText(g.head)}${g.match ? `, ${g.match}` : ""}`;
}

/** A hole that stays as it is in the mesh, and why. */
export function leftText(h: FoundHole): string {
  return `${mm(h.diameter)} hole, ${depthText(h.depth)}${h.note ? `: ${h.note}` : ""}`;
}

/** What was recognised, for the foot of the list. */
export function summaryText(r: Recognition): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return `${count(r.planes, "flat face", "flat faces")} and ${count(r.faces.length, "round face", "round faces")} recognised, ${Math.round(r.coverage * 100)}% of the surface.`;
}

/** Under this share of the surface recognised, the mesh is sculpted rather than machined. */
export const SCULPTED = 1 / 3;
/** From this many triangles, say that looking may take a while. */
export const BIG_MESH = 200_000;
