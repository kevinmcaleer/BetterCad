/**
 * The robot parts catalogue (#167, #186): bought parts a robot is built round (servos, motors, boards, sensors,
 * bearings, cells), each as a simple model to design against and the room to cut for it.
 *
 * Millimetres and grams. Each part has its own origin: z = 0 is the surface it sits on or is screwed to, x and y are
 * centred on its footprint, and anything below z = 0 goes into the pocket cut for it. Pockets are the part's nominal
 * size; a fit's gap (#183) is added when the pocket is cut.
 */
import { validate, type Schema } from "../bcad";
import { screw } from "../screws";
import schemaJson from "./part.schema.json";

export type CatalogueCategory = "servo" | "motor" | "board" | "sensor" | "bearing" | "power";
type V2 = [number, number];
type V3 = [number, number, number];

/** One block of a part's model. A box's `at` is the centre of its bottom face; a cylinder's is the centre of its first end. */
export interface CatalogueShape {
  kind: "box" | "cylinder";
  /** Width, depth and height before turning; a cylinder is [diameter, diameter, length]. */
  size: V3;
  at: V3;
  /** Which way the shape's height runs. Z when missing. */
  axis?: "x" | "y" | "z";
  /** Taken away from the blocks before it (a bearing's bore) rather than added. */
  cut?: boolean;
}

/** One outline of the pocket, on the surface, centred on `at`. A circle's size is [diameter, diameter]. */
export interface PocketShape {
  kind: "rect" | "circle";
  at: V2;
  size: V2;
}

export interface Cutout {
  /** What to cut away so the part drops in, `depth` deep. Empty when the part sits on the surface. */
  pocket: PocketShape[];
  depth: number;
  /** Screw holes, by the screw table's size (#70). */
  holes: { at: V2; screw: string }[];
}

export interface CataloguePart {
  /** Stable, lower case: "sg90". */
  id: string;
  /** Goes up when the model or cutout changes, so a design can tell its copy is old. */
  version: number;
  name: string;
  category: CatalogueCategory;
  description: string;
  model: CatalogueShape[];
  cutout: Cutout;
  /** Where it drives from: a servo's or motor's output shaft, a bearing's centre. For joints (#164). */
  mount?: { origin: V3; axis: V3 };
  /** Grams, for mass estimates (#164). */
  mass: number;
  /** Where the sizes come from. */
  source: string;
  /** Whether the outline and mounting holes have been checked against the maker's drawing or a standard. */
  checked: boolean;
  licence: "MIT";
  buy?: string;
}

export const CATALOGUE_CATEGORIES: { id: CatalogueCategory; label: string }[] = [
  { id: "servo", label: "Servos" },
  { id: "motor", label: "Motors" },
  { id: "board", label: "Boards" },
  { id: "sensor", label: "Sensors" },
  { id: "bearing", label: "Bearings" },
  { id: "power", label: "Power" },
];

// The parts themselves, cataloguePart and HOLE_PATTERNS are in list.ts (`@bettercad/kernel/catalogue`), so that the
// document, which needs only the helpers here, does not bring the whole list into the app's first paint (#320).

/** A shape's box as [min, max]. */
export function shapeBounds(s: CatalogueShape): [V3, V3] {
  const [w, d, h] = s.size;
  const [x, y, z] = s.at;
  if (s.axis === "x")
    return [
      [x, y - d / 2, z - w / 2],
      [x + h, y + d / 2, z + w / 2],
    ];
  if (s.axis === "y")
    return [
      [x - w / 2, y, z - d / 2],
      [x + w / 2, y + h, z + d / 2],
    ];
  return [
    [x - w / 2, y - d / 2, z],
    [x + w / 2, y + d / 2, z + h],
  ];
}

/** The part's box, from the blocks it adds. */
export function partBounds(p: CataloguePart): [V3, V3] {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of p.model) {
    if (s.cut) continue;
    const [a, b] = shapeBounds(s);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, a[i]!);
      max[i] = Math.max(max[i]!, b[i]!);
    }
  }
  return [min, max];
}

const EPS = 1e-6;

/** Whether a block's plan lies inside a pocket outline: its box, or its circle for an upright cylinder. */
function inside(s: CatalogueShape, o: PocketShape): boolean {
  const [lo, hi] = shapeBounds(s);
  const [cx, cy] = o.at;
  if (o.kind === "circle" && s.kind === "cylinder" && (s.axis ?? "z") === "z")
    return Math.hypot(s.at[0] - cx, s.at[1] - cy) + s.size[0] / 2 <= o.size[0] / 2 + EPS;
  if (o.kind === "rect") {
    const [w, h] = o.size;
    return lo[0] >= cx - w / 2 - EPS && hi[0] <= cx + w / 2 + EPS && lo[1] >= cy - h / 2 - EPS && hi[1] <= cy + h / 2 + EPS;
  }
  const r = o.size[0] / 2;
  return [lo[0], hi[0]].every((x) => [lo[1], hi[1]].every((y) => Math.hypot(x - cx, y - cy) <= r + EPS));
}

/**
 * The first thing wrong with a part, or null. Beyond the schema: sizes are positive, circles are round, screws are
 * in the screw table, and everything below the surface fits inside the pocket and its depth.
 */
export function checkPart(p: unknown): string | null {
  const problem = validate(schemaJson as Schema, p, "");
  if (problem) return problem;
  const part = p as CataloguePart;
  const where = part.id;
  const triple = (v: unknown) => Array.isArray(v) && v.length === 3;
  const pair = (v: unknown) => Array.isArray(v) && v.length === 2;
  if (!part.model.some((s) => !s.cut)) return `${where} has no model`;
  for (const s of part.model) {
    if (!triple(s.size) || !triple(s.at)) return `${where} has a block without three sizes and a place`;
    if (s.size.some((v) => v <= 0)) return `${where} has a block with no size`;
    if (s.kind === "cylinder" && Math.abs(s.size[0] - s.size[1]) > EPS) return `${where} has a cylinder that isn't round`;
  }
  for (const o of part.cutout.pocket) {
    if (!pair(o.at) || !pair(o.size) || o.size.some((v) => v <= 0)) return `${where} has a pocket without a size and a place`;
    if (o.kind === "circle" && Math.abs(o.size[0] - o.size[1]) > EPS) return `${where} has a pocket circle that isn't round`;
  }
  for (const h of part.cutout.holes) {
    if (!pair(h.at)) return `${where} has a hole without a place`;
    if (!screw(h.screw)) return `${where} uses a screw the screw table doesn't have: ${h.screw}`;
  }
  if (part.mount && (!triple(part.mount.origin) || !triple(part.mount.axis))) return `${where} has a mount without a point and a direction`;
  // Everything below the surface must drop into the pocket.
  for (const s of part.model) {
    if (s.cut) continue;
    const [a] = shapeBounds(s);
    if (a[2] >= -EPS) continue;
    if (-a[2] > part.cutout.depth + EPS) return `${where} goes deeper than its pocket`;
    if (!part.cutout.pocket.some((o) => inside(s, o))) return `${where} has a block below the surface outside its pocket`;
  }
  if (part.cutout.pocket.length && part.cutout.depth <= 0) return `${where} has a pocket with no depth`;
  return null;
}

type Vec3 = { x: number; y: number; z: number };
const DEG = 180 / Math.PI;

/**
 * Where a part stands when placed on a face (#187): its origin at `point`, its z along the face's outward `normal`
 * and its x along `x` (a direction in the face), turned a further `quarters` × 90° about the normal. Returns the
 * position and the turn in degrees about X, Y and Z (applied X, then Y, then Z), the way parts are placed.
 */
export function placeOnFace(point: V3, normal: V3, x: V3, quarters = 0): { position: Vec3; rotation: Vec3 } {
  const unit = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const z = unit(normal);
  // x made square to z, falling back to any direction in the face.
  const d = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
  let ex: V3 = [x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]];
  if (Math.hypot(...ex) < 1e-9) ex = Math.abs(z[0]) < 0.9 ? cross([0, 1, 0], z) : cross(z, [0, 0, 1]);
  ex = unit(ex);
  let ey = cross(z, ex);
  const q = (((Math.round(quarters) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  for (let i = 0; i < q; i++) [ex, ey] = [ey, ex.map((v) => -v) as V3];
  // The matrix R = Rz · Ry · Rx with columns ex, ey, z.
  const r20 = ex[2];
  let rx: number, ry: number, rz: number;
  if (Math.abs(r20) < 1 - 1e-9) {
    ry = Math.asin(-r20);
    rx = Math.atan2(ey[2], z[2]);
    rz = Math.atan2(ex[1], ex[0]);
  } else {
    // Looking straight along y: only the sum of the X and Z turns matters.
    ry = r20 < 0 ? Math.PI / 2 : -Math.PI / 2;
    rx = 0;
    rz = Math.atan2(-ey[0], ey[1]);
  }
  const deg = (a: number) => Math.round(a * DEG * 1e6) / 1e6 + 0;
  return { position: { x: point[0], y: point[1], z: point[2] }, rotation: { x: deg(rx), y: deg(ry), z: deg(rz) } };
}

/** Turns a vector about X, then Y, then Z, by degrees: the way parts are placed. */
function turnVec(v: V3, r: Vec3): V3 {
  const rad = Math.PI / 180;
  let [x, y, z] = v;
  const [cx, sx] = [Math.cos(r.x * rad), Math.sin(r.x * rad)];
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const [cy, sy] = [Math.cos(r.y * rad), Math.sin(r.y * rad)];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const [cz, sz] = [Math.cos(r.z * rad), Math.sin(r.z * rad)];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  const tidy = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);
  return [tidy(x), tidy(y), tidy(z)];
}

/** A placed part's own frame in the world (#188): origin on its surface, x along its x, normal along its z. */
export function partFrame(position: Vec3, rotation?: Vec3): { origin: V3; x: V3; normal: V3 } {
  const r = rotation ?? { x: 0, y: 0, z: 0 };
  return { origin: [position.x, position.y, position.z], x: turnVec([1, 0, 0], r), normal: turnVec([0, 0, 1], r) };
}

export interface HolePattern {
  id: string;
  label: string;
  /** The screw the part uses. */
  screw: string;
  /** Hole centres about the pattern's middle, mm. */
  points: V2[];
}

export const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/** Four holes on the corners of a rectangle, about its middle. */
export const rectPattern = (w: number, h: number): V2[] => [
  [tidy(-w / 2), tidy(-h / 2)],
  [tidy(w / 2), tidy(-h / 2)],
  [tidy(w / 2), tidy(h / 2)],
  [tidy(-w / 2), tidy(h / 2)],
];

/** `n` holes evenly round a circle of diameter `d`, the first on +x. */
export const circlePattern = (n: number, d: number): V2[] =>
  Array.from({ length: Math.max(1, Math.round(n)) }, (_, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, Math.round(n));
    return [tidy((d / 2) * Math.cos(a)), tidy((d / 2) * Math.sin(a))] as V2;
  });
