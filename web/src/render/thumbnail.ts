/**
 * A saved model's thumbnail from the path tracer: a few samples in Studio light, framed from the default view. It
 * loads with the renderer, apart from the shell, and runs after a save has gone, so saving never waits for it.
 */
import { Box3, Vector3 } from "three";
import { PathRender, type RenderBody } from "./pathRender";
import { DEFAULT_CAMERA, fit } from "../viewport/camera";

export const THUMB_SAMPLES = 10;
/** Past this the browser is too slow to render well, and the shaded thumbnail stays. */
const GIVE_UP_MS = 20_000;

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  samples?: number;
  timeout?: number;
}

/** The bodies' bounds in BetterCad's own Z-up space. */
function bounds(bodies: RenderBody[]): Box3 {
  const box = new Box3();
  const v = new Vector3();
  for (const b of bodies) {
    const p = b.mesh.positions;
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(v.set(p[i]!, p[i + 1]!, p[i + 2]!).applyMatrix4(b.matrix));
  }
  return box;
}

/**
 * A JPEG data URL of the bodies, or null when there is nothing to draw, the browser has no WebGL2, or it takes too
 * long. Each call makes its own WebGL context and gives it back.
 */
export async function renderThumbnail(bodies: RenderBody[], o: ThumbnailOptions = {}): Promise<string | null> {
  const { width = 320, height = 200, samples = THUMB_SAMPLES, timeout = GIVE_UP_MS } = o;
  const box = bounds(bodies);
  if (box.isEmpty()) return null;
  const canvas = document.createElement("canvas");
  let pr: PathRender;
  try {
    pr = new PathRender(canvas);
  } catch {
    return null;
  }
  const until = performance.now() + timeout;
  try {
    pr.maxSamples = samples;
    pr.setBodies(bodies);
    pr.setPreset("studio");
    pr.setStyle("finishes");
    const c = box.getCenter(new Vector3());
    const r = Math.max(box.getSize(new Vector3()).length() / 2, 5);
    pr.setCamera(fit(DEFAULT_CAMERA, [c.x, c.y, c.z], r, width / height));
    // Rendered at twice the size and shrunk: each pixel averages four, which takes the grain out of a few samples.
    const png = await pr.snapshot(width * 2, height * 2, samples, () => {
      if (performance.now() > until) throw new Error("Too slow");
    });
    return await jpeg(png, width, height);
  } catch {
    return null;
  } finally {
    pr.dispose();
    pr.renderer.forceContextLoss();
  }
}

/** Shrinks the render to the thumbnail's size, as a JPEG: a tenth the size of a PNG and the same to look at. */
async function jpeg(png: Blob, width: number, height: number): Promise<string> {
  const img = await createImageBitmap(png);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  img.close();
  return c.toDataURL("image/jpeg", 0.85);
}
