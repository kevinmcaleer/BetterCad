/** Recording a canvas to a video with the browser's MediaRecorder: Draw on and the camera moves both save this way. */

/** The video formats to try, best first: MP4 where the browser records it, else WebM. */
const VIDEO_TYPES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
export function videoType(supported: (t: string) => boolean = (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)): string | null {
  return VIDEO_TYPES.find(supported) ?? null;
}

/**
 * Records `canvas` while `run` plays, then a moment more on the last frame. Resolves with the video, or null if the
 * browser can't record (no MediaRecorder or no format it knows) or `signal` stopped it early.
 */
export async function recordCanvas(canvas: HTMLCanvasElement, run: () => Promise<void>, signal?: AbortSignal): Promise<{ blob: Blob; type: string } | null> {
  const type = videoType();
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
