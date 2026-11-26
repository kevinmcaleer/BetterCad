/**
 * Video render: a camera move path-traced frame by frame and encoded with the browser's WebCodecs, then put in an MP4
 * (or a WebM where the browser can't make MP4). Slow, as each frame clears like a picture does, but it looks like the
 * Render view's pictures rather than the quick preview. Loads only when a video render starts.
 */
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import { FPS } from "./video";

interface Codec {
  config: VideoEncoderConfig;
  mux: "avc" | "vp9" | "V_VP9" | "V_VP8";
}

/** The codecs to try for each file, best first. */
function codecs(ext: "mp4" | "webm", width: number, height: number): Codec[] {
  const base = { width, height, bitrate: 12_000_000, framerate: FPS };
  return ext === "mp4"
    ? [
        { config: { ...base, codec: "avc1.640028", avc: { format: "avc" } } as VideoEncoderConfig, mux: "avc" },
        { config: { ...base, codec: "avc1.42E028", avc: { format: "avc" } } as VideoEncoderConfig, mux: "avc" },
        { config: { ...base, codec: "vp09.00.40.08" }, mux: "vp9" },
      ]
    : [
        { config: { ...base, codec: "vp09.00.40.08" }, mux: "V_VP9" },
        { config: { ...base, codec: "vp8" }, mux: "V_VP8" },
      ];
}

export interface FrameSource {
  /** Draws frame `i` of `count` on `canvas`, path-traced, and settles when it is done. */
  frame(i: number, count: number): Promise<void>;
  canvas: HTMLCanvasElement;
}

/**
 * Encodes `count` frames from `source` into a video of `ext`. `progress` hears each finished frame; `signal` stops it
 * early, and the promise then rejects.
 */
export async function encodeFrames(
  source: FrameSource,
  count: number,
  ext: "mp4" | "webm",
  progress?: (done: number, count: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const { width, height } = source.canvas;
  let codec: Codec | null = null;
  for (const c of codecs(ext, width, height)) {
    const ok = await VideoEncoder.isConfigSupported(c.config).catch(() => null);
    if (ok?.supported) {
      codec = c;
      break;
    }
  }
  if (!codec) throw new Error("This browser can't encode video");
  const mp4 =
    ext === "mp4"
      ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: codec.mux as "avc" | "vp9", width, height, frameRate: FPS }, fastStart: "in-memory" })
      : null;
  const webm =
    ext === "webm" ? new WebmMuxer({ target: new WebmTarget(), video: { codec: codec.mux as "V_VP9" | "V_VP8", width, height, frameRate: FPS } }) : null;
  let failed: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => (mp4 ? mp4.addVideoChunk(chunk, meta) : webm!.addVideoChunk(chunk, meta)),
    error: (e) => (failed = e),
  });
  encoder.configure(codec.config);
  try {
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw new Error("Stopped");
      if (failed) throw failed;
      await source.frame(i, count);
      const frame = new VideoFrame(source.canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      // Don't let the encoder fall far behind the frames.
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
      progress?.(i + 1, count);
    }
    await encoder.flush();
    if (failed) throw failed;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  if (mp4) {
    mp4.finalize();
    return new Blob([mp4.target.buffer], { type: "video/mp4" });
  }
  webm!.finalize();
  return new Blob([webm!.target.buffer], { type: "video/webm" });
}
