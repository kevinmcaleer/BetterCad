import { FOV, clampDistance, pan, type CameraState, type V3, type ViewRect } from "./camera";

const RAD = Math.PI / 180;

/**
 * Frames a sphere (centre, radius) so it fills most of a view `aspect` wide. The Render view and build-step pictures frame
 * this way; the editor's view uses it only for a new model's first part (fitPoints frames tighter).
 */
export function fit(c: CameraState, centre: V3, radius: number, aspect = 1): CameraState {
  const r = Math.max(radius, 1);
  const half = (FOV / 2) * RAD;
  // Fit the narrower of the two directions, with a margin.
  const vertical = r / Math.sin(half);
  const horizontal = r / Math.sin(Math.atan(Math.tan(half) * Math.max(aspect, 0.01)));
  return { ...c, target: centre, distance: clampDistance(Math.max(vertical, horizontal) * 1.15) };
}

/**
 * Frames a sphere inside `rect` of a view `width` × `height` px, loosely: sized up by how much smaller the rect is than
 * the view and centred on it. A new model's first part arrives this way, with room round it for what comes next.
 */
export function fitInRect(c: CameraState, centre: V3, radius: number, width: number, height: number, rect?: ViewRect | null): CameraState {
  const aspect = width / Math.max(height, 1);
  if (!rect || rect.width < 80 || rect.height < 80) return fit(c, centre, radius, aspect);
  const scale = Math.min(Math.max(width / rect.width, height / rect.height, 1), 4);
  const f = fit(c, centre, radius * scale, aspect);
  return pan(f, rect.left + rect.width / 2 - width / 2, rect.top + rect.height / 2 - height / 2, height);
}
