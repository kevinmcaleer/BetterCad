/**
 * Video render: a camera move path-traced frame by frame and encoded with the browser's WebCodecs, then put in an MP4
 * (or a WebM where the browser can't make MP4). Slow, as each frame clears like a picture does, but it looks like the
 * Render view's pictures rather than the quick preview. Loads only when a video render starts.
 */
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import { FPS } from "./video";
import { alphaPlanes, muxWebmAlpha, type AlphaFrame } from "./webmAlpha";

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
  seeThrough = false,
): Promise<Blob> {
  const { width, height } = source.canvas;
  if (seeThrough && ext === "webm") {
    const vp9 = codecs("webm", width, height)[0].config;
    if ((await VideoEncoder.isConfigSupported(vp9).catch(() => null))?.supported) return encodeSeeThrough(source, count, vp9, progress, signal);
  }
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

/**
 * As encodeFrames, keeping the transparent background see-through: the picture and its alpha go through two VP9
 * encoders, frame for frame, and into a WebM that carries the alpha beside each picture (see `webmAlpha.ts`).
 */
async function encodeSeeThrough(
  source: FrameSource,
  count: number,
  config: VideoEncoderConfig,
  progress?: (done: number, count: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const { width, height } = source.canvas;
  const pictures: EncodedVideoChunk[] = [];
  const alphas: EncodedVideoChunk[] = [];
  let failed: unknown = null;
  const make = (into: EncodedVideoChunk[], bitrate: number) => {
    const e = new VideoEncoder({ output: (chunk) => into.push(chunk), error: (err) => (failed = err) });
    e.configure({ ...config, bitrate });
    return e;
  };
  const picture = make(pictures, config.bitrate ?? 12_000_000);
  const alpha = make(alphas, 4_000_000);
  // Reads the frame back to find its alpha.
  const grab = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })!;
  try {
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw new Error("Stopped");
      if (failed) throw failed;
      await source.frame(i, count);
      const timestamp = Math.round((i * 1e6) / FPS);
      const duration = Math.round(1e6 / FPS);
      const keyFrame = i % (FPS * 2) === 0;
      const frame = new VideoFrame(source.canvas, { timestamp, duration });
      grab.clearRect(0, 0, width, height);
      grab.drawImage(frame, 0, 0);
      picture.encode(frame, { keyFrame });
      frame.close();
      const planes = alphaPlanes(grab.getImageData(0, 0, width, height).data, width, height);
      const a = new VideoFrame(planes, { format: "I420", codedWidth: width, codedHeight: height, timestamp, duration });
      alpha.encode(a, { keyFrame });
      a.close();
      while (picture.encodeQueueSize > 4 || alpha.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
      progress?.(i + 1, count);
    }
    await Promise.all([picture.flush(), alpha.flush()]);
    if (failed) throw failed;
  } finally {
    for (const e of [picture, alpha]) if (e.state !== "closed") e.close();
  }
  const bytes = (c: EncodedVideoChunk) => {
    const b = new Uint8Array(c.byteLength);
    c.copyTo(b);
    return b;
  };
  const frames: AlphaFrame[] = pictures.map((p, i) => ({
    data: bytes(p),
    alpha: alphas[i] ? bytes(alphas[i]) : new Uint8Array(),
    key: p.type === "key",
    timestamp: p.timestamp,
  }));
  return muxWebmAlpha(frames, width, height, FPS);
}
