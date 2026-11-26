/** Recording a canvas to a video with the browser's MediaRecorder: Draw on and the camera moves both save this way. */

/** The video formats to try, best first: MP4 where the browser records it, else WebM. */
const VIDEO_TYPES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
/** With a transparent background: WebM first, since VP9 and VP8 keep the see-through parts and MP4 (H.264) can't. */
const SEE_THROUGH_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", ...VIDEO_TYPES];
const canRecord = (t: string) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t);
export function videoType(seeThrough = false, supported: (t: string) => boolean = canRecord): string | null {
  return (seeThrough ? SEE_THROUGH_TYPES : VIDEO_TYPES).find(supported) ?? null;
}

/**
 * Records `canvas` while `run` plays, then a moment more on the last frame. Resolves with the video, or null if the
 * browser can't record (no MediaRecorder or no format it knows) or `signal` stopped it early.
 */
export async function recordCanvas(
  canvas: HTMLCanvasElement,
  run: () => Promise<void>,
  signal?: AbortSignal,
  seeThrough = false,
): Promise<{ blob: Blob; type: string } | null> {
  const type = videoType(seeThrough);
  if (!type || !("captureStream" in canvas)) return null;
  const stream = canvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((done) => (rec.onstop = () => done()));
  rec.start(250);
  try {
    await run();
    if (!signal?.aborted) await new Promise((r) => setTimeout(r, 200));
  } finally {
    rec.stop();
    await stopped;
    for (const t of stream.getTracks()) t.stop();
  }
  if (signal?.aborted) return null;
  const plain = type.split(";")[0];
  return { blob: new Blob(chunks, { type: plain }), type: plain };
}

/** The file a video render makes, decided at the click (the save dialog opens then): MP4 where the browser makes it. */
export function videoExt(): "mp4" | "webm" {
  return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/mp4") ? "mp4" : "webm";
}

/** Whether this browser can encode video frame by frame (WebCodecs), for a video render. */
export const canRenderVideo = () => typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";

/** A video render is full HD, at 30 frames a second. */
export const FPS = 30;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
/** Frames in a clip of `seconds`, at least two so the move has a start and an end. Tests cap it. */
export const frameCount = (seconds: number) => (window as unknown as { __bcVideoFrames?: number }).__bcVideoFrames ?? Math.max(2, Math.round(seconds * FPS));
