/**
 * A WebM with a see-through background, for a video render on the Transparent background. Browsers' video encoders
 * can't keep alpha, so the picture and its alpha are encoded as two VP9 streams, as WebM carries them: the alpha
 * stream rides in each frame's BlockAdditional (BlockAddID 1), with the track's AlphaMode set. Chrome, Firefox and
 * ffmpeg play it see-through; anything else shows the picture on black.
 */

/** One frame: the picture's VP9 data, its alpha's VP9 data, whether both are key frames, and its time in µs. */
export interface AlphaFrame {
  data: Uint8Array;
  alpha: Uint8Array;
  key: boolean;
  timestamp: number;
}

type Part = Uint8Array | Part[];

/** An EBML element ID's bytes (the IDs below already carry their length marker). */
function id(n: number): Uint8Array {
  const out: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return Uint8Array.from(out);
}

/** An EBML size, in 8 bytes so it never needs working out twice. */
function size(n: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7, v = n; i >= 1; i--, v = Math.floor(v / 256)) out[i] = v & 0xff;
  return out;
}

const length = (p: Part): number => (!Array.isArray(p) ? p.length : p.reduce((s, x) => s + length(x), 0));
const element = (tag: number, ...body: Part[]): Part => [id(tag), size(length(body)), body];

function uint(tag: number, v: number): Part {
  const bytes: number[] = [];
  for (let x = v; bytes.length === 0 || x > 0; x = Math.floor(x / 256)) bytes.unshift(x & 0xff);
  return element(tag, Uint8Array.from(bytes));
}
function float(tag: number, v: number): Part {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return element(tag, b);
}
const text = (tag: number, s: string): Part => element(tag, new TextEncoder().encode(s));

/** A Block's header: track 1, the time from the cluster's start in ms, no flags. */
function blockHeader(relative: number): Uint8Array {
  const b = new Uint8Array(4);
  const v = new DataView(b.buffer);
  v.setUint8(0, 0x81);
  v.setInt16(1, relative);
  return b;
}

function flatten(p: Part, out: Uint8Array, at: number): number {
  if (!Array.isArray(p)) {
    out.set(p, at);
    return at + p.length;
  }
  for (const x of p) at = flatten(x, out, at);
  return at;
}

/** Puts the frames in a WebM file, one cluster per key frame. */
export function muxWebmAlpha(frames: readonly AlphaFrame[], width: number, height: number, fps: number): Blob {
  return new Blob([webmAlphaBytes(frames, width, height, fps)], { type: "video/webm" });
}

/** The file's bytes, as muxWebmAlpha puts them in a Blob. */
export function webmAlphaBytes(frames: readonly AlphaFrame[], width: number, height: number, fps: number): Uint8Array<ArrayBuffer> {
  const ms = (us: number) => Math.round(us / 1000);
  const clusters: Part[][] = [];
  let cluster: Part[] | null = null;
  let start = 0;
  let last = 0;
  for (const f of frames) {
    const t = ms(f.timestamp);
    // A new cluster at each key frame, and before a frame's offset could overflow the Block's 16 bits.
    if (!cluster || f.key || t - start > 30_000) {
      cluster = [uint(0xe7, t)];
      clusters.push(cluster);
      start = t;
    }
    cluster.push(
      element(
        0xa0,
        element(0xa1, blockHeader(t - start), f.data),
        element(0x75a1, element(0xa6, uint(0xee, 1), element(0xa5, f.alpha))),
        // Not a key frame: it refers back to the frame before.
        ...(f.key ? [] : [element(0xfb, signed(last - t))]),
      ),
    );
    last = t;
  }
  const duration = frames.length ? ms(frames[frames.length - 1].timestamp) + 1000 / fps : 0;
  const file: Part = [
    element(0x1a45dfa3, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), text(0x4282, "webm"), uint(0x4287, 4), uint(0x4285, 2)),
    element(
      0x18538067,
      element(0x1549a966, uint(0x2ad7b1, 1_000_000), text(0x4d80, "BetterCad"), text(0x5741, "BetterCad"), float(0x4489, duration)),
      element(
        0x1654ae6b,
        element(
          0xae,
          uint(0xd7, 1),
          uint(0x73c5, 1),
          uint(0x83, 1),
          text(0x86, "V_VP9"),
          uint(0x23e383, Math.round(1e9 / fps)),
          element(0xe0, uint(0xb0, width), uint(0xba, height), uint(0x53c0, 1)),
        ),
      ),
      ...clusters.map((c) => element(0x1f43b675, ...c)),
    ),
  ];
  const out = new Uint8Array(length(file));
  flatten(file, out, 0);
  return out;
}

/** A signed EBML integer (ReferenceBlock), in two bytes. */
function signed(v: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setInt16(0, v);
  return b;
}

/**
 * The alpha of an RGBA picture as a grey I420 frame: luma is the alpha, chroma is neutral, so the encoder codes the
 * alpha exactly as WebM wants it (no colour conversion to squeeze 0 to 255 into 16 to 235).
 */
export function alphaPlanes(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const cw = Math.ceil(width / 2),
    ch = Math.ceil(height / 2);
  const out = new Uint8Array(width * height + 2 * cw * ch);
  for (let i = 0, n = width * height; i < n; i++) out[i] = rgba[i * 4 + 3];
  out.fill(128, width * height);
  return out;
}
