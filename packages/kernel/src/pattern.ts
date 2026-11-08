import type { Part, PatternFeature, Vec3 } from "./document";

/**
 * Mirror and patterns (#69): copies that follow the original. A rectangular copy is the part moved, so a box stays a
 * box you can resize. A mirrored or turned copy is a new body made from the original as it stood (`Part.copy`), since a
 * mirror can't be written as a move and a turn about an axis away from the part would need its turns composed.
 */

export type WorldAxis = "x" | "y" | "z";
export type MirrorPlane = "XY" | "XZ" | "YZ";
export type PatternKind = "mirror" | "rect" | "circle";

/** How one copy is made from the original: moved, mirrored across a plane, or turned round an axis, in the world. */
export type CopyMove = { move: Vec3 } | { mirror: { origin: Vec3; normal: Vec3 } } | { turn: { origin: Vec3; axis: Vec3; deg: number } };

/** A body made from another (Mirror and circular patterns): `body` as it stood, transformed, then held at `at`. */
export interface CopySpec {
  body: Part;
  by: Exclude<CopyMove, { move: Vec3 }>;
  /** Where the copy's own coordinates start: its position when it was made, so a later move carries it. */
  at: Vec3;
}

/** More copies than this in one step is almost surely a typing slip, and would take minutes to build. */
export const PATTERN_LIMIT = 100;

export const PATTERN_DEFAULTS: Omit<PatternFeature, "id" | "name" | "type" | "parts" | "kind"> = {
  plane: "YZ",
  offset: 0,
  dir1: "x",
  count1: 3,
  spacing1: 20,
  dir2: "y",
  count2: 1,
  spacing2: 20,
  axis: "z",
  count: 6,
  angle: 360,
  join: false,
};

const AXIS: Record<WorldAxis, Vec3> = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };
const NORMAL: Record<MirrorPlane, WorldAxis> = { XY: "z", XZ: "y", YZ: "x" };

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const tidy = (v: Vec3): Vec3 => ({ x: tidyN(v.x), y: tidyN(v.y), z: tidyN(v.z) });
/** Rounds away float dust (1e-12) so a turned copy at 90° sits exactly where a person would type it. */
const tidyN = (n: number) => Math.round(n * 1e9) / 1e9 + 0;

/** Why the step can't be made as set, or null. */
export function patternProblem(f: PatternFeature): string | null {
  const whole = (n: number) => Number.isInteger(n) && n >= 1;
  if (!f.parts.length) return "Pick the bodies to copy";
  if (f.kind === "rect") {
    if (!whole(f.count1) || !whole(f.count2)) return "Counts are whole numbers, 1 or more";
    if (f.count1 * f.count2 < 2) return "Give it 2 or more copies in a direction";
    if (f.count1 > 1 && !(Math.abs(f.spacing1) > 1e-9)) return "Give it a spacing other than 0 mm";
    if (f.count2 > 1 && !(Math.abs(f.spacing2) > 1e-9)) return "Give it a spacing other than 0 mm";
    if (f.count2 > 1 && f.dir2 === f.dir1) return "Pick two different directions";
  }
  if (f.kind === "circle") {
    if (!whole(f.count) || f.count < 2) return "Give it a count of 2 or more";
    if (!(f.angle > 0 && f.angle <= 360)) return "Give it an angle from 1° to 360°";
  }
  if (copiesPer(f) * f.parts.length > PATTERN_LIMIT) return `That's more than ${PATTERN_LIMIT} copies. Use fewer.`;
  return null;
}

/** How many copies each original gets (the original is not counted). */
export function copiesPer(f: PatternFeature): number {
  if (f.kind === "mirror") return 1;
  if (f.kind === "rect") return Math.max(0, Math.floor(f.count1) * Math.floor(f.count2) - 1);
  return Math.max(0, Math.floor(f.count) - 1);
}

/** Each copy's move from the original, in order; the original itself is left out. */
export function patternMoves(f: PatternFeature): CopyMove[] {
  if (f.kind === "mirror") {
    const normal = AXIS[NORMAL[f.plane]];
    return [{ mirror: { origin: scale(normal, f.offset), normal } }];
  }
  if (f.kind === "rect") {
    const out: CopyMove[] = [];
    const n2 = Math.max(1, Math.floor(f.count2));
    for (let j = 0; j < n2; j++)
      for (let i = 0; i < Math.floor(f.count1); i++)
        if (i || j) out.push({ move: tidy(add(scale(AXIS[f.dir1], i * f.spacing1), scale(AXIS[f.dir2], j * f.spacing2))) });
    return out;
  }
  const n = Math.floor(f.count);
  // A full circle shares the turn out evenly; a part circle puts the last copy on the end of the angle.
  const step = f.angle >= 360 ? 360 / n : f.angle / (n - 1);
  return Array.from({ length: n - 1 }, (_, k) => ({ turn: { origin: { x: 0, y: 0, z: 0 }, axis: AXIS[f.axis], deg: (k + 1) * step } }));
}

/** Where a point goes under a copy's move. */
export function movePoint(p: Vec3, m: CopyMove): Vec3 {
  if ("move" in m) return tidy(add(p, m.move));
  if ("mirror" in m) {
    const { origin, normal } = m.mirror;
    return tidy(sub(p, scale(normal, 2 * dot(sub(p, origin), normal))));
  }
  const { origin, axis, deg } = m.turn;
  const v = sub(p, origin);
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  // Rodrigues: v cos + (k × v) sin + k (k · v)(1 − cos).
  return tidy(add(origin, add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)))));
}

/** The id of copy `k` of part `from`: fixed by the step, so changing the count keeps the others' ids (and looks). */
export const copyId = (f: { id: string }, from: string, k: number) => `${f.id}.${from}.${k}`;

/** The ids of the parts the step makes (none when the copies are joined to their originals). */
export function patternCopyIds(f: PatternFeature): string[] {
  if (f.join) return [];
  const n = copiesPer(f);
  return f.parts.flatMap((from) => Array.from({ length: n }, (_, k) => copyId(f, from, k)));
}

/** A copy's name: "Box 1 mirrored", "Box 1 copy 2". */
export const copyName = (f: PatternFeature, src: string, k: number) => (f.kind === "mirror" ? `${src} mirrored` : `${src} copy ${k + 1}`);

/** One copy of a part as it stands. */
export function copyPart(src: Part, m: CopyMove, id: string, name: string): Part {
  if ("move" in m) return { ...src, id, name, hidden: false, position: movePoint(src.position, m), size: { ...src.size } };
  const at = movePoint(src.position, m);
  return {
    id,
    name,
    kind: "solid",
    hidden: false,
    position: at,
    size: { ...src.size },
    copy: { body: { ...src, hidden: false }, by: m, at },
    ...(src.hole ? { hole: true } : {}),
    ...(src.fit ? { fit: src.fit } : {}),
    ...(src.gap !== undefined ? { gap: src.gap } : {}),
    ...(src.reference ? { reference: true } : {}),
  };
}

/** The step's summary on its tile: "Box 1, 3 × 2 at 20 mm". */
export function patternSummary(f: PatternFeature, who: string): string {
  const joined = f.join ? ", joined" : "";
  if (f.kind === "mirror") return `${who} across ${f.plane}${f.offset ? ` at ${f.offset} mm` : ""}${joined}`;
  if (f.kind === "rect") {
    const two = f.count2 > 1 ? ` × ${f.count2} along ${f.dir2.toUpperCase()} at ${f.spacing2} mm` : "";
    return `${who}, ${f.count1} along ${f.dir1.toUpperCase()} at ${f.spacing1} mm${two}${joined}`;
  }
  return `${who}, ${f.count} round ${f.axis.toUpperCase()}${f.angle < 360 ? ` over ${f.angle}°` : ""}${joined}`;
}
