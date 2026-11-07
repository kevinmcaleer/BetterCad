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

/** The camera's position, and its right / up / back axes in world space. */
export function cameraBasis(c: CameraState) {
  const back = viewDir(c.azimuth, c.elevation);
  const up = viewUp(c.azimuth, c.elevation);
  const right = cross(up, back);
  return { position: add(c.target, back, c.distance), right, up, back };
}

/** World → camera rotation, row-major 3×3 (rows: right, up, back). The view cube turns by this. */
export function viewRotation(c: Pick<CameraState, "azimuth" | "elevation">): number[] {
  const back = viewDir(c.azimuth, c.elevation);
  const up = viewUp(c.azimuth, c.elevation);
  const right = cross(up, back);
  return [...right, ...up, ...back];
}

/** Half the height of world the view shows at the target, in mm. */
export const halfHeight = (c: Pick<CameraState, "distance">) => c.distance * Math.tan((FOV / 2) * RAD);

const clampDistance = (d: number) => Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, d));
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Turntable orbit: dx, dy in degrees. Elevation stops at straight up and straight down. */
export function orbit(c: CameraState, dAzimuth: number, dElevation: number): CameraState {
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
  return { ...c, ...PRESETS[p] };
}

/**
 * The camera looking from `dir` (towards the camera, any length) at the same target and distance: a view cube face,
 * edge or corner. Straight down or up keeps the Top view's +Y up the screen.
 */
export function lookFrom(c: CameraState, dir: V3): CameraState {
  const [x, y, z] = norm(dir);
  if (Math.abs(z) > 0.9999) return { ...c, ...PRESETS[z > 0 ? "top" : "bottom"] };
  return { ...c, azimuth: Math.atan2(y, x) / RAD, elevation: Math.asin(z) / RAD };
}

/** Which preset the camera is at, if any. */
export function presetOf(c: CameraState): Preset | null {
  for (const [name, p] of Object.entries(PRESETS) as [Preset, { azimuth: number; elevation: number }][]) {
    if (Math.abs(c.elevation - p.elevation) < 0.01 && Math.abs(wrap(c.azimuth - p.azimuth)) < 0.01) return name;
  }
  return null;
}

/** Frames a sphere (centre, radius) so it fills most of a view `aspect` wide. */
export function fit(c: CameraState, centre: V3, radius: number, aspect = 1): CameraState {
  const r = Math.max(radius, 1);
  const half = (FOV / 2) * RAD;
  // Fit the narrower of the two directions, with a margin.
  const vertical = r / Math.sin(half);
  const horizontal = r / Math.sin(Math.atan(Math.tan(half) * Math.max(aspect, 0.01)));
  return { ...c, target: centre, distance: clampDistance(Math.max(vertical, horizontal) * 1.15) };
}

/** A rectangle of the view in CSS px from its top left: the part no floating panel covers. */
export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Frames a sphere inside `rect` of a view `width` × `height` px: sized to the rect and centred on it, so nothing
 * lands under the panels that float over the view. Without a usable rect it frames the whole view.
 */
export function fitInRect(c: CameraState, centre: V3, radius: number, width: number, height: number, rect?: ViewRect | null): CameraState {
  const aspect = width / Math.max(height, 1);
  if (!rect || rect.width < 80 || rect.height < 80) return fit(c, centre, radius, aspect);
  const scale = Math.min(Math.max(width / rect.width, height / rect.height, 1), 4);
  const f = fit(c, centre, radius * scale, aspect);
  return pan(f, rect.left + rect.width / 2 - width / 2, rect.top + rect.height / 2 - height / 2, height);
}

/** Eases from a to b; t from 0 to 1. Azimuth takes the short way round. */
export function lerpCamera(a: CameraState, b: CameraState, t: number): CameraState {
  const s = t * t * (3 - 2 * t);
  const mix = (x: number, y: number) => x + (y - x) * s;
  return {
    target: [mix(a.target[0], b.target[0]), mix(a.target[1], b.target[1]), mix(a.target[2], b.target[2])],
    azimuth: wrap(a.azimuth + wrap(b.azimuth - a.azimuth) * s),
    elevation: mix(a.elevation, b.elevation),
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
