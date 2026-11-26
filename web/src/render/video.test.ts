import { videoType } from "./video";

describe("video format", () => {
  const chrome = (t: string) => t.startsWith("video/webm") || t.startsWith("video/mp4");
  it("prefers MP4, which plays everywhere", () => {
    expect(videoType(false, chrome)).toBe("video/mp4;codecs=avc1");
  });
  it("records WebM for a see-through background, since MP4 can't keep it see-through", () => {
    expect(videoType(true, chrome)).toBe("video/webm;codecs=vp9");
  });
  it("falls back to MP4 when the browser records nothing else", () => {
    expect(videoType(true, (t) => t.startsWith("video/mp4"))).toBe("video/mp4;codecs=avc1");
    expect(videoType(true, () => false)).toBeNull();
  });
});
