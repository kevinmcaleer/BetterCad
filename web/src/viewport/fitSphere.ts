import { FOV, clampDistance, type CameraState, type V3 } from "./camera";

const RAD = Math.PI / 180;

/**
 * Frames a sphere (centre, radius) so it fills most of a view `aspect` wide. Kept out of camera.ts, off the first-paint
 * bundle: only the Render view and build-step pictures use it.
 */
export function fit(c: CameraState, centre: V3, radius: number, aspect = 1): CameraState {
  const r = Math.max(radius, 1);
  const half = (FOV / 2) * RAD;
  // Fit the narrower of the two directions, with a margin.
  const vertical = r / Math.sin(half);
  const horizontal = r / Math.sin(Math.atan(Math.tan(half) * Math.max(aspect, 0.01)));
  return { ...c, target: centre, distance: clampDistance(Math.max(vertical, horizontal) * 1.15) };
}
