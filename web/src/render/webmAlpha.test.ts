import { alphaPlanes, muxWebmAlpha, webmAlphaBytes } from "./webmAlpha";

const has = (hay: Uint8Array, needle: number[]) => hay.some((_, i) => needle.every((b, k) => hay[i + k] === b));

describe("see-through WebM", () => {
  it("makes the alpha a grey frame: luma is the alpha, chroma neutral", () => {
    const rgba = new Uint8ClampedArray([9, 9, 9, 0, 9, 9, 9, 128, 9, 9, 9, 255, 9, 9, 9, 64]);
    const planes = alphaPlanes(rgba, 2, 2);
    expect(Array.from(planes)).toEqual([0, 128, 255, 64, 128, 128]);
  });

  it("marks the track as having alpha and carries each frame's alpha beside it", () => {
    const frames = [0, 1, 2].map((i) => ({
      data: Uint8Array.from([0xd0 + i]),
      alpha: Uint8Array.from([0xe0 + i]),
      key: i === 0,
      timestamp: Math.round((i * 1e6) / 30),
    }));
    expect(muxWebmAlpha(frames, 320, 240, 30).type).toBe("video/webm");
    const bytes = webmAlphaBytes(frames, 320, 240, 30);
    // The EBML header, then "webm".
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(has(bytes, [...new TextEncoder().encode("webm")])).toBe(true);
    // AlphaMode 1.
    expect(has(bytes, [0x53, 0xc0, 0x01, 0, 0, 0, 0, 0, 0, 0x01, 0x01])).toBe(true);
    for (const f of frames) {
      // BlockAdditional holding this frame's alpha.
      expect(has(bytes, [0xa5, 0x01, 0, 0, 0, 0, 0, 0, 0x01, f.alpha[0]])).toBe(true);
    }
    // The two frames after the key frame refer back.
    expect(bytes.filter((_, i) => bytes[i] === 0xfb && bytes[i + 1] === 0x01).length).toBeGreaterThanOrEqual(2);
  });
});
