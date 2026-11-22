/**
 * The camera as plain numbers, so it can be saved (named views), tweened and tested without WebGL.
 *
 * Z is up. The camera turns round `target` like a turntable: `azimuth` round the Z axis, `elevation` above the XY
 * plane, both in degrees. It looks from target + distance × dir(azimuth, elevation). The orthographic camera shows
 * the same height of the world as the perspective one does at the target, so switching keeps the scale.
 */
export type V3 = [number, number, number];

export interface CameraState {
  target: V3;
  azimuth: number;
  elevation: number;
  distance: number;
  ortho: boolean;
  /**
   * Degrees the view is rolled about the line of sight (the view cube's turn arrows). Positive turns the picture
   * clockwise on screen. Missing means 0.
   */
  roll?: number;
}

export type Preset = "iso" | "front" | "side" | "top" | "back" | "left" | "bottom";

/** Fusion's views, Z up: Front looks along +Y (from −Y), Side (right) along −X, Top down −Z with +Y up the screen. */
export const PRESETS: Record<Preset, { azimuth: number; elevation: number }> = {
  iso: { azimuth: -45, elevation: 35.264 },
  front: { azimuth: -90, elevation: 0 },
  back: { azimuth: 90, elevation: 0 },
  side: { azimuth: 0, elevation: 0 },
  left: { azimuth: 180, elevation: 0 },
  top: { azimuth: -90, elevation: 90 },
  bottom: { azimuth: -90, elevation: -90 },
};

export const FOV = 35;
export const MIN_DISTANCE = 1;
export const MAX_DISTANCE = 200_000;
const RAD = Math.PI / 180;

export const DEFAULT_CAMERA: CameraState = { target: [0, 0, 10], ...PRESETS.iso, distance: 260, ortho: false };

/** The unit vector from the target towards the camera. */
export function viewDir(azimuth: number, elevation: number): V3 {
  const a = azimuth * RAD;
  const e = elevation * RAD;
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
}

/** The camera's up: Z when level, turning smoothly towards the screen's top when looking straight down or up. */
export function viewUp(azimuth: number, elevation: number): V3 {
  const a = azimuth * RAD;
  const e = elevation * RAD;
  return [-Math.sin(e) * Math.cos(a), -Math.sin(e) * Math.sin(a), Math.cos(e)];
}

export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The camera's right and up after rolling the picture `roll` degrees clockwise on screen. */
function rolled(right: V3, up: V3, roll = 0): { right: V3; up: V3 } {
  if (!roll) return { right, up };
  const cs = Math.cos(roll * RAD);
  const sn = Math.sin(roll * RAD);
  return { right: add(right.map((v) => v * cs) as V3, up, sn), up: add(up.map((v) => v * cs) as V3, right, -sn) };
}

/** The camera's position, and its right / up / back axes in world space. */
export function cameraBasis(c: CameraState) {
  const back = viewDir(c.azimuth, c.elevation);
  const { right, up } = rolled(cross(viewUp(c.azimuth, c.elevation), back), viewUp(c.azimuth, c.elevation), c.roll);
  return { position: add(c.target, back, c.distance), right, up, back };
}

/** The turn that looks straight at a plane with this normal. Looking straight down or up keeps +Y up the screen, as the Top view does. */
export function facing(normal: V3): { azimuth: number; elevation: number } {
  const l = Math.hypot(...normal) || 1;
  const [x, y, z] = [normal[0] / l, normal[1] / l, normal[2] / l];
  const elevation = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
  const azimuth = Math.abs(Math.abs(elevation) - 90) < 1e-6 ? -90 : (Math.atan2(y, x) * 180) / Math.PI;
  return { azimuth, elevation };
}

/** World → camera rotation, row-major 3×3 (rows: right, up, back). The view cube turns by this. */
export function viewRotation(c: Pick<CameraState, "azimuth" | "elevation" | "roll">): number[] {
  const back = viewDir(c.azimuth, c.elevation);
  const { right, up } = rolled(cross(viewUp(c.azimuth, c.elevation), back), viewUp(c.azimuth, c.elevation), c.roll);
  return [...right, ...up, ...back];
}

/** Half the height of world the view shows at the target, in mm. */
export const halfHeight = (c: Pick<CameraState, "distance">) => c.distance * Math.tan((FOV / 2) * RAD);

export const clampDistance = (d: number) => Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, d));
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * Turntable orbit: dx, dy in degrees. Elevation stops at straight up and straight down. On a rolled view the turn is
 * taken as a drag on the rolled screen, so the model still follows the pointer.
 */
export function orbit(c: CameraState, dAzimuth: number, dElevation: number): CameraState {
  if (c.roll) {
    const cs = Math.cos(c.roll * RAD);
    const sn = Math.sin(c.roll * RAD);
    [dAzimuth, dElevation] = [dAzimuth * cs - dElevation * sn, dAzimuth * sn + dElevation * cs];
  }
  return { ...c, azimuth: wrap(c.azimuth + dAzimuth), elevation: Math.max(-90, Math.min(90, c.elevation + dElevation)) };
}

/** Pans by a screen offset in pixels, for a viewport `height` pixels tall: the point under the cursor follows it. */
export function pan(c: CameraState, dxPx: number, dyPx: number, heightPx: number): CameraState {
  const mmPerPx = (2 * halfHeight(c)) / Math.max(1, heightPx);
  const { right, up } = cameraBasis(c);
  return { ...c, target: add(add(c.target, right, -dxPx * mmPerPx), up, dyPx * mmPerPx) };
}

/**
 * Zooms by `factor` (< 1 closer) towards a point given in normalised screen coordinates (−1…1, y up), keeping the
 * point under the cursor where it is.
 */
export function zoom(c: CameraState, factor: number, ndcX = 0, ndcY = 0, aspect = 1): CameraState {
  const distance = clampDistance(c.distance * factor);
  const f = 1 - distance / c.distance;
  const h = halfHeight(c);
  const { right, up } = cameraBasis(c);
  // The point under the cursor on the plane through the target, facing the camera.
  const under = add(add(c.target, right, ndcX * h * aspect), up, ndcY * h);
  const target: V3 = [c.target[0] + (under[0] - c.target[0]) * f, c.target[1] + (under[1] - c.target[1]) * f, c.target[2] + (under[2] - c.target[2]) * f];
  return { ...c, distance, target };
}

/** The camera for a preset, keeping the target and distance. */
export function toPreset(c: CameraState, p: Preset): CameraState {
  return { ...c, ...PRESETS[p], roll: 0 };
}

/** Rolls the view a quarter turn about the line of sight: clockwise on screen when `dir` is 1, anticlockwise at −1. */
export function rollBy(c: CameraState, dir: 1 | -1): CameraState {
  // Snap to whole quarter turns, so a roll from an odd angle lands square.
  const quarter = Math.round((c.roll ?? 0) / 90) + dir;
  return { ...c, roll: (((((quarter % 4) + 4) % 4) * 90 + 180) % 360) - 180 };
}

/** A roll squared off to the nearest quarter turn, −180…90. */
export function squareRoll(roll = 0): number {
  const quarter = (((Math.round(roll / 90) % 4) + 4) % 4) * 90;
  return ((quarter + 180) % 360) - 180;
}

/**
 * The quarter turn to save with a sketch: the view's roll, squared, while the camera looks straight at the sketch's
 * plane (along its normal); null when it looks some other way.
 */
export function sketchTurn(c: CameraState, normal: V3): number | null {
  return dot(viewDir(c.azimuth, c.elevation), norm(normal)) > 0.9999 ? squareRoll(c.roll) : null;
}

/**
 * The camera looking from `dir` (towards the camera, any length) at the same target and distance: a view cube face,
 * edge or corner. Straight down or up keeps the Top view's +Y up the screen. A turned view keeps its turn, squared to
 * the nearest quarter turn, as in Fusion: upside down and nudged, a click squares it up and leaves it upside down.
 */
export function lookFrom(c: CameraState, dir: V3): CameraState {
  const [x, y, z] = norm(dir);
  const roll = squareRoll(c.roll);
  if (Math.abs(z) > 0.9999) return { ...c, ...PRESETS[z > 0 ? "top" : "bottom"], roll };
  return { ...c, azimuth: Math.atan2(y, x) / RAD, elevation: Math.asin(z) / RAD, roll };
}

/** Which preset the camera is at, if any. */
export function presetOf(c: CameraState): Preset | null {
  for (const [name, p] of Object.entries(PRESETS) as [Preset, { azimuth: number; elevation: number }][]) {
    if (Math.abs(c.elevation - p.elevation) < 0.01 && Math.abs(wrap(c.azimuth - p.azimuth)) < 0.01 && Math.abs(wrap(c.roll ?? 0)) < 0.01) return name;
  }
  return null;
}

/** A rectangle of the view in CSS px from its top left: the part no floating panel covers. */
export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The share of the clear area Fit leaves empty round the model, on each side. */
export const FIT_MARGIN = 0.06;

/**
 * Frames a set of world points (a model's corners or vertices) so they fill `rect` of a view `width` × `height` px,
 * less a small margin, as tightly as they can: the view keeps its direction and roll and only moves and zooms. When the
 * rect is under a third of the view either way (a tool's panel pushed it into a strip), it fills the whole view. The target lands in the middle of the points' depth, so turning afterwards
 * turns round the model.
 *
 * On each screen axis a point is inside the clear area while lo ≤ (u − U) / (w − W) ≤ hi, for a camera at (U, W) and a
 * point at (u, w), w into the screen: two planes through the camera. They just touch the points when the camera stands
 * at W = (B − A) / (hi − lo), with A and B the points' extremes below. The camera takes the further back of the two
 * axes and centres on the looser one. Orthographic is the same sum with every point at w = 0 and −W as the distance.
 */
export function fitPoints(c: CameraState, points: readonly V3[], width: number, height: number, rect?: ViewRect | null, margin = FIT_MARGIN): CameraState {
  if (!points.length) return c;
  const W = Math.max(width, 1);
  const H = Math.max(height, 1);
  const r = rect && rect.width >= Math.max(80, W / 3) && rect.height >= Math.max(80, H / 3) ? rect : { left: 0, top: 0, width: W, height: H };
  const { right, up, back } = cameraBasis(c);
  const tanH = Math.tan((FOV / 2) * RAD);
  let wMin = Infinity;
  let wMax = -Infinity;
  const depth = points.map((p) => {
    const w = -dot(p, back);
    wMin = Math.min(wMin, w);
    wMax = Math.max(wMax, w);
    return c.ortho ? 0 : w;
  });
  const wMid = (wMin + wMax) / 2;
  // The clear area less the margin, as slopes from the line of sight: right / up per mm into the screen.
  const axis = (dir: V3, lo: number, hi: number) => {
    let A = -Infinity;
    let B = Infinity;
    points.forEach((p, i) => {
      A = Math.max(A, dot(p, dir) - hi * depth[i]!);
      B = Math.min(B, dot(p, dir) - lo * depth[i]!);
    });
    return { A, B, lo, hi, W: (B - A) / (hi - lo) };
  };
  const s = (2 * tanH) / H;
  const mx = r.width * margin;
  const my = r.height * margin;
  const x = axis(right, (r.left + mx - W / 2) * s, (r.left + r.width - mx - W / 2) * s);
  const y = axis(up, (H / 2 - r.top - r.height + my) * s, (H / 2 - r.top - my) * s);
  const Wc = Math.min(x.W, y.W);
  const mid = (a: typeof x) => (a.A + a.B + (a.hi + a.lo) * Wc) / 2;
  const distance = clampDistance(c.ortho ? -Wc : wMid - Wc);
  const eye = add(add(right.map((k) => k * mid(x)) as V3, up, mid(y)), back, distance - wMid);
  return { ...c, target: add(eye, back, -distance), distance };
}

/** The eight corners of a box. */
export function boxCorners(min: V3, max: V3): V3[] {
  const out: V3[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z]);
  return out;
}

/** Eases from a to b; t from 0 to 1. Azimuth takes the short way round. */
export function lerpCamera(a: CameraState, b: CameraState, t: number): CameraState {
  const s = t * t * (3 - 2 * t);
  const mix = (x: number, y: number) => x + (y - x) * s;
  return {
    target: [mix(a.target[0], b.target[0]), mix(a.target[1], b.target[1]), mix(a.target[2], b.target[2])],
    azimuth: wrap(a.azimuth + wrap(b.azimuth - a.azimuth) * s),
    elevation: mix(a.elevation, b.elevation),
    roll: wrap((a.roll ?? 0) + wrap((b.roll ?? 0) - (a.roll ?? 0)) * s),
    // Distances tween in log space, so a long zoom feels even.
    distance: Math.exp(mix(Math.log(a.distance), Math.log(b.distance))),
    ortho: t < 1 ? a.ortho : b.ortho,
  };
}

/** The adaptive grid's minor step: 1, 10, 100… mm, so roughly 10–100 minor lines span the view. */
export function gridStep(viewHeightMm: number): number {
  const raw = viewHeightMm / 10;
  return Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1)))));
}

/** Rounds to the nearest multiple of `step` (Shift on the gizmo: 5 mm, 15°). */
export function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
